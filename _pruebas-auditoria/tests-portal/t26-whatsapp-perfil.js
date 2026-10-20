// WhatsApp en Mi perfil: el interruptor guarda al instante; sin número en la
// ficha lo dice; si no se pudo guardar, vuelve a como estaba.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const SHOT = process.env.SHOTS;
const fnWith = (st) => async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : name === "portal-whatsapp" ? st : {} });
const openPerfil = async (h) => {
  await h.page.goto(h.url("/portal/"));
  await h.page.waitForFunction(() => !document.getElementById("view-app").hidden);
  await h.page.click('[data-atab="perfil"]');
  await h.page.waitForSelector("#waRow:not([hidden])");
  await h.page.waitForTimeout(400);
};

(async () => {
  await test("con número: dice que avisa por WhatsApp; apagarlo guarda y avisa que sigue por mail", async () => {
    const h = await harness({ viewport: { width: 390, height: 844 }, sb: { session: SESSION, profile: ARTIST, tables: { profiles: [{ ...ARTIST }] } }, fn: fnWith({ configured: true, phone: true, written: true, last4: "7422", on: true }) });
    try {
      await openPerfil(h);
      const hint = await h.page.locator("#waHint").innerText();
      assert(/Te aviso por WhatsApp/.test(hint) && !/todavía no tengo/.test(hint), hint);
      assert(await h.page.locator("#waSwitch").getAttribute("aria-checked") === "true", "arranca apagado");
      await h.page.locator("#waRow").scrollIntoViewIfNeeded();
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/4-perfil-whatsapp-prendido.png` });
      await h.page.click("#waSwitch");
      await h.page.waitForFunction(() => /apagaste/.test(document.getElementById("waMsg").textContent));
      const st = await h.page.evaluate(() => ({ sw: document.getElementById("waSwitch").getAttribute("aria-checked"), row: window.__SB.tables.profiles[0].whatsapp_avisos }));
      assert(st.sw === "false" && st.row === false, JSON.stringify(st));
      await h.page.mouse.move(0, 0); await h.page.waitForTimeout(450);
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/5-perfil-whatsapp-apagado.png` });
      assert(!h.logs.length, h.logs.join("\n"));
    } finally { await h.close(); }
  });

  await test("sin número en la ficha: lo dice y pide pasarlo", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST, tables: { profiles: [{ ...ARTIST }] } }, fn: fnWith({ configured: true, phone: false, written: false, last4: null, on: true }) });
    try {
      await openPerfil(h);
      const hint = await h.page.locator("#waHint").innerText();
      assert(/todavía no tengo tu número/.test(hint), hint);
    } finally { await h.close(); }
  });

  await test("si no se pudo guardar, el interruptor vuelve y avisa", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST, tables: { profiles: [{ ...ARTIST }] }, fail: { "profiles:update": { message: "Failed to fetch" } } }, fn: fnWith({ configured: true, phone: true, written: true, last4: "7422", on: true }) });
    try {
      await openPerfil(h);
      await h.page.click("#waSwitch");
      await h.page.waitForFunction(() => /No pudimos guardarlo/.test(document.getElementById("waMsg").textContent));
      assert(await h.page.locator("#waSwitch").getAttribute("aria-checked") === "true", "quedó apagado sin guardarse");
    } finally { await h.close(); }
  });
  done();
})();
