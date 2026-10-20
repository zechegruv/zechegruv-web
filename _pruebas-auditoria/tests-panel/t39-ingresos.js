// Bug 39: Ingresos decía "Conectá Notion" ante cualquier error pasajero (429/500).
const H = require("./h");
const { S, F, check, done, setup, adminEvent } = H;
setup();
const fn = F("admin-ingresos");
const { home } = require("./home-stub");
let mode = "ok";
const f = global.fetch;
global.fetch = async (u, i = {}) => {
  if (String(u).includes("api.notion.com/v1/data_sources/52f1e043")) {
    if (mode === "500") return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
    if (mode === "404") return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [{ properties: { Tipo: { select: { name: "Entrada" } }, Valor: { number: 1000 }, "Pago Recibido": { checkbox: true } } }], has_more: false }) };
  }
  return f(u, i);
};
const call = async () => JSON.parse((await fn.handler({ ...adminEvent("POST"), httpMethod: "POST" })).body);
(async () => {
  console.log("servidor");
  mode = "500"; let r = await call();
  check("Notion 500: no dice que falta conectar", !r.connected && !r.missing && r.temporary === true, r);
  mode = "404"; r = await call();
  check("base no compartida: sí dice que falta (not_shared)", r.missing === true && r.problem === "not_shared", r);
  const tok = process.env.NOTION_TOKEN; process.env.NOTION_TOKEN = ""; r = await call(); process.env.NOTION_TOKEN = tok;
  check("sin NOTION_TOKEN: sí dice que falta conectar", r.missing === true, r);
  mode = "ok"; r = await call();
  check("todo bien: trae los números", r.connected === true && r.cobrado === 1000, r);

  console.log("navegador");
  const ok = (b) => ({ ok: true, json: async () => b });
  const { window, home: root, calls } = home({ ingresos: (n) => (n === 1 ? ok({ temporary: true, goal: 100, month: "octubre" }) : ok({ connected: true, month: "octubre", goal: 2000, cobrado: 1000, pendiente: 0, gastos: 0, neto: 1000, pagos: 1 })) });
  window.ZGHome.open();
  await new Promise((r) => setTimeout(r, 60));
  const txt = () => root.byClass("zh-wide")[0].textContent;
  check("error pasajero: no dice «Conectá Notion»", !/Conectá Notion/.test(txt()), txt());
  check("dice «No pudimos traer los ingresos, probá en un rato»", /No pudimos traer los ingresos, probá en un rato/.test(txt()), txt());
  const retry = root.byClass("zh-btn").find((b) => /Reintentar/.test(b.textContent));
  check("ofrece reintentar", !!retry);
  if (retry) { await retry.click(); await new Promise((r) => setTimeout(r, 60)); }
  check("al reintentar, vuelve a pedirlos y los muestra", calls.ingresos === 2 && /Ingresos de octubre/.test(txt()) && /1 pago/.test(txt()), { calls: calls.ingresos, txt: txt() });

  const b = home({ ingresos: () => ({ ok: false, json: async () => ({}) }) });
  b.window.ZGHome.open();
  await new Promise((r) => setTimeout(r, 60));
  const t2 = b.home.byClass("zh-wide")[0].textContent;
  check("si la función falla (500): tampoco dice «Conectá Notion»", !/Conectá Notion/.test(t2) && /probá en un rato/.test(t2), t2);
  const c = home({ ingresos: () => ok({ missing: true, goal: 100, month: "octubre" }) });
  c.window.ZGHome.open();
  await new Promise((r) => setTimeout(r, 60));
  check("si de verdad falta la conexión: «Conectá Notion»", /Conectá Notion/.test(c.home.byClass("zh-wide")[0].textContent));
  done("t39 ingresos");
})().catch((e) => { console.error(e); process.exitCode = 1; });
