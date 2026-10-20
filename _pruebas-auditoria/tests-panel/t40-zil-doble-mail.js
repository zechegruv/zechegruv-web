// Bug 40: si se toca "sync" en el panel mientras corre la función programada,
// el lanzamiento pasa a "published" dos veces y el artista recibe dos mails.
const path = require("path");
const H = require("./h");
const { S, F, check, done, setup } = H;
setup();
process.env.ZIL_API_TOKEN = "x";
process.env.ZIL_API_URL = "https://api.zil.prueba.test"; // no es la de pruebas: manda mails
// ZIL de mentira (sin red).
const zr = path.join(H.ROOT, "netlify/functions/_lib/zil-release.js");
require.cache[require.resolve(zr)] = { id: zr, filename: zr, loaded: true, exports: { labelSession: async () => ({ call: async (name, method, p) => {
  await new Promise((r) => setTimeout(r, 10));
  if (/distributionStatus/.test(p)) return [{ dsp: "spotify", status: "delivered" }];
  if (/smartLink/.test(p)) return { smartLink: "https://lnk.prueba.test/faro" };
  return {};
} }) } };
const { syncRelease } = F("zil-sync");
S.tables.releases = [{ id: "r40", title: "Faro", status: "loaded", zil_album_id: "alb1", zil_status: {}, smart_link: null, profiles: { display_name: "Pazz", email: "artista@prueba.test" } }];
(async () => {
  const [a, b] = await Promise.all([syncRelease("r40"), syncRelease("r40", { force: true })]);
  const mails = S.mails.filter((m) => (m.to || []).includes("artista@prueba.test"));
  check("el artista recibe un solo mail", mails.length === 1, mails.length);
  check("queda publicado con su link", S.tables.releases[0].status === "published" && S.tables.releases[0].smart_link === "https://lnk.prueba.test/faro", S.tables.releases[0]);
  check("solo una de las dos pasadas dice que lo publicó", [a, b].filter((x) => x.published).length === 1, [a.published, b.published]);
  done("t40 zil sin mail doble");
})().catch((e) => { console.error(e); process.exitCode = 1; });
