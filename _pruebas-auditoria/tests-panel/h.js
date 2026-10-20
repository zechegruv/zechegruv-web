// Ayudante de las pruebas del panel: carga el simulador compartido (sin
// modificarlo) y le suma lo que necesitan estas pruebas.
const path = require("path");
const M = require("../tests-shared/mock");
const { S } = M;
const ROOT = path.join(__dirname, "../panel");
const F = (p) => require(path.join(ROOT, "netlify/functions", p));

// PostgREST: el simulador ignora "neq." en los filtros; acá se respeta.
const base = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("supabase.co/rest/v1/") && !u.includes("/rpc/") && /=neq\./.test(u) && (init.method === "PATCH" || init.method === "DELETE" || !init.method)) {
    const x = new URL(u);
    const neq = [...x.searchParams].filter(([, v]) => v.startsWith("neq."));
    neq.forEach(([k]) => x.searchParams.delete(k));
    const table = x.pathname.replace("/rest/v1/", "");
    const all = (S.tables[table] = S.tables[table] || []);
    // Se esconden las filas que no pasan el neq y se llama al simulador.
    const hidden = all.filter((r) => neq.some(([k, v]) => String(r[k]) === decodeURIComponent(v.slice(4))));
    S.tables[table] = all.filter((r) => !hidden.includes(r));
    try { return await base(x.toString(), init); } finally { S.tables[table].push(...hidden); }
  }
  return base(url, init);
};

const ADMIN = "11111111-1111-4111-8111-111111111111";
function setup({ google = true } = {}) {
  S.tables.profiles = [{ id: ADMIN, role: "admin", email: "admin@prueba.test" }];
  if (google) S.tables.app_tokens = [{ provider: "google_calendar", refresh_token: "r", account: "estudio@prueba.test" }];
}
const adminEvent = (method, body, qs) => ({ httpMethod: method, headers: { authorization: `Bearer tok-${ADMIN}` }, body: body ? JSON.stringify(body) : undefined, queryStringParameters: qs || {} });
const parse = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || "{}") });

let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FALLA ${name}${extra !== undefined ? ` -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`); }
}
function done(title) {
  console.log(fails ? `ROJO  ${title}: ${fails} fallas` : `VERDE ${title}`);
  process.exitCode = fails ? 1 : 0;
}
// Evento simulado de Google Calendar.
function ev(id, summary, start, end, extra = {}) {
  const t = (x) => (/T/.test(x) ? { dateTime: x, timeZone: "America/Argentina/Buenos_Aires" } : { date: x });
  S.events[id] = { id, summary, start: t(start), end: t(end), ...extra };
  return S.events[id];
}
module.exports = { ...M, F, ROOT, setup, adminEvent, parse, check, done, ev, ADMIN };
