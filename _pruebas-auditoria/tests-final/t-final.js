// Pruebas de los cierres entre frentes (corren contra ../int2).
const { S, page, title, sel, relp, date, dayAR } = require("../tests-shared/mock");
const F = __dirname + "/../panel/netlify/functions";
const ps = require(F + "/portal-songs");
const review = require(F + "/portal-review").handler;
const songs = require(F + "/portal-songs").handler;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "PASA " : "FALLA"} ${what}`); if (!ok) fails++; };
const call = async (h, user, method, body) => { const r = await h({ httpMethod: method, headers: { authorization: `Bearer tok-${user}` }, body: body ? JSON.stringify(body) : undefined, queryStringParameters: {} }); return { status: r.statusCode, ...JSON.parse(r.body) }; };
const today = dayAR(new Date());
const U = "a1000000-0000-4000-8000-000000000001", C = "c1000000-0000-4000-8000-000000000001", SG = "51000000-0000-4000-8000-000000000001";
function reset() {
  S.pages = {}; S.events = {}; S.mails = []; S.log = []; S.failFreeBusy = false; S.notion429 = 0;
  page(ps.CLIENTS_DS, C, { "Nombre Artista": title("Artista Prueba") });
  page(ps.SONGS_DS, SG, { "Canción": title("Tema Prueba"), Artista: relp([C]), "Etapa actual": sel("Mix"), Entrega: sel("Mezcla entregada"), "Fecha de entrega": date(today) });
  S.tables = { profiles: [{ id: U, role: "artist", display_name: "Artista Prueba", full_name: "Artista Prueba", email: "a@prueba.test" }], artist_private: [{ profile_id: U, notion_page_id: C }], app_tokens: [{ provider: "google_calendar", refresh_token: "r" }], song_stage_log: [], song_approvals: [], portal_reminders: [], task_reschedules: [] };
}
(async () => {
  reset(); S.failFreeBusy = true;
  const r = await call(review, U, "POST", { song: SG, kind: "mezcla", action: "cambios", note: "subir la voz" });
  const mail = S.mails.find((m) => /pidió cambios/.test(m.subject));
  check(r.status === 200 && mail && /Google Calendar no respondió/.test(mail.html), "pedir modificaciones con Google caído: el mail a Zeche dice que Google no respondió (no 'no encontré hueco')");
  reset(); S.notion429 = 1;
  const s = await call(songs, U, "GET");
  check(s.status === 200 && (s.active || []).some((x) => x.title === "Tema Prueba"), `Tus canciones con Notion saturado un momento: reintenta y muestra la canción (status ${s.status})`);
  reset(); S.notion429 = 2;
  const a = await call(review, U, "POST", { song: SG, kind: "mezcla", action: "aprobada" });
  check(a.status === 200 && S.pages[SG].properties["Etapa actual"].select.name === "Master", `aprobar con Notion saturado un momento: reintenta y pasa a Master (status ${a.status})`);
  console.log(fails ? `${fails} FALLAN` : "TODAS PASAN"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
