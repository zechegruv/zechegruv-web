// Bug 50: no dejar restos — letras vacías "Sin título", notas de voz
// huérfanas en el bucket y referencias de YouTube sin título.
const path = require("path");
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const base = { "portal-shows": { shows: [] }, "portal-songs": { configured: true, active: [], done: [] }, "portal-files": { configured: true, exists: true, files: [], groups: [], canUpload: false } };

async function boot(extra = {}, fnExtra = null) {
  const h = await harness({ sb: { session: SESSION, profile: ARTIST, ...extra }, fn: async (name, req, url) => (fnExtra && (await fnExtra(name, req, url))) || { json: base[name] || {} }, viewport: { width: 375, height: 800 } });
  await h.page.goto(h.url("/portal/"));
  await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
  return h;
}

(async () => {
  await test("letras: crear una letra y salir por las pestañas sin escribir no deja una «Sin título»", async () => {
    const h = await boot({ tables: { lyrics: [] } });
    try {
      await h.page.evaluate(() => window.ZGFiles.open("letras", window.ZGPortal.me));
      await h.page.click("#lyricsNew");
      await h.page.waitForSelector("#panel-lyric:not([hidden])");
      await h.page.click('[data-atab="proyecto"]'); // sale por la pestaña
      await h.page.waitForTimeout(800);
      const n = await h.page.evaluate(() => window.__SB.tables.lyrics.length);
      assert(n === 0, `quedaron ${n} letras vacías`);
    } finally { await h.close(); }
  });

  await test("letras: si escribió algo, salir por las pestañas la conserva", async () => {
    const h = await boot({ tables: { lyrics: [] } });
    try {
      await h.page.evaluate(() => window.ZGFiles.open("letras", window.ZGPortal.me));
      await h.page.click("#lyricsNew");
      await h.page.waitForSelector("#panel-lyric:not([hidden])");
      await h.page.fill("#lyricTitle", "Puerto");
      await h.page.click('[data-atab="proyecto"]');
      await h.page.waitForTimeout(800);
      const rows = await h.page.evaluate(() => window.__SB.tables.lyrics);
      assert(rows.length === 1 && rows[0].title === "Puerto", JSON.stringify(rows));
    } finally { await h.close(); }
  });

  await test("notas de voz: borrar una nota de voz sin mandar borra también su audio", async () => {
    const SONG = { id: "12121212-0000-4000-8000-000000000001", title: "Sal", step: 3, delivery: { kind: "mezcla", state: "aprobar", file: { name: "Sal mix.wav", url: "/x.wav", modified: "2026-10-18T15:00:00Z", size: 0 }, versions: [], review: null } };
    const voice = `${ARTIST.id}/121212120000-1700000000000.webm`;
    const h = await boot();
    try {
      await h.page.evaluate(([song, v]) => {
        localStorage.setItem(`zg-notas:${song.id}:${song.delivery.file.name}:${song.delivery.file.modified}`, JSON.stringify([{ t: 4, text: "Nota de voz", voice: v }, { t: 9, text: "más brillo" }]));
        window.ZGReview.open(song, { own: true });
      }, [SONG, voice]);
      await h.page.click('#rvNotes [data-del="0"]');
      await h.page.waitForTimeout(300);
      const removed = await h.page.evaluate(() => window.__SB.calls.filter((c) => c.storage === "remove"));
      assert(removed.length === 1 && removed[0].bucket === "notas-voz" && removed[0].paths[0] === voice, JSON.stringify(removed));
      await h.page.click('#rvNotes [data-del="0"]'); // la nota escrita: no hay audio que borrar
      await h.page.waitForTimeout(300);
      const again = await h.page.evaluate(() => window.__SB.calls.filter((c) => c.storage === "remove").length);
      assert(again === 1, "intentó borrar un audio de una nota escrita");
    } finally { await h.close(); }
  });

  const openRefs = async (h) => {
    await h.page.evaluate(() => window.ZGFiles.open("referencias", window.ZGPortal.me));
    await h.page.waitForSelector("#refLinksCard:not([hidden])");
  };

  await test("YouTube: «Agregar» no se habilita hasta tener el título del video", async () => {
    const h = await boot({ tables: { reference_links: [] } }, async (name) => (name === "youtube-info" ? { delay: 1200, json: { title: "Canción del mar (en vivo)", channel: "Banda Ficticia" } } : null));
    try {
      await openRefs(h);
      await h.page.fill("#refLinkUrl", "https://youtu.be/abcdefghijk");
      await h.page.waitForTimeout(200);
      assert(await h.page.locator("#refLinkAdd").isDisabled(), "«Agregar» se habilitó mientras buscaba el título");
      await h.page.waitForTimeout(1400);
      assert(!(await h.page.locator("#refLinkAdd").isDisabled()), "con el título, «Agregar» sigue deshabilitado");
      await h.page.click("#refLinkAdd");
      await h.page.waitForTimeout(400);
      const rows = await h.page.evaluate(() => window.__SB.tables.reference_links);
      assert(rows.length === 1 && rows[0].title === "Canción del mar (en vivo)", JSON.stringify(rows));
    } finally { await h.close(); }
  });

  await test("YouTube: si no se pudo leer el título, se pide al guardar (y no se guarda sin título)", async () => {
    const h = await boot({ tables: { reference_links: [] } }, async (name) => (name === "youtube-info" ? { json: { title: "", channel: "", restricted: true } } : null));
    try {
      await openRefs(h);
      await h.page.fill("#refLinkUrl", "https://youtu.be/abcdefghijk");
      await h.page.waitForTimeout(500);
      await h.page.click("#refLinkAdd");
      await h.page.waitForTimeout(300);
      let rows = await h.page.evaluate(() => window.__SB.tables.reference_links);
      assert(rows.length === 0, "guardó el video sin título");
      const ask = h.page.locator("#refLinkTitle");
      assert(await ask.isVisible(), "no pidió el título");
      await h.page.screenshot({ path: path.join(__dirname, "shots/50-youtube-pide-titulo-375.png"), fullPage: false });
      await ask.fill("Referencia de batería");
      await h.page.click("#refLinkAdd");
      await h.page.waitForTimeout(400);
      rows = await h.page.evaluate(() => window.__SB.tables.reference_links);
      assert(rows.length === 1 && rows[0].title === "Referencia de batería", JSON.stringify(rows));
    } finally { await h.close(); }
  });
  done();
})();
