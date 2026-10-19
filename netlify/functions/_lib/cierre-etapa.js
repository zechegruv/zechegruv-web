// Cierre automático de una etapa cuando el artista aprueba en el portal.
//
// Lo único que hace el artista es aprobar la mezcla o el master. Con eso,
// sin que Zeche toque nada, quedan iguales el portal, Notion y el calendario:
//
//   Mezcla aprobada
//     1. Notion → Canciones: Entrega = "Mezcla aprobada" y Etapa actual = Master.
//     2. Notion → Tareas Pendientes: toda tarea de Mix de esa canción que
//        siguiera abierta pasa a COMPLETADO (no queda ninguna de mezcla).
//     3. Google Calendar: el evento "Entrega: Mix …" queda tildado con ✓ y las
//        sesiones de mezcla que todavía no pasaron también (y dejan de ocupar
//        el horario). No se borra nada.
//     4. Fecha de entrega del master: el día de la sesión de master si ya hay
//        una agendada; si no, la regla de 15 días (auto-etapas.js → onMaster);
//        si tampoco hay regla y la fecha vieja ya pasó, una semana desde hoy.
//        Se mueve junto con su evento "Entrega:" (admin-reschedule.js).
//        Queda anotado el paso a Master en song_stage_log, así la función
//        programada no lo vuelve a procesar.
//   Master aprobado
//     1. Notion: Entrega = "Master aprobado", Etapa actual = Distribución y
//        sin fecha de entrega (ya no hay nada que entregar).
//     2. Tareas de Master abiertas → COMPLETADO.
//     3. Calendario: "Entrega: Master …" y sesiones de master por venir con ✓.
//     El resto sigue como siempre: la función programada (cada 15 min) crea la
//     tarea de Distribución y le avisa al equipo (auto-etapas.js → onDistribution).
//
// Lo usan portal-review.js (el artista aprueba) y, si se suma, cualquier otra
// aprobación. Devuelve qué hizo y el estado nuevo de la canción para el portal.
const { db } = require("./pass");
const gc = require("./gcal");
const { norm } = require("./song-audio");
const ae = () => require("./auto-entregas");
const et = () => require("./auto-etapas");
const rs = () => require("../admin-reschedule");

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const TZ = "America/Argentina/Buenos_Aires";
const OFF = "-03:00";
const LABEL = { mezcla: "Mezcla aprobada", master: "Master aprobado" };
const STAGE = { mezcla: "Mix", master: "Master" };
const NEXT = { mezcla: "Master", master: "Distribución" };
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayOf = (start) => (/T/.test(start) ? dayAR(new Date(start)) : String(start).slice(0, 10));

async function notion(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

// ¿El evento es de esta etapa? (mezcla: "Mix"/"Mezcla"; master: "Master").
const isStage = (kind, text) => (kind === "master" ? /master/i : /\b(mix|mezcla)/i).test(text || "");

// Calendario: tilda con ✓ la entrega y las sesiones por venir de esa etapa.
async function tickCalendar(song, kind, refDate, now = new Date()) {
  try {
    if (!(await gc.status()).connected) return "sin-google";
    const today = dayAR(now);
    const from = [refDate, today].filter(Boolean).sort()[0];
    const list = await gc.events(`${addDays(from, -10)}T00:00:00${OFF}`, `${addDays(today, 45)}T00:00:00${OFF}`);
    if (!list) return "error";
    const key = norm(song.title);
    const mine = list.filter((e) => key && !/^✓/.test(e.summary || "") && isStage(kind, e.summary) && norm(`${e.summary} ${e.description || ""}`).includes(key));
    const delivery = mine.filter((e) => e.start && e.start.date && /^entrega/i.test(e.summary || ""));
    const sessions = mine.filter((e) => e.start && e.start.dateTime && Date.parse(e.end && e.end.dateTime || e.start.dateTime) > now.getTime());
    const text = `✓ ${LABEL[kind]} por el artista en el portal`;
    const res = await Promise.all([
      ...delivery.map((e) => gc.patchEvent(e.id, { summary: `✓ ${e.summary}`, description: `${e.description ? `${e.description}\n\n` : ""}${text}.` })),
      // La sesión ya no hace falta: queda a la vista con ✓ y libera el horario.
      ...sessions.map((e) => gc.patchEvent(e.id, { summary: `✓ ${e.summary}`, transparency: "transparent", description: `${e.description ? `${e.description}\n\n` : ""}${text}: esta sesión ya no hace falta.` })),
    ]);
    if (res.some((r) => !r.ok)) return "error";
    return res.length ? `tildados ${res.length}` : "sin-evento";
  } catch (e) {
    return "error";
  }
}

// Mezcla aprobada → fecha de entrega del master.
async function masterDate(song, now = new Date()) {
  const today = dayAR(now);
  // Paso a Master anotado (si lo tomamos nosotros, la función programada no lo repite).
  const claim = await db(`song_stage_log?song_id=eq.${encodeURIComponent(song.id)}&stage=eq.Mix`, { method: "PATCH", prefer: "return=representation", body: { stage: "Master", changed_at: now.toISOString() } }).catch(() => null);
  const row = claim && claim.ok && claim.data && claim.data[0];
  const artist = await et()._artistName(song.clientId).catch(() => "");
  // 1) Si ya hay una sesión de master agendada, la entrega es ese día.
  const open = await et()._openTasks(song.id, ["Master"]).catch(() => []);
  const dated = open.map((t) => t.properties["Fecha de Vencimiento"] && t.properties["Fecha de Vencimiento"].date && t.properties["Fecha de Vencimiento"].date.start).filter(Boolean).map(dayOf).filter((d) => d >= today).sort();
  if (dated.length) {
    if (song.delivery === dated[0]) return { date: dated[0], from: "sesion", moved: false };
    const r = await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: "Master" }, song.delivery, dated[0]);
    return { date: dated[0], from: "sesion", moved: r.notion, calendar: r.calendar };
  }
  // 2) Regla de 15 días.
  if (row && row.vocals_at) {
    const r = await et()._onMaster({ ...song, stage: "Master" }, row);
    if (r.actions.some((a) => /^entrega \d/.test(a))) return { date: r.actions.find((a) => /^entrega \d/.test(a)).slice(8), from: "regla", moved: true };
    if (song.delivery && song.delivery >= today) return { date: song.delivery, from: "regla", moved: false };
  }
  // 3) Sin regla: si la fecha vieja (la de la mezcla) ya pasó, una semana desde hoy.
  if (!song.delivery || song.delivery < today) {
    const target = addDays(today, 7);
    const r = await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: "Master" }, song.delivery, target);
    return { date: target, from: "semana", moved: r.notion, calendar: r.calendar };
  }
  return { date: song.delivery, from: "sin-cambio", moved: false };
}

// page: la ficha de la canción en Notion (ya leída). kind: "mezcla" | "master".
async function closeStage({ page, kind, now = new Date() }) {
  const p = page.properties || {};
  const song = {
    id: page.id,
    title: plain(p["Canción"] && p["Canción"].title) || "Sin título",
    clientId: ((p.Artista && p.Artista.relation) || [])[0]?.id || null,
    delivery: p["Fecha de entrega"] && p["Fecha de entrega"].date && p["Fecha de entrega"].date.start ? p["Fecha de entrega"].date.start.slice(0, 10) : null,
  };
  const out = { kind, notion: false, tasks: [], calendar: null, master: null };
  const props = { Entrega: { select: { name: LABEL[kind] } }, "Etapa actual": { select: { name: NEXT[kind] } } };
  if (kind === "master") props["Fecha de entrega"] = { date: null };
  const patch = () => notion(`/pages/${song.id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
  let upd = await patch().catch(() => ({ ok: false }));
  if (!upd.ok) upd = await patch().catch(() => ({ ok: false })); // un reintento
  out.notion = !!upd.ok;
  if (!out.notion) return out; // sin la canción cerrada no se toca lo demás (queda todo como estaba)

  // Tareas de esa etapa: todas las abiertas, sin importar cuándo se crearon.
  const [tasks, calendar] = await Promise.all([
    ae()._closeTasks(song, kind, song.clientId, Infinity).catch(() => null),
    tickCalendar(song, kind, song.delivery, now),
  ]);
  out.tasks = tasks || [];
  out.tasksOk = tasks !== null;
  out.calendar = calendar;
  if (kind === "mezcla") out.master = await masterDate(song, now).catch((e) => ({ error: String(e && e.message).slice(0, 80) }));
  return out;
}

// Cómo queda la canción en el portal del artista, sin esperar a recargar.
function nextSong(kind) {
  if (kind === "mezcla") {
    return { stage: "master", step: 4, entrega: LABEL.mezcla, ready: false, review: null,
      delivery: { kind: "master", state: "proceso", file: null, versions: [], demo: null, review: null, manual: null, by: null } };
  }
  return null; // master: el portal ya lo muestra aprobado; pasa a Terminadas al recargar
}

module.exports = { closeStage, nextSong, _tickCalendar: tickCalendar, _masterDate: masterDate };
