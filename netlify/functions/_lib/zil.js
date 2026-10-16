// ZIL (distribuidora) — conexión con su API.
// Variables de entorno en Netlify:
//   ZIL_API_TOKEN  (secreta) token que da ZIL
//   ZIL_API_URL    https://api.dev.zil.gl para pruebas; la dirección real
//                  cuando esté todo probado
// La API no avisa sola cuando algo cambia: el estado de cada lanzamiento se
// consulta cada hora (zil-sync.js).
// Las respuestas de ZIL no traen ejemplos en su documentación, así que los
// ids y estados se leen de forma tolerante (id, _id, data.id…) y, ante
// cualquier respuesta rara, se corta con un error claro en vez de seguir.
const clean = (v) => String(v || "").replace(/[\s"'“”‘’]/g, "");
const base = () => clean(process.env.ZIL_API_URL || "https://api.dev.zil.gl").replace(/\/+$/, "");
const token = () => clean(process.env.ZIL_API_TOKEN);
const isDev = () => /\.dev\./.test(base());

class ZilError extends Error {
  constructor(step, status, detail) {
    super(`${step}: ZIL respondió ${status}${detail ? ` (${detail})` : ""}`);
    this.step = step; this.status = status; this.detail = detail;
  }
}

function client(startToken) {
  let current = startToken || token();
  async function call(step, method, path, body) {
    if (!current) throw new ZilError(step, "sin token", "falta ZIL_API_TOKEN en Netlify");
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${current}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 300) }; }
    if (!res.ok) {
      const msg = data && (data.message || data.error || data.msg || data.raw);
      throw new ZilError(step, res.status, typeof msg === "string" ? msg.slice(0, 200) : JSON.stringify(msg || "").slice(0, 200));
    }
    return data;
  }
  return {
    call,
    get token() { return current; },
    // Pasa a actuar como un usuario (la cuenta del sello o un artista).
    async loginAs(email) {
      const data = await call("Entrar como el sello", "POST", "/me/loginAdmin", { email });
      const t = data && (data.token || (data.data && data.data.token));
      if (!t) throw new ZilError("Entrar como el sello", "sin token", "la respuesta no trajo token");
      current = t;
      return data.user || (data.data && data.data.user) || null;
    },
  };
}

// Id de lo que devuelva ZIL, venga como venga.
function idOf(x) {
  if (!x || typeof x !== "object") return null;
  for (const k of ["_id", "id", "albumId", "projectId", "trackId", "artistId"]) if (x[k] && typeof x[k] !== "object") return String(x[k]);
  for (const k of ["data", "album", "project", "track", "artist", "result"]) { const v = x[k] && idOf(x[k]); if (v) return v; }
  return null;
}

// Lista dentro de la respuesta: [..] o { algo: [..] }.
function listOf(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") for (const v of Object.values(x)) { if (Array.isArray(v)) return v; }
  if (x && x.data && typeof x.data === "object") return listOf(x.data);
  return [];
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

module.exports = { client, idOf, listOf, norm, base, token, isDev, ZilError };
