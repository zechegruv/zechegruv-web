// ZECHE GRUV — Google Calendar del estudio, para el panel de administrador.
//
// Se conecta una sola vez desde el Inicio del panel ("Conectar Google
// Calendar"): Google pide permiso y devuelve una llave de larga duración
// (refresh token) que queda guardada en Supabase (tabla app_tokens, solo la
// lee el servidor). Con ella se piden accesos cortos cada vez que hace falta.
//
// Variables de entorno en Netlify (las da Google Cloud → Credenciales →
// "ID de cliente de OAuth", tipo Aplicación web):
//   GOOGLE_CLIENT_ID      ...apps.googleusercontent.com
//   GOOGLE_CLIENT_SECRET  la clave secreta de ese cliente
//   GOOGLE_CALENDAR_ID    (opcional) qué calendario; por defecto el principal
const crypto = require("crypto");
const { db } = require("./pass");

const clean = (v) => (v || "").replace(/[\s"'“”‘’]/g, "");
const clientId = () => clean(process.env.GOOGLE_CLIENT_ID);
const clientSecret = () => clean(process.env.GOOGLE_CLIENT_SECRET);
const calendarId = () => clean(process.env.GOOGLE_CALENDAR_ID) || "primary";
const SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy openid email";
const API = "https://www.googleapis.com/calendar/v3";
const configured = () => !!(clientId() && clientSecret());

// ---------- Conexión (una sola vez) ----------
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const sign = (text) => b64u(crypto.createHmac("sha256", clientSecret()).update(text).digest());
// El "state" va firmado y vence a los 15 minutos: así nadie más puede
// colgarle su propio calendario al panel.
function makeState() { const ts = String(Date.now()); return `${ts}.${sign(ts)}`; }
function validState(state) {
  const [ts, sig] = String(state || "").split(".");
  if (!ts || !sig || sig.length !== sign(ts).length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(ts)))) return false;
  return Date.now() - Number(ts) < 15 * 60 * 1000;
}
function authUrl(redirectUri) {
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri, response_type: "code", scope: SCOPES,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: makeState(),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function exchangeCode(code, redirectUri) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) return { ok: false, error: data.error_description || data.error || "Google no devolvió la llave." };
  let email = null;
  try { email = JSON.parse(Buffer.from(String(data.id_token || "").split(".")[1] || "", "base64").toString()).email || null; } catch (e) { /* sin mail */ }
  const saved = await db("app_tokens?on_conflict=provider", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { provider: "google_calendar", refresh_token: data.refresh_token, account: email, updated_at: new Date().toISOString() },
  });
  if (!saved.ok) return { ok: false, error: "No se pudo guardar la conexión (¿corriste supabase/024_google_calendar.sql?)." };
  cache = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return { ok: true, email };
}

// ---------- Acceso ----------
let cache = null;
async function status() {
  if (!configured()) return { configured: false, connected: false };
  const row = await db("app_tokens?provider=eq.google_calendar&select=account,updated_at");
  const r = row.ok && row.data && row.data[0];
  return { configured: true, connected: !!r, account: (r && r.account) || null };
}
async function accessToken() {
  if (cache && cache.until > Date.now()) return cache.token;
  if (!configured()) return null;
  const row = await db("app_tokens?provider=eq.google_calendar&select=refresh_token");
  const refresh = row.ok && row.data && row.data[0] && row.data[0].refresh_token;
  if (!refresh) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // Si Google la revocó (cambio de contraseña, permiso quitado), se borra
    // para que el panel vuelva a ofrecer "Conectar".
    if (data.error === "invalid_grant") await db("app_tokens?provider=eq.google_calendar", { method: "DELETE" });
    return null;
  }
  cache = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  return cache.token;
}
async function gcal(path, { method = "GET", body, query } = {}) {
  const token = await accessToken();
  if (!token) return { ok: false, status: 401, data: null };
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${API}${path}${qs}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}
const calPath = () => `/calendars/${encodeURIComponent(calendarId())}`;

// Horarios ocupados entre dos momentos (los eventos "libres", como las
// entregas de todo el día, no ocupan).
async function busy(fromISO, toISO) {
  const r = await gcal("/freeBusy", { method: "POST", body: { timeMin: fromISO, timeMax: toISO, timeZone: "America/Argentina/Buenos_Aires", items: [{ id: calendarId() }] } });
  if (!r.ok) return null;
  const cal = r.data && r.data.calendars && Object.values(r.data.calendars)[0];
  return ((cal && cal.busy) || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}
// Todos los eventos entre dos momentos. Google los da de a páginas (hasta
// 250 por pedido): se recorren todas, así ningún evento queda afuera en
// semanas cargadas. Si alguna página falla, null (mejor no decidir con la
// lista a medias). Tope de 20 páginas por las dudas.
async function events(fromISO, toISO, q) {
  const items = [];
  let pageToken = null;
  for (let i = 0; i < 20; i++) {
    const r = await gcal(`${calPath()}/events`, { query: { timeMin: fromISO, timeMax: toISO, singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(q ? { q } : {}), ...(pageToken ? { pageToken } : {}) } });
    if (!r.ok) return null;
    items.push(...((r.data && r.data.items) || []));
    pageToken = r.data && r.data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}
const patchEvent = (id, body) => gcal(`${calPath()}/events/${encodeURIComponent(id)}`, { method: "PATCH", body });
const createEvent = (body) => gcal(`${calPath()}/events`, { method: "POST", body });
// Borrar un evento: solo para deshacer uno que el mismo pedido acaba de crear
// (p. ej. reprogramar que falló a mitad de camino). Si ya no existe, cuenta como borrado.
async function deleteEvent(id) {
  const r = await gcal(`${calPath()}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  return { ...r, ok: r.ok || r.status === 404 || r.status === 410 };
}

// ---------- ¿Este evento es de esta canción? ----------
// Una sola regla para todas las búsquedas (tildar al aprobar o entregar,
// reprogramar, el ✓ del Inicio y las vencidas que se movieron en el
// calendario), para que nunca se confundan canciones parecidas.
//
// 1) Todo evento que crea el sistema lleva una marca escondida (no se ve en
//    el calendario): { zgSong: id de la canción sin guiones, zgStage:
//    "mezcla" | "master", zgKind: "sesion" | "entrega" }. Si el evento tiene
//    marca, manda la marca (aunque le cambies el título a mano).
// 2) Eventos viejos o creados a mano (sin marca): el título tiene que nombrar
//    la canción con palabras completas y sin nada de más. No cuenta lo que
//    está entre paréntesis ni, al final, el nombre del artista. Delante solo
//    pueden ir palabras como "Entrega:", "Mix", "Mezcla", "Master",
//    "Correcciones", "Modificaciones", "Sesión de".
//    Ejemplos con la canción «Luna»: "Mix – Luna (Pazz)" sí; "Mix – Luna
//    Llena (Pazz)" no. «Mar» no es "Mix – Otra (Layla Mar)". «Amor» no es
//    "Entrega: Mix Seu amor Rouse Bby". «Soltando Etiquetas» sí es
//    "Correcciones Mix Soltando Etiquetas (Pazz)".
const idKey = (id) => String(id || "").replace(/-/g, "").toLowerCase();
const words = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const PREFIX = new Set(["entrega", "sesion", "de", "del", "la", "el", "mix", "mezcla", "master", "mastering", "correccion", "correcciones", "modificacion", "modificaciones", "cambios"]);
const stageKey = (s) => (/master/i.test(String(s || "")) ? "master" : "mezcla");

// La marca escondida, para crear eventos. stage: "mezcla"/"Mix"/"Mezcla" o "master"/"Master".
function tag({ songId, stage, kind }) {
  return { private: { zgSong: idKey(songId), zgStage: stageKey(stage), zgKind: kind === "entrega" ? "entrega" : "sesion" } };
}

// "marca" (seguro por la marca), "nombre" (seguro por el título) o null.
//   song: { id, title, artist } · stage: mezcla/master · kind: sesion/entrega
//   (kind opcional: si falta, se deduce de si el evento es de todo el día).
function eventMatch(e, { id, title, artist }, stage, kind) {
  if (!e) return null;
  const evKind = e.start && e.start.date ? "entrega" : "sesion";
  const k = kind || evKind;
  const st = stageKey(stage);
  const mark = e.extendedProperties && e.extendedProperties.private;
  if (mark && mark.zgSong) {
    return mark.zgSong === idKey(id) && (mark.zgStage || st) === st && (mark.zgKind || evKind) === k ? "marca" : null;
  }
  if (evKind !== k) return null;
  const songW = words(title);
  if (!songW.length) return null;
  const summary = String(e.summary || "").replace(/^\s*([✓✗]\s*)+/, "").replace(/\([^)]*\)/g, " ");
  const all = words(summary);
  const isDelivery = all[0] === "entrega";
  if ((k === "entrega") !== isDelivery) return null;
  const artistW = words(artist);
  const fits = (w) => {
    if (w.length <= songW.length) return false;
    const tail = w.slice(w.length - songW.length);
    if (tail.join(" ") !== songW.join(" ")) return false;
    const head = w.slice(0, w.length - songW.length);
    // Delante, solo palabras de etapa, y tiene que decir cuál etapa.
    if (!head.every((x) => PREFIX.has(x))) return false;
    return st === "master" ? head.some((x) => x === "master" || x === "mastering") : head.some((x) => x === "mix" || x === "mezcla");
  };
  if (fits(all)) return "nombre";
  // El artista al final, sin paréntesis ("Entrega: Mix Seu amor Rouse Bby").
  if (artistW.length && all.length > artistW.length && all.slice(-artistW.length).join(" ") === artistW.join(" ") && fits(all.slice(0, -artistW.length))) return "nombre";
  return null;
}

module.exports = { configured, status, authUrl, validState, exchangeCode, busy, events, patchEvent, createEvent, deleteEvent, tag, eventMatch };
