// GET  /.netlify/functions/admin-tasks              -> próximas tareas
// POST /.netlify/functions/admin-tasks { task }     -> marcarla como hecha (devuelve { prev })
// POST /.netlify/functions/admin-tasks { task, undo: true, state } -> deshacer el tilde
// POST /.netlify/functions/admin-tasks { sync: true } -> revisa ya las carpetas
//      y marca solas las mezclas y masters subidos (_lib/auto-entregas.js);
//      lo mismo que hace la función programada cada 15 minutos.
// Para el Inicio del panel de administrador, solo lo de mezcla y master:
//   - las sesiones de mezcla y master de "Tareas Pendientes" que no están
//     completadas ("Tenés sesión de mezcla hoy"), y
//   - las fechas límite de entrega de cada canción en mezcla o master
//     (Canciones → Fecha de entrega), salvo que ya figure entregada o aprobada.
// Las sesiones de estructura, producción y grabación no aparecen: son
// presenciales, de todas las semanas. Todo por fecha, con su urgencia:
//   vencida (rojo) · hoy / mañana (naranja) · en 2 o 3 días (amarillo) · el resto.
//   Si la mezcla o el master ya se entregó y espera al artista, nunca figura
//   vencida: urgencia "espera" ("Esperando aprobación de <artista>"). Si ya
//   está aprobada (o la canción pasó de etapa), no aparece.
// "Hecha" la pasa a COMPLETADO en Notion, tilda su evento en Google Calendar
// con ✓ y desaparece de la lista. "Deshacer" vuelve las dos cosas atrás.
// Solo el administrador (sesión de Supabase en Authorization: Bearer).
const { json, db } = require("./_lib/pass");
const { TASKS_DS, SONGS_DS } = require("./portal-songs");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const TZ = "America/Argentina/Buenos_Aires";
const AHEAD_DAYS = 21;
const MAX = 20;
// Estados a los que puede volver una tarea al deshacer el tilde.
const UNDO_STATES = ["PENDIENTE", "SIN EMPEZAR", "EN PROCESO"];
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const STAGE = { Estructura: "Estructura", Prod: "Producción", Rec: "Grabación", Mix: "Mezcla", Master: "Master", "Distribución": "Distribución" };

// Con reintentos ante 429/502/503 y pocos pedidos a la vez (_lib/notion.js).
const notion = (path, init) => require("./_lib/notion").notion(path, init);

async function isAdmin(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  if (!user || !user.id) return false;
  const role = await db(`profiles?id=eq.${user.id}&select=role`);
  return !!(role.ok && role.data[0] && role.data[0].role === "admin");
}

const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const dayKey = (start) => (/T/.test(start) ? dayAR(new Date(start)) : start.slice(0, 10));
// Días entre hoy y la fecha de la tarea, en Buenos Aires (negativo = vencida).
function daysFrom(start, now = new Date()) {
  const day = /T/.test(start) ? dayAR(new Date(start)) : start.slice(0, 10);
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${dayAR(now)}T12:00:00Z`)) / 86400000);
}
function urgency(days) {
  if (days < 0) return "vencida";
  if (days === 0) return "hoy";
  if (days === 1) return "manana";
  if (days <= 3) return "pronto";
  return "normal";
}

// ✓ / Deshacer de una sesión: el evento de Google Calendar acompaña a Notion.
//   done = true  -> "✓ Mix – …" (si todavía no pasó, además libera el horario)
//   done = false -> vuelve a su nombre y vuelve a ocupar el horario.
async function tickSessionEvent(taskId, done) {
  try {
    const gc = require("./_lib/gcal");
    if (!(await gc.status()).connected) return "sin-google";
    const rs = require("./admin-reschedule");
    const t = await rs._loadTask(taskId, "sesion");
    if (!t || !t.song) return "sin-evento";
    const start = t.date && t.date.start;
    const ref = start ? dayKey(start) : dayAR(new Date());
    // Que sea de esta canción y etapa lo decide gcal.js → eventMatch (marca o título exacto).
    const ev = await rs._findEvent(t, `${rs._addDays(ref, -2)}T00:00:00-03:00`, `${rs._addDays(ref, 3)}T00:00:00-03:00`,
      (e) => !!(e.start && e.start.dateTime) && (done ? !/^✓/.test(e.summary || "") : /^✓/.test(e.summary || "")));
    if (!ev) return "sin-evento";
    const future = Date.parse((ev.end && ev.end.dateTime) || ev.start.dateTime) > Date.now();
    const body = done
      ? { summary: `✓ ${ev.summary}`, ...(future ? { transparency: "transparent" } : {}) }
      : { summary: ev.summary.replace(/^✓\s*/, ""), transparency: "opaque" };
    const r = await gc.patchEvent(ev.id, body);
    return r.ok ? (done ? "tildado" : "destildado") : "error";
  } catch (e) {
    return "error";
  }
}

exports.handler = async (event) => {
  if (!notionToken()) return json(200, { connected: false, tasks: [] });
  if (!(await isAdmin(event))) return json(403, { error: "Solo para el administrador." });

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
    if (body.sync) {
      const r = await require("./_lib/auto-entregas").syncAll();
      return json(200, { ok: r.ok, delivered: (r.delivered || []).map(({ artist, song, kind, tasks }) => ({ artist, song, kind, tasks: (tasks || []).length })), errors: (r.errors || []).length });
    }
    const id = String(body.task || "").replace(/[^0-9a-f-]/gi, "");
    if (!id) return json(400, { error: "Pedido inválido." });
    const setState = (name) => notion(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Estado de Tarea": { select: { name } } } }) });
    // Deshacer: vuelve la tarea al estado que tenía antes del tilde.
    if (body.undo) {
      const prev = UNDO_STATES.includes(body.state) ? body.state : "PENDIENTE";
      const res = await setState(prev);
      if (!res.ok) return json(502, { error: "Notion no dejó deshacerla. Probá de nuevo." });
      const calendar = await tickSessionEvent(id, false);
      return json(200, { ok: true, state: prev, calendar });
    }
    // Antes de tildar se guarda el estado actual, para poder deshacer.
    const cur = await notion(`/pages/${id}`);
    const was = (cur.ok && cur.data && cur.data.properties && cur.data.properties["Estado de Tarea"] && cur.data.properties["Estado de Tarea"].select && cur.data.properties["Estado de Tarea"].select.name) || null;
    const res = await setState("COMPLETADO");
    if (!res.ok) return json(502, { error: "Notion no dejó marcarla. Probá de nuevo." });
    const calendar = await tickSessionEvent(id, true);
    return json(200, { ok: true, prev: UNDO_STATES.includes(was) ? was : "PENDIENTE", calendar });
  }

  const limit = new Date(Date.now() + AHEAD_DAYS * 86400000);
  // Solo lo de mezcla y master: el resto (estructura, producción, grabación)
  // son sesiones presenciales de todas las semanas y no hace falta recordarlas.
  const [q, sq] = await Promise.all([
    notion(`/data_sources/${TASKS_DS}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: { and: [
          { property: "Estado de Tarea", select: { does_not_equal: "COMPLETADO" } },
          { property: "Estado de Tarea", select: { does_not_equal: "INACTIVA" } }, // proyectos en pausa
          { property: "Fecha de Vencimiento", date: { on_or_before: dayAR(limit) } },
        ] },
        sorts: [{ property: "Fecha de Vencimiento", direction: "ascending" }],
        page_size: 100,
      }),
    }),
    // Fechas de entrega de las canciones que están en mezcla o en master.
    notion(`/data_sources/${SONGS_DS}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: { and: [
          { or: [
            { property: "Etapa actual", select: { equals: "Mix" } },
            { property: "Etapa actual", select: { equals: "Master" } },
          ] },
          { property: "Fecha de entrega", date: { on_or_before: dayAR(limit) } },
        ] },
        sorts: [{ property: "Fecha de entrega", direction: "ascending" }],
        page_size: 100,
      }),
    }),
  ]);
  if (!q.ok) return json(502, { error: "No pudimos leer Tareas Pendientes en Notion." });

  const item = (date) => {
    const days = daysFrom(date.start);
    return { start: date.start, end: date.end || null, timed: /T/.test(date.start), days, urgency: urgency(days) };
  };

  // Sesiones de mezcla y master (Tareas Pendientes).
  const sessions = (q.data.results || []).map((t) => {
    const p = t.properties || {};
    const date = p["Fecha de Vencimiento"] && p["Fecha de Vencimiento"].date;
    if (!date || !date.start) return null;
    const etapa = p.Etapa && p.Etapa.select && p.Etapa.select.name;
    const name = plain(p.Nombre && p.Nombre.title) || "Sin nombre";
    const isMix = etapa === "Mix" || (!etapa && /^(mix|mezcla)\b/i.test(name));
    const isMaster = etapa === "Master" || (!etapa && /^(master|mastering)\b/i.test(name));
    if (!isMix && !isMaster) return null;
    return {
      id: t.id, kind: "sesion", url: t.url, name, ...item(date),
      state: (p["Estado de Tarea"] && p["Estado de Tarea"].select && p["Estado de Tarea"].select.name) || null,
      stage: isMix ? "Mezcla" : "Master",
      clientId: ((p.Cliente && p.Cliente.relation) || [])[0]?.id || null,
      songId: ((p["Canción"] && p["Canción"].relation) || [])[0]?.id || null,
    };
  }).filter(Boolean);

  // ¿En qué está la mezcla / el master de cada canción? (Canciones → Entrega
  // y lo último registrado en song_approvals.)
  //   cerrada  -> ya aprobada o la canción ya pasó de etapa: no se muestra.
  //   espera   -> entregada, esperando que el artista apruebe: nunca "vencida",
  //               el cartel dice "Esperando aprobación de <artista>".
  //   abierta  -> todavía hay que hacerla: urgencia normal (vencida, hoy…).
  const ORDER = ["Estructura", "Prod", "Rec", "Mix", "Master", "Distribución", "Publicada"];
  const ETAPA = { Mezcla: "Mix", Master: "Master" };
  const LABELS = { Mezcla: ["Mezcla entregada", "Mezcla aprobada"], Master: ["Master entregado", "Master aprobado"] };
  const KIND = { Mezcla: "mezcla", Master: "master" };
  const key = (id) => String(id || "").replace(/-/g, "");
  const songPages = Object.fromEntries(((sq.ok && sq.data.results) || []).map((sp) => [key(sp.id), sp]));
  const missing = [...new Set(sessions.map((x) => x.songId).filter((id) => id && !songPages[key(id)]))];
  const fetched = await Promise.all(missing.map((id) => notion(`/pages/${id}`)));
  missing.forEach((id, i) => { if (fetched[i].ok) songPages[key(id)] = fetched[i].data; });
  const allSongs = Object.values(songPages).map((sp) => sp.id);
  const appr = allSongs.length ? await db(`song_approvals?song_id=in.(${allSongs.join(",")})&select=song_id,kind,action,created_at&order=created_at.desc&limit=500`) : { ok: false };
  const lastOf = (songId, stage) => ((appr.ok && appr.data) || []).find((r) => key(r.song_id) === key(songId) && r.kind === KIND[stage]) || null;
  // Canciones vinculadas que Notion no dejó leer (ni con reintentos): de esas
  // no se sabe si ya se entregó, así que no se deciden (ver "desconocida").
  const unread = new Set(missing.filter((id, i) => !fetched[i].ok).map(key));
  function stateOf(songId, stage) {
    const sp = songPages[key(songId)];
    if (!sp && unread.has(key(songId))) return "desconocida";
    if (!sp) return "abierta"; // sin canción vinculada: como siempre
    const p = sp.properties || {};
    const etapa = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
    const entrega = p.Entrega && p.Entrega.select && p.Entrega.select.name;
    const [delivered, approved] = LABELS[stage];
    if (entrega === approved) return "cerrada";
    if (ORDER.indexOf(etapa) > ORDER.indexOf(ETAPA[stage])) return "cerrada";
    if (entrega === delivered) return "espera";
    const last = lastOf(songId, stage);
    if (!entrega && last && last.action === "entregada") return "espera";
    return "abierta";
  }
  const waiting = (t) => ({ ...t, urgency: "espera", waiting: true });
  // No se pudo leer la canción: se muestra, pero sin cartel de "Vencida"
  // (podría estar entregada esperando al artista). En la próxima
  // actualización, con Notion respondiendo, vuelve a su estado real.
  const unknown = (t) => ({ ...t, urgency: t.urgency === "vencida" ? "normal" : t.urgency, unknown: true });

  // Sesiones: las de canciones ya aprobadas no se muestran; las entregadas, en espera.
  const liveSessions = sessions
    .map((x) => ({ x, st: x.songId ? stateOf(x.songId, x.stage) : "abierta" }))
    .filter(({ st }) => st !== "cerrada")
    .map(({ x, st }) => (st === "espera" ? waiting(x) : st === "desconocida" ? unknown(x) : x));

  // ---------- Reprogramadas: el día nuevo, avisando que vas atrasado ----------
  // 1) Si una sesión vencida en Notion ya tiene su evento movido a otro día en
  //    Google Calendar (p. ej. lo corriste directo en el calendario), manda
  //    el calendario: se muestra ese día y hora, y Notion (tarea y fecha de
  //    entrega) se pone igual, así las tres fuentes dicen lo mismo.
  // 2) Cada sesión que se reprogramó estando vencida lleva "late": desde qué
  //    día estás atrasado (029_reprogramadas.sql). Se ve como
  //    "Atrasada · era el sáb 17" junto al día nuevo.
  const titleOfPage = (pg) => { const t = pg && Object.values(pg.properties || {}).find((x) => x && x.type === "title"); return t ? plain(t.title) : ""; };
  const lateRows = liveSessions.length ? await db(`task_reschedules?task_id=in.(${liveSessions.map((x) => x.id).join(",")})&select=task_id,original_due`) : { ok: false };
  const lateOk = lateRows.ok; // sin 029 se muestra igual, pero no se escribe nada en Notion
  const lateOf = Object.fromEntries(((lateOk && lateRows.data) || []).map((r) => [key(r.task_id), r.original_due]));
  const overdue = liveSessions.filter((x) => x.days < 0 && !x.waiting && x.timed && x.songId && songPages[key(x.songId)]);
  if (overdue.length) {
    const gc = require("./_lib/gcal");
    const rs = require("./admin-reschedule");
    const g = await gc.status().catch(() => ({ connected: false }));
    const from = overdue.map((x) => dayKey(x.start)).sort()[0];
    const list = g.connected ? await gc.events(`${from}T00:00:00-03:00`, `${dayAR(new Date(Date.now() + AHEAD_DAYS * 86400000))}T23:59:00-03:00`).catch(() => null) : null;
    const et = require("./_lib/auto-etapas");
    for (const x of list ? overdue : []) {
      // Solo un evento que seguro es de esta canción y etapa (por su marca o
      // por el título con palabras completas, gcal.js → eventMatch): con una
      // coincidencia a medias no se toca Notion («Luna» ≠ «Luna Llena»).
      const song = { id: x.songId, title: titleOfPage(songPages[key(x.songId)]), artist: await et._artistName(x.clientId).catch(() => "") };
      const after = list.filter((e) => e.start && e.start.dateTime && !/^[✓✗]/.test(e.summary || "")
        && gc.eventMatch(e, song, x.stage, "sesion") && Date.parse(e.start.dateTime) > Date.parse(x.start) + 30 * 60000);
      if (!after.length) continue;
      const ahead = after.filter((e) => Date.parse(e.end.dateTime) > Date.now()).sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime));
      const ev = ahead[0] || after.sort((a, b) => Date.parse(b.start.dateTime) - Date.parse(a.start.dateTime))[0];
      const original = x.start;
      if (lateOk) {
        // Notion se pone igual que el calendario (tarea + fecha de entrega).
        const upd = await notion(`/pages/${x.id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Fecha de Vencimiento": { date: { start: ev.start.dateTime, end: ev.end.dateTime } } } }) });
        if (upd.ok) {
          await rs._rememberLate({ taskId: x.id, songId: x.songId, stage: x.stage, original, current: ev.start.dateTime }).catch(() => null);
          const sp = songPages[key(x.songId)].properties || {};
          const fe = sp["Fecha de entrega"] && sp["Fecha de entrega"].date && sp["Fecha de entrega"].date.start;
          const newDay = dayAR(new Date(ev.start.dateTime));
          if (fe && fe.slice(0, 10) < newDay) {
            await rs._moveDelivery({ songId: x.songId, song: song.title, artist: song.artist, stage: x.stage }, fe.slice(0, 10), newDay).catch(() => null);
            sp["Fecha de entrega"] = { date: { start: newDay } };
          }
        }
      }
      if (!lateOf[key(x.id)]) lateOf[key(x.id)] = original;
      Object.assign(x, item({ start: ev.start.dateTime, end: ev.end.dateTime }), { fromCalendar: true });
    }
  }
  liveSessions.forEach((x) => { if (lateOf[key(x.id)]) x.late = lateOf[key(x.id)]; });

  // Fechas límite de entrega (Canciones → Fecha de entrega).
  const deadlines = ((sq.ok && sq.data.results) || []).map((sp) => {
    const p = sp.properties || {};
    const date = p["Fecha de entrega"] && p["Fecha de entrega"].date;
    const etapa = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
    if (!date || !date.start || !["Mix", "Master"].includes(etapa)) return null;
    const stage = etapa === "Mix" ? "Mezcla" : "Master";
    const st = stateOf(sp.id, stage);
    if (st === "cerrada") return null;
    const row = {
      id: sp.id, kind: "entrega", url: sp.url, name: plain(p["Canción"] && p["Canción"].title) || "Sin título", ...item(date),
      stage,
      clientId: ((p.Artista && p.Artista.relation) || [])[0]?.id || null,
      songId: sp.id,
    };
    return st === "espera" ? waiting(row) : row;
  }).filter(Boolean)
    // Si ya hay una sesión de la misma canción y etapa ese día (o en espera), alcanza con la sesión.
    .filter((d) => !liveSessions.some((s) => s.songId && key(s.songId) === key(d.songId) && s.stage === d.stage && (dayKey(s.start) === dayKey(d.start) || s.waiting || d.waiting)));

  // Lo que espera al artista va después de lo que hay que hacer.
  const raw = [...liveSessions, ...deadlines].sort((x, y) => (x.waiting ? 1 : 0) - (y.waiting ? 1 : 0) || x.days - y.days || Date.parse(x.start) - Date.parse(y.start)).slice(0, MAX);

  // Nombres de artista y de canción (cada ficha, una vez).
  const clientIds = [...new Set(raw.map((t) => t.clientId).filter(Boolean))];
  const songIds = [...new Set(raw.filter((t) => t.kind === "sesion").map((t) => t.songId).filter(Boolean))];
  const [clients, songs] = await Promise.all([
    Promise.all(clientIds.map((id) => notion(`/pages/${id}`))),
    // Las canciones ya se leyeron arriba (estado de entrega): no se piden de nuevo.
    Promise.all(songIds.map((id) => (songPages[key(id)] ? { ok: true, data: songPages[key(id)] } : notion(`/pages/${id}`)))),
  ]);
  const titleOf = (res) => {
    if (!res.ok || !res.data) return null;
    const props = res.data.properties || {};
    const t = Object.values(props).find((x) => x && x.type === "title");
    return t ? plain(t.title) : null;
  };
  const cName = Object.fromEntries(clientIds.map((id, i) => [id, titleOf(clients[i])]));
  const sName = Object.fromEntries(songIds.map((id, i) => [id, titleOf(songs[i])]));
  // Regla de 15 días (025_automatizaciones.sql): día límite del master de cada canción.
  const rules = await require("./_lib/auto-etapas").ruleLimits().catch(() => ({}));
  const tasks = raw.map(({ clientId, songId, ...t }) => ({ ...t, artist: cName[clientId] || null, song: t.kind === "entrega" ? t.name : sName[songId] || null, clientId, rule: (songId && rules[songId.replace(/-/g, "")]) || null }));
  return json(200, { connected: true, tasks });
};

exports._urgency = urgency;
exports._daysFrom = daysFrom;
exports._notion = notion;
exports._isAdmin = isAdmin;
exports._dayAR = dayAR;
