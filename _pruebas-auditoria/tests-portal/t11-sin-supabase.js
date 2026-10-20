// Bug 11: si la librería de Supabase no carga, el portal no puede quedar en
// "Cargando…" para siempre; y la versión tiene que estar fija.
const fs = require("fs");
const path = require("path");
const { harness, test, done, assert } = require("./harness");

(async () => {
  await test("la librería de Supabase se pide con una versión exacta (2.x.y)", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../portal/ZECHE_GRUV_Web/portal/index.html"), "utf8");
    const m = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+)"><\/script>/);
    assert(m, "no encontré el script de supabase-js en el mismo CDN");
    assert(/@2\.\d+\.\d+$/.test(m[1]), `versión no fija: ${m[1]}`);
  });

  await test("sin la librería: mensaje claro con «Reintentar» (y reintentar recarga)", async () => {
    const h = await harness({ supabaseScript: "abort" });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForTimeout(1200);
      const txt = await h.page.locator("#view-loading").innerText();
      assert(!/^\s*Cargando…\s*$/.test(txt), `sigue en: ${txt}`);
      assert(/conect/i.test(txt), `mensaje: ${txt}`);
      const btn = h.page.getByRole("button", { name: "Reintentar" });
      assert(await btn.isVisible(), "no hay botón Reintentar");
      const nav = h.page.waitForNavigation({ timeout: 3000 }).then(() => true).catch(() => false);
      await btn.click();
      assert(await nav, "Reintentar no recargó la página");
      await h.page.setViewportSize({ width: 375, height: 700 });
      await h.page.waitForTimeout(800);
      await h.page.screenshot({ path: path.join(__dirname, "shots/11-sin-supabase-375.png") });
    } finally { await h.close(); }
  });
  done();
})();
