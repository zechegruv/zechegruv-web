// POST /.netlify/functions/portal-artist-access   { id, active }
// Activa o pasa a inactivo a un artista.
//
// - Inactivo: la cuenta queda bloqueada en Supabase (no puede iniciar
//   sesión ni pedir contraseña nueva, y la sesión abierta se corta en
//   cuanto vence) y el perfil queda marcado como inactivo. No se borra
//   nada: perfil, letras, lanzamientos y carpetas siguen guardados.
// - Activo: se desbloquea la cuenta y vuelve a entrar con su misma
//   contraseña.
// - Solo lo puede usar el administrador (Authorization: Bearer <token>),
//   y nunca sobre su cuenta ni la de otro administrador.
//
// Necesita la columna profiles.active (supabase/013_activos.sql).
// Variables de entorno en Netlify: SUPABASE_SERVICE_ROLE_KEY (secreta).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const BAD_KEY = "La clave secreta de Supabase cargada en Netlify (SUPABASE_SERVICE_ROLE_KEY) no es válida. Volvé a copiarla completa desde Supabase.";
const serviceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/[\s"'“”‘’]/g, "");

// Bloqueo "para siempre" (100 años) hasta que el administrador lo reactive.
const BAN_FOREVER = "876000h";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  const serviceKey = serviceRoleKey();
  if (!serviceKey) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });
  const service = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const id = String(body.id || "");
  const active = body.active === true;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Artista inválido." });
  if (typeof body.active !== "boolean") return json(400, { error: "Falta indicar si queda activo o inactivo." });
  if (id === user.id) return json(400, { error: "No podés cambiar el estado de tu propia cuenta." });

  const rolesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${user.id},${id})&select=id,role`, { headers: service });
  if (!rolesRes.ok) return json(500, { error: BAD_KEY });
  const roles = await rolesRes.json();
  const me = roles.find((r) => r.id === user.id);
  const target = roles.find((r) => r.id === id);
  if (!me || me.role !== "admin") return json(403, { error: "Solo el administrador puede cambiar el estado de un artista." });
  if (!target) return json(404, { error: "Ese perfil ya no existe." });
  if (target.role === "admin") return json(400, { error: "Un administrador siempre queda activo." });

  // 1) Bloquear o desbloquear la cuenta (esto es lo que corta el acceso).
  const banRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers: service,
    body: JSON.stringify({ ban_duration: active ? "none" : BAN_FOREVER }),
  });
  if (!banRes.ok) return json(502, { error: "No pudimos cambiar el acceso de la cuenta. Probá de nuevo en un momento." });

  // 2) Marcar el perfil, para que se vea en la lista de artistas.
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...service, Prefer: "return=representation" },
    body: JSON.stringify({ active }),
  });
  if (!profRes.ok) {
    return json(500, { error: "El acceso ya cambió, pero no pudimos marcar el perfil. ¿Ya corriste supabase/013_activos.sql en Supabase?" });
  }
  const [profile] = await profRes.json();
  return json(200, { profile });
};
