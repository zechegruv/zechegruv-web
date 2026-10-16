// POST /.netlify/functions/release-notify  { id, event }
// Avisos por mail de los lanzamientos del portal (con Resend):
// - event "submitted": el artista tocó "Enviar". Le llega a Zeche un mail
//   con el resumen y un botón para revisarlo en el panel. No se publica nada.
// - event "changes": el administrador (o el equipo de distribución) pidió
//   cambios. Le llega al artista un mail con la nota y el lanzamiento vuelve
//   a quedar editable para él.
// Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// Cada aviso se manda solo si el lanzamiento está en el estado que
// corresponde, así no se puede usar para mandar mails sueltos.
const { SUPABASE_URL, json, serviceKey, db, esc, sendMail, notifyEmail } = require("./_lib/pass");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const PORTAL_URL = process.env.PORTAL_URL || "https://zechegruv.com/portal/";
const FROM = "ZECHE GRUV <portal@zechegruv.com>";
const TYPE = { single: "Single", ep: "EP", album: "Álbum" };
const fmt = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "sin fecha");

async function caller(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json().catch(() => null) : null;
  if (!user || !user.id) return null;
  const me = await db(`profiles?id=eq.${user.id}&select=id,role,active`);
  return me.ok && me.data[0] ? me.data[0] : null;
}

function layout(title, body, button) {
  return `<div style="background:#241105;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#2E1607;border-radius:16px;padding:28px;color:#FFF4DC">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#F5A623">ZECHE GRUV · Distribución</p>
    <h1 style="margin:0 0 18px;font-size:24px;line-height:1.15;color:#FFF4DC">${title}</h1>
    ${body}
    ${button ? `<p style="margin:26px 0 0"><a href="${button.href}" style="display:inline-block;background:#F07800;color:#241105;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${button.text}</a></p>` : ""}
  </div></div>`;
}

const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#C9A980;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:14px;color:#FFF4DC">${v}</td></tr>`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ""))) return json(400, { error: "Lanzamiento inválido." });

  const me = await caller(event);
  if (!me) return json(401, { error: "Iniciá sesión de nuevo." });
  const staff = me.role === "admin" || me.role === "distribution";

  const r = await db(`releases?id=eq.${body.id}&select=*,profiles(display_name,full_name,email)`);
  const rel = r.ok && r.data[0];
  if (!rel) return json(404, { error: "No encontramos el lanzamiento." });
  const artist = rel.profiles || {};
  const name = artist.display_name || artist.full_name || "Un artista";
  const tracks = Array.isArray(rel.tracks) ? rel.tracks : [];

  if (body.event === "submitted") {
    if (rel.artist_id !== me.id || rel.status !== "submitted") return json(409, { error: "El lanzamiento no está enviado." });
    const list = tracks.map((t, i) => `${i + 1}. ${esc(t.title || "Sin título")}${t.master ? ` <span style="color:#C9A980">· máster: ${esc(t.master)}</span>` : ""}`).join("<br>");
    const html = layout(`${esc(name)} te mandó «${esc(rel.title || "Sin título")}» para revisar`,
      `<table style="border-collapse:collapse">${row("Tipo", TYPE[rel.release_type] || "—")}${row("Salida", fmt(rel.release_date))}${row("Género", esc(rel.genre || "—"))}${row("Pitch editorial", rel.pitch ? "Sí" : "No")}${row("Canciones", list || "—")}${rel.notes ? row("Notas", esc(rel.notes)) : ""}</table>
      <p style="margin:18px 0 0;font-size:14px;color:#F0E0C0">Todavía no se publicó nada. Revisalo en el panel y, si está todo bien, mandalo a las tiendas desde ahí.</p>`,
      { href: `${PORTAL_URL}#lanzamiento-${rel.id}`, text: "Revisar en el panel" });
    const ok = await sendMail({ to: notifyEmail(), subject: `Nuevo lanzamiento para revisar: ${name} — ${rel.title || "Sin título"}`, html, replyTo: artist.email || undefined, from: FROM });
    return ok ? json(200, { ok: true }) : json(502, { error: "No se pudo mandar el aviso por mail." });
  }

  if (body.event === "changes") {
    if (!staff) return json(403, { error: "Solo el administrador puede pedir cambios." });
    if (rel.status !== "draft" || !rel.review_note) return json(409, { error: "Primero devolvé el lanzamiento con una nota." });
    if (!artist.email) return json(200, { ok: false, error: "El artista no tiene mail cargado." });
    const html = layout(`Hay que ajustar algo en «${esc(rel.title || "tu lanzamiento")}»`,
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#F0E0C0">Revisamos tu lanzamiento y antes de mandarlo a las tiendas hay que corregir esto:</p>
      <p style="margin:0;padding:14px 16px;background:#241105;border-left:3px solid #F07800;border-radius:8px;font-size:15px;line-height:1.5;color:#FFF4DC">${esc(rel.review_note).replace(/\n/g, "<br>")}</p>
      <p style="margin:16px 0 0;font-size:14px;color:#F0E0C0">Ya podés editarlo de nuevo en el portal. Cuando esté, tocá Enviar.</p>`,
      { href: PORTAL_URL, text: "Abrir el portal" });
    const ok = await sendMail({ to: artist.email, subject: `Cambios en tu lanzamiento: ${rel.title || "Sin título"}`, html, replyTo: notifyEmail(), from: FROM });
    return ok ? json(200, { ok: true }) : json(502, { error: "No se pudo mandar el mail al artista." });
  }

  return json(400, { error: "Aviso desconocido." });
};
