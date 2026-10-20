// Bug 8 (consecuencia): las notas sin mandar se guardan con la fecha del
// audio. Al pasar a la fecha de subida, las que ya estaban guardadas con la
// fecha vieja no se tienen que perder.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const SONG = { id: "cccccccc-0000-4000-8000-000000000001", title: "Faro", step: 3, delivery: { kind: "mezcla", state: "aprobar", file: { name: "Faro mix.wav", url: "/x.wav", modified: "2026-10-18T15:00:00Z", size: 0 }, versions: [], review: null } };

(async () => {
  const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : {} }) });
  await h.page.addInitScript((song) => {
    localStorage.setItem(`zg-notas:${song.id}:${song.delivery.file.name}:2026-10-15T12:00:00Z`, JSON.stringify([{ t: 12, text: "subir la voz" }]));
  }, SONG);
  await h.page.goto(h.url("/portal/"));
  await h.page.waitForFunction(() => window.ZGReview && !document.getElementById("view-app").hidden);
  await test("las notas guardadas con la fecha vieja del archivo siguen apareciendo", async () => {
    const n = await h.page.evaluate((song) => window.ZGReview.drafts(song), SONG);
    assert(n === 1, `notas guardadas: ${n}`);
    await h.page.evaluate((song) => window.ZGReview.open(song, { own: true }), SONG);
    const items = await h.page.locator("#rvNotes li").count();
    assert(items === 1, `notas en el reproductor: ${items}`);
  });
  await h.close();
  done();
})();
