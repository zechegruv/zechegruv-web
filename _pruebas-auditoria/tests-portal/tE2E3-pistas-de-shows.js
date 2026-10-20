// Extras E2 y E3: pistas de los shows.
//  E2: "done" (terminó una tanda) no se puede repetir para mandarle mails a
//      Zeche sin límite, ni usar con la subida cerrada.
//  E3: la subcarpeta del artista usa su nombre completo (no el que edita).
const { S } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive } = require("./onedrive-fake");
const shows = require("../portal/netlify/functions/portal-shows");

const ME = "60000000-0000-4000-8000-000000000001";
const EV = "70000000-0000-4000-8000-000000000001";
const EV_OLD = "70000000-0000-4000-8000-000000000002";
const future = new Date(Date.now() + 5 * 864e5).toISOString();
const event = (id, extra = {}) => ({ id, name: "Shows & Open Mic #9", is_test: false, status: "on_sale", starts_at: future, shows_deadline: future, kind: "show", ...extra });
S.tables.profiles = [{ id: ME, role: "artist", active: true, email: "sol@ejemplo.com", display_name: "Sol ✨ Nocturno", full_name: "Sol Martínez" }];
S.tables.pass_show_artists = [
  { event_id: EV, profile_id: ME, pass_events: event(EV) },
  { event_id: EV_OLD, profile_id: ME, pass_events: event(EV_OLD, { shows_deadline: new Date(Date.now() - 2 * 864e5).toISOString(), starts_at: new Date(Date.now() - 864e5).toISOString() }) },
];
S.tables.pass_settings = [{ key: "root_folder_link", value: "https://1drv.ms/f/s!madre" }];
S.tables.pass_show_files = [];
const log = [];
S.extraFetch = oneDrive({}, log);
const call = (body) => shows.handler({ httpMethod: "POST", headers: { authorization: `Bearer tok-${ME}` }, body: JSON.stringify(body) });
const FILES = [{ name: "Sol - pista 1.wav", size: 1000 }, { name: "Sol - pista 2.wav", size: 2000 }];

(async () => {
  await test("E3: la subcarpeta de pistas se llama como el nombre completo del artista", async () => {
    const r = await call({ action: "start", event_id: EV, name: "pista.wav", size: 5000 });
    assert(r.statusCode === 200, r.body);
    const made = log.filter((l) => l[0] === "POST" && /\/children$/.test(new URL(l[1]).pathname)).map((l) => JSON.parse(l[2]).name);
    assert(made.includes("Sol Martínez"), `carpetas creadas: ${made.join(" | ")}`);
    assert(!made.some((n) => /Nocturno/.test(n)), "usó el nombre que edita el artista");
  });

  await test("E2: repetir «done» con los mismos archivos no los registra de nuevo ni manda otro mail", async () => {
    const a = await call({ action: "done", event_id: EV, files: FILES });
    const b = await call({ action: "done", event_id: EV, files: FILES });
    assert(a.statusCode === 200 && b.statusCode === 200, `${a.statusCode} ${b.statusCode} ${b.body}`);
    assert(S.tables.pass_show_files.length === 2, `filas: ${S.tables.pass_show_files.length}`);
    assert(S.mails.length === 1, `mails: ${S.mails.length}`);
  });

  await test("E2: una tanda nueva sí avisa (solo con lo nuevo)", async () => {
    const r = await call({ action: "done", event_id: EV, files: [FILES[0], { name: "Sol - pista 3.wav", size: 3000 }] });
    assert(r.statusCode === 200, r.body);
    assert(S.tables.pass_show_files.length === 3, `filas: ${S.tables.pass_show_files.length}`);
    assert(S.mails.length === 2 && /pista 3/.test(S.mails[1].html) && !/pista 1/.test(S.mails[1].html), "el mail no fue solo por lo nuevo");
  });

  await test("E2: con la subida de pistas ya cerrada, «done» no registra ni manda mails", async () => {
    const before = S.mails.length;
    const r = await call({ action: "done", event_id: EV_OLD, files: [{ name: "tarde.wav", size: 1 }] });
    assert(r.statusCode === 409, `status ${r.statusCode}`);
    assert(S.mails.length === before && !S.tables.pass_show_files.some((f) => f.file_name === "tarde.wav"), "registró o avisó igual");
  });
  done();
})();
