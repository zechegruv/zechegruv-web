// GET /.netlify/functions/portal-whatsapp[?artist=<id>]
// ¿A qué número le llegan los avisos por WhatsApp? Lo usa el Perfil del
// artista (para el interruptor "Avisos por WhatsApp") y la ficha del artista
// en el panel del administrador (una línea, solo lectura).
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Cada artista ve solo lo suyo; el administrador puede pedir el de
//   cualquiera con ?artist=<id del perfil>.
// - El número sale de la ficha de Notion (Clientes Zeche Gruv → Teléfono),
//   que el artista no puede leer: por eso pasa por acá. Nunca sale el número
//   completo, solo las últimas 4 cifras para reconocerlo.
// Devuelve { configured, phone, written, last4, on }:
//   configured: si WhatsApp está conectado en Netlify (WHATSAPP_TOKEN y
//     WHATSAPP_PHONE_ID); phone: si hay un número que se pueda usar;
//   written: si en la ficha hay algo escrito (aunque no se entienda);
//   on: si el artista tiene los avisos prendidos (profiles.whatsapp_avisos).
const { db } = require("./_lib/pass");
const wa = require("./_lib/whatsapp");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método no permitido." });
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }).catch(() => null) : null;
  const user = userRes && userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  const q = event.queryStringParameters || {};
  const meRes = await db(`profiles?id=eq.${user.id}&select=*`);
  const me = meRes.ok && meRes.data && meRes.data[0];
  if (!me) return json(500, { error: "No pudimos leer tu perfil." });
  const admin = me.role === "admin";
  if (!admin && me.active === false) return json(403, { error: "Tu acceso al portal está pausado." });

  let artist = me;
  if (q.artist && q.artist !== user.id) {
    if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
    if (!admin) return json(403, { error: "No tenés permiso para ver eso." });
    const r = await db(`profiles?id=eq.${q.artist}&select=*`);
    artist = r.ok && r.data && r.data[0];
    if (!artist) return json(404, { error: "Ese perfil ya no existe." });
  }

  const { raw, phone } = await wa.artistPhone(artist.id).catch(() => ({ raw: "", phone: null }));
  return json(200, {
    configured: wa.configured(),
    phone: !!phone,
    written: !!raw,
    last4: phone ? phone.slice(-4) : null,
    // Antes de correr 033 la columna no existe: cuenta como prendido.
    on: artist.whatsapp_avisos !== false,
  });
};
