// GET /.netlify/functions/pass-order?t=<clave de la orden>[&payment_id=…]
// Lo que ve el comprador al volver de pagar: el estado de su orden y, si
// está paga, sus entradas. La clave larga de la orden hace de llave: sin
// ella no se puede ver nada.
//
// Si vuelve de Mercado Pago con el número de pago y el aviso todavía no
// llegó, se confirma acá mismo (consultándole el pago a Mercado Pago), así
// la entrada aparece al instante.
const { json, db, settlePayment, serviceKey } = require("./_lib/pass");

const SELECT = "id,number,status,total,expires_at,buyer_first_name,buyer_last_name,buyer_email,"
  + "pass_events(slug,kind,name,starts_at,venue_name,venue_address,important_info,openmic_enabled,openmic_deadline),"
  + "pass_tickets(code,token,status,holder_name,price_paid,pass_ticket_types(name))";

const load = (token) => db(`pass_orders?access_token=eq.${token}&select=${SELECT}`);

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta configurar el servidor." });

  const q = event.queryStringParameters || {};
  const token = String(q.t || "");
  if (!/^[0-9a-f]{64}$/.test(token)) return json(404, { error: "No encontramos esa orden." });

  let res = await load(token);
  if (!res.ok) return json(502, { error: "No pudimos cargar tu orden. Probá de nuevo en un rato." });
  let order = res.data[0];
  if (!order) return json(404, { error: "No encontramos esa orden." });

  if (order.status !== "paid" && q.payment_id) {
    try {
      const done = await settlePayment(q.payment_id);
      if (done.orderId === order.id) {
        res = await load(token);
        if (res.ok && res.data[0]) order = res.data[0];
      }
    } catch (e) {
      console.error("ZG PASS: no se pudo confirmar al volver del pago", e);
    }
  }

  const paid = order.status === "paid";
  const expired = order.status === "expired" || (order.status === "pending" && Date.parse(order.expires_at) <= Date.now());
  return json(200, {
    number: order.number,
    status: paid ? "paid" : expired ? "expired" : order.status,
    total: Number(order.total),
    expires_at: order.expires_at,
    buyer_name: `${order.buyer_first_name} ${order.buyer_last_name}`,
    buyer_email: order.buyer_email,
    event: order.pass_events,
    openmic_open: order.pass_events.openmic_enabled && (!order.pass_events.openmic_deadline || Date.now() <= Date.parse(order.pass_events.openmic_deadline)),
    // Las entradas (y sus QR) solo se entregan con la orden paga.
    tickets: paid
      ? order.pass_tickets
        .filter((t) => t.status === "valid" || t.status === "used")
        .sort((a, b) => String(a.code).localeCompare(String(b.code)))
        .map((t) => ({ code: t.code, token: t.token, status: t.status, holder_name: t.holder_name, type: t.pass_ticket_types.name }))
      : [],
  });
};
