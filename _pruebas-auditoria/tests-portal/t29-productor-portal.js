// Portal del Productor: ve sus artistas, canciones (sin aprobar) y archivos
// (sin subir); el reproductor es propio (no mide escuchas del artista); y el
// administrador le elige los artistas desde su perfil.
const { harness, test, done, assert } = require("./harness");
const SHOT = process.env.SHOTS;
const PROD = { id: "30000000-0000-4000-8000-000000000001", role: "producer", active: true, display_name: "Nico Beats", email: "nico@ejemplo.com" };
const ADMIN = { id: "40000000-0000-4000-8000-000000000001", role: "admin", active: true, display_name: "Zeche", email: "z@ejemplo.com" };
const A1 = { id: "20000000-0000-4000-8000-000000000001", display_name: "Luna Prisma", avatar_url: null, spotify_artist_id: null, format: "ep" };
const A2 = { id: "20000000-0000-4000-8000-000000000002", display_name: "Bruma Sur", avatar_url: null, spotify_artist_id: null, format: "single" };
const sess = (p) => ({ access_token: "tok", user: { id: p.id, user_metadata: { password_set: true } } });
const f = (name, tag, mod) => ({ name, tag, size: 41000000, created: mod, modified: mod, url: `https://dl.example/${encodeURIComponent(name)}` });
const SONGS = {
  [A1.id]: { configured: true, next: null,
    active: [
      { id: "s1", title: "Faro", feat: null, stage: "master", step: 4, done: false, release: null, delivery: { kind: "master", state: "aprobar", file: f("Faro - Master.wav", "master", "2026-10-20T12:00:00Z"), versions: [] } },
      { id: "s2", title: "Seu amor", feat: "Pazz", stage: "mezcla", step: 3, done: false, release: null, delivery: { kind: "mezcla", state: "proceso", file: null, versions: [] } },
      { id: "s3", title: "Niebla", feat: null, stage: "grabacion", step: 2, done: false, release: null, delivery: null },
    ],
    done: [{ id: "s4", title: "Marea", feat: null, stage: "publicada", step: -1, done: true, release: "2026-09-12", delivery: { kind: "master", state: "aprobada", file: f("Marea - Master.wav", "master", "2026-09-01T12:00:00Z"), versions: [] } }] },
  [A2.id]: { configured: true, next: null, active: [{ id: "s9", title: "Humo", feat: null, stage: "produccion", step: 1, done: false, release: null, delivery: null }], done: [] },
};
const FILES = { configured: true, exists: true, canUpload: false, files: [f("idea guitarra.mp3", null, "2026-10-02T12:00:00Z")], groups: [{ name: "Faro", files: [f("Faro - Mix v2.wav", "mezcla", "2026-10-15T12:00:00Z"), f("Faro letra.pdf", null, "2026-10-01T12:00:00Z")] }] };
const fn = async (name, req, url) => {
  if (name === "portal-songs") return { json: SONGS[url.searchParams.get("artist")] || { configured: false, active: [], done: [] } };
  if (name === "portal-files") return { json: FILES };
  return { json: {} };
};

(async () => {
  for (const vp of [{ width: 390, height: 844, n: "celu" }, { width: 1280, height: 900, n: "compu" }]) {
    await test(`productor (${vp.n}): ve sus artistas, canciones y archivos, sin aprobar ni subir`, async () => {
      const h = await harness({ viewport: vp, sb: { session: sess(PROD), profile: PROD, rpc: { producer_my_artists: [A1, A2] } }, fn });
      try {
        await h.page.goto(h.url("/portal/"));
        await h.page.waitForSelector(".pr-artist");
        await h.page.waitForFunction(() => [...document.querySelectorAll(".pr-artist-sub")].every((e) => !/Cargando/.test(e.textContent)));
        await h.page.waitForTimeout(700);
        const names = await h.page.$$eval(".pr-artist b", (b) => b.map((x) => x.textContent));
        assert(names.join() === "Luna Prisma,Bruma Sur", names.join());
        assert(await h.page.isHidden("#artistTabs") && await h.page.isHidden("#tabs"), "se ve un menú de artista o admin");
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-${vp.n}-1-inicio.png`, fullPage: true });
        await h.page.click(".pr-artist");
        await h.page.waitForSelector(".pr-song");
        await h.page.waitForTimeout(900);
        const txt = await h.page.innerText("#prBody");
        assert(/Master entregado/.test(txt) && /esperando que Luna Prisma/.test(txt), txt);
        assert(!/Aprobar|Pedir cambios|Escuchar y aprobar/i.test(txt), "aparece algo para aprobar");
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-${vp.n}-2-canciones.png`, fullPage: true });
        await h.page.click(".pr-song .pr-play");
        await h.page.waitForSelector(".pr-player:not([hidden])");
        await h.page.waitForTimeout(500);
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-${vp.n}-3-reproductor.png` });
        await h.page.click('[data-ptab="archivos"]');
        await h.page.waitForSelector(".pr-file");
        await h.page.waitForTimeout(600);
        assert(!(await h.page.$('[data-sec="membresia"]')), "muestra Membresía");
        assert(!(await h.page.$("#prBody input[type=file]")), "deja subir");
        if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-${vp.n}-4-archivos.png`, fullPage: true });
        const calls = h.fnCalls.map((c) => c.name);
        assert(!calls.some((n) => /review|mark|upload|push|whatsapp|shows/.test(n)), `llamó a: ${calls.join()}`);
        const tracked = await h.page.evaluate(() => (window.dataLayer || []).some((x) => x && x[1] === "portal_escuchar"));
        assert(!tracked, "contó la escucha como del artista");
        assert(!h.logs.length, h.logs.join("\n"));
      } finally { await h.close(); }
    });
  }

  await test("novedades: si una canción avanzó desde la última visita, se marca", async () => {
    const h = await harness({ viewport: { width: 390, height: 844 }, sb: { session: sess(PROD), profile: PROD, rpc: { producer_my_artists: [A1] } }, fn });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.evaluate((id) => localStorage.setItem(`zg-prod-visto-${id}`, JSON.stringify({ s1: "mezcla|aprobada|", s2: "mezcla|proceso|", s3: "grabacion||", s4: "publicada|aprobada|2026-09-01T12:00:00Z" })), PROD.id);
      await h.page.reload();
      await h.page.waitForSelector(".pr-badge:not([hidden])");
      assert(/1 novedad/.test(await h.page.innerText(".pr-badge")), await h.page.innerText(".pr-badge"));
      await h.page.click(".pr-artist");
      await h.page.waitForSelector(".pr-song.is-new");
      await h.page.waitForTimeout(800);
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-celu-5-novedad.png`, fullPage: true });
    } finally { await h.close(); }
  });

  await test("admin: en el perfil del productor elige qué artistas sigue", async () => {
    const profiles = [ADMIN, PROD, { ...A1, role: "artist", active: true }, { ...A2, role: "artist", active: true }];
    const h = await harness({ viewport: { width: 1280, height: 900 }, sb: { session: sess(ADMIN), tables: { profiles, producer_artists: [{ producer_id: PROD.id, artist_id: A1.id }] } }, fn });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => !document.getElementById("view-app").hidden);
      await h.page.evaluate((p) => window.ZGPortal.showProfile(p), PROD);
      await h.page.waitForSelector(".pr-chip");
      assert(await h.page.isHidden("#spaceCard") && await h.page.isHidden("#songsCard"), "muestra carpetas o canciones del productor");
      const on = await h.page.$$eval(".pr-chip.is-on", (b) => b.map((x) => x.textContent.trim()));
      assert(on.join() === "Luna Prisma", on.join());
      await h.page.click(".pr-chip:not(.is-on)");
      await h.page.waitForFunction(() => /ya ve a Bruma Sur/.test(document.querySelector(".pr-admin .msg").textContent));
      const rows = await h.page.evaluate(() => window.__SB.tables.producer_artists.map((r) => r.artist_id));
      assert(rows.length === 2, JSON.stringify(rows));
      await h.page.click(".pr-chip.is-on");
      await h.page.waitForFunction(() => /ya no ve/.test(document.querySelector(".pr-admin .msg").textContent));
      await h.page.locator(".pr-admin").scrollIntoViewIfNeeded();
      if (SHOT) await h.page.screenshot({ path: `${SHOT}/prod-admin-asignar.png` });
      assert(!h.logs.length, h.logs.join("\n"));
    } finally { await h.close(); }
  });
  done();
})();
