// Captura a 375px de la pantalla de ingreso con «Tu sesión venció» y de «No pudimos conectarnos».
const path = require("path");
const { harness, ARTIST, SESSION } = require("./harness");
(async () => {
  const h = await harness({ sb: { session: SESSION, profile: ARTIST }, viewport: { width: 375, height: 760 }, fn: async (n) => (n === "portal-songs" ? { status: 401, json: {} } : { json: n === "portal-shows" ? { shows: [] } : {} }) });
  await h.page.goto(h.url("/portal/")); await h.page.waitForTimeout(1500);
  await h.page.screenshot({ path: path.join(__dirname, "shots/18-sesion-vencida-375.png") });
  await h.close();
  const g = await harness({ sb: { session: SESSION }, viewport: { width: 375, height: 760 } });
  await g.page.addInitScript(() => { window.__SB.profile = () => ({ data: null, error: { message: "Failed to fetch" } }); });
  await g.page.goto(g.url("/portal/")); await g.page.waitForTimeout(1200);
  await g.page.screenshot({ path: path.join(__dirname, "shots/19-sin-conexion-375.png") });
  await g.close();
})();
