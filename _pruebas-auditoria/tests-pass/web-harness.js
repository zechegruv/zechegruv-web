// Banco de pruebas del navegador: sirve ZECHE_GRUV_Web con python, abre
// Chromium (Playwright) a 375 px y responde las functions con datos falsos.
// Sin red: todo lo que no sea el servidor local se corta (o se simula).
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const WEB = path.join(__dirname, "../pass/ZECHE_GRUV_Web");
const SHOTS = path.join(__dirname, "shots");

// Librería del QR de mentira (la real viene de cdnjs, que acá no hay).
const QR_STUB = "window.qrcode=function(){return{addData:function(){},make:function(){},getModuleCount:function(){return 25},isDark:function(r,c){return (r*7+c*3)%5<2}}};";
// PNG chico (1x1) para cuando se pide la imagen del QR al servidor.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function start() {
  const port = await freePort();
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: WEB, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); r(true); }); c.on("error", () => r(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${port}`;
  // page(fns, opts): fns = { "pass-order": (url, req) => ({ status, json }) | async … }
  async function page(fns = {}, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 375, height: opts.height || 812 }, locale: opts.locale || "es-AR" });
    const p = await ctx.newPage();
    p.errors = [];
    p.on("pageerror", (e) => p.errors.push(String(e)));
    p.calls = [];
    await p.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("/.netlify/functions/")) {
        const name = url.split("/.netlify/functions/")[1].split("?")[0];
        p.calls.push({ name, url, body: route.request().postData() });
        if (name === "pass-qr") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        const h = fns[name];
        if (!h) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        const out = await h(url, route.request());
        if (out === "abort") return route.abort();
        return route.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.json || {}) });
      }
      if (url.includes("qrcode-generator")) return opts.noQr ? route.abort() : route.fulfill({ status: 200, contentType: "application/javascript", body: QR_STUB });
      // Páginas de prueba (fuera del sitio): /__test/<archivo> de tests-pass.
      if (url.startsWith(`${base}/__test/`)) return route.fulfill({ status: 200, contentType: "text/html", body: require("fs").readFileSync(path.join(__dirname, url.split("/__test/")[1].split("?")[0])) });
      if (url.startsWith(base)) return route.continue();
      return route.abort();
    });
    return p;
  }
  return { base, page, close: async () => { await browser.close(); server.kill(); }, SHOTS };
}

module.exports = { start, WEB, SHOTS };
