// ZG PASS — piezas compartidas por las functions de entradas: acceso a la
// base (Supabase, con la clave secreta), a Mercado Pago, y la confirmación
// de un pago.
//
// Variables de entorno en Netlify (todas secretas, nunca en el código):
//   SUPABASE_SERVICE_ROLE_KEY  la misma del portal
//   MP_ACCESS_TOKEN            credencial de Mercado Pago (en el sitio de
//                              pruebas, la de prueba)
//   MP_WEBHOOK_SECRET          clave con la que Mercado Pago firma sus avisos
//   PASS_TEST_MODE             "1" solo en el sitio de pruebas: ahí se venden
//                              únicamente los eventos marcados como prueba
//   RESEND_API_KEY             para mandar los mails
//   PASS_NOTIFY_EMAIL          (opcional) a dónde llegan los avisos internos
const crypto = require("crypto");
const { ticketEmail } = require("./pass-mail");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLIC_URL = "https://www.zechegruv.com";
const MP_API = "https://api.mercadopago.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Las claves tal como están cargadas en Netlify, sin espacios ni comillas
// que se hayan colado al pegarlas.
const clean = (value) => (value || "").replace(/[\s"'“”‘’]/g, "");
const serviceKey = () => clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const mpToken = () => clean(process.env.MP_ACCESS_TOKEN);
const testMode = () => process.env.PASS_TEST_MODE === "1";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  body: JSON.stringify(body),
});

// Dirección del sitio que atiende el pedido: la real, o la del sitio de
// pruebas cuando corresponde (para que Mercado Pago vuelva y avise ahí).
function siteUrl(event) {
  const host = event.headers && (event.headers.host || event.headers.Host);
  return testMode() && host ? `https://${host}` : PUBLIC_URL;
}

// ---------- Base ----------
async function db(path, { method = "GET", body, prefer } = {}) {
  const key = serviceKey();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Detalle técnico corto de un fallo de la base, para poder diagnosticar
// desde una captura (código y mensaje, sin datos de nadie).
const dbDetail = (res) => `${res.status} ${(res.data && (res.data.code || "")) || ""} ${String((res.data && res.data.message) || "").slice(0, 140)}`.trim();

const rpc = (name, args) => db(`rpc/${name}`, { method: "POST", body: args });

const audit = (action, entity, entityId, detail, actorId) =>
  db("pass_audit", { method: "POST", body: { action, entity, entity_id: String(entityId || ""), detail: detail || {}, actor_id: actorId || null } });

// ---------- Mercado Pago ----------
async function mp(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${mpToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${MP_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// ¿El aviso viene de Mercado Pago? Se rehace la firma con la clave secreta
// y se compara con la del encabezado x-signature ("ts=…,v1=…").
function validWebhookSignature(event, dataId) {
  const secret = clean(process.env.MP_WEBHOOK_SECRET);
  const h = event.headers || {};
  const parts = Object.fromEntries(String(h["x-signature"] || "").split(",").map((p) => p.trim().split("=")));
  if (!secret || !parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${h["x-request-id"] || ""};ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function refund(paymentId, orderId, reason) {
  const res = await mp(`/v1/payments/${paymentId}/refunds`, { method: "POST", body: {}, idempotencyKey: `zgpass-refund-${paymentId}` });
  await audit(res.ok ? "pago_devuelto" : "devolucion_fallida", "order", orderId, { payment_id: String(paymentId), reason });
  if (!res.ok) console.error("ZG PASS: no se pudo devolver el pago", paymentId, res.status, res.data);
  return res.ok;
}

// Confirma un pago: se lo consulta directamente a Mercado Pago (nunca se
// confía en lo que diga el aviso ni el navegador) y, si está aprobado y por
// el monto de la orden, la base emite las entradas. Se puede llamar varias
// veces con el mismo pago. Devuelve { result, orderId }. "base" es la
// dirección del sitio, para los links del mail.
async function settlePayment(paymentId, base) {
  if (!/^\d+$/.test(String(paymentId || ""))) return { result: "ignored" };
  const pay = await mp(`/v1/payments/${paymentId}`);
  if (!pay.ok || !pay.data) return { result: "payment_not_found" };
  const p = pay.data;
  const orderId = String(p.external_reference || "");
  if (!UUID.test(orderId)) return { result: "ignored" };

  const found = await db(`pass_orders?id=eq.${orderId}&select=id,status,mp_payment_id`);
  if (!found.ok) throw new Error("No se pudo leer la orden.");
  const order = found.data[0];
  if (!order) return { result: "ignored" };

  if (p.status === "refunded" || p.status === "charged_back") {
    if (order.mp_payment_id === String(p.id) && order.status === "paid") {
      await rpc("pass_close_order", { p_order: orderId, p_status: "refunded" });
      await audit("orden_reembolsada", "order", orderId, { payment_id: String(p.id), status: p.status });
    }
    return { result: "refunded", orderId };
  }
  if (p.status !== "approved") return { result: "not_approved", orderId };

  // Un segundo pago aprobado para una orden que ya estaba paga con otro.
  if (order.status === "paid" && order.mp_payment_id && order.mp_payment_id !== String(p.id)) {
    await refund(p.id, orderId, "pago duplicado");
    return { result: "duplicate_refunded", orderId };
  }

  const amount = p.currency_id === "ARS" ? p.transaction_amount : -1;
  const done = await rpc("pass_confirm_paid", { p_order: orderId, p_method: "mercadopago", p_amount: amount, p_payment_id: String(p.id) });
  if (!done.ok || !done.data) throw new Error("No se pudo confirmar la orden.");
  const result = done.data.result;
  if (result === "no_capacity" || result === "amount_mismatch" || result === "not_payable") {
    await refund(p.id, orderId, result);
  }
  if (result === "paid") await sendTickets(orderId, base);
  return { result, orderId };
}

// ---------- Mails (Resend, con el dominio zechegruv.com ya verificado) ----------
const esc = (text) => String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendMail({ to, subject, html, replyTo }) {
  const key = clean(process.env.RESEND_API_KEY);
  if (!key) { console.error("ZG PASS: falta RESEND_API_KEY, no se mandó el mail", subject); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "ZG PASS <pass@zechegruv.com>", to: [to], subject, html, reply_to: replyTo || undefined }),
  });
  if (!res.ok) console.error("ZG PASS: Resend rechazó el mail", res.status, await res.text().catch(() => ""));
  return res.ok;
}

// Manda el mail con las entradas de una orden paga, una sola vez: primero
// se marca la orden como "mail enviado" (solo una llamada lo logra) y, si
// el envío falla, se desmarca para poder reintentar.
async function sendTickets(orderId, base) {
  const claim = await db(`pass_orders?id=eq.${orderId}&status=eq.paid&email_sent_at=is.null&buyer_email=not.is.null`, {
    method: "PATCH", prefer: "return=representation", body: { email_sent_at: new Date().toISOString() },
  });
  const order = claim.ok && claim.data[0];
  if (!order) return false;
  let sent = false;
  try {
    const ev = (await db(`pass_events?id=eq.${order.event_id}&select=kind,name,starts_at,venue_name,venue_address,important_info,openmic_enabled,openmic_deadline`)).data[0];
    const rows = (await db(`pass_tickets?order_id=eq.${orderId}&status=in.(valid,used)&select=code,token,holder_name,pass_ticket_types(name)&order=code.asc`)).data;
    const tickets = rows.map((t) => ({ code: t.code, token: t.token, holder_name: t.holder_name, type: t.pass_ticket_types.name }));
    const openmicOpen = ev.openmic_enabled && (!ev.openmic_deadline || Date.now() <= Date.parse(ev.openmic_deadline));
    const mail = ticketEmail({ order, ev, tickets, base: base || PUBLIC_URL, openmicOpen });
    sent = tickets.length > 0 && await sendMail({ to: order.buyer_email, subject: mail.subject, html: mail.html, replyTo: notifyEmail() });
  } catch (e) {
    console.error("ZG PASS: fallo al armar el mail de la orden", orderId, e);
  }
  if (!sent) await db(`pass_orders?id=eq.${orderId}`, { method: "PATCH", body: { email_sent_at: null } });
  return sent;
}

// A dónde llegan los avisos internos (inscripciones al open mic, etc.).
const notifyEmail = () => clean(process.env.PASS_NOTIFY_EMAIL) || "zechegruv@gmail.com";

module.exports = { SUPABASE_URL, PUBLIC_URL, UUID, json, siteUrl, testMode, serviceKey, mpToken, db, dbDetail, rpc, audit, mp, validWebhookSignature, settlePayment, esc, sendMail, sendTickets, notifyEmail };
