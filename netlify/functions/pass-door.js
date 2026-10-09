// POST /.netlify/functions/pass-door   { k, action, … }
// Acceso de puerta de ZG PASS: para quien controla la entrada de un evento,
// con un link único (zechegruv.com/puerta?k=…) que arma el administrador.
// Sin cuenta y sin acceso a nada más del portal: solo este evento, el
// scanner, la venta en puerta (sin bonificadas ni precios a mano) y el
// contador. Cada pedido lleva también el código de 4 números de ese acceso
// ({ pin }): la página lo pide una vez y lo guarda en el celular. Con 10
// intentos fallidos el acceso se bloquea. El link vence 24 h después de que
// termina el evento (o de que empieza, si no tiene hora de fin) y se puede
// dar de baja.
//
// Acciones:
//   info                                  → evento, tipos de entrada y contador
//   peek    { token | code }              → ¿esta entrada es válida? (no la marca)
//   checkin { token | code }              → marcar como ingresada
//   issue   { ticket_type_id, quantity, first_name, last_name, email?, method, checkin? }
//           method: cash | transfer | mercadopago
const { json, db, serviceKey, testMode } = require("./_lib/pass");
const { eventStats, checkTicket, issueTickets } = require("./_lib/pass-ops");

const AFTER = 24 * 3600 * 1000;
const MAX_TRIES = 10;
const GONE = "Este acceso ya no está activo. Pedile un link nuevo a ZECHE GRUV.";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta configurar el servidor." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }

  const k = String(body.k || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(k)) return json(404, { error: GONE });
  const res = await db(`pass_door_access?token=eq.${k}&select=id,label,pin,failed_attempts,revoked_at,pass_events(*,pass_ticket_types(id,name,price,active,sort))`);
  const access = res.ok && res.data[0];
  const ev = access && access.pass_events;
  if (!access || access.revoked_at || !ev || ev.is_test !== testMode()) return json(404, { error: GONE });
  if (Date.now() > Date.parse(ev.ends_at || ev.starts_at) + AFTER) return json(410, { error: "Este acceso venció: el evento ya pasó." });

  // Código de 4 números.
  if (access.failed_attempts >= MAX_TRIES) return json(423, { error: "Este acceso se bloqueó por demasiados códigos incorrectos. Pedile un link nuevo a ZECHE GRUV." });
  const pin = String(body.pin || "");
  if (!pin) return json(401, { need_pin: true });
  if (pin !== access.pin) {
    const tries = access.failed_attempts + 1;
    await db(`pass_door_access?id=eq.${access.id}`, { method: "PATCH", body: { failed_attempts: tries } });
    const left = MAX_TRIES - tries;
    return json(401, { need_pin: true, error: left > 0 ? `Código incorrecto. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.` : "Código incorrecto. El acceso se bloqueó: pedile un link nuevo a ZECHE GRUV." });
  }
  if (access.failed_attempts) await db(`pass_door_access?id=eq.${access.id}`, { method: "PATCH", body: { failed_attempts: 0 } });

  if (body.action === "info") {
    const s = await eventStats(ev);
    return json(200, {
      door: { label: access.label },
      event: { id: ev.id, kind: ev.kind, name: ev.name, starts_at: ev.starts_at, venue_name: ev.venue_name, status: ev.status },
      ticket_types: ev.pass_ticket_types.filter((t) => t.active).sort((a, b) => a.sort - b.sort).map((t) => ({ id: t.id, name: t.name, price: Number(t.price) })),
      counts: { capacity: s.capacity, issued: s.issued, advance: s.issued - s.door, door: s.door, used: s.used, available: s.available },
    });
  }
  if (body.action === "peek" || body.action === "checkin") return checkTicket(ev.id, body, null);
  if (body.action === "issue") {
    if (body.method === "comp") return json(403, { error: "Las bonificadas solo las emite el administrador." });
    return issueTickets(event, ev.id, body, null, { allowComp: false, allowPrice: false, door: access.label });
  }
  return json(400, { error: "Acción desconocida." });
};
