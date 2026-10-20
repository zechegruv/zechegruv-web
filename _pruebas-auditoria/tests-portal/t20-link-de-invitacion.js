// Bug 20: volver a tocar el link de invitación con la sesión abierta no
// tiene que decir "Ese link ya se usó o venció".
const { harness, test, done, assert, ARTIST } = require("./harness");
const fn = async (name) => ({ json: name === "portal-shows" ? { shows: [] } : name === "portal-songs" ? { configured: true, active: [], done: [] } : name === "portal-files" ? { configured: true, exists: true, files: [], groups: [] } : {} });
const LINK = "/portal/?token_hash=abc123&type=invite";
const state = (h) => h.page.evaluate(() => ({
  app: !document.getElementById("view-app").hidden,
  rec: !document.getElementById("view-recovery").hidden,
  login: !document.getElementById("view-login").hidden,
  title: document.getElementById("recoveryTitle").textContent,
  msg: document.getElementById("loginMsg").textContent,
}));

(async () => {
  await test("sesión abierta y todavía sin contraseña: muestra «Creá tu contraseña»", async () => {
    const h = await harness({ sb: { session: { access_token: "tok-a", user: { id: ARTIST.id, user_metadata: {} } }, profile: ARTIST, verifyOtpError: "Email link is invalid or has expired" }, fn });
    try {
      await h.page.goto(h.url(LINK));
      await h.page.waitForTimeout(1000);
      const st = await state(h);
      assert(!/ya se usó/.test(st.msg), `dijo: ${st.msg}`);
      assert(st.rec && /Creá tu/.test(st.title), JSON.stringify(st));
    } finally { await h.close(); }
  });

  await test("sesión abierta y con contraseña: entra directo al portal", async () => {
    const h = await harness({ sb: { session: { access_token: "tok-a", user: { id: ARTIST.id, user_metadata: { password_set: true } } }, profile: ARTIST, verifyOtpError: "Email link is invalid or has expired" }, fn });
    try {
      await h.page.goto(h.url(LINK));
      await h.page.waitForTimeout(1000);
      const st = await state(h);
      assert(st.app && !st.rec && !st.login, JSON.stringify(st));
    } finally { await h.close(); }
  });

  await test("sin sesión: sigue avisando que el link ya se usó o venció", async () => {
    const h = await harness({ sb: { session: null, verifyOtpError: "Email link is invalid or has expired" }, fn });
    try {
      await h.page.goto(h.url(LINK));
      await h.page.waitForTimeout(1000);
      const st = await state(h);
      assert(st.login && /ya se usó o venció/.test(st.msg), JSON.stringify(st));
    } finally { await h.close(); }
  });
  done();
})();
