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
//     4. Sesión de master: si ya hay una agendada, la entrega del master es
//        ese día; si no, se agenda sola en el primer hueco libre (lunes a
//        viernes desde las 15 h, sin chocar con nada) con su tarea, su evento
//        y la entrega ese día. Si no se puede agendar, la regla de 15 días
//        (auto-etapas.js → onMaster) o, si tampoco hay, una semana desde hoy.
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
const ae = () => require("./auto-entregas");
const et = () => require("./auto-etapas");
const rs = () => require("../admin-reschedule");

const TZ = "America/Argentina/Buenos_Aires";
const OFF = "-03:00";
const LABEL = { mezcla: "Mezcla aprobada", master: "Master aprobado" };
const STAGE = { mezcla: "Mix", master: "Master" };
const NEXT = { mezcla: "Master", master: "Distribución" };
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayOf = (start) => (/T/.test(start) ? dayAR(new Date(start)) : String(start).slice(0, 10));

// Con reintentos ante 429/502/503 y pocos pedidos a la vez (_lib/notion.js).
const notion = (path, init) => require("./notion").notion(path, init);

// Calendario: tilda con ✓ la entrega y las sesiones por venir de esa etapa.
// why: el motivo que queda escrito en el evento.
async function tickCalendar(song, kind, refDate, now = new Date(), why = `${LABEL[kind]} por el artista en el portal`) {
  try {
    if (!(await gc.status()).connected) return "sin-google";
    const today = dayAR(now);
    const from = [refDate, today].filter(Boolean).sort()[0];
    const list = await gc.events(`${addDays(from, -10)}T00:00:00${OFF}`, `${addDays(today, 45)}T00:00:00${OFF}`);
    if (!list) return "error";
    // Solo los eventos de esta canción y etapa (por su marca o por el título
    // con palabras completas, ver gcal.js → eventMatch): «Luna» nunca tilda
    // «Luna Llena». El nombre del artista hace falta para los "Entrega:".
    const artist = song.artist != null ? song.artist : await et()._artistName(song.clientId).catch(() => "");
    const mine = list.filter((e) => !/^✓/.test(e.summary || "") && gc.eventMatch(e, { ...song, artist }, kind));
    const delivery = mine.filter((e) => e.start && e.start.date);
    const sessions = mine.filter((e) => e.start && e.start.dateTime && Date.parse(e.end && e.end.dateTime || e.start.dateTime) > now.getTime());
    const text = `✓ ${why}`;
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
  // 2) No hay sesión de master por delante: se agenda sola (lunes a viernes
  //    desde las 15 h) y la entrega del master es ese día.
  const auto = await scheduleSession(song, "master", artist, "el artista aprobó la mezcla", now).catch(() => null);
  if (auto && auto.scheduled) return { date: auto.date, from: "agendada", moved: true, session: auto };
  // 3) Si no se pudo agendar: regla de 15 días.
  if (row && row.vocals_at) {
    const r = await et()._onMaster({ ...song, stage: "Master" }, row);
    if (r.actions.some((a) => /^entrega \d/.test(a))) return { date: r.actions.find((a) => /^entrega \d/.test(a)).slice(8), from: "regla", moved: true };
    if (song.delivery && song.delivery >= today) return { date: song.delivery, from: "regla", moved: false };
  }
  // 4) Sin regla: si la fecha vieja (la de la mezcla) ya pasó, una semana desde hoy.
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

// Song a partir de la ficha de Notion.
function songOf(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: plain(p["Canción"] && p["Canción"].title) || "Sin título",
    clientId: ((p.Artista && p.Artista.relation) || [])[0]?.id || null,
    delivery: p["Fecha de entrega"] && p["Fecha de entrega"].date && p["Fecha de entrega"].date.start ? p["Fecha de entrega"].date.start.slice(0, 10) : null,
  };
}

// Botón "Entregado" del panel (o lo que lo reemplace): igual que cuando subís
// el audio a la carpeta, se completan las sesiones de esa etapa que estaban
// abiertas y el calendario queda tildado. La Entrega en Notion la pone quien llama.
async function deliverStage({ page, kind, now = new Date() }) {
  const song = songOf(page);
  const label = kind === "mezcla" ? "Mezcla entregada" : "Master entregado";
  const [tasks, calendar] = await Promise.all([
    ae()._closeTasks(song, kind, song.clientId, now.getTime()).catch(() => null),
    tickCalendar(song, kind, song.delivery, now, `${label} (marcado desde el panel)`),
  ]);
  return { tasks: tasks || [], tasksOk: tasks !== null, calendar };
}

// El artista pidió cambios: hace falta una sesión para corregir. Si ya hay
// una abierta por delante, la entrega pasa a ese día; si no, se agenda sola
// en el primer hueco libre de 2 h (tarea + evento) y la entrega va ese día,
// así nunca queda "vencida" con la fecha vieja. Sin Google Calendar
// conectado no se agenda nada (se avisa en el mail).
async function reopenStage({ page, kind, now = new Date() }) {
  const song = songOf(page);
  const stage = kind === "master" ? "Master" : "Mix";
  const stageLabel = kind === "master" ? "Master" : "Mezcla";
  const today = dayAR(now);
  const artist = await et()._artistName(song.clientId).catch(() => "");
  const open = await et()._openTasks(song.id, [stage]).catch(() => []);
  const ahead = open
    .map((t) => ({ t, d: t.properties["Fecha de Vencimiento"] && t.properties["Fecha de Vencimiento"].date }))
    .filter(({ d }) => d && d.start && dayOf(d.start) >= today)
    .sort((a, b) => Date.parse(a.d.start) - Date.parse(b.d.start))[0];
  if (ahead) {
    const day = dayOf(ahead.d.start);
    if (song.delivery !== day) await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: stageLabel }, song.delivery, day);
    return { scheduled: false, existing: true, date: day, start: ahead.d.start };
  }
  return scheduleSession(song, kind, artist, "el artista pidió cambios desde el portal", now);
}

// Agenda sola una sesión de mezcla o de master en el primer hueco libre del
// horario automático (lunes a viernes desde las 15 h, ver auto-etapas.js →
// AUTO): evento en Google Calendar + tarea en Notion + entrega ese día.
// Sin Google Calendar conectado no agenda nada a medias.
async function scheduleSession(song, kind, artist, why, now = new Date()) {
  const stage = kind === "master" ? "Master" : "Mix";
  const stageLabel = kind === "master" ? "Master" : "Mezcla";
  if (!(await gc.status()).connected) return { scheduled: false, google: false };
  const slot = await et()._firstSlot(now);
  if (!slot || !slot.google) return { scheduled: false, google: !!slot };
  const ev = await gc.createEvent({
    start: { dateTime: slot.start, timeZone: TZ }, end: { dateTime: slot.end, timeZone: TZ },
    summary: `${stage} – ${song.title}${artist ? ` (${artist})` : ""}`, colorId: kind === "master" ? "8" : "7",
    extendedProperties: gc.tag({ songId: song.id, stage: kind, kind: "sesion" }),
    description: `Agendada sola por el portal: ${why}. Si no te sirve, movela desde el Inicio del panel (Reprogramar).`,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
  });
  if (!ev.ok) return { scheduled: false, error: "calendario" };
  const t = await et()._createTask({ name: `${stage} ${song.title}${artist ? ` ${artist}` : ""}`, etapa: stage, song, start: slot.start, end: slot.end, description: `Agendada sola: ${why}.` });
  if (!t.ok) {
    // Sin tarea en Notion, el evento no queda ocupando el horario como si nada.
    await gc.patchEvent(ev.data.id, { summary: `✗ ${ev.data.summary}`, transparency: "transparent", description: `${ev.data.description}\n\n✗ Notion no dejó crear la tarea: agendala desde el Inicio del panel.` }).catch(() => null);
    return { scheduled: false, error: "notion" };
  }
  await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: stageLabel }, song.delivery, slot.date);
  return { scheduled: true, date: slot.date, time: slot.time, start: slot.start, end: slot.end };
}

// Cómo queda la canción en el portal del artista, sin esperar a recargar.
function nextSong(kind) {
  if (kind === "mezcla") {
    return { stage: "master", step: 4, entrega: LABEL.mezcla, ready: false, review: null,
      delivery: { kind: "master", state: "proceso", file: null, versions: [], demo: null, review: null, manual: null, by: null } };
  }
  return null; // master: el portal ya lo muestra aprobado; pasa a Terminadas al recargar
}

module.exports = { closeStage, deliverStage, reopenStage, nextSong, tickCalendar, _masterDate: masterDate };
