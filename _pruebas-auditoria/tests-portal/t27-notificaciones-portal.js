// Notificaciones en el portal: tarjeta en Mi proyecto (con los dos tipos),
// el permiso recién al tocar «Activar», «Ahora no», bloqueadas, Mi perfil
// (tipos, Probar, Desactivar), abrir la sección del aviso y cerrar sesión.
// El permiso y la suscripción del navegador se simulan (en una prueba no hay
// servicio de notificaciones de verdad).
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const SHOT = process.env.SHOTS;

const FAKE_PUSH = () => {
  const K = "__fakeSub";
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || "null"); } catch (e) { return null; } };
  const mk = (s) => s && { endpoint: s.endpoint, toJSON() { return { endpoint: s.endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }; }, async unsubscribe() { localStorage.removeItem(K); return true; } };
  window.__asked = 0;
  Object.defineProperty(Notification, "permission", { get: () => localStorage.getItem("__perm") || "default", configurable: true });
  Notification.requestPermission = async () => { window.__asked++; const a = window.__answer || "granted"; localStorage.setItem("__perm", a); return a; };
  PushManager.prototype.getSubscription = async function () { return mk(load()); };
  PushManager.prototype.subscribe = async function () { const s = { endpoint: "https://web.push.apple.com/prueba-123" }; localStorage.setItem(K, JSON.stringify(s)); return mk(s); };
};

async function setup({ configured = true, perm = null, answer = null } = {}) {
  const calls = [];
  const h = await harness({
    sw: true, viewport: { width: 390, height: 844 },
    sb: { session: SESSION, profile: ARTIST, tables: { profiles: [{ ...ARTIST }] } },
    fn: async (name, req) => {
      if (name === "portal-push") {
        calls.push({ method: req.method, body: req.body });
        if (req.method === "GET") return { json: { configured, publicKey: configured ? "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" : null, devices: 0, proyecto: true, novedades: true } };
        if (req.body && req.body.action === "test") return { json: { ok: true, sent: 1, devices: 1 } };
        return { json: { ok: true } };
      }
      return { json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} };
    },
  });
  await h.page.addInitScript(FAKE_PUSH);
  if (perm) await h.page.addInitScript((p) => { if (!localStorage.getItem("__perm")) localStorage.setItem("__perm", p); }, perm);
  if (answer) await h.page.addInitScript((a) => { window.__answer = a; }, answer);
  h.calls = calls;
  return h;
}
const open = async (h, path = "/portal/") => {
  await h.page.goto(h.url(path));
  await h.page.waitForFunction(() => window.ZGPush && !document.getElementById("view-app").hidden);
  await h.page.waitForTimeout(700);
};

(async () => {
  await test("tarjeta en Mi proyecto: el permiso se pide recién al tocar «Activar», con los tipos elegidos", async () => {
    const h = await setup();
    try {
      await open(h);
      await h.page.waitForSelector("#zgPush");
      assert(await h.page.evaluate(() => window.__asked) === 0, "pidió el permiso apenas entró");
      const txt = await h.page.locator("#zgPush").innerText();
      assert(/Enterate apenas esté tu mezcla/.test(txt) && /Tu proyecto/.test(txt) && /Eventos/.test(txt), txt);
      await h.page.locator("#zgPush").scrollIntoViewIfNeeded();
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/6-tarjeta-notificaciones.png` });
      await h.page.click("#zgnNovedades"); // no quiere eventos
      await h.page.click("#zgPush [data-push-on]");
      await h.page.waitForSelector("#zgPush.is-done");
      if (SHOT) { await h.page.waitForTimeout(400); await h.page.screenshot({ path: `${SHOT}/7-notificaciones-listo.png` }); }
      const st = await h.page.evaluate(() => ({ asked: window.__asked, row: window.__SB.tables.profiles[0] }));
      assert(st.asked === 1, "no pidió el permiso");
      assert(st.row.notif_proyecto === true && st.row.notif_novedades === false, JSON.stringify(st.row));
      const sub = h.calls.find((c) => c.body && c.body.action === "subscribe");
      assert(sub && sub.body.subscription.endpoint === "https://web.push.apple.com/prueba-123" && sub.body.device, JSON.stringify(h.calls));
      await h.page.waitForFunction(() => !document.getElementById("zgPush"), null, { timeout: 7000 });
      assert(!h.logs.length, h.logs.join("\n"));
    } finally { await h.close(); }
  });

  await test("«Ahora no» la cierra y no vuelve al entrar de nuevo", async () => {
    const h = await setup();
    try {
      await open(h);
      await h.page.click("#zgPush [data-push-later]");
      await h.page.waitForFunction(() => !document.getElementById("zgPush"));
      await open(h);
      assert(!(await h.page.locator("#zgPush").count()), "volvió a aparecer");
    } finally { await h.close(); }
  });

  await test("si el navegador las bloquea, explica cómo habilitarlas", async () => {
    const h = await setup({ answer: "denied" });
    try {
      await open(h);
      await h.page.click("#zgPush [data-push-on]");
      await h.page.waitForFunction(() => /bloqueadas/.test(document.getElementById("zgnMsg").textContent));
      const msg = await h.page.locator("#zgnMsg").innerText();
      assert(/Permitir/.test(msg), msg);
    } finally { await h.close(); }
  });

  await test("sin las claves en Netlify no aparece nada", async () => {
    const h = await setup({ configured: false });
    try {
      await open(h);
      await h.page.click('[data-atab="perfil"]');
      await h.page.waitForTimeout(400);
      const st = await h.page.evaluate(() => ({ card: !!document.getElementById("zgPush"), prof: !!document.getElementById("zgnProfile") && !document.getElementById("zgnProfile").hidden }));
      assert(!st.card && !st.prof, JSON.stringify(st));
    } finally { await h.close(); }
  });

  await test("Mi perfil: activas en este dispositivo, cambiar un tipo, Probar y Desactivar", async () => {
    const h = await setup({ perm: "granted" });
    try {
      await h.page.addInitScript(() => { localStorage.setItem("__fakeSub", JSON.stringify({ endpoint: "https://web.push.apple.com/prueba-123" })); });
      await open(h);
      assert(!(await h.page.locator("#zgPush").count()), "con las notificaciones activas no tiene que salir la tarjeta");
      await h.page.click('[data-atab="perfil"]');
      await h.page.waitForSelector("#zgnProfile:not([hidden]) [data-push-test]");
      const hint = await h.page.locator("#zgnProfile .hint").innerText();
      assert(/^Activas en/.test(hint), hint);
      await h.page.locator("#zgnProfile").scrollIntoViewIfNeeded();
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/8-perfil-notificaciones.png` });
      await h.page.click("#zgnpNovedades");
      await h.page.waitForFunction(() => /no te aviso más de los eventos/.test(document.getElementById("zgnpMsg").textContent));
      assert(await h.page.evaluate(() => window.__SB.tables.profiles[0].notif_novedades) === false, "no guardó");
      await h.page.click("[data-push-test]");
      await h.page.waitForFunction(() => /de prueba/.test(document.getElementById("zgnpMsg").textContent));
      await h.page.click("[data-push-off]");
      await h.page.waitForFunction(() => /ya no recibe/.test((document.getElementById("zgnpMsg") || {}).textContent || ""));
      assert(h.calls.some((c) => c.body && c.body.action === "unsubscribe"), "no avisó al servidor");
      assert(await h.page.locator("[data-push-pon]").count() === 1, "no ofrece activarlas de nuevo");
    } finally { await h.close(); }
  });

  await test("tocar la notificación abre la sección (#canciones) y cerrar sesión da de baja el dispositivo", async () => {
    const h = await setup({ perm: "granted" });
    try {
      await h.page.addInitScript(() => { localStorage.setItem("__fakeSub", JSON.stringify({ endpoint: "https://web.push.apple.com/prueba-123" })); });
      await open(h, "/portal/#canciones");
      const st = await h.page.evaluate(() => ({ tab: document.body.dataset.atab, hash: location.hash }));
      assert(st.tab === "canciones" && !st.hash, JSON.stringify(st));
      await h.page.click("#logoutBtn");
      await h.page.waitForTimeout(600);
      assert(h.calls.some((c) => c.body && c.body.action === "unsubscribe"), "no dio de baja el dispositivo al salir");
    } finally { await h.close(); }
  });
  await test("panel: la ficha del artista dice si activó las notificaciones y qué tipos recibe", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name, req, url) => ({ json: name === "portal-push" ? (url.searchParams.get("artist") ? { configured: true, devices: 2, proyecto: true, novedades: false } : { configured: true, devices: 0, proyecto: true, novedades: true }) : name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : {} }) });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGPush && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => window.ZGPush.paintAdminLine({ id: "22222222-2222-4222-8222-222222222222" }));
      await h.page.waitForFunction(() => /activas en 2 dispositivos/.test((document.getElementById("zgnAdmin") || {}).textContent || ""));
      const t = await h.page.locator("#zgnAdmin").innerText();
      assert(/recibe su proyecto\.$/.test(t), t);
    } finally { await h.close(); }
  });

  await test("el service worker muestra la notificación que llega (título, texto, ícono y a dónde lleva)", async () => {
    const h = await harness({ sw: true, full: true, sb: { session: SESSION, profile: ARTIST }, fn: async (name) => ({ json: name === "portal-push" ? { configured: false } : name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : {} }) });
    try {
      await h.context.grantPermissions(["notifications"]);
      await h.page.goto(h.url("/portal/"));
      await h.page.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await h.context.newCDPSession(h.page);
      const regs = [];
      cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
      await cdp.send("ServiceWorker.enable");
      await h.page.waitForTimeout(500);
      const reg = regs.find((r) => /\/portal\/$/.test(r.scopeURL));
      assert(reg, "no encontré el service worker del portal");
      const data = JSON.stringify({ title: "Tu mezcla de «Faro» está lista", body: "Hola Luna, ya la podés escuchar en el portal.", url: "/portal/#canciones", tag: "cancion-1", icon: "/assets/favicon/android-chrome-192x192.png?v=3", badge: "/assets/favicon/zg-badge-96.png" });
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(h.url("/")).origin, registrationId: reg.registrationId, data });
      await h.page.waitForTimeout(800);
      const shown = await h.page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, icon: n.icon, tag: n.tag, url: n.data && n.data.url })));
      assert(shown.length === 1 && shown[0].title === "Tu mezcla de «Faro» está lista" && shown[0].url === "/portal/#canciones" && /android-chrome-192/.test(shown[0].icon) && shown[0].tag === "cancion-1", JSON.stringify(shown));
    } finally { await h.close(); }
  });
  done();
})();
