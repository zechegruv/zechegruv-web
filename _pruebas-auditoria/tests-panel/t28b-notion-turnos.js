// Bug 28 (segunda parte): nunca más de 3 pedidos a Notion a la vez, y un 429 se reintenta como mucho 3 veces.
const H = require("./h");
const { S, F, check, done, page, title } = H;
const { notion } = F("_lib/notion");
let inFlight = 0, peak = 0, calls = 0;
const f = global.fetch;
global.fetch = async (u, i) => {
  if (!String(u).includes("api.notion.com")) return f(u, i);
  calls++; inFlight++; peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, 15));
  try { return await f(u, i); } finally { inFlight--; }
};
page("x", "p0000000-0000-4000-8000-000000000001", { Nombre: title("Prueba") });
(async () => {
  const rs = await Promise.all(Array.from({ length: 12 }, () => notion("/pages/p0000000-0000-4000-8000-000000000001")));
  check("los 12 pedidos responden bien", rs.every((r) => r.ok));
  check("nunca más de 3 a la vez", peak <= 3, peak);
  calls = 0; S.notion429 = 10;
  const r = await notion("/pages/p0000000-0000-4000-8000-000000000001");
  check("con 429 sin fin, se rinde a los 3 intentos y devuelve 429", r.status === 429 && calls === 3, { status: r.status, calls });
  S.notion429 = 0;
  done("t28b turnos de Notion");
})().catch((e) => { console.error(e); process.exitCode = 1; });
