// Bug 22: al abrir el reproductor se descarga (para la onda y el volumen)
// solo la versión que se escucha; las otras, recién cuando se eligen.
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");

function wav(seconds = 0.3, rate = 8000) {
  const n = Math.floor(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * 8000), 44 + i * 2);
  return b;
}
const F = (name) => ({ name, url: `/audio/${encodeURIComponent(name)}`, modified: "2026-10-18T15:00:00Z", size: 5000 });
const SONG = { id: "ffffffff-0000-4000-8000-000000000001", title: "Viento", step: 3, delivery: { kind: "mezcla", state: "aprobar", file: F("Viento mix v3.wav"), versions: [F("Viento mix v2.wav"), F("Viento mix v1.wav")], demo: F("Viento maqueta.wav"), review: null } };

(async () => {
  await test("abre: mide solo la versión nueva; al elegir «Versión 2», recién ahí la mide", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn: async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : {} }) });
    const fetched = [];
    const body = wav();
    await h.page.route(/\/audio\//, (route) => {
      if (route.request().resourceType() === "fetch") fetched.push(decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()));
      return route.fulfill({ status: 200, contentType: "audio/wav", body });
    });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.waitForFunction(() => window.ZGReview && !document.getElementById("view-app").hidden);
      await h.page.evaluate((song) => window.ZGReview.open(song, { own: true }), SONG);
      await h.page.waitForTimeout(1500);
      assert(fetched.length === 1 && fetched[0] === "Viento mix v3.wav", `descargó al abrir: ${fetched.join(", ")}`);
      await h.page.click('#rvAB [data-src="1"]');
      await h.page.waitForTimeout(1000);
      assert(fetched.includes("Viento mix v2.wav"), `no midió la versión elegida: ${fetched.join(", ")}`);
      assert(!fetched.includes("Viento mix v1.wav") && !fetched.includes("Viento maqueta.wav"), `descargó de más: ${fetched.join(", ")}`);
      const hint = await h.page.locator("#rvABHint").innerText();
      assert(/Volumen igualado/.test(hint), `con las dos medidas tiene que igualar el volumen: ${hint}`);
    } finally { await h.close(); }
  });
  done();
})();
