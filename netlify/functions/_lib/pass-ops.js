// ZG PASS — lo que comparten la administración (pass-admin.js) y el acceso
// de puerta (pass-door.js): números del evento, control de acceso con el
// scanner y venta en puerta.
const { UUID, json, db, rpc, audit, sendTickets, siteUrl, testMode } = require("./pass");

const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const active = (t) => t.status === "valid" || t.status === "used";

// Números de un evento a partir de sus entradas.
function summary(ev, tickets) {
  const now = Date.now();
  const issued = tickets.filter(active);
  const held = tickets.filter((t) => t.status === "reserved" && t.pass_orders.status === "pending" && Date.parse(t.pass_orders.expires_at) > now).length;
  const by = (test) => issued.filter(test).length;
  const sum = (list, field) => list.reduce((total, t) => total + Number(t[field]), 0);
  const method = (m) => {
    const list = issued.filter((t) => t.modality !== "comp" && t.pass_orders.payment_method === m);
    return { tickets: list.length, amount: sum(list, "price_paid") };
  };
  return {
    capacity: ev.capacity,
    issued: issued.length,
    held,
    available: Math.max(0, ev.capacity - issued.length - held),
    used: by((t) => t.status === "used"),
    comp: by((t) => t.modality === "comp"),
    promo: by((t) => t.modality === "promo"),
    door: by((t) => t.pass_orders.channel === "door"),
    face_value: sum(issued, "face_value"),
    revenue: sum(issued, "price_paid"),
    methods: { mercadopago: method("mercadopago"), transfer: method("transfer"), cash: method("cash") },
  };
}

// Entrada a partir de lo que leyó el scanner (clave del QR). El código
// visible escrito a mano solo lo acepta el panel del administrador
// (opts.allowCode) y siempre dentro del evento elegido: así nunca aparece
// el nombre de alguien de otro evento.
async function findTicket(body, eventId, opts = {}) {
  const select = "id,code,token,status,used_at,event_id,holder_name,modality,pass_ticket_types(name)";
  const token = String(body.token || "").toLowerCase();
  const code = text(body.code, 20).toUpperCase();
  let filter = "";
  if (/^[0-9a-f]{64}$/.test(token)) filter = `token=eq.${token}`;
  else if (opts.allowCode && /^ZG-\d{2}-[0-9A-Z]{6}$/.test(code)) filter = `code=eq.${encodeURIComponent(code)}&event_id=eq.${eventId}`;
  if (!filter) return null;
  const res = await db(`pass_tickets?${filter}&select=${select}`);
  return res.ok ? res.data[0] || null : undefined;
}

// Lo que se muestra de una entrada leída. Si es de otro evento, solo eso:
// ni el nombre ni el código de esa persona.
const ticketView = (t, result) => (result === "wrong_event" ? { result } : {
  result,
  code: t.code,
  holder_name: t.holder_name,
  type: t.pass_ticket_types && t.pass_ticket_types.name,
  comp: t.modality === "comp",
  used_at: t.used_at,
});


// Scanner: { action: "peek" | "checkin", token } → respuesta lista.
//   opts.allowCode: acepta también { code } escrito a mano (solo el panel).
async function checkTicket(eventId, body, actorId, opts = {}) {
    if (!opts.allowCode && !body.token && body.code) return json(400, { error: "En la puerta las entradas se validan solo escaneando el QR." });
    const ticket = await findTicket(body, eventId, opts);
    if (ticket === undefined) return json(502, { error: "No pudimos consultar la entrada. Revisá la conexión." });
    if (!ticket) {
      if (body.action === "checkin") await rpc("pass_checkin", { p_token: "", p_event: eventId, p_admin: actorId });
      return json(200, { result: "unknown" });
    }
    if (body.action === "peek") {
      const result = ticket.event_id !== eventId ? "wrong_event" : ticket.status === "valid" ? "ok" : ticket.status === "used" ? "already_used" : "not_valid";
      return json(200, ticketView(ticket, result));
    }
    const done = await rpc("pass_checkin", { p_token: ticket.token, p_event: eventId, p_admin: actorId });
    if (!done.ok || !done.data) return json(502, { error: "No pudimos marcar el ingreso. Probá de nuevo." });
    const view = ticketView(ticket, done.data.result);
    return json(200, done.data.result === "wrong_event" ? view : { ...view, used_at: done.data.used_at || ticket.used_at });
}

// Reserva con la clave única del pedido. Si la base todavía no tiene la
// versión de pass_reserve con p_idem (falta correr supabase/031_pass.sql),
// se repite sin ella para no frenar la venta.
async function reserveOnce(args, idem) {
  if (!idem) return rpc("pass_reserve", args);
  const res = await rpc("pass_reserve", { ...args, p_idem: idem });
  if (res.ok || !/PGRST202|p_idem|pass_reserve/.test(JSON.stringify(res.data || ""))) return res;
  console.error("ZG PASS: pass_reserve sin p_idem (¿falta correr 031?)");
  return rpc("pass_reserve", args);
}

// Venta en puerta (y bonificadas, solo si opts.allowComp).
//   opts: { allowComp, allowPrice, door: nombre de quien vende en puerta,
//           idemPrefix: de dónde viene el pedido (door, admin, gl) }
//   body.idem: clave única de esta venta, generada en el navegador. Si se
//   corta la conexión y se reintenta con la misma clave, la base devuelve la
//   misma orden: nunca se emiten entradas dobles.
async function issueTickets(event, eventId, body, actorId, opts = {}) {
    const typeId = String(body.ticket_type_id || "");
    const quantity = Number(body.quantity);
    const firstName = text(body.first_name, 60);
    const lastName = text(body.last_name, 60);
    const email = text(body.email, 160).toLowerCase();
    const comp = body.method === "comp";
    if (!UUID.test(typeId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return json(400, { error: "Revisá el tipo de entrada y la cantidad." });
    if (!firstName || !lastName) return json(400, { error: "Completá nombre y apellido." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Ese mail no parece válido." });
    if (!["cash", "transfer", "mercadopago", "comp"].includes(body.method)) return json(400, { error: "Elegí el medio de pago." });
    if (comp && !opts.allowComp) return json(403, { error: "Las bonificadas solo las emite el administrador." });
    const unitPrice = comp ? 0 : !opts.allowPrice || body.unit_price === undefined || body.unit_price === "" ? null : Number(body.unit_price);
    if (unitPrice !== null && !(unitPrice >= 0)) return json(400, { error: "Precio inválido." });

    const idemRaw = String(body.idem || "");
    const idem = /^[A-Za-z0-9-]{8,64}$/.test(idemRaw) ? `${opts.idemPrefix || "door"}:${idemRaw}` : null;

    const reserved = await reserveOnce({
      p_event: eventId, p_type: typeId, p_qty: quantity,
      p_first_name: firstName, p_last_name: lastName, p_email: email || null,
      p_channel: comp ? "admin" : "door", p_hold_minutes: 5, p_unit_price: unitPrice,
      p_modality: comp ? "comp" : "normal", p_admin: actorId, p_test: testMode(),
    }, idem);
    if (!reserved.ok) {
      const code = reserved.data && reserved.data.message;
      if (code === "ZG_SOLD_OUT") return json(409, { error: "No quedan lugares suficientes para esa cantidad." });
      if (code === "ZG_CLOSED") return json(409, { error: "El evento está cancelado." });
      return json(502, { error: "No pudimos emitir la entrada. Probá de nuevo." });
    }
    const order = reserved.data;
    // reused: es un reintento de una venta que ya había llegado. Si ya quedó
    // confirmada ("already_paid") se devuelve tal cual, sin registrarla de nuevo.
    const reused = order.reused === true;
    const paid = await rpc("pass_confirm_paid", { p_order: order.order_id, p_method: comp ? "none" : body.method, p_amount: order.total });
    const result = paid.ok && paid.data && paid.data.result;
    if (result !== "paid" && !(reused && result === "already_paid")) return json(502, { error: "No pudimos confirmar la entrada. Probá de nuevo." });

    if (result === "paid") {
      await audit(comp ? "entrada_bonificada" : "venta_en_puerta", "order", order.order_id, {
        number: order.number, quantity, holder: `${firstName} ${lastName}`, method: body.method, total: Number(order.total), ...(opts.door ? { puerta: opts.door } : {}),
      }, actorId);
    }
    let emailed = email ? await sendTickets(order.order_id, siteUrl(event)) : false;
    if (email && !emailed && reused) {
      // En un reintento el mail pudo haber salido la primera vez.
      const sent = await db(`pass_orders?id=eq.${order.order_id}&select=email_sent_at`);
      emailed = !!(sent.ok && sent.data[0] && sent.data[0].email_sent_at);
    }
    // La persona está entrando en este momento: se registra el ingreso sin
    // tener que escanear la entrada recién emitida.
    if (body.checkin === true) {
      const fresh = await db(`pass_tickets?order_id=eq.${order.order_id}&select=token`);
      for (const t of fresh.ok ? fresh.data : []) await rpc("pass_checkin", { p_token: t.token, p_event: eventId, p_admin: actorId });
    }
    const tk = await db(`pass_tickets?order_id=eq.${order.order_id}&select=code,token,status,holder_name,pass_ticket_types(name)&order=code.asc`);
    return json(200, {
      number: order.number,
      total: Number(order.total),
      emailed,
      order_url: `${siteUrl(event)}/pass/orden/?t=${order.access_token}`,
      tickets: (tk.ok ? tk.data : []).map((t) => ({ code: t.code, token: t.token, status: t.status, holder_name: t.holder_name, type: t.pass_ticket_types.name })),
    });
}

// Números de un evento, leyendo sus entradas.
async function eventStats(ev) {
  const tk = await db(`pass_tickets?event_id=eq.${ev.id}&select=status,modality,face_value,price_paid,pass_orders(channel,payment_method,status,expires_at)`);
  return summary(ev, tk.ok ? tk.data : []);
}

module.exports = { text, summary, eventStats, findTicket, ticketView, checkTicket, issueTickets };
