// Bug 19: un corte de red al leer el perfil no cierra la sesión.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const fn = async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} });

(async () => {
  await test("error de red al leer el perfil: «No pudimos conectarnos» + Reintentar, sin cerrar sesión", async () => {
    const h = await harness({ sb: { session: SESSION }, fn });
    try {
      await h.page.addInitScript((artist) => {
        let fails = 1;
        window.__SB.profile = () => (fails-- > 0 ? { data: null, error: { message: "TypeError: Failed to fetch", code: "" } } : { data: artist, error: null });
      }, ARTIST);
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForTimeout(1000);
      const st = await h.page.evaluate(() => ({ out: window.__SB.calls.some((c) => c.auth === "signOut"), txt: document.getElementById("view-loading").innerText, loading: !document.getElementById("view-loading").hidden }));
      assert(!st.out, "cerró la sesión por un corte de red");
      assert(st.loading && /No pudimos conectarnos/.test(st.txt), `pantalla: ${st.txt}`);
      await h.page.getByRole("button", { name: "Reintentar" }).click();
      await h.page.waitForFunction(() => !document.getElementById("view-app").hidden, null, { timeout: 4000 });
    } finally { await h.close(); }
  });

  await test("el perfil no existe (sin filas): ahí sí cierra la sesión y avisa", async () => {
    const h = await harness({ sb: { session: SESSION }, fn });
    try {
      await h.page.addInitScript(() => { window.__SB.profile = () => ({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }); });
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForTimeout(1000);
      const st = await h.page.evaluate(() => ({ out: window.__SB.calls.some((c) => c.auth === "signOut"), login: !document.getElementById("view-login").hidden, msg: document.getElementById("loginMsg").textContent }));
      assert(st.out && st.login && /perfil/.test(st.msg), JSON.stringify(st));
    } finally { await h.close(); }
  });
  done();
})();
