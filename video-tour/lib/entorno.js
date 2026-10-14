// ZECHE GRUV — Entorno común del tour y la auditoría (Playwright + Chromium).
//
// - Abre el portal REAL: los archivos de ZECHE_GRUV_Web/portal tal como están
//   en el proyecto (mismo HTML, CSS, JS y animaciones que se publican).
// - Modo demo: la sesión y los datos son de "Artista Demo" (demo/datos-demo.js).
// - Seguro para repetir: TODO pedido a internet se corta acá. Las funciones
//   del portal (aprobar, subir, pagar, mandar mails) responden "ok" de mentira
//   y nunca salen de la computadora. No hay forma de pagar ni de enviar nada.
// - Fuentes: las mismas del portal (Bricolage Grotesque, Geist, Manrope,
//   DM Mono), servidas desde demo/fonts (licencia OFL) para que se vean igual
//   que online aunque no haya conexión.
const fs = require("fs");
const path = require("path");
const demo = require("../demo/datos-demo");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.resolve(process.env.ZG_SITE || path.join(ROOT, "..", "ZECHE_GRUV_Web"));
const HOST = "portal.zechegruv.test"; // dirección local de mentira, no existe en internet
const BASE = `http://${HOST}`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".otf": "font/otf", ".webmanifest": "application/manifest+json" };

const FONT_FACES = [
  ["Bricolage Grotesque", "bricolage-grotesque", [600, 700, 800]],
  ["Geist", "geist", [400, 500, 600, 700]],
  ["Geist Mono", "geist-mono", [400, 500]],
  ["DM Mono", "dm-mono", [400, 500]],
  ["Manrope", "manrope", [400, 500, 600, 700, 800]],
].flatMap(([family, file, weights]) => weights.map((w) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:block;src:url(${BASE}/__demo/fonts/${file}-latin-${w}-normal.woff2) format('woff2');}`)).join("\n");

// Viewports del tour y la auditoría.
const VIEWPORTS = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  // iPhone de 390 × 844 (densidad 3): se graba nítido para el vertical 1080 × 1920.
  mobile: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  // Reel: celular a pantalla completa 9:16. 405 × 720 con densidad 2,667 = 1080 × 1920 exactos.
  reel: {
    viewport: { width: 405, height: 720 }, deviceScaleFactor: 1080 / 405, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};

async function newDemoContext(browser, kind, { video, videoSize, loggedOut } = {}) {
  const preset = VIEWPORTS[kind];
  const ctx = await browser.newContext({
    ...preset,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    colorScheme: "dark",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    acceptDownloads: false, // nunca se descarga nada
    ...(video ? { recordVideo: { dir: video, size: videoSize || preset.viewport } } : {}),
  });
  const blocked = [];
  const posted = [];

  // Datos de la demo para el reemplazo de Supabase (antes de que cargue la página).
  await ctx.addInitScript((d) => {
    window.__ZG_DEMO = d;
    try { localStorage.setItem("zg-portal-recordar", "1"); } catch (e) { /* nada */ }
  }, { me: loggedOut ? null : demo.ARTISTA, tables: { profiles: [demo.ARTISTA], lyrics: demo.LETRAS, releases: demo.LANZAMIENTOS, reference_links: [] } });

  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // supabase-js (CDN) -> reemplazo demo.
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("supabase")) {
      return route.fulfill({ body: fs.readFileSync(path.join(ROOT, "demo", "supabase-demo.js")), contentType: TYPES[".js"] });
    }
    // Fuentes de Google -> las mismas, locales.
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ body: FONT_FACES, contentType: TYPES[".css"] });
    if (url.hostname !== HOST) { blocked.push(url.hostname); return route.fulfill({ status: 204, body: "" }); }

    if (url.pathname.startsWith("/__demo/")) {
      const f = path.join(ROOT, "demo", url.pathname.replace("/__demo/", ""));
      if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || "application/octet-stream" });
      return route.fulfill({ status: 404, body: "" });
    }
    if (url.pathname.startsWith("/.netlify/functions/")) {
      const fn = url.pathname.split("/").pop();
      let json = null;
      try { json = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { json = null; }
      if (req.method() !== "GET") posted.push({ fn, json });
      const [status, out] = demo.functionResponse(fn, req.method(), { query: url.search, json });
      return route.fulfill({ status, body: JSON.stringify(out), contentType: TYPES[".json"] });
    }
    // Archivos del sitio (los mismos que se publican).
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const f = path.join(SITE, rel);
    if (f.startsWith(SITE) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || "application/octet-stream" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  return { ctx, blocked, posted };
}

module.exports = { newDemoContext, VIEWPORTS, BASE, SITE, ROOT };
