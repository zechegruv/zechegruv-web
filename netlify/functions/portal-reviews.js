// GET /.netlify/functions/portal-reviews
// Solo para el administrador: lo último que dijeron los artistas sobre sus
// mezclas y masters desde el portal (aprobaciones y pedidos de cambios con
// sus notas en el tiempo). Lo muestra el Inicio del panel, para entrar
// directo a escuchar cada nota en su momento exacto.
// Lee song_approvals (020 y 021) con la clave secreta: el navegador no
// tiene acceso directo a esa tabla.
const { json, db, serviceKey } = require("./_lib/pass");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";

exports.handler = async (event) => {
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify." });
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });
  const me = await db(`profiles?id=eq.${user.id}&select=role`);
  if (!me.ok || !me.data || !me.data[0] || me.data[0].role !== "admin") return json(403, { error: "Solo para el administrador." });

  const rows = await db("song_approvals?select=*,profiles(id,display_name,full_name)&order=created_at.desc&limit=12");
  if (!rows.ok) return json(200, { reviews: [], missing: rows.status === 404 });
  const reviews = (rows.data || []).map((r) => ({
    profile_id: r.profile_id,
    artist: r.profiles ? (r.profiles.display_name || r.profiles.full_name || "") : "",
    song_id: r.song_id,
    song: r.song_title,
    kind: r.kind,
    action: r.action,
    notes: Array.isArray(r.marks) ? r.marks.length : 0,
    note: r.note || null,
    at: r.created_at,
  }));
  return json(200, { reviews });
};
