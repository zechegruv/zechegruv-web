// Pruebas de las Netlify Functions de ZG PASS con Supabase, Resend y
// Mercado Pago simulados en memoria (tests-shared/mock.js).
// Uso: node fn.test.js [filtro por número, p. ej. "13"]
const path = require("path");
const crypto = require("crypto");
const { S } = require("../tests-shared/mock");
const FN = path.join(__dirname, "../pass/netlify/functions");
Object.assign(process.env, { MP_ACCESS_TOKEN: "mp-test", MP_WEBHOOK_SECRET: "secreto", PASS_NOTIFY_EMAIL: "aviso@example.com" });
const fn = (name) => require(path.join(FN, name)).handler;

const only = process.argv[2] || process.env.ONLY || "";
const tests = [];
const test = (name, run) => tests.push([name, run]);
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what || "valor"}: esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`); }
function ok(v, what) { if (!v) throw new Error(what || "esperaba verdadero"); }

const res = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
function reset() {
  S.tables = {}; S.rpc = {}; S.mails = []; S.failMail = false; S.extraFetch = null; S.log = []; S.missingTables = [];
}
const calls = (name) => { S.rpcCalls = S.rpcCalls || {}; return S.rpcCalls[name] || []; };
// Envuelve las rpc simuladas para anotar con qué se las llamó.
function rpc(name, handler) {
  S.rpcCalls = S.rpcCalls || {};
  S.rpcCalls[name] = [];
  S.rpc[name] = (args) => { S.rpcCalls[name].push(args); return handler(args); };
}
const body = (out) => JSON.parse(out.body || "{}");
const post = (data, extra = {}) => ({ httpMethod: "POST", headers: { host: "www.zechegruv.com", ...(extra.headers || {}) }, body: JSON.stringify(data), queryStringParameters: extra.query || {} });
const get = (query) => ({ httpMethod: "GET", headers: { host: "www.zechegruv.com" }, queryStringParameters: query });

const TOKEN = "a".repeat(64);
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER_ID = "99999999-9999-4999-8999-999999999999";
const EV = { id: EVENT_ID, slug: "show", kind: "show", name: "Show de prueba", starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), venue_name: "Teatro", venue_address: "Calle 1", important_info: null, openmic_enabled: true, openmic_deadline: null, lineup: [], is_test: false, capacity: 10, status: "published" };

// Firma de un aviso de Mercado Pago, como la arma Mercado Pago.
function signed(dataId) {
  const ts = "1700000000", rid = "req-1";
  const v1 = crypto.createHmac("sha256", "secreto").update(`id:${dataId};request-id:${rid};ts:${ts};`).digest("hex");
  return { httpMethod: "POST", headers: { host: "www.zechegruv.com", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid }, body: JSON.stringify({ type: "payment", data: { id: dataId } }), queryStringParameters: {} };
}
function paidOrderTables() {
  S.tables.pass_orders = [{ id: ORDER_ID, number: "ZG-000001", status: "paid", mp_payment_id: "555", email_sent_at: null, buyer_email: "comprador@example.com", buyer_first_name: "Ana", buyer_last_name: "Prueba", event_id: EVENT_ID, access_token: TOKEN, total: 100 }];
  S.tables.pass_events = [EV];
  S.tables.pass_tickets = [{ id: "t1", order_id: ORDER_ID, event_id: EVENT_ID, code: "ZG-26-000001", token: "b".repeat(64), status: "valid", holder_name: "Ana Prueba", pass_ticket_types: { name: "General" } }];
}

// ---------- 13 · webhook: si Mercado Pago no responde, pedir reintento ----------
test("13 · webhook: consulta del pago con 503 → responde 500 (Mercado Pago reintenta)", async () => {
  reset();
  S.extraFetch = async (url) => (url.includes("api.mercadopago.com/v1/payments/555") ? res(503, { message: "unavailable" }) : null);
  const out = await fn("pass-mp-webhook")(signed("555"));
  eq(out.statusCode, 500, "status");
});
test("13 · webhook: consulta del pago con 429 → responde 500", async () => {
  reset();
  S.extraFetch = async (url) => (url.includes("api.mercadopago.com") ? res(429, {}) : null);
  eq((await fn("pass-mp-webhook")(signed("555"))).statusCode, 500, "status");
});
test("13 · webhook: pago inexistente (404 real) → responde 200 (no hay nada que reintentar)", async () => {
  reset();
  S.extraFetch = async (url) => (url.includes("api.mercadopago.com") ? res(404, { message: "not found" }) : null);
  const out = await fn("pass-mp-webhook")(signed("555"));
  eq(out.statusCode, 200, "status");
  eq(body(out).result, "payment_not_found", "result");
});

// ---------- 14 · mail de entradas: reintentar en avisos repetidos ----------
test("14 · si el mail falló al confirmar, el aviso siguiente (already_paid) lo vuelve a mandar", async () => {
  reset();
  paidOrderTables();
  S.extraFetch = async (url) => (url.includes("/v1/payments/555") ? res(200, { id: 555, status: "approved", external_reference: ORDER_ID, currency_id: "ARS", transaction_amount: 100 }) : null);
  rpc("pass_confirm_paid", () => ({ result: "already_paid", order_id: ORDER_ID }));
  const out = await fn("pass-mp-webhook")(signed("555"));
  eq(out.statusCode, 200, "status");
  eq(S.mails.length, 1, "mails enviados");
  eq(S.mails[0].to, ["comprador@example.com"], "destinatario");
});
test("14 · con el mail ya enviado, un aviso repetido no lo manda de nuevo", async () => {
  reset();
  paidOrderTables();
  S.tables.pass_orders[0].email_sent_at = new Date().toISOString();
  S.extraFetch = async (url) => (url.includes("/v1/payments/555") ? res(200, { id: 555, status: "approved", external_reference: ORDER_ID, currency_id: "ARS", transaction_amount: 100 }) : null);
  rpc("pass_confirm_paid", () => ({ result: "already_paid", order_id: ORDER_ID }));
  await fn("pass-mp-webhook")(signed("555"));
  eq(S.mails.length, 0, "mails enviados");
});

// ---------- 17 · contador de lugares: sin dato no es "Agotado" ----------
test("17 · si falla pass_taken, el evento NO sale como agotado", async () => {
  reset();
  S.tables.pass_events = [{ ...EV, sales_start: null, sales_end: null, ends_at: null, description: null, image_url: null, max_per_buyer: 2, pass_ticket_types: [{ id: TYPE_ID, name: "General", price: 100, active: true, sort: 0 }] }];
  S.rpc.pass_taken = () => { throw new Error("timeout"); };
  const out = await fn("pass-events")(get({}));
  eq(out.statusCode, 200, "status");
  const e = body(out).events[0];
  eq(e.sold_out, false, "sold_out");
  eq(e.few_left, null, "few_left");
  eq(e.on_sale, true, "on_sale (sigue a la venta)");
});
test("17 · con el dato, un evento lleno sigue saliendo agotado", async () => {
  reset();
  S.tables.pass_events = [{ ...EV, sales_start: null, sales_end: null, max_per_buyer: 2, pass_ticket_types: [] }];
  S.rpc.pass_taken = () => 10;
  const e = body(await fn("pass-events")(get({}))).events[0];
  eq(e.sold_out, true, "sold_out");
});

// ---------- 49 · sin detalles internos de la base al público ----------
test("49 · pass-order no devuelve 'detail' con el error de la base", async () => {
  reset();
  S.missingTables = ["pass_orders"];
  const out = await fn("pass-order")(get({ t: TOKEN }));
  eq(out.statusCode, 502, "status");
  ok(!("detail" in body(out)), `devolvió detail: ${out.body}`);
});
test("49 · pass-events no devuelve 'detail' con el error de la base", async () => {
  reset();
  S.missingTables = ["pass_events"];
  const out = await fn("pass-events")(get({}));
  eq(out.statusCode, 502, "status");
  ok(!("detail" in body(out)), `devolvió detail: ${out.body}`);
});

// ---------- 12 · volver a intentar el pago ----------
function checkoutTables() {
  S.tables.pass_events = [{ ...EV, pass_ticket_types: [{ id: TYPE_ID, name: "General" }] }];
  S.tables.pass_orders = [{ id: ORDER_ID }];
  rpc("pass_reserve", () => ({ order_id: ORDER_ID, number: "ZG-000001", access_token: TOKEN, total: 100, expires_at: new Date(Date.now() + 15 * 60e3).toISOString() }));
  rpc("pass_rate_hit", () => true);
  S.extraFetch = async (url) => (url.includes("/checkout/preferences") ? res(201, { id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }) : null);
}
const buy = (ip = "203.0.113.7") => post({ slug: "show", ticket_type_id: TYPE_ID, quantity: 1, first_name: "Ana", last_name: "Prueba", email: "ana@example.com" }, { headers: { "x-nf-client-connection-ip": ip } });
test("12 · al iniciar la compra se guarda el link de pago con la orden", async () => {
  reset();
  checkoutTables();
  const out = await fn("pass-checkout")(buy());
  eq(out.statusCode, 200, "status");
  eq(S.tables.pass_orders[0].pay_url, "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1", "pay_url guardado");
});
test("12 · la orden pendiente y viva devuelve su link de pago", async () => {
  reset();
  S.tables.pass_orders = [{ id: ORDER_ID, number: "ZG-000001", status: "pending", total: 100, expires_at: new Date(Date.now() + 5 * 60e3).toISOString(), buyer_first_name: "Ana", buyer_last_name: "Prueba", buyer_email: "ana@example.com", access_token: TOKEN, pay_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1", pass_events: EV, pass_tickets: [] }];
  const data = body(await fn("pass-order")(get({ t: TOKEN })));
  eq(data.status, "pending", "status");
  eq(data.pay_url, "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1", "pay_url");
});
test("12 · la orden vencida no devuelve link de pago", async () => {
  reset();
  S.tables.pass_orders = [{ id: ORDER_ID, number: "ZG-000001", status: "pending", total: 100, expires_at: new Date(Date.now() - 60e3).toISOString(), buyer_first_name: "Ana", buyer_last_name: "Prueba", buyer_email: "ana@example.com", access_token: TOKEN, pay_url: "https://www.mercadopago.com.ar/x", pass_events: EV, pass_tickets: [] }];
  const data = body(await fn("pass-order")(get({ t: TOKEN })));
  eq(data.status, "expired", "status");
  eq(data.pay_url, undefined, "pay_url");
});

// ---------- X1 · límite de reservas por conexión ----------
test("X1 · con el límite de la conexión alcanzado no se reserva (429)", async () => {
  reset();
  checkoutTables();
  rpc("pass_rate_hit", () => false);
  const out = await fn("pass-checkout")(buy());
  eq(out.statusCode, 429, "status");
  eq(calls("pass_reserve").length, 0, "reservas");
});
test("X1 · la clave del límite no guarda la IP tal cual", async () => {
  reset();
  checkoutTables();
  await fn("pass-checkout")(buy("203.0.113.7"));
  const args = calls("pass_rate_hit")[0];
  ok(args, "no se llamó a pass_rate_hit");
  ok(!JSON.stringify(args).includes("203.0.113.7"), "la IP quedó a la vista");
  eq([args.p_max, args.p_minutes], [6, 15], "máx y minutos");
});

// ---------- 30 · lista de invitados sin duplicados ----------
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
function adminTables() {
  S.tables.profiles = [{ id: ADMIN, role: "admin" }];
  S.tables.pass_tickets = [{ order_id: ORDER_ID, code: "ZG-26-000010", token: "c".repeat(64), status: "valid", holder_name: "Invi Tado", pass_ticket_types: { name: "General" } }];
  S.tables.pass_orders = [{ id: ORDER_ID, status: "paid", email_sent_at: new Date().toISOString(), buyer_email: "invi@example.com", event_id: EVENT_ID }];
}
const admin = (data) => post(data, { headers: { authorization: `Bearer tok-${ADMIN}` } });
test("30 · cada invitado lleva su clave al reservar (gl:<clave>)", async () => {
  reset();
  adminTables();
  rpc("pass_reserve", () => ({ order_id: ORDER_ID, number: "ZG-000010", access_token: TOKEN, total: 0, reused: false }));
  rpc("pass_confirm_paid", () => ({ result: "paid" }));
  const out = await fn("pass-admin")(admin({ action: "guestlist_send", event_id: EVENT_ID, ticket_type_id: TYPE_ID, guests: [{ first_name: "Invi", last_name: "Tado", email: "invi@example.com", quantity: 1, idem: "k-0001-abcdef" }] }));
  eq(out.statusCode, 200, "status");
  eq(calls("pass_reserve")[0].p_idem, "gl:k-0001-abcdef", "p_idem");
});
test("30 · reenviar el mismo invitado (orden ya emitida) da ok sin emitir otra", async () => {
  reset();
  adminTables();
  rpc("pass_reserve", () => ({ order_id: ORDER_ID, number: "ZG-000010", access_token: TOKEN, total: 0, reused: true }));
  rpc("pass_confirm_paid", () => ({ result: "already_paid" }));
  const out = await fn("pass-admin")(admin({ action: "guestlist_send", event_id: EVENT_ID, ticket_type_id: TYPE_ID, guests: [{ first_name: "Invi", last_name: "Tado", email: "invi@example.com", quantity: 1, idem: "k-0001-abcdef" }] }));
  const r = body(out).results[0];
  eq(r.ok, true, `ok (${r.error})`);
  eq(r.tickets, 1, "entradas");
});
test("30 · el servidor no acepta tandas grandes (se mandan de a pocos desde el navegador)", async () => {
  reset();
  adminTables();
  rpc("pass_reserve", () => ({ order_id: ORDER_ID, number: "ZG-000010", access_token: TOKEN, total: 0 }));
  rpc("pass_confirm_paid", () => ({ result: "paid" }));
  const guests = Array.from({ length: 11 }, (_, i) => ({ first_name: "A", last_name: `B${i}`, email: `a${i}@example.com`, quantity: 1, idem: `k-${i}-abcdefgh` }));
  const out = await fn("pass-admin")(admin({ action: "guestlist_send", event_id: EVENT_ID, ticket_type_id: TYPE_ID, guests }));
  eq(out.statusCode, 400, "status");
  eq(calls("pass_reserve").length, 0, "reservas");
});

// ---------- Puerta (31, 33, X3) ----------
const DOOR_K = "d".repeat(64);
function doorTables(pin = "1234", tries = 0) {
  S.tables.pass_door_access = [{ id: "acc-1", token: DOOR_K, label: "Puerta", pin, failed_attempts: tries, revoked_at: null, pass_events: { ...EV, ends_at: null, pass_ticket_types: [{ id: TYPE_ID, name: "General", price: 100, active: true, sort: 0 }] } }];
  rpc("pass_door_try", ({ p_pin }) => (p_pin === pin ? { result: "ok", tries: 0 } : { result: "wrong", tries: tries + 1 }));
}
const door = (data) => post({ k: DOOR_K, pin: "1234", ...data });
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
function ticketsTables() {
  S.tables.pass_tickets = [
    { id: "t1", code: "ZG-26-000123", token: "e".repeat(64), status: "valid", event_id: EVENT_ID, holder_name: "María José Pérez", modality: "normal", pass_ticket_types: { name: "General" } },
    { id: "t2", code: "ZG-26-000124", token: "f".repeat(64), status: "valid", event_id: OTHER_EVENT, holder_name: "Juan Otro", modality: "normal", pass_ticket_types: { name: "General" } },
  ];
}
test("31 · la puerta no acepta códigos escritos a mano: ni valida ni dice de quién es", async () => {
  reset(); doorTables(); ticketsTables();
  const out = await fn("pass-door")(door({ action: "peek", code: "ZG-26-000123" }));
  const data = body(out);
  ok(!data.holder_name, `devolvió el nombre: ${out.body}`);
  ok(data.result !== "ok", "lo dio por válido");
});
test("31 · la puerta no marca ingresos por código escrito a mano", async () => {
  reset(); doorTables(); ticketsTables();
  rpc("pass_checkin", () => ({ result: "ok" }));
  const data = body(await fn("pass-door")(door({ action: "checkin", code: "ZG-26-000123" })));
  ok(data.result !== "ok", "marcó el ingreso");
  ok(!calls("pass_checkin").some((c) => c.p_token === "e".repeat(64)), "marcó la entrada");
});
test("31 · QR escaneado de otro evento: dice 'otro evento' sin el nombre ni el código", async () => {
  reset(); doorTables(); ticketsTables();
  const data = body(await fn("pass-door")(door({ action: "peek", token: "f".repeat(64) })));
  eq(data.result, "wrong_event", "result");
  ok(!data.holder_name, "devolvió el nombre");
  ok(!data.code, "devolvió el código");
});
test("31 · ingreso con QR de otro evento: tampoco devuelve el nombre", async () => {
  reset(); doorTables(); ticketsTables();
  rpc("pass_checkin", () => ({ result: "wrong_event", holder_name: "Juan Otro", code: "ZG-26-000124" }));
  const data = body(await fn("pass-door")(door({ action: "checkin", token: "f".repeat(64) })));
  eq(data.result, "wrong_event", "result");
  ok(!data.holder_name && !data.code, `devolvió datos: ${JSON.stringify(data)}`);
});
test("31 · QR escaneado del evento sigue funcionando igual", async () => {
  reset(); doorTables(); ticketsTables();
  const data = body(await fn("pass-door")(door({ action: "peek", token: "e".repeat(64) })));
  eq(data.result, "ok", "result");
  eq(data.holder_name, "María José Pérez", "titular");
});
test("31 · panel (admin): el código a mano solo busca en el evento elegido, nunca muestra otro", async () => {
  reset(); adminTables(); ticketsTables();
  const out = await fn("pass-admin")(admin({ action: "peek", event_id: EVENT_ID, code: "ZG-26-000124" }));
  ok(!body(out).holder_name, `devolvió el nombre: ${out.body}`);
  const mine = body(await fn("pass-admin")(admin({ action: "peek", event_id: EVENT_ID, code: "zg-26-000123" })));
  eq(mine.result, "ok", "código del evento");
});

function saleTables(reused) {
  rpc("pass_reserve", () => ({ order_id: ORDER_ID, number: "ZG-000020", access_token: TOKEN, total: 100, reused }));
  rpc("pass_confirm_paid", () => ({ result: reused ? "already_paid" : "paid" }));
  rpc("pass_checkin", () => ({ result: "ok" }));
  S.tables.pass_tickets = [{ order_id: ORDER_ID, code: "ZG-26-000020", token: "1".repeat(64), status: "valid", holder_name: "Ana Puerta", pass_ticket_types: { name: "General" } }];
}
const sale = (extra) => door({ action: "issue", ticket_type_id: TYPE_ID, quantity: 1, first_name: "Ana", last_name: "Puerta", method: "cash", checkin: false, ...extra });
test("33 · la venta en puerta manda su clave al reservar (door:<clave>)", async () => {
  reset(); doorTables(); saleTables(false);
  const out = await fn("pass-door")(sale({ idem: "venta-abc-12345678" }));
  eq(out.statusCode, 200, "status");
  eq(calls("pass_reserve")[0].p_idem, "door:venta-abc-12345678", "p_idem");
});
test("33 · reintento de la misma venta: devuelve la misma entrada, sin error ni otra emisión", async () => {
  reset(); doorTables(); saleTables(true);
  const out = await fn("pass-door")(sale({ idem: "venta-abc-12345678" }));
  eq(out.statusCode, 200, `status (${out.body})`);
  eq(body(out).tickets.length, 1, "entradas");
  eq(S.tables.pass_audit, undefined, "no vuelve a registrar la venta");
});

test("33 · sin 031 corrido todavía, la venta en puerta sigue andando (sin la clave)", async () => {
  reset(); doorTables(); saleTables(false);
  rpc("pass_reserve", (a) => { if ("p_idem" in a) throw new Error("Could not find the function public.pass_reserve(p_idem, ...) PGRST202"); return { order_id: ORDER_ID, number: "ZG-000020", access_token: TOKEN, total: 100 }; });
  const out = await fn("pass-door")(sale({ idem: "venta-abc-12345678" }));
  eq(out.statusCode, 200, `status (${out.body})`);
});
test("X3 · el código de puerta se valida con el conteo atómico de la base", async () => {
  reset(); doorTables("1234", 3);
  const out = await fn("pass-door")(post({ k: DOOR_K, pin: "0000", action: "info" }));
  eq(out.statusCode, 401, "status");
  eq(calls("pass_door_try").length, 1, "llamadas a pass_door_try");
  ok(/6 intentos/.test(body(out).error), `mensaje: ${body(out).error}`);
  ok(!S.log.some((l) => l[1] === "PATCH" && l[2] === "pass_door_access"), "escribió failed_attempts leyendo y escribiendo");
});

test("X3 · sin 031 corrido todavía, el código de puerta sigue andando como antes", async () => {
  reset(); doorTables("1234", 0); delete S.rpc.pass_door_try;
  eq((await fn("pass-door")(post({ k: DOOR_K, pin: "0000", action: "info" }))).statusCode, 401, "código mal");
  eq(S.tables.pass_door_access[0].failed_attempts, 1, "intento contado");
  eq((await fn("pass-door")(post({ k: DOOR_K, pin: "1234", action: "info" }))).statusCode, 200, "código bien");
});

// ---------- 32 · open mic con el mail: sin códigos, aviso al comprador, límite por IP ----------
function micTables() {
  S.tables.pass_events = [{ ...EV, is_test: false }];
  S.tables.pass_orders = [{ id: ORDER_ID, event_id: EVENT_ID, buyer_email: "cantante@example.com", status: "paid", access_token: TOKEN, buyer_first_name: "Cata", buyer_last_name: "Cantante" }];
  S.tables.pass_tickets = [{ id: "11111111-aaaa-4aaa-8aaa-000000000001", order_id: ORDER_ID, event_id: EVENT_ID, holder_email: "cantante@example.com", status: "valid", code: "ZG-26-K7Q4X2", holder_name: "Cata Cantante" }];
  S.tables.pass_openmic = [];
  rpc("pass_rate_hit", () => true);
}
const micMail = (data, ip = "198.51.100.4") => post({ slug: "show", email: "cantante@example.com", ...data }, { headers: { "x-nf-client-connection-ip": ip } });
test("32 · con el mail se ve el nombre pero no los códigos de las entradas", async () => {
  reset(); micTables();
  const out = await fn("pass-openmic")(micMail({ action: "info" }));
  eq(out.statusCode, 200, "status");
  ok(!out.body.includes("K7Q4X2"), `mostró el código: ${out.body}`);
  ok(out.body.includes("Cata Cantante"), "no muestra el nombre");
  ok(body(out).tickets[0].ref, "sin referencia para elegir la entrada");
});
test("32 · límite por IP: 20 cada 15 minutos, sin guardar la IP a la vista", async () => {
  reset(); micTables();
  await fn("pass-openmic")(micMail({ action: "info" }));
  const k = calls("pass_rate_hit")[0];
  ok(k, "no se llamó a pass_rate_hit");
  eq([k.p_max, k.p_minutes], [20, 15], "máx y minutos");
  ok(!JSON.stringify(k).includes("198.51.100.4"), "guardó la IP a la vista");
});
test("32 · pasado el límite: 429, sin datos", async () => {
  reset(); micTables();
  rpc("pass_rate_hit", () => false);
  const out = await fn("pass-openmic")(micMail({ action: "info" }));
  eq(out.statusCode, 429, "status");
  ok(!out.body.includes("Cata"), "devolvió datos");
});
test("32 · las partes de la subida no gastan intentos", async () => {
  reset(); micTables();
  await fn("pass-openmic")(micMail({ action: "status", uploadUrl: "https://example.com/x" }));
  eq(calls("pass_rate_hit").length, 0, "marcas");
});
test("32 · el link con la clave sigue funcionando como hoy (con códigos)", async () => {
  reset(); micTables();
  S.tables.pass_orders[0].pass_events = EV;
  S.tables.pass_orders[0].pass_tickets = [{ id: "t1", code: "ZG-26-K7Q4X2", status: "valid", holder_name: "Cata Cantante" }];
  const out = await fn("pass-openmic")(post({ t: TOKEN, action: "info" }));
  eq(body(out).tickets[0].code, "ZG-26-K7Q4X2", "código");
  eq(calls("pass_rate_hit").length, 0, "el link no gasta intentos");
});
function micSignup() {
  S.tables.pass_openmic = [{ id: "s1", ticket_id: "11111111-aaaa-4aaa-8aaa-000000000001", event_id: EVENT_ID, aka: "Cata", full_name: "Cata Cantante", instagram: "cata", email: "otro-contacto@example.com", song_title: "Tema", tune_note: "Do mayor", file_name: "Cata - Tema - Do mayor.mp3", uploaded_at: null }];
}
test("32 · inscripción por la vía del mail: le llega una confirmación al comprador, una sola vez", async () => {
  reset(); micTables(); micSignup();
  const h = fn("pass-openmic");
  const ref = "11111111-aaaa-4aaa-8aaa-000000000001";
  await Promise.all([h(micMail({ action: "done", code: ref })), h(micMail({ action: "done", code: ref }))]);
  const toBuyer = S.mails.filter((m) => m.to[0] === "cantante@example.com");
  eq(toBuyer.length, 1, "confirmaciones al comprador");
  ok(/anotad/i.test(toBuyer[0].subject + toBuyer[0].html) && toBuyer[0].html.includes(EV.name), "texto de la confirmación");
  ok(!toBuyer[0].html.includes("K7Q4X2"), "la confirmación muestra el código");
});
test("32 · inscripción con el link de la orden: no hace falta la confirmación extra", async () => {
  reset(); micTables(); micSignup();
  S.tables.pass_orders[0].pass_events = EV;
  S.tables.pass_orders[0].pass_tickets = [{ id: "11111111-aaaa-4aaa-8aaa-000000000001", code: "ZG-26-K7Q4X2", status: "valid", holder_name: "Cata Cantante" }];
  await fn("pass-openmic")(post({ t: TOKEN, action: "done", code: "ZG-26-K7Q4X2" }));
  eq(S.mails.filter((m) => m.to[0] === "cantante@example.com").length, 0, "confirmaciones al comprador");
});

// ---------- 44 · open mic: un solo mail de aviso ----------
test("44 · dos 'done' a la vez: el aviso de inscripción sale una sola vez", async () => {
  reset(); micTables();
  S.tables.pass_orders[0].pass_events = EV;
  S.tables.pass_orders[0].pass_tickets = [{ id: "t1", code: "ZG-26-000300", status: "valid", holder_name: "Cata Cantante" }];
  S.tables.pass_openmic = [{ id: "s1", ticket_id: "t1", event_id: EVENT_ID, aka: "Cata", full_name: "Cata Cantante", instagram: "cata", email: "cantante@example.com", song_title: "Tema", tune_note: "Do mayor", file_name: "Cata - Tema - Do mayor.mp3", uploaded_at: null }];
  const h = fn("pass-openmic");
  await Promise.all([h(post({ t: TOKEN, action: "done", code: "ZG-26-000300" })), h(post({ t: TOKEN, action: "done", code: "ZG-26-000300" }))]);
  eq(S.mails.length, 1, "mails de aviso");
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, run] of tests) {
    if (only && !name.startsWith(only)) continue;
    try { await run(); console.log(`PASS  ${name}`); pass++; }
    catch (e) { console.log(`FAIL  ${name}\n      ${e.message.split("\n")[0]}`); fail++; }
  }
  console.log(`\nFunctions: ${pass} ok, ${fail} con fallas`);
  process.exitCode = fail ? 1 : 0;
})();
