// Bug 24: abrir "Tus canciones" no espera la entrega automática completa
// (Notion, calendario, mails); igual muestra la mezcla nueva para escuchar.
const { S, page, title, relp, sel } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive, file } = require("./onedrive-fake");
const songs = require("../portal/netlify/functions/portal-songs");

const CLIENT = "aaaaaaaa-0000-4000-8000-000000000030";
const SONG = "abababab-0000-4000-8000-000000000001";
const ME = "40000000-0000-4000-8000-000000000001";
page(songs.SONGS_DS, SONG, { "Canción": title("Duna"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]), Entrega: sel(null) });
S.tables.profiles = [{ id: ME, role: "artist", active: true, email: "duna@ejemplo.com", display_name: "Duna", full_name: "Duna Ríos" }];
S.tables.artist_private = [{ profile_id: ME, notion_page_id: CLIENT.replace(/-/g, ""), onedrive_link: "https://1drv.ms/f/s!duna" }];
S.tables.song_approvals = [];
S.extraFetch = oneDrive({ Exports: { "Duna mix.wav": file("2026-10-18T15:00:00Z") } });

(async () => {
  await test("responde con la mezcla para escuchar sin escribir en Notion ni mandar mails en el camino", async () => {
    const before = S.log.length;
    const r = await songs.handler({ httpMethod: "GET", headers: { authorization: `Bearer tok-${ME}` }, queryStringParameters: {} });
    const out = JSON.parse(r.body);
    assert(r.statusCode === 200, r.body);
    assert(out.active[0].delivery.state === "aprobar" && out.active[0].delivery.file, `estado: ${out.active[0].delivery.state}`);
    const writes = S.log.slice(before).filter((l) => (l[0] === "notion" && l[1] !== "GET") || l[0] === "gcal" || (l[0] === "db" && l[1] !== "GET"));
    assert(!writes.length && !S.mails.length, `escribió al abrir: ${JSON.stringify(writes.map((w) => w.slice(0, 3)))} mails=${S.mails.length}`);
  });
  done();
})();
