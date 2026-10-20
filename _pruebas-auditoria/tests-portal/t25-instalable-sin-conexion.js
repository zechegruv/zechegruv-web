// Portal instalable y sin conexión (sin-conexion.js + sw.js), con el service
// worker de verdad y la red cortada de verdad (context.setOffline).
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");

function wav(seconds = 2, rate = 8000) {
  const n = Math.floor(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * 8000), 44 + i * 2);
  return b;
}
const BODY = wav();
const MOD1 = "2026-10-18T15:00:00Z", MOD2 = "2026-10-20T10:00:00Z";
const listing = (mod) => ({ configured: true, exists: true, canUpload: false, files: [],
  groups: [{ name: "Faro", files: [{ name: "Faro master.wav", url: "/audio/faro.wav", tag: "master", created: MOD1, modified: mod, size: BODY.length }] }] });

async function setup({ mod = MOD1, other = false } = {}) {
  let curMod = mod;
  const h = await harness({ sw: true, viewport: { width: 390, height: 844 },
    sb: { session: SESSION, profile: other ? { ...ARTIST, id: "22222222-2222-4222-8222-222222222222" } : ARTIST },
    fn: async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? listing(curMod) : {} }) });
  await h.context.route(/\/audio\//, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: BODY, headers: { "content-length": String(BODY.length) } }));
  // Sin red, la base falsa responde como Supabase sin conexión.
  await h.page.addInitScript(() => {
    if (!navigator.onLine) window.__SB.profile = () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } });
  });
  h.setMod = (m) => { curMod = m; };
  return h;
}
const openMasters = (h) => h.page.evaluate(() => window.ZGFiles.open("masters", window.ZGPortal.me));
const saveBtn = '[data-zgo-save="masters/Faro/Faro master.wav"]';

(async () => {
  await test("guarda un master en el celu, se corta la red, el portal abre igual y se escucha desde ahí", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => navigator.serviceWorker.ready);
      await openMasters(h);
      await h.page.locator(".file-group summary").first().click();
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s) && document.querySelector(s).dataset.state === "saved", saveBtn, { timeout: 5000 });
      const toast = await h.page.locator("#zgoToast").innerText();
      assert(/quedó en (el celu|la compu)/.test(toast), `aviso: ${toast}`);
      const inCache = await h.page.evaluate(async () => (await (await caches.open("zg-audios")).keys()).length);
      assert(inCache === 1, `audios en el celu: ${inCache}`);

      // Recarga con red para que el service worker controle la página y guarde la cáscara.
      await h.page.reload();
      await h.page.waitForFunction(() => !!navigator.serviceWorker.controller && !document.getElementById("view-app").hidden);
      const mine = await h.page.locator("#view-app .zgo-saved .zgo-row").count();
      assert(mine === 1, `en Mi proyecto se ven ${mine} guardados`);

      await h.context.setOffline(true);
      await h.page.reload();
      await h.page.waitForSelector("#view-loading .load-retry", { timeout: 8000 });
      const txt = await h.page.locator("#view-loading").innerText();
      assert(/No pudimos conectarnos/.test(txt) && /Guardados en (este celu|esta compu)/.test(txt) && /Faro master/.test(txt), `pantalla sin señal: ${txt}`);
      await h.page.locator("#view-loading [data-zgo-play]").click();
      await h.page.waitForFunction(() => { const r = document.querySelector("#view-loading .zgo-row"); return r && r.classList.contains("is-playing"); }, null, { timeout: 5000 });
      await h.page.waitForTimeout(600);
      const t = await h.page.locator("#view-loading .zgo-time").innerText();
      assert(/^0:0\d \/ 0:02$/.test(t), `tiempo del reproductor: ${t}`);
      assert(!h.logs.length, h.logs.join("\n"));
    } finally { await h.close(); }
  });

  await test("si en OneDrive hay una versión más nueva, el botón dice «Actualizar» y la vuelve a bajar", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await openMasters(h);
      await h.page.locator(".file-group summary").first().click();
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s).dataset.state === "saved", saveBtn);
      h.setMod(MOD2);
      await h.page.reload();
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await openMasters(h);
      await h.page.locator(".file-group summary").first().click();
      const st = await h.page.locator(saveBtn).getAttribute("data-state");
      const label = await h.page.locator(saveBtn).getAttribute("aria-label");
      assert(st === "old" && /Actualizar/.test(label), `estado: ${st} / ${label}`);
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s).dataset.state === "saved", saveBtn);
      const idx = await h.page.evaluate(() => JSON.parse(localStorage.getItem("zg-audios")));
      assert(idx.length === 1 && idx[0].modified === "2026-10-20T10:00:00Z", JSON.stringify(idx));
    } finally { await h.close(); }
  });

  await test("quitar del celu y cerrar sesión borran lo guardado", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await openMasters(h);
      await h.page.locator(".file-group summary").first().click();
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s).dataset.state === "saved", saveBtn);
      // Tocar de nuevo el botón lo quita.
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s).dataset.state === "", saveBtn);
      let n = await h.page.evaluate(async () => (await (await caches.open("zg-audios")).keys()).length);
      assert(n === 0, `quedaron ${n}`);
      // Guardar otra vez y cerrar sesión.
      await h.page.locator(saveBtn).click();
      await h.page.waitForFunction((s) => document.querySelector(s).dataset.state === "saved", saveBtn);
      await h.page.locator("#logoutBtn").click();
      await h.page.waitForTimeout(500);
      const st = await h.page.evaluate(async () => ({ has: await caches.has("zg-audios"), idx: localStorage.getItem("zg-audios") }));
      assert(!st.has && !st.idx, JSON.stringify(st));
    } finally { await h.close(); }
  });

  await test("aviso para instalar: aparece en Mi proyecto, «Instalar» abre el pedido del navegador y ✕ lo cierra para siempre", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => {
        const e = new Event("beforeinstallprompt"); window.__asked = 0;
        e.prompt = async () => { window.__asked++; }; e.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(e);
      });
      await h.page.waitForSelector("#zgInstall:not([hidden])");
      await h.page.locator("#zgInstall [data-install]").click();
      assert(await h.page.evaluate(() => window.__asked) === 1, "no abrió el pedido del navegador");
      await h.page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = async () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
      await h.page.locator("#zgInstall [data-install-close]").click();
      await h.page.waitForTimeout(400);
      await h.page.reload();
      await h.page.waitForFunction(() => !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = async () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
      await h.page.waitForTimeout(300);
      const shown = await h.page.evaluate(() => { const c = document.getElementById("zgInstall"); return !!c && !c.hidden; });
      assert(!shown, "volvió a aparecer después de cerrarlo");
    } finally { await h.close(); }
  });

  await test("el service worker no guarda audios ni datos del portal (solo la cáscara)", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.evaluate(() => navigator.serviceWorker.ready);
      await h.page.reload();
      await h.page.waitForFunction(() => !!navigator.serviceWorker.controller && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => fetch("/audio/faro.wav").then((r) => r.arrayBuffer()));
      await h.page.waitForTimeout(500);
      const urls = await h.page.evaluate(async () => {
        const out = [];
        for (const k of await caches.keys()) if (k.startsWith("zg-portal-")) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
        return out;
      });
      assert(urls.some((u) => /\/portal\/$/.test(u)) && urls.some((u) => /portal\.js/.test(u)), `no guardó la cáscara: ${urls.join(", ")}`);
      const bad = urls.filter((u) => /\/audio\/|\.netlify|supabase\.co/.test(u));
      assert(!bad.length, `guardó de más: ${bad.join(", ")}`);
    } finally { await h.close(); }
  });

  await test("si entra otra cuenta en el mismo celu, lo guardado de la anterior se borra", async () => {
    const h = await setup();
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGOffline && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => { localStorage.setItem("zg-audios", JSON.stringify([{ id: "masters//x.wav", name: "x.wav", sec: "masters", group: "", size: 10 }])); localStorage.setItem("zg-audios-de", JSON.stringify("otra-cuenta")); });
      await h.page.reload();
      await h.page.waitForFunction(() => !document.getElementById("view-app").hidden);
      await h.page.waitForTimeout(300);
      const st = await h.page.evaluate(() => ({ idx: localStorage.getItem("zg-audios"), rows: document.querySelectorAll(".zgo-row").length }));
      assert(!st.idx && !st.rows, JSON.stringify(st));
    } finally { await h.close(); }
  });

  done();
})();
