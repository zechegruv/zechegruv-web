// Bug 23: cuando vence el link del audio de OneDrive, se pide uno nuevo
// (una sola vez) en lugar de reintentar con el vencido.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");

function wav(seconds = 1, rate = 8000) {
  const n = Math.floor(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const BODY = wav();
const songWith = (tok) => ({ id: "99999999-0000-4000-8000-000000000001", title: "Niebla", feat: null, stage: "mezcla", step: 3, done: false, ready: true, review: null,
  delivery: { kind: "mezcla", state: "aprobar", file: { name: "Niebla mix.wav", url: `/audio/niebla.wav?tok=${tok}`, modified: "2026-10-18T15:00:00Z", size: 0 }, versions: [], demo: null, review: null, manual: null, by: null } });
const routeAudio = (h, goodTok) => h.page.route(/\/audio\//, (r) => (new URL(r.request().url()).searchParams.get("tok") === goodTok
  ? r.fulfill({ status: 200, contentType: "audio/wav", body: BODY })
  : r.fulfill({ status: 403, contentType: "text/plain", body: "vencido" })));

(async () => {
  await test("reproductor: con el link vencido pide las canciones de nuevo y sigue con el link nuevo", async () => {
    let n = 0;
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name) => {
      if (name === "portal-songs") return { json: { configured: true, active: [songWith(++n === 1 ? "viejo" : "nuevo")], done: [], next: null } };
      return { json: name === "portal-shows" ? { shows: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} };
    } });
    try {
      await routeAudio(h, "nuevo");
      await h.page.goto(h.url("/portal/"));
      await h.page.click('[data-atab="canciones"]');
      await h.page.click('#songsList [data-listen]');
      await h.page.waitForTimeout(2000);
      const st = await h.page.evaluate(() => ({ src: document.getElementById("rvAudio").currentSrc || document.getElementById("rvAudio").src, msg: document.getElementById("rvLoading").textContent }));
      assert(/tok=nuevo/.test(st.src), `sigue con: ${st.src} (${st.msg})`);
      assert(n === 2, `pedidos de canciones: ${n}`);
    } finally { await h.close(); }
  });

  await test("reproductor: si el link nuevo también falla, reintenta una sola vez y avisa", async () => {
    let n = 0;
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name) => {
      if (name === "portal-songs") return { json: { configured: true, active: [songWith(`v${++n}`)], done: [], next: null } };
      return { json: name === "portal-shows" ? { shows: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} };
    } });
    try {
      await routeAudio(h, "ninguno");
      await h.page.goto(h.url("/portal/"));
      await h.page.click('[data-atab="canciones"]');
      await h.page.click('#songsList [data-listen]');
      await h.page.waitForTimeout(2500);
      const msg = await h.page.locator("#rvLoading").innerText();
      assert(n === 2, `pedidos de canciones: ${n}`);
      assert(/No pudimos abrir el audio/.test(msg), `mensaje: ${msg}`);
    } finally { await h.close(); }
  });

  await test("Archivos: con el link vencido vuelve a pedir la carpeta y reproduce con el link nuevo", async () => {
    let n = 0;
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name, req, url) => {
      if (name === "portal-files" && url.searchParams.get("section") === "exports") {
        n++;
        return { json: { configured: true, exists: true, files: [], groups: [{ name: "Niebla", files: [{ name: "Niebla mix.wav", tag: "mezcla", size: 1, created: "2026-10-18T15:00:00Z", modified: "2026-10-18T15:00:00Z", url: `/audio/niebla.wav?tok=${n === 1 ? "viejo" : "nuevo"}` }] }] } };
      }
      return { json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} };
    } });
    try {
      await routeAudio(h, "nuevo");
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGFiles && !document.getElementById("view-app").hidden);
      await h.page.evaluate(() => window.ZGFiles.open("exports", window.ZGPortal.me));
      await h.page.waitForTimeout(800);
      await h.page.evaluate(() => { document.querySelectorAll("#filesList details").forEach((d) => { d.open = true; }); });
      await h.page.click("#filesList .play-btn");
      await h.page.waitForTimeout(2000);
      const st = await h.page.evaluate(() => ({ src: document.getElementById("player").querySelector("audio") ? "" : "", a: [...document.querySelectorAll("audio")].map((x) => x.src), name: document.getElementById("playerName").textContent }));
      assert(st.a.some((s) => /tok=nuevo/.test(s)), `audios: ${st.a.join(", ")} — ${st.name}`);
      assert(!/No pudimos/.test(st.name), st.name);
      assert(n === 2, `pedidos de la carpeta: ${n}`);
    } finally { await h.close(); }
  });
  done();
})();
