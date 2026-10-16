// GET /.netlify/functions/zil-genres
// Lista oficial de géneros de ZIL para el buscador de la ficha de
// lanzamiento: [{ code, name }]. Hace falta estar en el portal (sesión de
// Supabase); se guarda en memoria unas horas para no consultar a ZIL cada vez.
const { SUPABASE_URL, json } = require("./_lib/pass");
const { client, token } = require("./_lib/zil");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
let cache = null, cachedAt = 0;

// "ALTERNATIVE / INDIE ROCK" -> "Alternative / Indie Rock" (siglas como R&B o EDM quedan igual).
const pretty = (s) => String(s).toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(r&b|edm|k-pop|j-pop|dj|uk|us|mpb|lo-fi)\b/gi, (m) => m.toUpperCase());

exports.handler = async (event) => {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const t = auth.replace(/^Bearer\s+/i, "");
  if (!t) return json(401, { error: "Iniciá sesión de nuevo." });
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${t}` } });
  if (!u.ok) return json(401, { error: "Iniciá sesión de nuevo." });
  if (!token()) return json(200, { genres: [] });

  if (!cache || Date.now() - cachedAt > 6 * 3600 * 1000) {
    try {
      const raw = await client().call("Leer géneros", "GET", "/genres");
      const list = Array.isArray(raw)
        ? raw.map((g) => (typeof g === "string" ? { code: g, name: g } : { code: g.code || g.id || g.value, name: g.name || g.label || g.code }))
        : Object.entries(raw || {}).filter(([, v]) => typeof v === "string").map(([code, name]) => ({ code, name }));
      cache = list.filter((g) => g.code && g.name).map((g) => ({ code: g.code, name: pretty(g.name) })).sort((a, b) => a.name.localeCompare(b.name, "es"));
      cachedAt = Date.now();
    } catch (err) {
      if (!cache) return json(200, { genres: [], error: "No pudimos traer los géneros de ZIL." });
    }
  }
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" }, body: JSON.stringify({ genres: cache }) };
};
