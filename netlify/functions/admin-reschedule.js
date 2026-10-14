// Reprogramar una mezcla o un master vencido, desde el Inicio del panel.
//   GET  ?task=<id>&kind=sesion|entrega&dur=<min>
//        -> huecos libres de los próximos 14 días (según Google Calendar y la
//           rutina fija de Zeche) para elegir cuándo.
//   POST { task, kind, date: "AAAA-MM-DD", time: "HH:MM", dur }
//        -> mueve todo junto:
//           · sesión: Notion (Tareas → Fecha de Vencimiento) y su evento en
//             Google Calendar (si no existe, lo crea). Si la fecha de entrega
//             de la canción quedaba antes, la corre a ese día (Notion y el
//             evento "Entrega:" del calendario).
//           · entrega: Notion (Canciones → Fecha de entrega) y el evento
//             "Entrega:" de todo el día (si no existe, lo crea).
// Sin Google conectado, igual reprograma en Notion (sin huecos sugeridos).
const { json } = require("./_lib/pass");
const gc = require("./_lib/gcal");
const { _notion: notion, _isAdmin: isAdmin, _dayAR: dayAR } = require("./admin-tasks");

const TZ = "America/Argentina/Buenos_Aires";
const OFF = "-03:00"; // Argentina no tiene horario de verano
const DAYS = 14, STEP = 30;
const DAY_START = 9 * 60 + 30, DAY_END = 21 * 60;
// Rutina fija (por día de la semana, 0 = domingo): almuerzo todos los días,
// gimnasio lunes/miércoles/viernes, sesión con Layla Mar los jueves.
const FIXED = (wd) => [[13 * 60, 15 * 60], ...([1, 3, 5].includes(wd) ? [[11 * 60, 13 * 60]] : []), ...(wd === 4 ? [[11 * 60, 13 * 60]] : [])];
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const at = (date, min) => `${date}T${hhmm(min)}:00${OFF}`;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const titleOf = (page) => { const t = Object.values((page && page.properties) || {}).find((x) => x && x.type === "title"); return t ? plain(t.title) : ""; };
const rel = (p, name) => ((p[name] && p[name].relation) || []).map((r) => r.id);
const fmtDay = (date) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00${OFF}`)).replace(",", "").replace(/\./g, "");

// Huecos libres por día, de a 30 minutos, donde entra la duración pedida.
function freeSlots(busyList, dur, now = new Date()) {
  const today = dayAR(now);
  const nowMin = (() => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":"); return +p[0] * 60 + +p[1]; })();
  const out = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    if (wd === 0) continue; // domingo libre
    const dayStartMs = Date.parse(at(date, 0));
    const blocks = [...FIXED(wd)];
    for (const b of busyList || []) {
      const s = Math.round((b.start - dayStartMs) / 60000), e = Math.round((b.end - dayStartMs) / 60000);
      if (e > 0 && s < 24 * 60) blocks.push([Math.max(0, s), Math.min(24 * 60, e)]);
    }
    let from = DAY_START;
    if (i === 0) from = Math.max(from, Math.ceil((nowMin + 15) / STEP) * STEP);
    const clash = (s, e) => blocks.some(([bs, be]) => s < be && e > bs);
    const slots = [];
    for (let s = from; s + dur <= DAY_END; s += STEP) if (!clash(s, s + dur)) slots.push(hhmm(s));
    let freeMin = 0;
    for (let m = Math.max(DAY_START, from); m < DAY_END; m += STEP) if (!clash(m, m + STEP)) freeMin += STEP;
    out.push({ date, label: fmtDay(date), today: i === 0, slots, freeMin });
  }
  return out;
}

async function loadTask(id, kind) {
  const page = await notion(`/pages/${id}`);
  if (!page.ok) return null;
  const p = page.data.properties || {};
  if (kind === "entrega") {
    const etapa = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
    const artistId = rel(p, "Artista")[0];
    const artist = artistId ? titleOf((await notion(`/pages/${artistId}`)).data) : "";
    return { kind, id, song: titleOf(page.data), songId: id, artist, stage: etapa === "Master" ? "Master" : "Mezcla", date: p["Fecha de entrega"] && p["Fecha de entrega"].date };
  }
  const etapa = p.Etapa && p.Etapa.select && p.Etapa.select.name;
  const name = plain(p.Nombre && p.Nombre.title);
  const [songId] = rel(p, "Canción"), [clientId] = rel(p, "Cliente");
  const [songPage, clientPage] = await Promise.all([songId ? notion(`/pages/${songId}`) : null, clientId ? notion(`/pages/${clientId}`) : null]);
  const artist = clientPage && clientPage.ok ? titleOf(clientPage.data) : "";
  let song = songPage && songPage.ok ? titleOf(songPage.data) : "";
  if (!song) song = name.replace(/^(mix|mezcla|master|mastering)\s+/i, "").replace(new RegExp(`\\s*${artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
  const isMaster = etapa === "Master" || /^master/i.test(name);
  return { kind, id, name, song, songId, songPage: songPage && songPage.ok ? songPage.data : null, artist, stage: isMaster ? "Master" : "Mezcla", date: p["Fecha de Vencimiento"] && p["Fecha de Vencimiento"].date };
}

// Busca el evento del calendario que corresponde (misma canción, cerca de la fecha vieja).
async function findEvent(t, fromISO, toISO, test) {
  const list = await gc.events(fromISO, toISO);
  if (!list) return null;
  const song = norm(t.song);
  const hits = list.filter((e) => test(e) && song && norm(`${e.summary} ${e.description || ""}`).includes(song));
  return hits[0] || null;
}
const isSessionEvent = (stage) => (e) => !!(e.start && e.start.dateTime) && (stage === "Master" ? /master/i.test(e.summary || "") : /\b(mix|mezcla)/i.test(e.summary || ""));
const isDeliveryEvent = (e) => !!(e.start && e.start.date) && /^entrega/i.test(e.summary || "");
const note = (desc, text) => `${desc ? `${desc}\n\n` : ""}${text}`;

async function moveDelivery(t, oldDate, newDate) {
  // Notion
  const n = await notion(`/pages/${t.songId}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de entrega": { date: { start: newDate } } } }) });
  // Calendario: el evento "Entrega:" de todo el día
  let cal = "sin-google";
  if ((await gc.status()).connected) {
    const ref = oldDate || newDate;
    const ev = await findEvent(t, at(addDays(ref, -3), 0), at(addDays(ref, 3), 0), isDeliveryEvent);
    const body = { start: { date: newDate }, end: { date: addDays(newDate, 1) } };
    if (ev) { const r = await gc.patchEvent(ev.id, { ...body, description: note(ev.description, `↻ Movida desde el portal (antes: ${fmtDay(ev.start.date)}).`) }); cal = r.ok ? "movido" : "error"; }
    else {
      const r = await gc.createEvent({ ...body, summary: `Entrega: ${t.stage === "Master" ? "Master" : "Mix"} ${t.song}${t.artist ? ` ${t.artist}` : ""}`, colorId: "11", transparency: "transparent", description: "Agendada desde el portal de ZECHE GRUV." });
      cal = r.ok ? "creado" : "error";
    }
  }
  return { notion: n.ok, calendar: cal };
}

exports.handler = async (event) => {
  if (!(await isAdmin(event))) return json(403, { error: "Solo para el administrador." });
  const clean = (v) => String(v || "").replace(/[^0-9a-f-]/gi, "");

  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    const dur = Math.min(8 * 60, Math.max(30, Math.round((+q.dur || 120) / STEP) * STEP));
    const g = await gc.status();
    let list = null;
    if (g.connected) {
      const today = dayAR(new Date());
      list = await gc.busy(at(today, 0), at(addDays(today, DAYS), 0));
    }
    return json(200, { google: { ...g, connected: g.connected && list !== null }, dur, days: freeSlots(list, dur) });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  const id = clean(body.task), kind = body.kind === "entrega" ? "entrega" : "sesion";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : null;
  if (!id || !date || date < dayAR(new Date())) return json(400, { error: "Elegí un día de hoy en adelante." });
  const t = await loadTask(id, kind);
  if (!t) return json(404, { error: "No encontramos la tarea en Notion." });

  if (kind === "entrega") {
    const r = await moveDelivery(t, t.date && t.date.start && t.date.start.slice(0, 10), date);
    if (!r.notion) return json(502, { error: "Notion no dejó mover la fecha. Probá de nuevo." });
    return json(200, { ok: true, calendar: r.calendar, label: fmtDay(date) });
  }

  const time = /^\d{2}:\d{2}$/.test(body.time || "") ? body.time : null;
  if (!time) return json(400, { error: "Elegí un horario." });
  const startMin = +time.slice(0, 2) * 60 + +time.slice(3);
  const dur = Math.min(8 * 60, Math.max(30, +body.dur || 120));
  const startISO = at(date, startMin), endISO = at(date, Math.min(24 * 60 - 1, startMin + dur));

  // 1) Notion
  const n = await notion(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de Vencimiento": { date: { start: startISO, end: endISO } } } }) });
  if (!n.ok) return json(502, { error: "Notion no dejó reprogramarla. Probá de nuevo." });

  // 2) Google Calendar: mover el evento de la sesión (o crearlo)
  let calendar = "sin-google";
  if ((await gc.status()).connected) {
    const old = t.date && t.date.start;
    const ref = old ? dayAR(new Date(/T/.test(old) ? old : `${old}T12:00:00${OFF}`)) : date;
    const ev = await findEvent(t, at(addDays(ref, -2), 0), at(addDays(ref, 3), 0), isSessionEvent(t.stage));
    const when = { start: { dateTime: startISO, timeZone: TZ }, end: { dateTime: endISO, timeZone: TZ } };
    if (ev) {
      const before = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.start.dateTime));
      const r = await gc.patchEvent(ev.id, { ...when, description: note(ev.description, `↻ Reprogramada desde el portal (antes: ${before}).`) });
      calendar = r.ok ? "movido" : "error";
    } else {
      const r = await gc.createEvent({ ...when, summary: `${t.stage === "Master" ? "Master" : "Mix"} – ${t.song || t.name}${t.artist ? ` (${t.artist})` : ""}`, colorId: "5", description: "Agendada desde el portal de ZECHE GRUV." });
      calendar = r.ok ? "creado" : "error";
    }
  }

  // 3) Si la entrega de la canción quedaba antes de la nueva sesión, se corre a ese día.
  let delivery = null;
  const sp = t.songPage && t.songPage.properties;
  const fe = sp && sp["Fecha de entrega"] && sp["Fecha de entrega"].date;
  if (t.songId && fe && fe.start && fe.start.slice(0, 10) < date) {
    const r = await moveDelivery({ ...t, kind: "entrega" }, fe.start.slice(0, 10), date);
    delivery = r.notion ? fmtDay(date) : null;
  }
  return json(200, { ok: true, calendar, delivery, label: `${fmtDay(date)} · ${time} h` });
};

exports._freeSlots = freeSlots;
