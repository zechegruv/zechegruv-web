// POST /.netlify/functions/portal-invite   { email, display_name }
// Crea la cuenta de un artista y le manda el mail de invitación de ZECHE
// GRUV, con el link para su primer ingreso (ahí elige su contraseña).
//
// - Solo lo puede usar el administrador (se manda su sesión de Supabase en
//   Authorization: Bearer <token>).
// - El texto del mail es la plantilla "Invite user" de Supabase
//   (ver supabase/emails/invitacion.html).
//
// Variables de entorno en Netlify: SUPABASE_SERVICE_ROLE_KEY (secreta).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PORTAL_URL = process.env.PORTAL_URL || "https://zechegruv.com/portal/";

// Clave pública del proyecto (la misma que usa el navegador): alcanza para
// comprobar de quién es una sesión. La secreta se usa solo para leer datos.
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";

// La clave tal como está cargada en Netlify, sin espacios ni comillas que
// se hayan colado al pegarla (rompen los encabezados de las consultas).
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'\u201C\u201D\u2018\u2019]/g, "");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  const serviceKey = serviceRoleKey();
  if (!serviceKey) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });
  const service = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // Quién llama: tiene que ser una sesión válida de un administrador.
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });
  const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: service });
  if (!roleRes.ok) return json(500, { error: BAD_KEY });
  const role = await roleRes.json();
  if (!role[0] || role[0].role !== "admin") return json(403, { error: "Solo el administrador puede invitar artistas." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const email = String(body.email || "").trim().toLowerCase();
  const displayName = String(body.display_name || "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Ese mail no parece válido." });

  const res = await fetch(`${SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(PORTAL_URL)}`, {
    method: "POST",
    headers: { ...service, "Content-Type": "application/json" },
    body: JSON.stringify({ email, data: { display_name: displayName } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error_code || data.code || "";
    if (code === "email_exists" || res.status === 422) return json(409, { error: "Ya existe una cuenta con ese mail." });
    if (res.status === 429 || code === "over_email_send_rate_limit") return json(429, { error: "Se enviaron muchos mails seguidos. Esperá unos minutos y probá de nuevo." });
    return json(502, { error: "No pudimos enviar la invitación. Revisá la configuración de mail en Supabase." });
  }
  return json(200, { id: data.id, email });
};
