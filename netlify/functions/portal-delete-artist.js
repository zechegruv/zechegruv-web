// POST /.netlify/functions/portal-delete-artist   { id }
// Borra la cuenta de un artista. Con la cuenta se van su perfil, el link
// de su carpeta y sus fichas de distribución (la base los borra en
// cascada). No toca nada en OneDrive.
//
// - Solo lo puede usar el administrador (Authorization: Bearer <token>).
// - No permite borrar la cuenta propia ni la de otro administrador.
//
// Variables de entorno en Netlify: SUPABASE_SERVICE_ROLE_KEY (secreta).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";

// Clave pública del proyecto (la misma que usa el navegador): alcanza para
// comprobar de quién es una sesión. La secreta se usa solo para leer datos.
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";

// La clave tal como está cargada en Netlify, sin espacios ni comillas que
// se hayan colado al pegarla (rompen los encabezados de las consultas).
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'“”‘’]/g, "");

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

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Artista inválido." });
  if (id === user.id) return json(400, { error: "No podés borrar tu propia cuenta desde acá." });

  // Roles de quien pide y de la cuenta a borrar.
  const rolesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${user.id},${id})&select=id,role`, { headers: service });
  if (!rolesRes.ok) return json(500, { error: BAD_KEY });
  const roles = await rolesRes.json();
  const me = roles.find((r) => r.id === user.id);
  const target = roles.find((r) => r.id === id);
  if (!me || me.role !== "admin") return json(403, { error: "Solo el administrador puede borrar perfiles." });
  if (!target) return json(404, { error: "Ese perfil ya no existe." });
  if (target.role === "admin") return json(400, { error: "No se puede borrar la cuenta de un administrador." });

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: service });
  if (!res.ok) return json(502, { error: "No pudimos borrar el perfil. Probá de nuevo en un momento." });
  return json(200, { deleted: id });
};
