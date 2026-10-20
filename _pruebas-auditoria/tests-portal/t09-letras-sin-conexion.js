// Bug 9: salir del editor de letras sin conexión no puede perder lo escrito.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const LYRIC = { id: "ly-1", artist_id: ARTIST.id, title: "Faro", sections: [{ kind: "verso", text: "" }], updated_at: "2026-10-10T10:00:00Z" };
const fn = async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} });

async function openLyric(h) {
  await h.page.goto(h.url("/portal/"));
  await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
  await h.page.evaluate(() => window.ZGFiles.open("letras", window.ZGPortal.me));
  await h.page.click('[data-lyric="ly-1"]');
  await h.page.waitForSelector("#panel-lyric:not([hidden]) .lyric-text");
}
const row = (h) => h.page.evaluate(() => window.__SB.tables.lyrics.find((l) => l.id === "ly-1"));

(async () => {
  await test("sale por las pestañas sin conexión y, al volver la conexión, lo escrito se guarda igual", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST, tables: { lyrics: [{ ...LYRIC }] } }, fn });
    try {
      await openLyric(h);
      await h.page.evaluate(() => { window.__SB.fail = { "lyrics:update": { message: "Failed to fetch" } }; });
      await h.page.fill("#lyricSections .lyric-text", "Una luz en el puerto");
      await h.page.evaluate(() => window.ZGPortal.showPanel("profile")); // sale por la pestaña al instante
      await h.page.waitForTimeout(1500);
      await h.page.evaluate(() => { window.__SB.fail = {}; }); // vuelve la conexión
      await h.page.waitForTimeout(6500);
      const r = await row(h);
      assert(r.sections[0].text === "Una luz en el puerto", `en la base quedó: ${JSON.stringify(r.sections[0].text)}`);
    } finally { await h.close(); }
  });

  await test("si cierra el portal sin conexión, al volver a entrar lo pendiente se recupera y se guarda", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST, tables: { lyrics: [{ ...LYRIC }] } }, fn });
    try {
      await openLyric(h);
      await h.page.evaluate(() => { window.__SB.fail = { "lyrics:update": { message: "Failed to fetch" } }; });
      await h.page.fill("#lyricSections .lyric-text", "Verso escrito sin señal");
      await h.page.waitForTimeout(1500); // intenta guardar y falla
      // Vuelve a entrar (la base falsa arranca de nuevo con la letra vieja y con conexión).
      await h.page.evaluate(() => { window.onbeforeunload = null; });
      h.page.on("dialog", (d) => d.accept());
      await h.page.reload();
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => window.ZGFiles.open("letras", window.ZGPortal.me));
      await h.page.waitForTimeout(1500);
      const r = await row(h);
      assert(r.sections[0].text === "Verso escrito sin señal", `en la base quedó: ${JSON.stringify(r.sections[0].text)}`);
      const pend = await h.page.evaluate(() => Object.keys(localStorage).filter((k) => /letra/i.test(k)).map((k) => localStorage.getItem(k)));
      assert(!pend.some((v) => /sin señal/.test(v)), "lo pendiente quedó guardado en el dispositivo después de confirmarse");
    } finally { await h.close(); }
  });
  done();
})();
