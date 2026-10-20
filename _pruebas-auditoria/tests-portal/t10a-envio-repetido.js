// Bug 10 (servidor): el mismo pedido mandado dos veces seguidas no se duplica.
const { S, page, title, relp, sel } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const songs = require("../portal/netlify/functions/portal-songs");
const review = require("../portal/netlify/functions/portal-review");

const CLIENT = "aaaaaaaa-0000-4000-8000-000000000020";
const SONG = "dddddddd-0000-4000-8000-000000000001";
const SONG2 = "dddddddd-0000-4000-8000-000000000002";
const ME = "30000000-0000-4000-8000-000000000001";
page(songs.SONGS_DS, SONG, { "Canción": title("Marea"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]), Entrega: sel("Mezcla entregada") });
page(songs.SONGS_DS, SONG2, { "Canción": title("Ola"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]), Entrega: sel("Mezcla entregada") });
S.tables.profiles = [{ id: ME, role: "artist", active: true, email: "marea@ejemplo.com", display_name: "Marea", full_name: "Marea Gómez" }];
S.tables.artist_private = [{ profile_id: ME, notion_page_id: CLIENT.replace(/-/g, ""), onedrive_link: null }];
S.tables.song_approvals = [];
const send = (body) => review.handler({ httpMethod: "POST", headers: { authorization: `Bearer tok-${ME}` }, body: JSON.stringify(body) });
const PEDIDO = { song: SONG, kind: "mezcla", action: "cambios", note: "Subir la voz", marks: [{ t: 12, text: "acá la voz" }] };

(async () => {
  await test("mandar dos veces el mismo pedido de cambios guarda uno y avisa una sola vez", async () => {
    const a = await send(PEDIDO);
    const b = await send(PEDIDO);
    assert(a.statusCode === 200 && b.statusCode === 200, `status ${a.statusCode} / ${b.statusCode}: ${b.body}`);
    const rows = S.tables.song_approvals.filter((r) => r.song_id === SONG && r.action === "cambios");
    assert(rows.length === 1, `filas guardadas: ${rows.length}`);
    assert(S.mails.length === 1, `mails a Zeche: ${S.mails.length}`);
    assert(JSON.parse(b.body).ok, "la segunda respuesta no dice ok");
  });

  await test("un pedido distinto (otra nota) sí se guarda", async () => {
    const before = S.mails.length;
    const r = await send({ ...PEDIDO, note: "Bajar el bajo" });
    assert(r.statusCode === 200, r.body);
    assert(S.tables.song_approvals.filter((x) => x.song_id === SONG).length === 2, "no guardó el pedido nuevo");
    assert(S.mails.length === before + 1, "no avisó del pedido nuevo");
  });

  await test("el mismo contenido en otra canción no cuenta como repetido", async () => {
    const r = await send({ ...PEDIDO, song: SONG2 });
    assert(r.statusCode === 200, r.body);
    assert(S.tables.song_approvals.some((x) => x.song_id === SONG2), "no guardó la otra canción");
  });
  await test("aprobar dos veces seguidas responde bien las dos veces y cierra la etapa una sola vez", async () => {
    const before = S.mails.length;
    const a = await send({ song: SONG2, kind: "mezcla", action: "aprobada" });
    const b = await send({ song: SONG2, kind: "mezcla", action: "aprobada" });
    assert(a.statusCode === 200 && b.statusCode === 200, `status ${a.statusCode} / ${b.statusCode}: ${b.body}`);
    assert(S.tables.song_approvals.filter((x) => x.song_id === SONG2 && x.action === "aprobada").length === 1, "guardó dos aprobaciones");
    assert(S.mails.length === before + 1, `mails: ${S.mails.length - before}`);
  });
  done();
})();
