// Acceso a una carpeta de OneDrive a partir de su link compartido de
// edición, con acceso de visitante (el mismo mecanismo que usa el portal
// para Referencias y Letras). Solo agrega archivos: si el nombre ya existe,
// OneDrive guarda el nuevo con otro nombre en vez de pisar el anterior.
const ONEDRIVE_API = "https://my.microsoftpersonalcontent.com/_api/v2.0";
const ONEDRIVE_TOKEN_URL = "https://api-badgerp.svc.ms/v1.0/token";
const ONEDRIVE_APP_ID = "5cbed6ac-a083-4e14-b191-b4ba07653de2";
const UPLOAD_HOST = /^https:\/\/([a-z0-9-]+\.)*microsoftpersonalcontent\.com\//i;

let cachedToken = null;
let cachedExpiresAt = 0;
async function auth() {
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

// Nombre de archivo sin caracteres que OneDrive no acepta ni rutas.
const cleanName = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 180);

// Carpeta a la que apunta el link: { headers, itemPath(name) } o { error }.
async function folder(editLink) {
  const headers = await auth();
  const shareId = "u!" + Buffer.from(editLink, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const res = await fetch(`${ONEDRIVE_API}/shares/${shareId}/driveitem`, { headers });
  if (!res.ok) return { error: `shares ${res.status}` };
  const root = await res.json();
  const driveId = root.parentReference && root.parentReference.driveId;
  if (!driveId || !root.id || !root.folder) return { error: "el link no es de una carpeta" };
  return { ...target(headers, driveId, root.id), name: root.name };
}

const target = (headers, driveId, itemId) => ({ headers, driveId, itemId, itemPath: (name) => `${ONEDRIVE_API}/drives/${driveId}/items/${itemId}:/${encodeURIComponent(name)}:` });

// Subcarpeta con ese nombre adentro de la carpeta (la crea si no existe).
// Si OneDrive no deja crearla, devuelve null y se sube a la carpeta misma.
async function subfolder(parent, name) {
  const base = `${ONEDRIVE_API}/drives/${parent.driveId}/items/${parent.itemId}/children`;
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const find = async () => {
    const res = await fetch(`${base}?$top=500`, { headers: parent.headers });
    if (!res.ok) return null;
    const hit = ((await res.json()).value || []).find((c) => c.folder && norm(c.name) === norm(name));
    return hit ? target(parent.headers, parent.driveId, hit.id) : null;
  };
  const found = await find();
  if (found) return found;
  const res = await fetch(base, {
    method: "POST",
    headers: { ...parent.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder: {}, "@name.conflictBehavior": "fail" }),
  });
  if (res.ok) {
    const made = await res.json().catch(() => null);
    if (made && made.id) return target(parent.headers, parent.driveId, made.id);
  }
  return find(); // la pudo haber creado otra subida al mismo tiempo
}

// Abre una subida por partes y devuelve la dirección a la que mandarlas.
async function createUploadSession(target, name) {
  const res = await fetch(`${target.itemPath(name)}/createUploadSession`, {
    method: "POST",
    headers: { ...target.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@name.conflictBehavior": "rename" } }),
  });
  const session = res.ok ? await res.json() : null;
  return session && session.uploadUrl ? session.uploadUrl : null;
}

async function putSmall(target, name, data) {
  const res = await fetch(`${target.itemPath(name)}/content?@name.conflictBehavior=rename`, { method: "PUT", headers: { ...target.headers, "Content-Type": "application/octet-stream" }, body: data });
  if (!res.ok) return null;
  const out = await res.json().catch(() => ({}));
  return out.name || name;
}

async function putChunk(uploadUrl, start, end, total, data) {
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Type": "application/octet-stream" }, body: data });
  if (!res.ok) return null;
  const out = await res.json().catch(() => ({}));
  return { done: !!out.id, name: out.name || null, nextExpectedRanges: out.nextExpectedRanges || null };
}

async function sessionStatus(uploadUrl) {
  const res = await fetch(uploadUrl);
  return res.ok ? res.json() : null;
}

module.exports = { UPLOAD_HOST, cleanName, folder, subfolder, createUploadSession, putSmall, putChunk, sessionStatus };
