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
async function events(fromISO, toISO, q) {
  const r = await gcal(`${calPath()}/events`, { query: { timeMin: fromISO, timeMax: toISO, singleEvents: "true", orderBy: "startTime", maxResults: "100", ...(q ? { q } : {}) } });
  return r.ok ? (r.data.items || []) : null;
}
const patchEvent = (id, body) => gcal(`${calPath()}/events/${encodeURIComponent(id)}`, { method: "PATCH", body });
const createEvent = (body) => gcal(`${calPath()}/events`, { method: "POST", body });

module.exports = { configured, status, authUrl, validState, exchangeCode, busy, events, patchEvent, createEvent };
