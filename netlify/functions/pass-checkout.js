// POST /.netlify/functions/pass-checkout
//   { slug, ticket_type_id, quantity, first_name, last_name, email }
// Inicia una compra: reserva los lugares en la base (que es la que decide
// si hay lugar y cuánto cuesta) y arma el pago en Mercado Pago. Devuelve la
// dirección a la que hay que mandar a la persona para pagar.
//
// El navegador nunca manda precios ni totales: solo qué quiere comprar.
const { json, db, rpc, mp, siteUrl, testMode, serviceKey, mpToken, UUID } = require("./_lib/pass");

const HOLD_MINUTES = 15;
const ERRORS = {
  ZG_SOLD_OUT: [409, "sold_out", "No quedan lugares suficientes para esa cantidad."],
  ZG_LIMIT: [409, "limit", "Con ese mail ya se alcanzó el máximo de entradas por persona para este evento."],
  ZG_CLOSED: [409, "closed", "La venta de este evento no está abierta."],
  ZG_QTY: [400, "invalid", "Cantidad inválida."],
  ZG_NAME: [400, "invalid", "Completá nombre y apellido."],
  ZG_EMAIL: [400, "invalid", "Ese mail no parece válido."],
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey() || !mpToken()) return json(500, { error: "Falta configurar el servidor." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const slug = String(body.slug || "").toLowerCase();
  const typeId = String(body.ticket_type_id || "");
  const quantity = Number(body.quantity);
  const firstName = String(body.first_name || "").trim().slice(0, 60);
  const lastName = String(body.last_name || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 160);
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !UUID.test(typeId)) return json(400, { error: "Datos inválidos." });
  if (!Number.isInteger(quantity) || quantity < 1) return json(400, { error: "Cantidad inválida." });
  if (!firstName || !lastName) return json(400, { error: "Completá nombre y apellido." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Ese mail no parece válido." });

  const found = await db(`pass_events?slug=eq.${slug}&is_test=eq.${testMode()}&select=id,name,pass_ticket_types(id,name)`);
  if (!found.ok) return json(502, { error: "No pudimos iniciar la compra. Probá de nuevo en un rato." });
  const ev = found.data[0];
  const type = ev && ev.pass_ticket_types.find((t) => t.id === typeId);
  if (!type) return json(404, { error: "No encontramos ese evento." });

  const reserved = await rpc("pass_reserve", {
    p_event: ev.id, p_type: typeId, p_qty: quantity,
    p_first_name: firstName, p_last_name: lastName, p_email: email,
    p_channel: "web", p_hold_minutes: HOLD_MINUTES, p_test: testMode(),
  });
  if (!reserved.ok) {
    const known = ERRORS[reserved.data && reserved.data.message];
    if (known) return json(known[0], { code: known[1], error: known[2] });
    console.error("ZG PASS: fallo al reservar", reserved.status, reserved.data);
    return json(502, { error: "No pudimos iniciar la compra. Probá de nuevo en un rato." });
  }
  const order = reserved.data;
  const base = siteUrl(event);
  const back = `${base}/pass/orden/?t=${order.access_token}`;

  // El pago vence junto con la reserva, y no se ofrecen medios en efectivo
  // (Rapipago, Pago Fácil): tardan días en acreditarse.
  const preference = await mp("/checkout/preferences", {
    method: "POST",
    body: {
      items: [{ id: typeId, title: `${ev.name} — ${type.name}`, quantity, unit_price: Number(order.total) / quantity, currency_id: "ARS" }],
      payer: { name: firstName, surname: lastName, email },
      external_reference: order.order_id,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: "approved",
      notification_url: `${base}/.netlify/functions/pass-mp-webhook`,
      statement_descriptor: "ZG PASS",
      binary_mode: true,
      expires: true,
      expiration_date_to: order.expires_at,
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
      metadata: { order_number: order.number },
    },
  });
  if (!preference.ok || !preference.data || !preference.data.init_point) {
    console.error("ZG PASS: Mercado Pago no creó el pago", preference.status, preference.data);
    await rpc("pass_close_order", { p_order: order.order_id, p_status: "cancelled" });
    return json(502, { error: "No pudimos conectar con Mercado Pago. Probá de nuevo en un rato." });
  }
  await db(`pass_orders?id=eq.${order.order_id}`, { method: "PATCH", body: { mp_preference_id: preference.data.id } });

  return json(200, {
    number: order.number,
    expires_at: order.expires_at,
    order_url: back,
    pay_url: preference.data.init_point,
  });
};
