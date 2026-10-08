// POST /.netlify/functions/portal-upload
// Subida de archivos a Referencias y Letras de la carpeta de OneDrive de un
// artista. Solo agrega archivos: no hay forma de borrar, mover ni
// renombrar, y si el nombre ya existe OneDrive guarda el nuevo con otro
// nombre en vez de pisar el anterior. Tampoco crea carpetas: sube a la
// carpeta de la sección o a una subcarpeta (canción) que ya exista.
//
// El archivo no pasa entero por acá (Netlify limita el tamaño): se abre
// una "sesión de subida" en OneDrive y el navegador manda el archivo en
// partes, directo a OneDrive o, si el navegador no puede, a través de
// esta misma function.
//
// Acciones (campo "action" del cuerpo):
//   start  { section, artist?, name, size, group? } -> { mode: "session", uploadUrl } | { mode: "simple" }
//   chunk  { uploadUrl, start, end, total, data(base64) }  -> reenvía una parte
//   status { uploadUrl }                                    -> qué partes faltan
//   simple { section, artist?, name, group?, data(base64) } -> archivos chicos, de una sola vez
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Cada artista sube solo a su carpeta; el administrador, a la de cualquiera.
// - Usa el link de edición de la carpeta (artist_private.onedrive_edit_link),
//   que el artista nunca recibe.
//
// Variables de entorno en Netlify: SUPABASE_SERVICE_ROLE_KEY (secreta).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'“”‘’]/g, "");

// Secciones donde se puede subir, con su carpeta, tipos de archivo y tamaño máximo.
const MB = 1024 * 1024;
const SECTIONS = {
  referencias: { folder: "Referencias", max: 300 * MB, types: /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff|mp4|mov|pdf|txt|jpg|jpeg|png)$/i },
  letras: { folder: "Letras", max: 25 * MB, types: /\.(txt|doc|docx|pdf|rtf|md|pages|odt)$/i },
};
const SIMPLE_MAX = 4 * MB; // lo que entra en un solo pedido a esta function

const ONEDRIVE_API = "https://my.microsoftpersonalcontent.com/_api/v2.0";
const ONEDRIVE_TOKEN_URL = "https://api-badgerp.svc.ms/v1.0/token";
const ONEDRIVE_APP_ID = "5cbed6ac-a083-4e14-b191-b4ba07653de2";
const UPLOAD_HOST = /^https:\/\/([a-z0-9-]+\.)*microsoftpersonalcontent\.com\//i;

const INACTIVE = "Tu acceso al portal está pausado. Si querés retomar, escribinos por WhatsApp.";
const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});
// Error con un detalle técnico corto, para poder diagnosticar desde una captura.
const fail = (statusCode, error, detail) => json(statusCode, { error, detail });

let cachedToken = null;
let cachedExpiresAt = 0;
async function oneDriveAuth() {
  const now = Date.now();
  if (!cachedToken || now >= cachedExpiresAt) {
    const res = await fetch(ONEDRIVE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: ONEDRIVE_APP_ID }) });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const data = await res.json();
    cachedToken = data.token;
    cachedExpiresAt = Math.min(new Date(data.expiryTimeUtc).getTime() || 0, now + 24 * 60 * 60 * 1000) - 60 * 60 * 1000;
  }
  return { Authorization: `Badger ${cachedToken}`, Prefer: "autoredeem" };
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Nombre de archivo sin caracteres que OneDrive no acepta ni rutas.
const cleanName = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 180);

async function supabase(path, key, bearer) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${bearer || key}` } });
  return res.ok ? res.json() : null;
}

// Ubica la carpeta de destino dentro del link de edición del artista.
async function findParent(editLink, folderName, group) {
  const auth = await oneDriveAuth();
  const shareId = "u!" + Buffer.from(editLink, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const rootRes = await fetch(`${ONEDRIVE_API}/shares/${shareId}/driveitem?$expand=children`, { headers: auth });
  if (!rootRes.ok) return { error: fail(502, "No pudimos abrir la carpeta de OneDrive. Revisá el link de edición en el perfil del artista.", `shares ${rootRes.status}`) };
  const root = await rootRes.json();
  const driveId = root.parentReference && root.parentReference.driveId;
  const section = (root.children || []).find((c) => c.folder && norm(c.name) === norm(folderName));
  if (!driveId || !section) return { error: fail(409, `La carpeta “${folderName}” todavía no existe en el OneDrive de este artista.`, "sin carpeta") };
  if (!group) return { auth, driveId, parentId: section.id };

  const kidsRes = await fetch(`${ONEDRIVE_API}/drives/${driveId}/items/${section.id}/children?$top=200`, { headers: auth });
  if (!kidsRes.ok) return { error: fail(502, "No pudimos leer la carpeta de OneDrive.", `children ${kidsRes.status}`) };
  const sub = ((await kidsRes.json()).value || []).find((c) => c.folder && norm(c.name) === norm(group));
  if (!sub) return { error: fail(400, "Esa canción ya no existe en la carpeta. Volvé a abrir la sección.", "sin grupo") };
  return { auth, driveId, parentId: sub.id };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  const serviceKey = serviceRoleKey();
  if (!serviceKey) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const user = token ? await supabase("/auth/v1/user", PUBLISHABLE_KEY, token) : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }

  try {
    // ---- Partes de una subida ya abierta ----
    if (body.action === "chunk" || body.action === "status") {
      const url = String(body.uploadUrl || "");
      if (!UPLOAD_HOST.test(url)) return json(400, { error: "Subida inválida." });
      if (body.action === "status") {
        const res = await fetch(url);
        if (!res.ok) return fail(502, "Se cortó la subida. Probá de nuevo.", `status ${res.status}`);
        return json(200, await res.json());
      }
      const start = Number(body.start), end = Number(body.end), total = Number(body.total);
      const data = Buffer.from(String(body.data || ""), "base64");
      if (!(start >= 0 && end >= start && total > end)) return json(400, { error: "Subida inválida." });
      const res = await fetch(url, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Type": "application/octet-stream" }, body: data });
      if (!res.ok) return fail(502, "Se cortó la subida. Probá de nuevo.", `chunk ${res.status}`);
      const out = await res.json().catch(() => ({}));
      return json(200, { done: !!out.id, name: out.name || null, nextExpectedRanges: out.nextExpectedRanges || null });
    }

    // ---- Abrir una subida ----
    if (body.action !== "start" && body.action !== "simple") return json(400, { error: "Acción desconocida." });
    const section = SECTIONS[body.section];
    if (!section) return json(400, { error: "En esta sección no se pueden subir archivos." });
    const name = cleanName(body.name);
    if (!name || !section.types.test(name)) return json(400, { error: "Ese tipo de archivo no se puede subir a esta sección." });

    // Artista inactivo (013_activos.sql): sin acceso, aunque su sesión
    // todavía no haya vencido. Se pide "*" para que ande también antes de
    // correr ese SQL.
    const caller = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=*`, serviceKey);
    if (!caller) return json(500, { error: BAD_KEY });
    if (caller[0] && caller[0].role !== "admin" && caller[0].active === false) return json(403, { error: INACTIVE });

    // Un artista siempre sube a lo suyo; solo el administrador puede elegir otro perfil.
    let artistId = user.id;
    if (body.artist && body.artist !== user.id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.artist))) return json(400, { error: "Artista inválido." });
      const me = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=role`, serviceKey);
      if (!me) return json(500, { error: BAD_KEY });
      if (!me[0] || me[0].role !== "admin") return json(403, { error: "No tenés permiso para subir a esa carpeta." });
      artistId = body.artist;
    }
    const rows = await supabase(`/rest/v1/artist_private?profile_id=eq.${artistId}&select=onedrive_edit_link`, serviceKey);
    if (!rows) return json(500, { error: BAD_KEY });
    const editLink = rows[0] && rows[0].onedrive_edit_link;
    if (!editLink) return fail(409, "La subida todavía no está habilitada para esta carpeta.", "sin link de edición");

    const group = body.group ? String(body.group) : "";
    const target = await findParent(editLink, section.folder, group);
    if (target.error) return target.error;
    const itemPath = `${ONEDRIVE_API}/drives/${target.driveId}/items/${target.parentId}:/${encodeURIComponent(name)}:`;

    if (body.action === "simple") {
      const data = Buffer.from(String(body.data || ""), "base64");
      if (!data.length || data.length > SIMPLE_MAX) return json(400, { error: "El archivo es demasiado grande para esta forma de subida." });
      const res = await fetch(`${itemPath}/content?@name.conflictBehavior=rename`, { method: "PUT", headers: { ...target.auth, "Content-Type": "application/octet-stream" }, body: data });
      if (!res.ok) return fail(502, "OneDrive no aceptó el archivo.", `simple ${res.status}`);
      const out = await res.json().catch(() => ({}));
      return json(200, { done: true, name: out.name || name });
    }

    const size = Number(body.size);
    if (!(size > 0)) return json(400, { error: "El archivo está vacío." });
    if (size > section.max) return json(400, { error: `El archivo pesa más de ${Math.round(section.max / MB)} MB.` });

    const res = await fetch(`${itemPath}/createUploadSession`, {
      method: "POST",
      headers: { ...target.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@name.conflictBehavior": "rename" } }),
    });
    if (res.ok) {
      const session = await res.json();
      if (session.uploadUrl) return json(200, { mode: "session", uploadUrl: session.uploadUrl, name });
    }
    // Sin sesión de subida, los archivos chicos igual pueden ir de una sola vez.
    if (size <= SIMPLE_MAX) return json(200, { mode: "simple", name });
    return fail(502, "OneDrive no aceptó abrir la subida de este archivo.", `session ${res.status}`);
  } catch (err) {
    return fail(502, "No pudimos conectar con OneDrive. Probá de nuevo en un momento.", String(err && err.message).slice(0, 80));
  }
};
