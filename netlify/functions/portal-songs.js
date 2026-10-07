// GET /.netlify/functions/portal-songs[?artist=<id>]
// Las canciones de un artista y en qué etapa está cada una, leídas de la
// base "Canciones" del Notion de ZECHE GRUV. El portal las muestra en
// "Tus canciones": las que siguen en proceso arriba, y las que ya tienen el
// master aprobado en una lista aparte de terminadas.
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Cada artista ve solo sus canciones; el administrador puede pedir las de
//   cualquiera con ?artist=<id del perfil>.
// - Qué ficha de Notion corresponde a cada artista vive en artist_private
//   (notion_page_id), que solo lee el administrador y esta function.
// - Solo lectura, y solo estos datos: nombre, feat, etapa y fecha de
//   lanzamiento. Las fechas de entrega de mezcla y master no salen: el
//   artista ve en qué etapa está cada canción, no los plazos internos (los
//   maneja el estudio). Tampoco salen las Notas, las tareas, los pagos ni
//   los datos personales de la ficha.
//
// Variables de entorno en Netlify:
//   SUPABASE_SERVICE_ROLE_KEY (secreta)
//   NOTION_TOKEN (secreta): clave de la integración de Notion "Portal ZECHE
//     GRUV", con acceso a la base Canciones.
//   NOTION_SONGS_DS (opcional): ID de la base de datos Canciones.
//
// Qué ficha de Notion es de cada artista se encuentra solo: se busca en
// Clientes Zeche Gruv la ficha con el mismo mail que la cuenta del portal y,
// si no hay, la que tiene el mismo nombre artístico (sin importar tildes ni
// mayúsculas). El campo "Ficha en Notion" del perfil queda solo para forzar
// otra ficha cuando el mail y el nombre no coinciden.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const SONGS_DS = process.env.NOTION_SONGS_DS || "6682afe6-bf6d-47e6-9029-168199aa18da";
const TASKS_DS = process.env.NOTION_TASKS_DS || "0b31e043-55b6-82df-ab70-074084ffacba";
const CLIENTS_DS = process.env.NOTION_CLIENTS_DS || "d291e043-55b6-83fc-a0c7-0759bf96279f";
const TZ = "America/Argentina/Buenos_Aires";

// Etapas tal como están en Notion ("Etapa actual") -> cómo se ven en el
// portal. Las del proceso van en orden; desde Distribución el master ya
// está terminado y aprobado, así que la canción pasa a "Terminadas".
const STAGES = [
  ["Estructura", "estructura"],
  ["Prod", "produccion"],
  ["Rec", "grabacion"],
  ["Mix", "mezcla"],
  ["Master", "master"],
];
const DONE = { "Distribución": "distribucion", "Publicada": "publicada" };

// ---------- Notion ----------
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");

async function notionQuery(dataSource, filter) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/data_sources/${dataSource}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken()}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(filter ? { filter } : {}),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) {
      const err = new Error(`Notion respondió ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    const page = await res.json();
    results.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return results;
}

const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const dateOf = (prop) => (prop && prop.date && prop.date.start) || null;

// Solo los campos que el artista puede ver.
function toSong(page) {
  const p = page.properties || {};
  const stageName = p["Etapa actual"] && p["Etapa actual"].select ? p["Etapa actual"].select.name : null;
  const step = STAGES.findIndex(([name]) => name === stageName);
  return {
    id: page.id,
    title: plain(p["Canción"] && p["Canción"].title) || "Sin título",
    feat: plain(p.Feat && p.Feat.rich_text) || null,
    stage: step >= 0 ? STAGES[step][1] : DONE[stageName] || null,
    step, // 0 a 4 en proceso; -1 si terminó o no tiene etapa
    done: stageName in DONE,
    release: dateOf(p["Fecha de lanzamiento"]),
    updated: page.last_edited_time || null,
  };
}

// En proceso: primero la más avanzada. Terminadas: la última que salió (o
// va a salir) primero.
function split(songs) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, "es", { numeric: true, sensitivity: "base" });
  const active = songs.filter((s) => !s.done).sort((a, b) => b.step - a.step || byTitle(a, b));
  const done = songs.filter((s) => s.done).sort((a, b) =>
    (b.release || b.updated || "").localeCompare(a.release || a.updated || "") || byTitle(a, b));
  return { active, done };
}

// Próxima sesión: en Tareas Pendientes, las sesiones con el artista son las
// tareas con horario de inicio y de fin (p. ej. jue 15 a 17 h); las de mezcla
// o master en solitario tienen solo fecha y no cuentan. Se toma la primera
// que todavía no terminó y no está completada. Si en ese horario se trabajan
// varias canciones, van todas. La Descripción no sale: es interna.
const STAGE_KEY = Object.fromEntries([...STAGES, ...Object.entries(DONE)]);

function nextSession(tasks, songs, now = new Date()) {
  const titles = Object.fromEntries(songs.map((s) => [s.id.replace(/-/g, ""), s.title]));
  const slots = tasks.map((task) => {
    const p = task.properties || {};
    const date = p["Fecha de Vencimiento"] && p["Fecha de Vencimiento"].date;
    const state = p["Estado de Tarea"] && p["Estado de Tarea"].select && p["Estado de Tarea"].select.name;
    if (!date || !date.end || !/T/.test(date.start) || state === "COMPLETADO") return null;
    if (new Date(date.end) <= now) return null;
    const stageName = p.Etapa && p.Etapa.select ? p.Etapa.select.name : null;
    const song = ((p["Canción"] && p["Canción"].relation) || []).map((r) => titles[r.id.replace(/-/g, "")]).find(Boolean) || null;
    return { start: date.start, end: date.end, stage: STAGE_KEY[stageName] || null, song };
  }).filter(Boolean).sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!slots.length) return null;
  const first = slots[0];
  const same = slots.filter((s) => new Date(s.start).getTime() === new Date(first.start).getTime());
  const plan = [];
  same.forEach(({ stage, song }) => { if (!plan.some((x) => x.stage === stage && x.song === song)) plan.push({ stage, song }); });
  return { start: first.start, end: first.end, plan };
}

// ---------- Ficha del artista en Notion ----------
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Busca la ficha en Clientes Zeche Gruv: primero por mail, después por nombre.
async function findClient(profile) {
  const clients = await notionQuery(CLIENTS_DS, undefined);
  const email = norm(profile.email);
  const names = [profile.display_name, profile.full_name].map(norm).filter(Boolean);
  const field = (c, name) => (c.properties || {})[name];
  const byEmail = email && clients.find((c) => norm(field(c, "Correo Electrónico") && field(c, "Correo Electrónico").email) === email);
  if (byEmail) return byEmail.id;
  const byName = names.length && clients.find((c) => names.includes(norm(plain(field(c, "Nombre Artista") && field(c, "Nombre Artista").title))));
  return byName ? byName.id : null;
}

// Hoy en Buenos Aires, como "2026-10-07" (para filtrar en Notion).
const todayAR = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);

// Acepta el link de la ficha o el ID suelto, con o sin guiones.
function parsePageId(value) {
  const hex = String(value || "").replace(/-/g, "").match(/([0-9a-f]{32})(?![0-9a-f])/i);
  if (!hex) return null;
  const h = hex[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- Supabase ----------
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";
async function supabase(path, key, bearer) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${bearer || key}` } });
  return res.ok ? res.json() : null;
}
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'“”‘’]/g, "");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const serviceKey = serviceRoleKey();
  if (!serviceKey) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });

  const q = event.queryStringParameters || {};
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const user = token ? await supabase("/auth/v1/user", PUBLISHABLE_KEY, token) : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  const me = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=role`, serviceKey);
  if (!me) return json(500, { error: BAD_KEY });
  const admin = !!(me[0] && me[0].role === "admin");

  // Un artista siempre ve lo suyo; solo el administrador puede pedir otro perfil.
  let artistId = user.id;
  if (q.artist && q.artist !== user.id) {
    if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
    if (!admin) return json(403, { error: "No tenés permiso para ver esas canciones." });
    artistId = q.artist;
  }

  if (!notionToken()) return json(500, { error: "Falta NOTION_TOKEN en las variables de entorno de Netlify." });
  const rows = await supabase(`/rest/v1/artist_private?profile_id=eq.${artistId}&select=notion_page_id`, serviceKey);
  const profile = await supabase(`/rest/v1/profiles?id=eq.${artistId}&select=email,display_name,full_name`, serviceKey);
  if (!profile || !profile[0]) return json(500, { error: BAD_KEY });

  try {
    // La ficha elegida a mano manda; si no hay, se busca sola.
    const pageId = parsePageId(rows && rows[0] && rows[0].notion_page_id) || parsePageId(await findClient(profile[0]));
    if (!pageId) return json(200, { configured: false, active: [], done: [], next: null });

    const [songPages, tasks] = await Promise.all([
      notionQuery(SONGS_DS, { property: "Artista", relation: { contains: pageId } }),
      // Si la base de tareas no está conectada, el portal sigue mostrando las
      // canciones; solo falta el aviso de la próxima sesión.
      notionQuery(TASKS_DS, { and: [
        { property: "Cliente", relation: { contains: pageId } },
        { property: "Fecha de Vencimiento", date: { on_or_after: todayAR() } },
      ] }).catch(() => []),
    ]);
    const songs = songPages.map(toSong);
    return json(200, { configured: true, ...split(songs), next: nextSession(tasks, songs) });
  } catch (err) {
    // 404: la integración no tiene acceso a la base (hay que conectarla en Notion).
    const hint = admin && (err.status === 404 || err.status === 401)
      ? "Notion no deja leer las bases: revisá que la integración esté conectada a Clientes Zeche Gruv y Canciones, y que NOTION_TOKEN esté bien cargado."
      : "No pudimos traer tus canciones. Probá de nuevo en un momento.";
    return json(502, { error: hint });
  }
};

// Para pruebas.
exports._toSong = toSong;
exports._split = split;
exports._parsePageId = parsePageId;
exports._nextSession = nextSession;
exports._findClient = findClient;
