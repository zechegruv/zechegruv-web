// Bug 18: con la sesión vencida, el portal pide entrar de nuevo (en vez de
// quedar vacío o con "Cannot read properties of null").
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const OK = { "portal-shows": { shows: [] }, "portal-songs": { configured: true, active: [], done: [] }, "portal-files": { configured: true, exists: true, files: [], groups: [] } };
const SONG = { id: "dddddddd-0000-4000-8000-000000000001", title: "Marea", step: 3, delivery: { kind: "mezcla", state: "aprobar", file: { name: "Marea mix.wav", url: "/x.wav", modified: "2026-10-18T15:00:00Z", size: 0 }, versions: [], review: null } };

async function run(name, deny, action) {
  await test(name, async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (fname) => (deny === fname ? { status: 401, json: { error: "Iniciá sesión de nuevo." } } : { json: OK[fname] || {} }) });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGPortal && document.getElementById("view-loading").hidden);
      if (action) await action(h);
      await h.page.waitForTimeout(1200);
      const st = await h.page.evaluate(() => ({ login: !document.getElementById("view-login").hidden, msg: document.getElementById("loginMsg").textContent }));
      assert(!h.logs.some((l) => /Cannot read properties of null/.test(l)), h.logs.join(" | "));
      assert(st.login, "no volvió a la pantalla de ingreso");
      assert(/sesión venció/i.test(st.msg), `mensaje: «${st.msg}»`);
    } finally { await h.close(); }
  });
}

(async () => {
  await run("Tus canciones: la función responde 401", "portal-songs");
  await run("Archivos: la función responde 401", "portal-files");
  await run("Tu show: la función responde 401", "portal-shows");
  await run("Reproductor: se vence la sesión antes de mandar las notas", null, async (h) => {
    await h.page.evaluate((song) => {
      localStorage.setItem(`zg-notas:${song.id}:${song.delivery.file.name}:${song.delivery.file.modified}`, JSON.stringify([{ t: 3, text: "más voz" }]));
      window.ZGReview.open(song, { own: true });
      window.__SB.session = null; // venció y no se pudo renovar
    }, SONG);
    await h.page.click('[data-rv="send"]');
  });
  await run("Tus canciones: se vence la sesión y se vuelven a pedir", null, async (h) => {
    await h.page.evaluate(() => { window.__SB.session = null; window.ZGSongs.load({ ...window.ZGPortal.me, id: "otro-perfil-sin-cache" }); });
  });
  done();
})();
