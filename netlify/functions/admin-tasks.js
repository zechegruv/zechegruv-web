// GET  /.netlify/functions/admin-tasks              -> próximas tareas
// POST /.netlify/functions/admin-tasks { task }     -> marcarla como hecha
// Para el Inicio del panel de administrador: las tareas de "Tareas
// Pendientes" en Notion que no están completadas, por fecha (las vencidas
// primero) y con su urgencia:
//   vencida (rojo) · hoy / mañana (naranja) · en 2 o 3 días (amarillo) · el resto.
// "Hecha" la pasa a COMPLETADO en Notion y desaparece de la lista.
// Solo el administrador (sesión de Supabase en Authorization: Bearer).
const { json, db } = require("./_lib/pass");
const { TASKS_DS } = require("./portal-songs");

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
  const q = await notion(`/data_sources/${TASKS_DS}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { and: [
        { property: "Estado de Tarea", select: { does_not_equal: "COMPLETADO" } },
        { property: "Fecha de Vencimiento", date: { on_or_before: dayAR(limit) } },
      ] },
      sorts: [{ property: "Fecha de Vencimiento", direction: "ascending" }],
      page_size: 100,
    }),
  });
  if (!q.ok) return json(502, { error: "No pudimos leer Tareas Pendientes en Notion." });

  const raw = (q.data.results || []).slice(0, MAX).map((t) => {
    const p = t.properties || {};
    const date = p["Fecha de Vencimiento"] && p["Fecha de Vencimiento"].date;
    if (!date || !date.start) return null;
    const days = daysFrom(date.start);
    return {
      id: t.id,
      url: t.url,
      name: plain(p.Nombre && p.Nombre.title) || "Sin nombre",
      start: date.start,
      end: date.end || null,
      timed: /T/.test(date.start),
      days,
      urgency: urgency(days),
      state: (p["Estado de Tarea"] && p["Estado de Tarea"].select && p["Estado de Tarea"].select.name) || null,
      stage: STAGE[p.Etapa && p.Etapa.select && p.Etapa.select.name] || null,
      clientId: ((p.Cliente && p.Cliente.relation) || [])[0]?.id || null,
      songId: ((p["Canción"] && p["Canción"].relation) || [])[0]?.id || null,
    };
  }).filter(Boolean);

  // Nombres de artista y de canción (una consulta de clientes + cada canción).
  const clientIds = [...new Set(raw.map((t) => t.clientId).filter(Boolean))];
  const songIds = [...new Set(raw.map((t) => t.songId).filter(Boolean))];
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
  const tasks = raw.map(({ clientId, songId, ...t }) => ({ ...t, artist: cName[clientId] || null, song: sName[songId] || null, clientId }));
  return json(200, { connected: true, tasks });
};

exports._urgency = urgency;
exports._daysFrom = daysFrom;
