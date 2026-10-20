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
// - Aprobar mezcla y master (portal-review.js): la mezcla o el master se
//   detectan solos en la carpeta de OneDrive del artista (un audio con
//   "mix"/"mezcla" o "master" en el nombre, ver _lib/song-audio.js). Cada
//   canción en Mezcla o Master trae "delivery": en qué está (proceso,
//   aprobar, cambios o aprobada), el audio entregado para escucharlo y lo
//   último que dijo el artista (con sus notas marcadas en el tiempo).
//   Mientras Zeche mezcla y todavía no subió el audio, la canción figura
//   "en proceso de mezcla" y no hay nada que aprobar.
//
// Variables de entorno en Netlify:
//   SUPABASE_SERVICE_ROLE_KEY (secreta)
//   NOTION_TOKEN (secreta): clave de la integración de Notion "Portal ZECHE
//     GRUV", con acceso a la base Canciones.
//   NOTION_SONGS_DS (opcional): ID de la base de datos Canciones.
//
// Qué ficha de Notion es de cada artista se encuentra sola: se busca en
// Clientes Zeche Gruv la ficha con el mismo mail que la cuenta del portal y,
// si no hay, la que tiene como nombre el nombre completo del perfil (sin
// importar tildes ni mayúsculas). Nunca por el nombre que se ve en el portal
// (display_name): ese lo cambia el propio artista, y con eso podía ver y
// aprobar canciones de otro. Apenas se encuentra, queda guardada en
// artist_private.notion_page_id (032_portal.sql): desde ahí manda esa, aunque
// después cambie el nombre o el mail. El campo "Ficha en Notion" del perfil
// sirve para elegir otra a mano cuando el mail y el nombre no coinciden.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const SONGS_DS = process.env.NOTION_SONGS_DS || "6682afe6-bf6d-47e6-9029-168199aa18da";
const TASKS_DS = process.env.NOTION_TASKS_DS || "0b31e043-55b6-82df-ab70-074084ffacba";
const CLIENTS_DS = process.env.NOTION_CLIENTS_DS || "d291e043-55b6-83fc-a0c7-0759bf96279f";
const TZ = "America/Argentina/Buenos_Aires";
const { listAudio, matchAudio } = require("./_lib/song-audio");

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
    // Con reintento si Notion está saturado un momento (_lib/notion.js).
    const res = await require("./_lib/notion").notion(`/data_sources/${dataSource}/query`, {
      method: "POST",
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
    const page = res.data || {};
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
    // Estado a mano de la mezcla o el master (Notion → "Entrega"): lo marcan
    // los botones Entregado / Aprobado del administrador, o se cambia en Notion.
    entrega: (p.Entrega && p.Entrega.select && p.Entrega.select.name) || null,
  };
}

// ---------- Mezcla y master entregados ----------
// Qué se aprueba en cada etapa: en Mezcla la mezcla, en Master el master.
const REVIEW_KIND = { 3: "mezcla", 4: "master" };
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");
const time = (iso) => Date.parse(iso || "") || 0;

function reviewOut(r) {
  return r ? { action: r.action, note: r.note || null, marks: Array.isArray(r.marks) ? r.marks : [], version: r.version || null, at: r.created_at } : null;
}

// proceso  -> Zeche está trabajando; todavía no hay audio entregado.
// aprobar  -> hay algo nuevo para escuchar y aprobar (o pedir cambios): un
//             audio nuevo en la carpeta o Zeche lo marcó "Entregado".
// cambios  -> el artista pidió cambios; Zeche los está haciendo. Cuando sube
//             una versión nueva (o vuelve a tocar "Entregado"), vuelve a "aprobar".
// aprobada -> el artista lo aprobó, o Zeche lo marcó "Aprobado" (en el
//             portal o en Notion → Entrega: "Mezcla aprobada" / "Master aprobado").
// Gana lo último que pasó: el audio subido, lo que hizo el artista, el botón
// del administrador o el cambio en Notion.
const MANUAL = {
  "Mezcla entregada": ["mezcla", "entregada"], "Mezcla aprobada": ["mezcla", "aprobada"],
  "Master entregado": ["master", "entregada"], "Master aprobado": ["master", "aprobada"],
};
const STATE_OF = { aprobada: "aprobada", cambios: "cambios", entregada: "aprobar" };

function deliveryOf(song, files, rows) {
  const kind = REVIEW_KIND[song.step] || (song.done ? "master" : null);
  if (!kind) return null;
  const mine = (rows || []).filter((r) => sameId(r.song_id, song.id) && r.kind === kind);
  const last = mine[0] || null; // de cualquiera (artista o admin)
  const lastArtist = mine.find((r) => (r.source || "artist") === "artist") || null;
  const file = (files[song.id] || {})[kind] || null;
  const manual = MANUAL[song.entrega];
  const manualHere = manual && manual[0] === kind ? manual[1] : null;
  let state;
  if (song.done || manualHere === "aprobada") state = "aprobada";
  else {
    const events = [];
    if (file) events.push([time(file.modified), "aprobar"]);
    if (last) events.push([time(last.created_at), STATE_OF[last.action] || "cambios"]);
    if (manualHere === "entregada") events.push([time(song.updated), "aprobar"]);
    events.sort((a, b) => b[0] - a[0]);
    state = events.length ? events[0][1] : "proceso";
  }
  const out = state === "proceso" || !file ? null : { name: file.name, url: file.url, modified: file.modified, size: file.size || 0 };
  const slot = files[song.id] || {};
  const pub = (a) => (a ? { name: a.name, url: a.url, modified: a.modified, size: a.size || 0 } : null);
  // Para comparar: las versiones anteriores de esta misma etapa (A/B) y la
  // maqueta (antes y después). Solo si hay algo entregado para escuchar.
  const versions = out ? ((slot.versions && slot.versions[kind]) || []).filter((a) => a.name !== out.name || a.modified !== out.modified).slice(0, 3).map(pub) : [];
  return { kind, state, file: out, versions, demo: out ? pub(slot.demo) : null, review: reviewOut(lastArtist), manual: manualHere, by: last ? last.source || "artist" : null };
}

function withDelivery(songs, files, rows) {
  return songs.map((song) => {
    const delivery = deliveryOf(song, files || {}, rows);
    return {
      ...song,
      delivery,
      // Lo de siempre (Mi proyecto, el menú): hay algo para aprobar.
      ready: !!delivery && delivery.state === "aprobar",
      review: delivery && delivery.review ? { kind: delivery.kind, ...delivery.review } : null,
    };
  });
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
    if (!date || !date.end || !/T/.test(date.start) || state === "COMPLETADO" || state === "INACTIVA") return null;
    if (new Date(date.end) <= now) return null;
    const stageName = p.Etapa && p.Etapa.select ? p.Etapa.select.name : null;
    // Mezcla, master y distribución los hace Zeche solo (aunque tengan
    // horario, p. ej. agendadas solas): no son una sesión con el artista.
    if (["Mix", "Master", "Distribución"].includes(stageName)) return null;
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

// Busca la ficha en Clientes Zeche Gruv: primero por mail, después por
// nombre completo (los dos los carga solo el administrador). Lo encontrado
// se recuerda unos minutos (mientras la function siga activa) para no
// recorrer la base de clientes en cada visita, y queda guardado en
// artist_private para que la próxima vez no haya que buscarla.
const clientCache = new Map(); // "mail|nombre completo" -> { id, at }
async function findClient(profile) {
  const key = [profile.email, profile.full_name].join("|");
  const hit = clientCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.id;
  const id = await searchClient(profile);
  clientCache.set(key, { id, at: Date.now() });
  if (id && profile.id) await rememberClient(profile.id, id).catch(() => null);
  return id;
}

async function searchClient(profile) {
  const clients = await notionQuery(CLIENTS_DS, undefined);
  const email = norm(profile.email);
  const names = [profile.full_name].map(norm).filter(Boolean);
  const field = (c, name) => (c.properties || {})[name];
  const byEmail = email && clients.find((c) => norm(field(c, "Correo Electrónico") && field(c, "Correo Electrónico").email) === email);
  if (byEmail) return byEmail.id;
  const byName = names.length && clients.find((c) => names.includes(norm(plain(field(c, "Nombre Artista") && field(c, "Nombre Artista").title))));
  return byName ? byName.id : null;
}

// La ficha encontrada queda fija en artist_private.notion_page_id (como si
// el administrador la hubiera pegado a mano: el ID suelto, sin guiones).
// Solo si todavía no tenía una: la elegida a mano nunca se pisa. Si el
// artista todavía no tiene fila (sin carpeta), se crea. Si la base no deja
// guardar (falta correr 032_portal.sql), no pasa nada: se vuelve a buscar.
async function rememberClient(profileId, pageId) {
  const key = serviceRoleKey();
  const hex = String(pageId).replace(/-/g, "").toLowerCase();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
  const body = JSON.stringify({ notion_page_id: hex, updated_at: new Date().toISOString() });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/artist_private?profile_id=eq.${profileId}&notion_page_id=is.null`, { method: "PATCH", headers, body });
  const hit = res.ok ? await res.json().catch(() => []) : [];
  if (res.ok && Array.isArray(hit) && hit.length) return true;
  const exists = await supabase(`/rest/v1/artist_private?profile_id=eq.${profileId}&select=profile_id`, key);
  if (exists && exists.length) return false; // ya tiene una elegida a mano
  const made = await fetch(`${SUPABASE_URL}/rest/v1/artist_private?on_conflict=profile_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ profile_id: profileId, notion_page_id: hex, updated_at: new Date().toISOString() }),
  });
  return made.ok;
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

const INACTIVE = "Tu acceso al portal está pausado. Si querés retomar, escribinos por WhatsApp.";
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

  // "*" para que ande también antes de correr 013_activos.sql.
  const me = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=*`, serviceKey);
  if (!me) return json(500, { error: BAD_KEY });
  const admin = !!(me[0] && me[0].role === "admin");
  // Artista inactivo: sin acceso, aunque su sesión todavía no haya vencido.
  if (!admin && me[0] && me[0].active === false) return json(403, { error: INACTIVE });

  // Un artista siempre ve lo suyo; solo el administrador puede pedir otro perfil.
  let artistId = user.id;
  if (q.artist && q.artist !== user.id) {
    if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
    if (!admin) return json(403, { error: "No tenés permiso para ver esas canciones." });
    artistId = q.artist;
  }

  if (!notionToken()) return json(500, { error: "Falta NOTION_TOKEN en las variables de entorno de Netlify." });
  const [rows, profile] = await Promise.all([
    supabase(`/rest/v1/artist_private?profile_id=eq.${artistId}&select=notion_page_id,onedrive_link,onedrive_edit_link`, serviceKey),
    supabase(`/rest/v1/profiles?id=eq.${artistId}&select=id,email,full_name`, serviceKey),
  ]);
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
    const base = songPages.map(toSong);
    // Aprobaciones (020 y 021_notas_en_el_tiempo.sql) y los audios de mezcla
    // y master de su carpeta de OneDrive. Si falta alguno (la tabla todavía
    // no existe, OneDrive no responde), las canciones se muestran igual.
    const folder = rows && rows[0] && (rows[0].onedrive_edit_link || rows[0].onedrive_link);
    const [reviews, audios] = await Promise.all([
      supabase(`/rest/v1/song_approvals?profile_id=eq.${artistId}&select=*&order=created_at.desc&limit=300`, serviceKey),
      folder ? listAudio(folder).catch(() => []) : Promise.resolve([]),
    ]);
    // Las entregas automáticas (marcar entregado en Notion, cerrar la sesión,
    // tildar el calendario y avisarle por mail: _lib/auto-entregas.js) ya no
    // se hacen acá: el artista esperaba todo eso cada vez que abría sus
    // canciones. Las hace la función programada cada 15 minutos y el Inicio
    // del panel. Lo que ve el artista no cambia: el audio nuevo de la
    // carpeta ya alcanza para que le aparezca para escuchar y aprobar
    // (deliveryOf), aunque Notion se actualice unos minutos después.
    const songs = withDelivery(base, matchAudio(base, audios), Array.isArray(reviews) ? reviews : []);
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
exports._withDelivery = withDelivery;
exports._deliveryOf = deliveryOf;
exports.MANUAL = MANUAL;
exports.TASKS_DS = TASKS_DS;
exports.CLIENTS_DS = CLIENTS_DS;
exports._parsePageId = parsePageId;
exports._nextSession = nextSession;
exports._findClient = findClient;
exports._notionQuery = notionQuery;
exports.SONGS_DS = SONGS_DS;
