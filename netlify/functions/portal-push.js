// Notificaciones del portal (Web Push): activar o desactivar este
// dispositivo y mandar un aviso de prueba. Lo usa notificaciones.js.
//
// Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// GET  [?artist=<id>]  → { configured, publicKey, devices, proyecto, novedades }
//        el administrador puede pedir el de cualquier artista (solo lectura).
// POST { action: "subscribe", subscription, device }   este dispositivo empieza a recibir
//      { action: "unsubscribe", endpoint }              este dispositivo deja de recibir
//      { action: "test" }                               aviso de prueba a sus dispositivos
// Qué tipos recibe (Tu proyecto / Eventos) lo guarda el portal directo en su
// perfil (profiles.notif_proyecto y notif_novedades, 035_notificaciones.sql).
const { db } = require("./_lib/pass");
const push = require("./_lib/push");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});
// Solo direcciones de los servicios de notificaciones de los navegadores.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/;
const B64 = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

exports.handler = async (event) => {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }).catch(() => null) : null;
  const user = userRes && userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });
  const meRes = await db(`profiles?id=eq.${user.id}&select=*`);
  const me = meRes.ok && meRes.data && meRes.data[0];
  if (!me) return json(500, { error: "No pudimos leer tu perfil." });
  const admin = me.role === "admin";
  if (!admin && me.active === false) return json(403, { error: "Tu acceso al portal está pausado." });

  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    let p = me;
    if (q.artist && q.artist !== user.id) {
      if (!/^[0-9a-f-]{36}$/i.test(q.artist)) return json(400, { error: "Artista inválido." });
      if (!admin) return json(403, { error: "No tenés permiso para ver eso." });
      const r = await db(`profiles?id=eq.${q.artist}&select=*`);
      p = r.ok && r.data && r.data[0];
      if (!p) return json(404, { error: "Ese perfil ya no existe." });
    }
    const subs = await db(`push_subscriptions?profile_id=eq.${p.id}&select=device`);
    return json(200, {
      configured: push.configured(),
      publicKey: push.publicKey(),
      devices: subs.ok ? (subs.data || []).length : 0,
      proyecto: p.notif_proyecto !== false,
      novedades: p.notif_novedades !== false,
    });
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }

  if (body.action === "subscribe") {
    const s = body.subscription || {};
    const k = s.keys || {};
    let host = "";
    try { host = new URL(s.endpoint).host; } catch (e) { host = ""; }
    if (!/^https:\/\//.test(s.endpoint || "") || !PUSH_HOSTS.test(host) || !B64.test(k.p256dh || "") || !B64.test(k.auth || "")) return json(400, { error: "Este navegador no dio una suscripción válida." });
    const device = String(body.device || "").slice(0, 40) || null;
    // Si este dispositivo era de otra cuenta, pasa a esta (on_conflict).
    const r = await db("push_subscriptions?on_conflict=endpoint", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { endpoint: s.endpoint, profile_id: user.id, p256dh: k.p256dh, auth: k.auth, device } });
    if (!r.ok) return json(500, { error: "No pudimos guardarlo. ¿Corriste supabase/035_notificaciones.sql?" });
    return json(200, { ok: true });
  }
  if (body.action === "unsubscribe") {
    if (!body.endpoint) return json(400, { error: "Pedido inválido." });
    await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}&profile_id=eq.${user.id}`, { method: "DELETE" });
    return json(200, { ok: true });
  }
  if (body.action === "test") {
    const r = await push.sendTest(user.id);
    return json(200, { ok: r.sent > 0, sent: r.sent, devices: r.total });
  }
  return json(400, { error: "Pedido inválido." });
};
