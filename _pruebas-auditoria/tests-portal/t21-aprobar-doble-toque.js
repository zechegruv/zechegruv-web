// Bug 21: en una entrega marcada a mano, "Aprobar" pide un segundo toque
// (igual que en el reproductor).
const path = require("path");
const { harness, test, done, assert, ARTIST, SESSION } = require("./harness");
const SONG = { id: "eeeeeeee-0000-4000-8000-000000000001", title: "Brasa", feat: null, stage: "mezcla", step: 3, done: false, ready: true, delivery: { kind: "mezcla", state: "aprobar", file: null, versions: [], demo: null, review: null, manual: "entregada", by: "admin" }, review: null };
const fn = async (name) => {
  if (name === "portal-songs") return { json: { configured: true, active: [SONG], done: [], next: null } };
  if (name === "portal-review") return { json: { ok: true, review: { kind: "mezcla", action: "aprobada", note: null, marks: [], at: "2026-10-19T12:00:00Z" } } };
  return { json: name === "portal-shows" ? { shows: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} };
};

(async () => {
  await test("el primer toque en «Aprobar» no aprueba: pide confirmar; el segundo sí", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn, viewport: { width: 375, height: 800 } });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.click('[data-atab="canciones"]');
      const btn = h.page.locator('#songsList [data-quick="aprobada"]');
      await btn.waitFor({ timeout: 5000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await h.page.waitForTimeout(400);
      const calls1 = h.fnCalls.filter((c) => c.name === "portal-review").length;
      assert(calls1 === 0, "aprobó con un solo toque");
      const label = await btn.innerText();
      assert(/Tocá de nuevo/.test(label), `texto: ${label}`);
      await h.page.screenshot({ path: path.join(__dirname, "shots/21-aprobar-confirmar-375.png") });
      await btn.click();
      await h.page.waitForTimeout(600);
      const calls2 = h.fnCalls.filter((c) => c.name === "portal-review");
      assert(calls2.length === 1 && calls2[0].body.action === "aprobada", `pedidos: ${calls2.length}`);
    } finally { await h.close(); }
  });

  await test("si no confirma, a los 4 segundos vuelve a «Aprobar»", async () => {
    const h = await harness({ sb: { session: SESSION, profile: ARTIST }, fn });
    try {
      await h.page.goto(h.url("/portal/"));
      await h.page.click('[data-atab="canciones"]');
      const btn = h.page.locator('#songsList [data-quick="aprobada"]');
      await btn.waitFor({ timeout: 5000 });
      await btn.click();
      await h.page.waitForTimeout(4400);
      assert((await btn.innerText()).trim() === "Aprobar", await btn.innerText());
      assert(h.fnCalls.filter((c) => c.name === "portal-review").length === 0, "aprobó solo");
    } finally { await h.close(); }
  });
  done();
})();
