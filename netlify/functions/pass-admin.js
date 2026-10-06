// POST /.netlify/functions/pass-admin   { action, … }
// Administración de ZG PASS desde el portal: resumen de eventos, listado de
// entradas, control de acceso (scanner), venta en puerta y bonificadas.
//
// - Solo lo puede usar el administrador (se manda su sesión de Supabase en
//   Authorization: Bearer <token>).
// - Las acciones que cambian algo quedan registradas en pass_audit.
//
// Acciones:
//   events                                   → eventos con sus números
//   tickets  { event_id }                    → entradas emitidas del evento
//   openmic  { event_id }                    → inscriptos al open mic
//   status   { event_id, status }            → publicar / cerrar la venta / volver a borrador
//   peek     { event_id, token | code }      → ¿esta entrada es válida? (no la marca)
//   checkin  { event_id, token | code }      → marcar como ingresada
//   issue    { event_id, ticket_type_id, quantity, first_name, last_name, email?, method, unit_price?, checkin? }
//            method: cash | transfer | mercadopago (cobrado por fuera) | comp (bonificada)
//            checkin: true registra el ingreso en el mismo momento
const { SUPABASE_URL, UUID, json, db, rpc, audit, sendTickets, siteUrl, testMode, serviceKey } = require("./_lib/pass");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

// Quién llama: tiene que ser una sesión válida de un administrador.
async function adminOf(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  if (!user || !user.id) return null;
  const role = await db(`profiles?id=eq.${user.id}&select=role`);
  return role.ok && role.data[0] && role.data[0].role === "admin" ? user.id : null;
}

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

// Entrada a partir de lo que leyó el scanner (clave del QR) o de su código visible.
async function findTicket(body) {
  const select = "id,code,token,status,used_at,event_id,holder_name,modality,pass_ticket_types(name)";
  const token = String(body.token || "").toLowerCase();
  const code = text(body.code, 20).toUpperCase();
  let filter = "";
  if (/^[0-9a-f]{64}$/.test(token)) filter = `token=eq.${token}`;
  else if (/^ZG-\d{2}-\d{6}$/.test(code)) filter = `code=eq.${code}`;
  if (!filter) return null;
  const res = await db(`pass_tickets?${filter}&select=${select}`);
  return res.ok ? res.data[0] || null : undefined;
}

const ticketView = (t, result) => ({
  result,
  code: t.code,
  holder_name: t.holder_name,
  type: t.pass_ticket_types && t.pass_ticket_types.name,
  comp: t.modality === "comp",
  used_at: t.used_at,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });
  const adminId = await adminOf(event);
  if (!adminId) return json(403, { error: "Iniciá sesión de nuevo con la cuenta de administrador." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const eventId = String(body.event_id || "");

  // ---------- Eventos con sus números ----------
  if (body.action === "events") {
    const res = await db(`pass_events?is_test=eq.${testMode()}&select=id,slug,kind,name,starts_at,venue_name,capacity,max_per_buyer,status,pass_ticket_types(id,name,price,active,sort)&order=starts_at.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar los eventos." });
    const events = await Promise.all(res.data.map(async (ev) => {
      const tk = await db(`pass_tickets?event_id=eq.${ev.id}&select=status,modality,face_value,price_paid,pass_orders(channel,payment_method,status,expires_at)`);
      return {
        id: ev.id, slug: ev.slug, kind: ev.kind, name: ev.name, starts_at: ev.starts_at, venue_name: ev.venue_name, status: ev.status,
        ticket_types: ev.pass_ticket_types.sort((a, b) => a.sort - b.sort).map((t) => ({ id: t.id, name: t.name, price: Number(t.price) })),
        stats: summary(ev, tk.ok ? tk.data : []),
      };
    }));
    return json(200, { events });
  }

  if (!UUID.test(eventId)) return json(400, { error: "Elegí un evento." });

  // ---------- Entradas emitidas ----------
  if (body.action === "tickets") {
    const res = await db(`pass_tickets?event_id=eq.${eventId}&status=in.(valid,used)&select=code,status,used_at,holder_name,holder_email,modality,price_paid,pass_ticket_types(name),pass_orders(number,channel,payment_method)&order=code.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar las entradas." });
    return json(200, {
      tickets: res.data.map((t) => ({
        code: t.code, status: t.status, used_at: t.used_at, holder_name: t.holder_name, holder_email: t.holder_email,
        type: t.pass_ticket_types.name, comp: t.modality === "comp", price_paid: Number(t.price_paid),
        order: t.pass_orders.number, channel: t.pass_orders.channel, method: t.pass_orders.payment_method,
      })),
    });
  }

  // ---------- Inscriptos al open mic ----------
  if (body.action === "openmic") {
    const res = await db(`pass_openmic?event_id=eq.${eventId}&select=full_name,aka,instagram,email,song_title,tune_note,file_name,uploaded_at,created_at,pass_tickets(code)&order=created_at.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar los inscriptos." });
    return json(200, {
      signups: res.data.map((s) => ({
        aka: s.aka, full_name: s.full_name, instagram: s.instagram, email: s.email, song_title: s.song_title,
        tune_note: s.tune_note, file_name: s.file_name, uploaded: !!s.uploaded_at, code: s.pass_tickets.code,
      })),
    });
  }

  // ---------- Publicar / cerrar la venta ----------
  if (body.action === "status") {
    if (!["draft", "published", "closed"].includes(body.status)) return json(400, { error: "Estado inválido." });
    const res = await db(`pass_events?id=eq.${eventId}`, { method: "PATCH", prefer: "return=representation", body: { status: body.status, updated_at: new Date().toISOString() } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos cambiar el estado del evento." });
    await audit("evento_estado", "event", eventId, { status: body.status, name: res.data[0].name }, adminId);
    return json(200, { status: body.status });
  }

  // ---------- Control de acceso ----------
  if (body.action === "peek" || body.action === "checkin") {
    const ticket = await findTicket(body);
    if (ticket === undefined) return json(502, { error: "No pudimos consultar la entrada. Revisá la conexión." });
    if (!ticket) {
      if (body.action === "checkin") await rpc("pass_checkin", { p_token: "", p_event: eventId, p_admin: adminId });
      return json(200, { result: "unknown" });
    }
    if (body.action === "peek") {
      const result = ticket.event_id !== eventId ? "wrong_event" : ticket.status === "valid" ? "ok" : ticket.status === "used" ? "already_used" : "not_valid";
      return json(200, ticketView(ticket, result));
    }
    const done = await rpc("pass_checkin", { p_token: ticket.token, p_event: eventId, p_admin: adminId });
    if (!done.ok || !done.data) return json(502, { error: "No pudimos marcar el ingreso. Probá de nuevo." });
    return json(200, { ...ticketView(ticket, done.data.result), used_at: done.data.used_at || ticket.used_at });
  }

  // ---------- Venta en puerta y bonificadas ----------
  if (body.action === "issue") {
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
    const unitPrice = comp ? 0 : body.unit_price === undefined || body.unit_price === "" ? null : Number(body.unit_price);
    if (unitPrice !== null && !(unitPrice >= 0)) return json(400, { error: "Precio inválido." });

    const reserved = await rpc("pass_reserve", {
      p_event: eventId, p_type: typeId, p_qty: quantity,
      p_first_name: firstName, p_last_name: lastName, p_email: email || null,
      p_channel: comp ? "admin" : "door", p_hold_minutes: 5, p_unit_price: unitPrice,
      p_modality: comp ? "comp" : "normal", p_admin: adminId, p_test: testMode(),
    });
    if (!reserved.ok) {
      const code = reserved.data && reserved.data.message;
      if (code === "ZG_SOLD_OUT") return json(409, { error: "No quedan lugares suficientes para esa cantidad." });
      if (code === "ZG_CLOSED") return json(409, { error: "El evento está cancelado." });
      return json(502, { error: "No pudimos emitir la entrada. Probá de nuevo." });
    }
    const order = reserved.data;
    const paid = await rpc("pass_confirm_paid", { p_order: order.order_id, p_method: comp ? "none" : body.method, p_amount: order.total });
    if (!paid.ok || !paid.data || paid.data.result !== "paid") return json(502, { error: "No pudimos confirmar la entrada. Probá de nuevo." });

    await audit(comp ? "entrada_bonificada" : "venta_en_puerta", "order", order.order_id, {
      number: order.number, quantity, holder: `${firstName} ${lastName}`, method: body.method, total: Number(order.total),
    }, adminId);
    const emailed = email ? await sendTickets(order.order_id, siteUrl(event)) : false;
    // La persona está entrando en este momento: se registra el ingreso sin
    // tener que escanear la entrada recién emitida.
    if (body.checkin === true) {
      const fresh = await db(`pass_tickets?order_id=eq.${order.order_id}&select=token`);
      for (const t of fresh.ok ? fresh.data : []) await rpc("pass_checkin", { p_token: t.token, p_event: eventId, p_admin: adminId });
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

  return json(400, { error: "Acción desconocida." });
};
