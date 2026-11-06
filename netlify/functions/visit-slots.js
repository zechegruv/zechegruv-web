// GET  /.netlify/functions/visit-slots       → turnos libres para visitar el estudio
// POST /.netlify/functions/visit-slots       → agenda la visita elegida en el formulario
//
// Visitas: sábados y domingos de 15 a 19 h (hora de Buenos Aires), turnos de
// 1 hora, de las próximas 4 semanas. Solo se ofrecen los que están libres en
// el Google Calendar del estudio (el mismo que conecta el panel). Al reservar
// se vuelve a chequear que siga libre, así no se superponen dos visitas.
// Si el calendario no está conectado, GET responde { ok: false } y la web
// sigue funcionando como antes (se coordina por WhatsApp).
const { json } = require("./_lib/pass");
const gcal = require("./_lib/gcal");

const TZ_OFFSET = "-03:00"; // Buenos Aires, sin horario de verano
const DAYS = [6, 0];        // sábado y domingo
const HOURS = [15, 16, 17, 18]; // empiezan a esas horas, terminan a las 19
const SLOT_MIN = 60;
const WEEKS = 4;
const MIN_NOTICE_H = 12;    // no se puede reservar con menos de 12 h
const COLOR = "6";          // naranja en Google Calendar (las visitas)

const pad = (n) => String(n).padStart(2, "0");
// Fecha de hoy en Buenos Aires (YYYY-MM-DD)
const baDate = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);

function candidates(now) {
  const out = [];
  const today = baDate(now);
  const base = Date.parse(`${today}T00:00:00${TZ_OFFSET}`);
  for (let d = 0; d < WEEKS * 7 + 1; d++) {
    const dayMs = base + d * 86400e3;
    const iso = baDate(dayMs + 12 * 3600e3);
    const wd = new Date(`${iso}T12:00:00${TZ_OFFSET}`).getUTCDay();
    if (!DAYS.includes(wd)) continue;
    for (const h of HOURS) {
      const start = Date.parse(`${iso}T${pad(h)}:00:00${TZ_OFFSET}`);
      if (start - now < MIN_NOTICE_H * 3600e3) continue;
      out.push({ date: iso, hour: h, start, end: start + SLOT_MIN * 60e3 });
    }
  }
  return out;
}
const overlaps = (s, busy) => busy.some((b) => b.start < s.end && b.end > s.start);

exports.handler = async (event) => {
  const st = await gcal.status().catch(() => ({ connected: false }));
  if (!st.connected) return json(200, { ok: false, reason: "calendar" });
  const now = Date.now();

  if (event.httpMethod === "GET") {
    const all = candidates(now);
    if (!all.length) return json(200, { ok: true, days: [] });
    const busy = await gcal.busy(new Date(all[0].start).toISOString(), new Date(all[all.length - 1].end).toISOString());
    if (!busy) return json(200, { ok: false, reason: "calendar" });
    const days = [];
    for (const s of all) {
      if (overlaps(s, busy)) continue;
      let day = days.find((d) => d.date === s.date);
      if (!day) { day = { date: s.date, hours: [] }; days.push(day); }
      day.hours.push(s.hour);
    }
    return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }, body: JSON.stringify({ ok: true, days }) };
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  if (body.bot) return json(200, { ok: true }); // trampa para robots
  const name = String(body.name || "").trim().slice(0, 80);
  const phone = String(body.phone || "").trim().slice(0, 30);
  if (!name || phone.replace(/\D/g, "").length < 8) return json(400, { error: "Faltan tu nombre o tu WhatsApp." });
  const slot = candidates(now).find((s) => s.date === body.date && s.hour === Number(body.hour));
  if (!slot) return json(400, { error: "Ese horario ya no está disponible. Elegí otro." });
  const busy = await gcal.busy(new Date(slot.start).toISOString(), new Date(slot.end).toISOString());
  if (!busy) return json(502, { error: "No pudimos confirmar el horario. Escribinos por WhatsApp." });
  if (overlaps(slot, busy)) return json(409, { error: "Alguien acaba de reservar ese horario. Elegí otro." });
  const lines = [
    `Visita al estudio de ${name}.`,
    `WhatsApp: ${phone}`,
    body.pack ? `Pack: ${String(body.pack).slice(0, 300)}` : "",
    body.origin ? `Nos conoció por: ${String(body.origin).slice(0, 80)}` : "",
    "Reservada desde zechegruv.com.",
  ].filter(Boolean);
  const r = await gcal.createEvent({
    summary: `Visita: ${name}`,
    description: lines.join("\n"),
    colorId: COLOR,
    start: { dateTime: new Date(slot.start).toISOString(), timeZone: "America/Argentina/Buenos_Aires" },
    end: { dateTime: new Date(slot.end).toISOString(), timeZone: "America/Argentina/Buenos_Aires" },
    extendedProperties: { private: { zgKind: "visita" } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 120 }] },
  });
  if (!r.ok) return json(502, { error: "No pudimos agendar la visita. Escribinos por WhatsApp." });
  return json(200, { ok: true, date: slot.date, hour: slot.hour });
};
