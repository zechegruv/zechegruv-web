// Bug 10 (navegador): cerrar el reproductor mientras se manda no deja el
// envío a medias (borradores sin borrar, la canción sin actualizar).
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const SONG = { id: "dddddddd-0000-4000-8000-000000000001", title: "Marea", step: 3, delivery: { kind: "mezcla", state: "aprobar", file: { name: "Marea mix.wav", url: "/x.wav", modified: "2026-10-18T15:00:00Z", size: 0 }, versions: [], review: null } };
const KEY = `zg-notas:${SONG.id}:${SONG.delivery.file.name}:${SONG.delivery.file.modified}`;

(async () => {
  const h = await harness({
    sb: { session: SESSION, profile: ARTIST },
    fn: async (name) => {
      if (name === "portal-review") return { delay: 1500, json: { ok: true, review: { kind: "mezcla", action: "cambios", note: null, marks: [{ t: 12, text: "subir la voz" }], at: "2026-10-19T12:00:00Z" } } };
      return { json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : {} };
    },
  });
  await h.page.addInitScript((key) => { localStorage.setItem(key, JSON.stringify([{ t: 12, text: "subir la voz" }])); }, KEY);
  await h.page.goto(h.url("/portal/"));
  await h.page.waitForFunction(() => window.ZGReview && !document.getElementById("view-app").hidden);

  await test("cierra mientras se envía: igual se borran las notas guardadas y la canción queda en «cambios»", async () => {
    await h.page.evaluate((song) => { window.__sent = null; window.ZGReview.open(song, { own: true, onSent: (review) => { window.__sent = review; } }); }, SONG);
    await h.page.click('[data-rv="send"]');
    await h.page.waitForTimeout(100);
    await h.page.keyboard.press("Escape"); // cierra con el envío en camino
    await h.page.waitForTimeout(2500);
    const st = await h.page.evaluate((key) => ({ draft: localStorage.getItem(key), sent: window.__sent }), KEY);
    assert(!h.logs.length, `errores en la página: ${h.logs.join(" | ")}`);
    assert(st.sent && st.sent.action === "cambios", "no avisó que se mandó (onSent)");
    assert(st.draft == null, "las notas quedaron guardadas como borrador: al volver a abrir se mandarían de nuevo");
    const calls = h.fnCalls.filter((c) => c.name === "portal-review").length;
    assert(calls === 1, `pedidos mandados: ${calls}`);
  });
  await h.close();
  done();
})();
