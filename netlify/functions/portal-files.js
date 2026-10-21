// GET /.netlify/functions/portal-files?section=<seccion>[&artist=<id>]
// Lista los archivos de una sección (Referencias, Letras, Exports, Masters,
// Membresía) de la carpeta de OneDrive de un artista, para mostrarlos
// dentro del portal: nombre, fechas, tamaño y link de descarga.
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Cada artista ve solo su carpeta; el administrador puede pedir la de
//   cualquiera con ?artist=<id del perfil>.
// - El link de la carpeta vive en la tabla artist_private (solo la lee el
//   administrador y esta function), así el artista nunca recibe el link
//   completo: solo las secciones que el portal muestra.
// - Solo lectura: acá no hay forma de subir, mover ni borrar nada.
//
// Variables de entorno en Netlify: SUPABASE_SERVICE_ROLE_KEY (secreta).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";

// Sección del portal -> nombre de la subcarpeta en OneDrive.
const SECTIONS = {
  referencias: "Referencias",
  letras: "Letras",
  exports: "Exports",
  masters: "Masters",
  membresia: "Membresía",
};

// Lo que ve un productor (036_productor.sql): todo menos Membresía.
const PRODUCER_SECTIONS = ["referencias", "letras", "exports", "masters"];
const { producerCanSee } = require("./_lib/productor");

// Secciones donde el portal deja subir archivos (ver portal-upload.js).
const UPLOAD_SECTIONS = ["referencias", "letras"];

// Acceso de visitante al link compartido, igual que cuando alguien abre el
// link en el navegador sin iniciar sesión en Microsoft.
const ONEDRIVE_API = "https://my.microsoftpersonalcontent.com/_api/v2.0";
const ONEDRIVE_TOKEN_URL = "https://api-badgerp.svc.ms/v1.0/token";
const ONEDRIVE_APP_ID = "5cbed6ac-a083-4e14-b191-b4ba07653de2";

let cachedToken = null;
let cachedExpiresAt = 0;

async function oneDriveToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt) return cachedToken;
  const res = await fetch(ONEDRIVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: ONEDRIVE_APP_ID }),
  });
  if (!res.ok) throw new Error(`OneDrive no dio acceso (${res.status}).`);
  const data = await res.json();
  cachedToken = data.token;
  // El token dura varios días; se renueva con una hora de margen.
  cachedExpiresAt = Math.min(new Date(data.expiryTimeUtc).getTime() || 0, now + 24 * 60 * 60 * 1000) - 60 * 60 * 1000;
  return cachedToken;
}

async function oneDriveGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Badger ${await oneDriveToken()}`, Prefer: "autoredeem" },
  });
  if (!res.ok) throw new Error(`OneDrive respondió ${res.status}.`);
  return res.json();
}

async function listChildren(driveId, itemId) {
  const items = [];
  let url = `${ONEDRIVE_API}/drives/${driveId}/items/${itemId}/children?$top=200`;
  while (url) {
    const page = await oneDriveGet(url);
    items.push(...(page.value || []));
    url = page["@odata.nextLink"] || null;
  }
  return items;
}

// Para comparar nombres sin importar mayúsculas ni tildes.
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Archivos de sistema o auxiliares que no tiene sentido mostrar
// (.asd = análisis de Ableton, etc.).
const HIDDEN = /^(\.|~\$)|\.(asd|ini|tmp)$|^(thumbs\.db|icon\r?)$/i;

const byName = (a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
const newestFirst = (a, b) => (b.modified || "").localeCompare(a.modified || "") || byName(a, b);

// Qué es cada archivo según su nombre (sin importar mayúsculas):
// "vivo" -> versión para show en vivo, "master", "mix"/"mezcla", "rec".
// Si dice "vivo", es para vivo aunque también diga master. Solo se lee el
// nombre: no se copia ni se mueve nada.
// titles: títulos de canción que no cuentan (las subcarpetas son las
// canciones). Así «Estoy vivo - Mix v2.wav» es Mezcla y la maqueta de «Mix
// de emociones» no se marca como mezcla. Lo que está en una subcarpeta para
// vivo ("Para show en vivo") es para vivo.
const words = (s) => ` ${String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
// "Para show en vivo", "Vivo", "Versiones en vivo"… (no "Estoy vivo", que es
// una canción): igual que en _lib/song-audio.js.
const LIVE_WORDS = new Set(["vivo", "live", "para", "show", "shows", "en", "el", "la", "los", "las", "de", "del", "version", "versiones", "tracks", "pistas"]);
const isLiveFolder = (name) => {
  const w = words(name).trim().split(" ").filter(Boolean);
  return w.some((x) => x === "vivo" || x === "live") && w.every((x) => LIVE_WORDS.has(x));
};
function tagOf(name, titles = [], liveGroup = false) {
  let n = words(String(name || "").replace(/\.[a-z0-9]{2,5}$/i, ""));
  // Primero el título más largo ("Seu amor" antes que "Amor").
  [...titles].map((t) => words(t).trim()).filter(Boolean).sort((a, b) => b.length - a.length)
    .forEach((t) => { n = n.split(` ${t} `).join(" "); });
  if (liveGroup || / (vivo|live)\d* /.test(n)) return "vivo";
  if (/ (master|mastered|mstr)\d* /.test(n)) return "master";
  if (/ (mix|mezcla|mixdown)\d* /.test(n)) return "mezcla";
  if (/ (rec|grabacion)\d* /.test(n)) return "rec";
  return null;
}

function toFile(item, titles, liveGroup) {
  const fs = item.fileSystemInfo || {};
  return {
    tag: tagOf(item.name, titles, liveGroup),
    name: item.name,
    size: item.size || 0,
    created: fs.createdDateTime || item.createdDateTime || null,
    modified: fs.lastModifiedDateTime || item.lastModifiedDateTime || null,
    url: item["@content.downloadUrl"] || null,
  };
}

const visibleFiles = (items, titles, liveGroup) => items.filter((i) => i.file && !HIDDEN.test(i.name)).map((i) => toFile(i, titles, liveGroup)).sort(newestFirst);

// Devuelve los archivos sueltos de la sección y un grupo por subcarpeta
// (las subcarpetas agrupan por canción).
async function listSection(shareLink, folderName) {
  const shareId = "u!" + Buffer.from(shareLink, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const root = await oneDriveGet(`${ONEDRIVE_API}/shares/${shareId}/driveitem?$expand=children`);
  const driveId = root.parentReference && root.parentReference.driveId;
  const folder = (root.children || []).find((c) => c.folder && norm(c.name) === norm(folderName));
  if (!folder || !driveId) return { exists: false, files: [], groups: [] };

  const items = await listChildren(driveId, folder.id);
  const subfolders = items.filter((i) => i.folder && !HIDDEN.test(i.name));
  // Las subcarpetas son canciones (salvo la de vivo): sus títulos no cuentan
  // para la etiqueta, ni adentro de su carpeta ni en los archivos sueltos.
  const songTitles = subfolders.filter((sub) => !isLiveFolder(sub.name)).map((sub) => sub.name);
  const groups = await Promise.all(subfolders.map(async (sub) => {
    const live = isLiveFolder(sub.name);
    return {
      name: sub.name,
      files: sub.folder.childCount ? visibleFiles(await listChildren(driveId, sub.id), live ? songTitles : [sub.name], live) : [],
    };
  }));
  return { exists: true, files: visibleFiles(items, songTitles), groups: groups.sort(byName) };
}

// ---------- Supabase ----------
// Clave pública del proyecto (la misma que usa el navegador): alcanza para
// comprobar de quién es una sesión. La secreta se usa solo para leer datos.
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";
async function supabase(path, key, bearer) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${bearer || key}` } });
  return res.ok ? res.json() : null;
}

// La clave tal como está cargada en Netlify, sin espacios ni comillas que
// se hayan colado al pegarla (rompen los encabezados de las consultas).
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'\u201C\u201D\u2018\u2019]/g, "");

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
  const folderName = SECTIONS[q.section];
  if (!folderName) return json(400, { error: "Sección desconocida." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const user = token ? await supabase("/auth/v1/user", PUBLISHABLE_KEY, token) : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  // Artista inactivo (013_activos.sql): sin acceso, aunque su sesión
  // todavía no haya vencido. Se pide "*" para que ande también antes de
  // correr ese SQL.
  const caller = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=*`, serviceKey);
  if (!caller) return json(500, { error: BAD_KEY });
  if (caller[0] && caller[0].role !== "admin" && caller[0].active === false) return json(403, { error: INACTIVE });

  // Un artista siempre ve lo suyo; el administrador puede pedir otro perfil, y
  // el productor (036_productor.sql) solo los artistas que tiene asignados,
  // sin Membresía y sin poder subir.
  // Un Productor/Artista (037) ve su propia carpeta completa como artista;
  // la restricción vale solo cuando mira la de otro.
  const isAdmin = !!(caller[0] && caller[0].role === "admin");
  let producer = false; // mirando como productor
  let artistId = user.id;
  if (q.artist && q.artist !== user.id) {
    if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
    if (!isAdmin) {
      if (!PRODUCER_SECTIONS.includes(q.section) || !(await producerCanSee(caller[0], q.artist, serviceKey))) return json(403, { error: "No tenés permiso para ver esa carpeta." });
      producer = true;
    }
    artistId = q.artist;
  } else if (caller[0] && caller[0].role === "producer") {
    return json(200, { configured: false, exists: false, files: [], groups: [] });
  }

  const rows = await supabase(`/rest/v1/artist_private?profile_id=eq.${artistId}&select=onedrive_link,onedrive_edit_link`, serviceKey);
  if (!rows) return json(500, { error: BAD_KEY });
  // Con el link de edición alcanza para todo (leer, descargar y subir); el
  // de solo ver queda como respaldo para carpetas cargadas antes.
  const link = rows && rows[0] && (rows[0].onedrive_edit_link || rows[0].onedrive_link);
  if (!link) return json(200, { configured: false, exists: false, files: [], groups: [] });

  try {
    // Se puede subir desde el portal si la sección lo admite y hay link de edición cargado.
    const canUpload = !producer && UPLOAD_SECTIONS.includes(q.section) && !!rows[0].onedrive_edit_link;
    return json(200, { configured: true, canUpload, ...(await listSection(link, folderName)) });
  } catch (err) {
    return json(502, { error: "No pudimos leer la carpeta de OneDrive. Probá de nuevo en un momento." });
  }
};

// Para pruebas.
exports._listSection = listSection;
exports._tagOf = tagOf;
