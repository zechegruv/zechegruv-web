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

function toFile(item) {
  const fs = item.fileSystemInfo || {};
  return {
    name: item.name,
    size: item.size || 0,
    created: fs.createdDateTime || item.createdDateTime || null,
    modified: fs.lastModifiedDateTime || item.lastModifiedDateTime || null,
    url: item["@content.downloadUrl"] || null,
  };
}

const visibleFiles = (items) => items.filter((i) => i.file && !HIDDEN.test(i.name)).map(toFile).sort(newestFirst);

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
  const groups = await Promise.all(subfolders.map(async (sub) => ({
    name: sub.name,
    files: sub.folder.childCount ? visibleFiles(await listChildren(driveId, sub.id)) : [],
  })));
  return { exists: true, files: visibleFiles(items), groups: groups.sort(byName) };
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

  // Un artista siempre ve lo suyo; solo el administrador puede pedir otro perfil.
  let artistId = user.id;
  if (q.artist && q.artist !== user.id) {
    if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
    const me = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=role`, serviceKey);
    if (!me) return json(500, { error: BAD_KEY });
    if (!me[0] || me[0].role !== "admin") return json(403, { error: "No tenés permiso para ver esa carpeta." });
    artistId = q.artist;
  }

  const rows = await supabase(`/rest/v1/artist_private?profile_id=eq.${artistId}&select=onedrive_link,onedrive_edit_link`, serviceKey);
  if (!rows) return json(500, { error: BAD_KEY });
  const link = rows && rows[0] && rows[0].onedrive_link;
  if (!link) return json(200, { configured: false, exists: false, files: [], groups: [] });

  try {
    // Se puede subir desde el portal si la sección lo admite y hay link de edición cargado.
    const canUpload = UPLOAD_SECTIONS.includes(q.section) && !!rows[0].onedrive_edit_link;
    return json(200, { configured: true, canUpload, ...(await listSection(link, folderName)) });
  } catch (err) {
    return json(502, { error: "No pudimos leer la carpeta de OneDrive. Probá de nuevo en un momento." });
  }
};

// Para pruebas.
exports._listSection = listSection;
