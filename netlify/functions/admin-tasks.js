// GET  /.netlify/functions/admin-tasks              -> próximas tareas
// POST /.netlify/functions/admin-tasks { task }     -> marcarla como hecha
// Para el Inicio del panel de administrador, solo lo de mezcla y master:
//   - las sesiones de mezcla y master de "Tareas Pendientes" que no están
//     completadas ("Tenés sesión de mezcla hoy"), y
//   - las fechas límite de entrega de cada canción en mezcla o master
//     (Canciones → Fecha de entrega), salvo que ya figure entregada o aprobada.
// Las sesiones de estructura, producción y grabación no aparecen: son
// presenciales, de todas las semanas. Todo por fecha, con su urgencia:
//   vencida (rojo) · hoy / mañana (naranja) · en 2 o 3 días (amarillo) · el resto.
// "Hecha" la pasa a COMPLETADO en Notion y desaparece de la lista.
// Solo el administrador (sesión de Supabase en Authorization: Bearer).
const { json, db } = require("./_lib/pass");
const { TASKS_DS, SONGS_DS } = require("./portal-songs");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const TZ = "America/Argentina/Buenos_Aires";
const AHEAD_DAYS = 21;
const MAX = 20;
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const STAGE = { Estructura: "Estructura", Prod: "Producción", Rec: "Grabación", Mix: "Mezcla", Master: "Master", "Distribución": "Distribución" };

async function notion(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

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

exports.handler = async (event) => {
  if (!notionToken()) return json(200, { connected: false, tasks: [] });
  if (!(await isAdmin(event))) return json(403, { error: "Solo para el administrador." });

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
    const id = String(body.task || "").replace(/[^0-9a-f-]/gi, "");
    if (!id) return json(400, { error: "Pedido inválido." });
    const res = await notion(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Estado de Tarea": { select: { name: "COMPLETADO" } } } }) });
    if (!res.ok) return json(502, { error: "Notion no dejó marcarla. Probá de nuevo." });
    return json(200, { ok: true });
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

  // Fechas límite de entrega (Canciones → Fecha de entrega). Si ya está
  // entregada o aprobada (Canciones → Entrega), no se recuerda más.
  const DONE = { Mix: ["Mezcla entregada", "Mezcla aprobada"], Master: ["Master entregado", "Master aprobado"] };
  const deadlines = ((sq.ok && sq.data.results) || []).map((sp) => {
    const p = sp.properties || {};
    const date = p["Fecha de entrega"] && p["Fecha de entrega"].date;
    const etapa = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
    if (!date || !date.start || !DONE[etapa]) return null;
    const entrega = p.Entrega && p.Entrega.select && p.Entrega.select.name;
    if (DONE[etapa].includes(entrega)) return null;
    return {
      id: sp.id, kind: "entrega", url: sp.url, name: plain(p["Canción"] && p["Canción"].title) || "Sin título", ...item(date),
      stage: etapa === "Mix" ? "Mezcla" : "Master",
      clientId: ((p.Artista && p.Artista.relation) || [])[0]?.id || null,
      songId: sp.id,
    };
  }).filter(Boolean)
    // Si ese día ya hay una sesión de la misma canción y etapa, alcanza con la sesión.
    .filter((d) => !sessions.some((s) => s.songId && s.songId.replace(/-/g, "") === d.songId.replace(/-/g, "") && s.stage === d.stage && dayKey(s.start) === dayKey(d.start)));

  const raw = [...sessions, ...deadlines].sort((x, y) => x.days - y.days || Date.parse(x.start) - Date.parse(y.start)).slice(0, MAX);

  // Nombres de artista y de canción (cada ficha, una vez).
  const clientIds = [...new Set(raw.map((t) => t.clientId).filter(Boolean))];
  const songIds = [...new Set(raw.filter((t) => t.kind === "sesion").map((t) => t.songId).filter(Boolean))];
  const [clients, songs] = await Promise.all([
    Promise.all(clientIds.map((id) => notion(`/pages/${id}`))),
    Promise.all(songIds.map((id) => notion(`/pages/${id}`))),
  ]);
  const titleOf = (res) => {
    if (!res.ok || !res.data) return null;
    const props = res.data.properties || {};
    const t = Object.values(props).find((x) => x && x.type === "title");
    return t ? plain(t.title) : null;
  };
  const cName = Object.fromEntries(clientIds.map((id, i) => [id, titleOf(clients[i])]));
  const sName = Object.fromEntries(songIds.map((id, i) => [id, titleOf(songs[i])]));
  const tasks = raw.map(({ clientId, songId, ...t }) => ({ ...t, artist: cName[clientId] || null, song: t.kind === "entrega" ? t.name : sName[songId] || null, clientId }));
  return json(200, { connected: true, tasks });
};

exports._urgency = urgency;
exports._daysFrom = daysFrom;
