// Banco de pruebas del navegador: sirve ZECHE_GRUV_Web, cambia supabase-js por
// uno falso (fake-supabase.js) y responde las Netlify Functions con lo que
// diga cada prueba. Uso:
//   const h = await harness({ sb: {...}, fn: async (name, req, url) => ({ status, json }) });
//   await h.page.goto(h.url("/portal/")); ... await h.close();
// Para que context.route también vea los pedidos que hace el service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const WEB = path.resolve(__dirname, "../portal/ZECHE_GRUV_Web");
const FAKE = fs.readFileSync(path.join(__dirname, "fake-supabase.js"), "utf8");

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

// El service worker del portal (portal/sw.js) se bloquea salvo que la prueba
// lo pida (sw: true): con él, los pedidos que hace el SW no pasan por
// page.route y el supabase falso se cambiaría por el real guardado.
async function harness({ sb = {}, fn = null, supabaseScript = "fake", viewport = { width: 1200, height: 900 }, sw = false } = {}) {
  const port = await freePort();
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: WEB, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((ok) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); ok(true); }); c.on("error", () => ok(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, serviceWorkers: sw ? "allow" : "block" });
  const page = await context.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message + (process.env.STACK ? " @ " + String(e.stack).split("\n").slice(1, 3).join(" ") : "")));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) logs.push("console: " + m.text()); });
  await page.addInitScript((cfg) => { window.__SB = cfg; }, sb);
  const fnCalls = [];
  const R = sw ? context : page;
  await R.route(/supabase-js/, (route) => (supabaseScript === "fake"
    ? route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE })
    : route.abort()));
  await R.route(/fonts\.(googleapis|gstatic)\.com|googletagmanager|google-analytics|i\.ytimg\.com|cdnjs\.cloudflare\.com/, (r) => r.abort());
  await R.route(/\/\.netlify\/functions\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const name = url.pathname.split("/").pop();
    let body = null;
    try { body = req.postDataJSON(); } catch (e) { body = req.postData(); }
    fnCalls.push({ name, method: req.method(), body, auth: req.headers().authorization || null, query: Object.fromEntries(url.searchParams) });
    const out = fn ? await fn(name, { body, headers: req.headers(), method: req.method() }, url) : null;
    if (!out) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (out.abort) return route.abort();
    if (out.delay) await new Promise((r) => setTimeout(r, out.delay));
    return route.fulfill({ status: out.status || 200, contentType: out.contentType || "application/json", body: out.raw != null ? out.raw : JSON.stringify(out.json || {}) });
  });
  return {
    page, context, browser, logs, fnCalls,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    async close() { await browser.close(); server.kill(); },
  };
}

// Mini runner: cada prueba imprime PASA / FALLA y el proceso sale con 1 si alguna falló.
const results = [];
async function test(name, body) {
  try { await body(); results.push([name, true]); console.log(`PASA  ${name}`); }
  catch (e) { results.push([name, false]); console.log(`FALLA ${name}\n      ${String(e && e.stack || e).split("\n").slice(0, 3).join("\n      ")}`); }
}
function done() { const bad = results.filter((r) => !r[1]).length; console.log(`\n${results.length - bad}/${results.length} pasan`); process.exit(bad ? 1 : 0); }
function assert(cond, msg) { if (!cond) throw new Error(msg || "falló la condición"); }

const ARTIST = { id: "11111111-1111-4111-8111-111111111111", role: "artist", display_name: "Luna Prisma", full_name: "Luna Pérez", email: "luna@ejemplo.com", active: true };
const SESSION = { access_token: "tok-artista", user: { id: ARTIST.id } };

module.exports = { harness, test, done, assert, ARTIST, SESSION };
