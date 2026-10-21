// Productor/Artista: entra a su portal de artista, pasa a la vista de
// productor con el interruptor y vuelve; queda recordado; el admin lo prende
// desde la pestaña Admin del artista y al invitar.
const { harness, test, done, assert } = require("./harness");
const SHOT = process.env.SHOTS;
const DUAL = { id: "20000000-0000-4000-8000-000000000003", role: "artist", also_producer: true, active: true, display_name: "Nico Beats", full_name: "Nico Beats", email: "nico@ejemplo.com", format: "ep" };
const ADMIN = { id: "40000000-0000-4000-8000-000000000001", role: "admin", active: true, display_name: "Zeche", email: "z@ejemplo.com" };
const A1 = { id: "20000000-0000-4000-8000-000000000001", display_name: "Luna Prisma", avatar_url: null, spotify_artist_id: null, format: "ep" };
const sess = (p) => ({ access_token: "tok", user: { id: p.id, user_metadata: { password_set: true } } });
const OWN = { configured: true, next: null, active: [{ id: "o1", title: "Propia", feat: null, stage: "produccion", step: 1, done: false, release: null, delivery: null, ready: false, review: null }], done: [] };
const LUNA = { configured: true, next: null, active: [{ id: "s1", title: "Faro", feat: null, stage: "mezcla", step: 3, done: false, release: null, delivery: { kind: "mezcla", state: "aprobar", file: { name: "Faro - Mix.wav", url: "https://dl.example/f.wav", modified: "2026-10-20T12:00:00Z", size: 1 }, versions: [] } }], done: [] };
const fn = async (name, req, url) => {
  if (name === "portal-songs") return { json: url.searchParams.get("artist") === A1.id ? LUNA : OWN };
  if (name === "portal-files") return { json: { configured: true, exists: true, files: [], groups: [] } };
  if (name === "portal-shows") return { json: { shows: [] } };
  return { json: {} };
};

(async () => {
  for (const vp of [{ width: 390, height: 844, n: "celu" }, { width: 1280, height: 900, n: "compu" }]) {
    await test(`Productor/Artista (${vp.n}): su portal de artista y el interruptor a la vista de productor`, async () => {
      const h = await harness({ viewport: vp, sb: { session: sess(DUAL), profile: DUAL, rpc: { producer_my_artists: [A1] } }, fn });
      try {
        await h.page.goto(h.url("/portal/"));
        await h.page.waitForSelector(".pr-mode");
        await h.page.waitForFunction(() => document.body.classList.contains("is-artist"));
        await h.page.waitForTimeout(800);
        assert(await h.page.isVisible("#artistTabs"), "no ve su menú de artista");
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/dual-${vp.n}-1-artista.png` });
        await h.page.click('.pr-mode [data-mode="producer"]');
        await h.page.waitForSelector(".pr-artist");
        await h.page.waitForTimeout(700);
        assert(await h.page.isHidden("#artistTabs"), "quedó el menú de artista");
        assert(await h.page.isHidden(".pr-account"), "muestra Mi cuenta (ya la tiene en su perfil)");
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/dual-${vp.n}-2-productor.png` });
        await h.page.click(".pr-artist");
        await h.page.waitForSelector(".pr-song");
        assert(/esperando que Luna Prisma/.test(await h.page.innerText("#prBody")), "no ve a la asignada");
        // Recargar: sigue en la vista de productor.
        await h.page.reload();
        await h.page.waitForSelector(".pr-artist");
        assert(await h.page.evaluate(() => document.body.classList.contains("is-producer")), "no recordó la vista");
        await h.page.click('.pr-mode [data-mode="artist"]');
        await h.page.waitForFunction(() => document.body.classList.contains("is-artist") && !document.getElementById("panel-profile").hidden);
        await h.page.waitForTimeout(500);
        assert(await h.page.isVisible("#artistTabs"), "no volvió el menú de artista");
        assert(!h.logs.length, h.logs.join("\n"));
      } finally { await h.close(); }
    });
  }

  await test("artista común: no tiene interruptor", async () => {
    const h = await harness({ sb: { session: sess(DUAL), profile: { ...DUAL, also_producer: false } }, fn });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => document.body.classList.contains("is-artist"));
      await h.page.waitForTimeout(500);
      assert(!(await h.page.$(".pr-mode")), "tiene interruptor");
    } finally { await h.close(); }
  });

  await test("admin: en la pestaña Admin del artista lo prende y le elige artistas", async () => {
    const plain = { ...DUAL, also_producer: false };
    const profiles = [ADMIN, plain, { ...A1, role: "artist", active: true }];
    const h = await harness({ viewport: { width: 1280, height: 900 }, sb: { session: sess(ADMIN), tables: { profiles, producer_artists: [] } }, fn });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => !document.getElementById("view-app").hidden);
      await h.page.evaluate((p) => window.ZGPortal.showProfile(p), plain);
      await h.page.waitForTimeout(300);
      assert(await h.page.isHidden(".pr-admin"), "se ve fuera de la pestaña Admin");
      await h.page.click('[data-vtab="admin"]');
      await h.page.waitForSelector(".pr-admin [data-toggle]");
      await h.page.click(".pr-admin [data-toggle]");
      await h.page.waitForSelector(".pr-chip");
      const row = await h.page.evaluate((id) => window.__SB.tables.profiles.find((p) => p.id === id).also_producer, plain.id);
      assert(row === true, "no guardó also_producer");
      const chips = await h.page.$$eval(".pr-chip", (b) => b.map((x) => x.textContent.trim()));
      assert(chips.join() === "Luna Prisma", `chips: ${chips.join()} (no tiene que aparecer él mismo)`);
      await h.page.click(".pr-chip");
      await h.page.waitForFunction(() => /ya ve a Luna/.test(document.querySelector(".pr-admin .msg").textContent));
      await h.page.locator(".pr-admin").scrollIntoViewIfNeeded();
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/dual-admin.png` });
      assert(!h.logs.length, h.logs.join("\n"));
    } finally { await h.close(); }
  });
  done();
})();
