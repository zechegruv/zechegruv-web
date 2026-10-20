// Reprogramar una mezcla o un master, desde el Inicio del panel.
//   GET  ?task=<id>&kind=sesion|entrega&dur=<min>
//        -> huecos libres de los próximos 14 días (según Google Calendar y la
//           rutina fija de Zeche) para elegir cuándo.
//   POST { task, kind, date: "AAAA-MM-DD", time: "HH:MM", dur }
//        -> mueve SIEMPRE las tres cosas juntas, nunca una sola:
//           · Notion → Tareas Pendientes: la Fecha de Vencimiento de la sesión
//             de Mix/Master de esa canción (si no hay ninguna abierta, se crea).
//           · Notion → Canciones: la Fecha de entrega pasa a ese mismo día.
//           · Google Calendar: el evento de la sesión y el "Entrega:" de todo
//             el día (si no existen, se crean).
//           "task" puede ser la tarea (fila de sesión) o la canción (fila de
//           entrega): en los dos casos se reprograma la sesión y la entrega.
//           Si algo falla a mitad de camino, lo que ya se había movido vuelve
//           a su fecha anterior y se avisa. Sin Google Calendar conectado no se
//           mueve nada (para que nunca quede Notion por un lado y el
//           calendario por otro).
const { json } = require("./_lib/pass");
const gc = require("./_lib/gcal");
const { _notion: notion, _isAdmin: isAdmin, _dayAR: dayAR } = require("./admin-tasks");
const et = () => require("./_lib/auto-etapas");

const TZ = "America/Argentina/Buenos_Aires";
const OFF = "-03:00"; // Argentina no tiene horario de verano
const DAYS = 14, STEP = 30;
const DAY_START = 9 * 60 + 30, DAY_END = 21 * 60;
// Rutina fija (por día de la semana, 0 = domingo): almuerzo todos los días,
// gimnasio lunes/miércoles/viernes, sesión con Layla Mar los jueves.
const FIXED = (wd) => [[13 * 60, 15 * 60], ...([1, 3, 5].includes(wd) ? [[11 * 60, 13 * 60]] : []), ...(wd === 4 ? [[11 * 60, 13 * 60]] : [])];
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const at = (date, min) => `${date}T${hhmm(min)}:00${OFF}`;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const titleOf = (page) => { const t = Object.values((page && page.properties) || {}).find((x) => x && x.type === "title"); return t ? plain(t.title) : ""; };
const rel = (p, name) => ((p[name] && p[name].relation) || []).map((r) => r.id);
const fmtDay = (date) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00${OFF}`)).replace(",", "").replace(/\./g, "");

// Huecos libres por día, de a 30 minutos, donde entra la duración pedida.
// opts (para lo que se agenda solo, ver auto-etapas.js → AUTO):
//   fromMin  desde qué hora (minutos del día), p. ej. 15 h = 900
//   weekdays qué días (0 = domingo), p. ej. [1, 2, 3, 4, 5]
//   startDate no antes de este día (AAAA-MM-DD)
//   days     cuántos días mirar
function freeSlots(busyList, dur, now = new Date(), opts = {}) {
  const today = dayAR(now);
  const nowMin = (() => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":"); return +p[0] * 60 + +p[1]; })();
  const out = [];
  for (let i = 0; i < (opts.days || DAYS); i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    if (wd === 0) continue; // domingo libre
    if (opts.weekdays && !opts.weekdays.includes(wd)) continue;
    if (opts.startDate && date < opts.startDate) continue;
    const dayStartMs = Date.parse(at(date, 0));
    const blocks = [...FIXED(wd)];
    for (const b of busyList || []) {
      const s = Math.round((b.start - dayStartMs) / 60000), e = Math.round((b.end - dayStartMs) / 60000);
      if (e > 0 && s < 24 * 60) blocks.push([Math.max(0, s), Math.min(24 * 60, e)]);
    }
    let from = Math.max(DAY_START, opts.fromMin || 0);
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

// Busca el evento del calendario que corresponde (misma canción, cerca de la
// fecha vieja). Que sea de esa canción y etapa lo decide gcal.js →
// eventMatch (por la marca del evento o por el título con palabras
// completas): «Luna» nunca agarra «Luna Llena». Si hay uno con marca, va primero.
async function findEvent(t, fromISO, toISO, test) {
  const list = await gc.events(fromISO, toISO);
  if (!list) return null;
  const song = { id: t.songId, title: t.song, artist: t.artist };
  const hits = list.map((e) => ({ e, how: test(e) ? gc.eventMatch(e, song, t.stage) : null })).filter((x) => x.how);
  hits.sort((a, b) => (a.how === "marca" ? 0 : 1) - (b.how === "marca" ? 0 : 1));
  return hits[0] ? hits[0].e : null;
}
// Sesión con horario (las tildadas con ✓ ya no cuentan).
const isSessionEvent = () => (e) => !!(e.start && e.start.dateTime) && !/^✓/.test(e.summary || "");
// "Entrega: Mix …" o "Entrega: Master …" de todo el día (la etapa la mira eventMatch).
const isDeliveryEvent = () => (e) => !!(e.start && e.start.date);
const note = (desc, text) => `${desc ? `${desc}\n\n` : ""}${text}`;

async function moveDelivery(t, oldDate, newDate) {
  // Notion
  const n = await notion(`/pages/${t.songId}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de entrega": { date: { start: newDate } } } }) });
  if (!n.ok) return { notion: false, calendar: "sin-tocar", undo: null };
  // Calendario: el evento "Entrega:" de todo el día
  let cal = "sin-google";
  if ((await gc.status()).connected) {
    const ref = oldDate || newDate;
    const ev = await findEvent(t, at(addDays(ref, -3), 0), at(addDays(ref, 3), 0), isDeliveryEvent(t.stage));
    const body = { start: { date: newDate }, end: { date: addDays(newDate, 1) } };
    if (ev && ev.start.date === newDate) cal = "sin-cambio";
    else if (ev) { const r = await gc.patchEvent(ev.id, { ...body, description: note(ev.description, `↻ Movida desde el portal (antes: ${fmtDay(ev.start.date)}).`) }); cal = r.ok ? "movido" : "error"; if (r.ok) cal = { state: "movido", id: ev.id, old: { start: ev.start, end: ev.end } }; }
    else {
      const r = await gc.createEvent({ ...body, summary: `Entrega: ${t.stage === "Master" ? "Master" : "Mix"} ${t.song}${t.artist ? ` ${t.artist}` : ""}`, colorId: "11", transparency: "transparent", extendedProperties: gc.tag({ songId: t.songId, stage: t.stage, kind: "entrega" }), description: "Agendada desde el portal de ZECHE GRUV." });
      cal = r.ok ? { state: "creado", id: r.data && r.data.id, created: true } : "error";
    }
  }
  // Para quien llama: "movido" / "creado" / "error" / "sin-google" (el
  // detalle, para deshacer: el evento movido vuelve a su día; el creado se borra).
  const undo = cal && typeof cal === "object" ? cal : null;
  return { notion: n.ok, calendar: undo ? undo.state : cal, undo };
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

  const time = /^\d{2}:\d{2}$/.test(body.time || "") ? body.time : null;
  if (!time) return json(400, { error: "Elegí un horario." });
  const startMin = +time.slice(0, 2) * 60 + +time.slice(3);
  const dur = Math.min(8 * 60, Math.max(30, +body.dur || 120));
  const startISO = at(date, startMin), endISO = at(date, Math.min(24 * 60 - 1, startMin + dur));
  // Hoy, solo de ahora en adelante (el navegador ya ofrece desde ahora + 15
  // min; esto frena un pedido viejo, p. ej. con la ventana abierta hace rato).
  if (Date.parse(startISO) <= Date.now()) return json(400, { error: "Ese horario ya pasó. Elegí uno de ahora en adelante." });

  // Sin Google Calendar no se mueve nada: nunca Notion por un lado y el calendario por otro.
  const g = await gc.status();
  if (!g.connected) return json(409, { error: g.configured ? "Conectá Google Calendar para reprogramar: se mueven juntos el evento, la tarea y la entrega." : "Falta configurar Google Calendar en Netlify: sin eso no se puede mover el evento junto con Notion." });

  // La fecha de entrega que tenía antes (para avisarle al artista solo si cambia).
  const songBefore = t.songPage || (t.songId ? (await notion(`/pages/${t.songId}`)).data : null);
  const dateOf = (d) => String((d && (d.start || d)) || "").slice(0, 10);
  const oldDelivery = dateOf(songBefore && songBefore.properties && songBefore.properties["Fecha de entrega"] && songBefore.properties["Fecha de entrega"].date);

  const r = await moveAll(t, { date, time, startISO, endISO });
  if (!r.ok) return json(502, { error: r.error });

  // Notificación al artista con la fecha nueva (si la activó; push.js).
  if (oldDelivery !== date && songBefore) {
    const push = require("./_lib/push");
    const clientId = rel(songBefore.properties || {}, "Artista")[0];
    const profileId = await push.profileByClient(clientId).catch(() => null);
    if (profileId) {
      const day = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric" }).format(new Date(`${date}T12:00:00${OFF}`)).replace(",", "");
      const prof = await require("./_lib/pass").db(`profiles?id=eq.${profileId}&select=*`);
      const p = prof.ok && prof.data && prof.data[0];
      await push.notify({
        profileId, profile: p, category: "proyecto", key: `fecha|${t.songId}|${t.stage}|${date}`, url: "/portal/#canciones", tag: `cancion-${t.songId}`,
        ...push.projectText("fecha", { name: p && (p.display_name || p.full_name), song: t.song, kind: t.stage === "Master" ? "master" : "mezcla", day }),
      }).catch(() => null);
    }
  }
  return json(200, { ok: true, calendar: r.calendar, delivery: fmtDay(date), created: r.created, label: `${fmtDay(date)} · ${time} h` });
};

// Reprogramada cuando ya estaba vencida: se guarda la fecha original
// (029_reprogramadas.sql) para que el Inicio diga "Atrasada · era el …".
// Si la tabla todavía no existe, se reprograma igual.
async function rememberLate({ taskId, songId, stage, original, current }) {
  if (!original || Date.parse(original) >= Date.now()) return false;
  const { db } = require("./_lib/pass");
  const ins = await db("task_reschedules?on_conflict=task_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { task_id: taskId, song_id: songId || null, stage, original_due: original, current_due: current } });
  if (!ins.ok) return false;
  await db(`task_reschedules?task_id=eq.${encodeURIComponent(taskId)}`, { method: "PATCH", body: { current_due: current, moved_at: new Date().toISOString() } });
  return true;
}

// La sesión abierta de esa canción y etapa (la más próxima), o null.
async function openSession(songId, stage) {
  const etapa = stage === "Master" ? "Master" : "Mix";
  const list = await et()._openTasks(songId, [etapa]).catch(() => []);
  const when = (x) => { const d = x.properties["Fecha de Vencimiento"] && x.properties["Fecha de Vencimiento"].date; return d && d.start ? Date.parse(d.start) : Infinity; };
  return list.sort((a, b) => when(a) - when(b))[0] || null;
}

// Mueve tarea + entrega + calendario. Si algo falla, lo ya hecho vuelve
// atrás: lo movido vuelve a su fecha y lo creado en este mismo pedido se
// saca (la tarea nueva se archiva en Notion, el evento nuevo se borra). Si
// algún paso de deshacer también falla, el mensaje lo dice con claridad (y
// qué revisar), nunca "Se dejó todo como estaba".
async function moveAll(t, { date, time, startISO, endISO }) {
  const done = []; // [qué es, cómo deshacerlo], en orden
  const undo = async () => {
    const left = [];
    for (const [what, f] of done.reverse()) {
      const r = await f().catch(() => null);
      if (!r || !r.ok) left.push(what);
    }
    return left;
  };
  // what: qué falló (una frase). Se agrega cómo quedó todo.
  const fail = async (what) => {
    const left = await undo();
    if (!left.length) return { ok: false, error: `${what} Se dejó todo como estaba.` };
    return { ok: false, error: `${what} Ojo: no se pudo deshacer ${left.join(", ")}. Revisalo a mano en Notion y en Google Calendar.` };
  };
  const archive = (id) => notion(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });

  // Canción: hace falta su ficha (fecha de entrega vieja y artista).
  const songPage = t.songPage || (t.songId ? (await notion(`/pages/${t.songId}`)).data : null);
  if (!t.songId || !songPage) return { ok: false, error: "La tarea no tiene la canción vinculada en Notion: vinculala y probá de nuevo." };
  const sp = songPage.properties || {};
  const oldDelivery = sp["Fecha de entrega"] && sp["Fecha de entrega"].date;

  // 1) La tarea de la sesión (si se reprograma desde la fila de entrega, la abierta de esa canción).
  let task = t.kind === "sesion" ? { id: t.id, date: t.date } : null;
  if (!task) {
    const open = await openSession(t.songId, t.stage);
    if (open) task = { id: open.id, date: open.properties["Fecha de Vencimiento"] && open.properties["Fecha de Vencimiento"].date };
  }
  let created = false;
  if (task) {
    const n = await notion(`/pages/${task.id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de Vencimiento": { date: { start: startISO, end: endISO } } } }) });
    if (!n.ok) return { ok: false, error: "Notion no dejó mover la tarea. No se cambió nada." };
    const prev = task.date && task.date.start ? { start: task.date.start, ...(task.date.end ? { end: task.date.end } : {}) } : null;
    done.push(["la fecha de la sesión en Notion", () => notion(`/pages/${task.id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de Vencimiento": { date: prev } } }) })]);
  } else {
    const clientId = rel(sp, "Artista")[0] || null;
    const c = await et()._createTask({ name: `${t.stage === "Master" ? "Master" : "Mix"} ${t.song}${t.artist ? ` ${t.artist}` : ""}`, etapa: t.stage === "Master" ? "Master" : "Mix", song: { id: t.songId, clientId }, start: startISO, end: endISO, description: "Agendada desde el portal al reprogramar la entrega." });
    if (!c.ok) return { ok: false, error: "Notion no dejó crear la sesión. No se cambió nada." };
    created = true;
    task = { id: c.data.id, date: null };
    done.push(["la sesión nueva en Notion (Tareas Pendientes)", () => archive(task.id)]);
  }

  // 2) Fecha de entrega de la canción = el día de la sesión (Notion + su evento "Entrega:").
  const oldDay = oldDelivery && oldDelivery.start ? oldDelivery.start.slice(0, 10) : null;
  const d = await moveDelivery({ ...t, kind: "entrega" }, oldDay, date);
  if (!d.notion) return fail("Notion no dejó mover la fecha de entrega.");
  done.push(["la fecha de entrega en Notion", () => notion(`/pages/${t.songId}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de entrega": { date: oldDelivery ? { start: oldDelivery.start } : null } } }) })]);
  if (d.undo && d.undo.created) done.push(["el evento «Entrega:» nuevo en Google Calendar", () => gc.deleteEvent(d.undo.id)]);
  else if (d.undo) done.push(["el evento «Entrega:» en Google Calendar", () => gc.patchEvent(d.undo.id, { start: d.undo.old.start, end: d.undo.old.end })]);
  if (d.calendar === "error") return fail("Google Calendar no dejó mover la entrega.");

  // 3) El evento de la sesión en Google Calendar (si no existe, se crea).
  const old = task.date && task.date.start;
  const ref = old ? dayAR(new Date(/T/.test(old) ? old : `${old}T12:00:00${OFF}`)) : date;
  const ev = await findEvent(t, at(addDays(ref, -2), 0), at(addDays(ref, 3), 0), isSessionEvent(t.stage));
  const when = { start: { dateTime: startISO, timeZone: TZ }, end: { dateTime: endISO, timeZone: TZ } };
  let calendar;
  if (ev) {
    const before = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.start.dateTime));
    const r = await gc.patchEvent(ev.id, { ...when, description: note(ev.description, `↻ Reprogramada desde el portal (antes: ${before}).`) });
    if (!r.ok) return fail("Google Calendar no dejó mover la sesión.");
    calendar = "movido";
  } else {
    const r = await gc.createEvent({ ...when, summary: `${t.stage === "Master" ? "Master" : "Mix"} – ${t.song || t.name}${t.artist ? ` (${t.artist})` : ""}`, colorId: t.stage === "Master" ? "8" : "7", extendedProperties: gc.tag({ songId: t.songId, stage: t.stage, kind: "sesion" }), description: "Agendada desde el portal de ZECHE GRUV." });
    if (!r.ok) return fail("Google Calendar no dejó crear la sesión.");
    calendar = "creado";
  }
  // Si ya estaba vencida, queda anotado desde cuándo (para el cartel "Atrasada").
  const wasDue = (task.date && task.date.start) || (created && oldDelivery && oldDelivery.start) || null;
  const original = wasDue && !/T/.test(wasDue) ? `${wasDue}T23:59:00${OFF}` : wasDue;
  await rememberLate({ taskId: task.id, songId: t.songId, stage: t.stage, original, current: startISO }).catch(() => null);
  return { ok: true, calendar, created };
}

exports._freeSlots = freeSlots;
exports._loadTask = loadTask;
exports._rememberLate = rememberLate;
exports._findEvent = findEvent;
exports._moveDelivery = moveDelivery;
exports._at = at;
exports._addDays = addDays;
exports._fmtDay = fmtDay;
