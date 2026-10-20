// Bug 6: la ficha de Clientes no se puede "robar" cambiándose el nombre visible.
const { S, page, title, relp, sel } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const FN = "../portal/netlify/functions/";
const songs = require(FN + "portal-songs");
const review = require(FN + "portal-review");

const VICTIM_CLIENT = "aaaaaaaa-0000-4000-8000-000000000001";
const VICTIM_SONG = "bbbbbbbb-0000-4000-8000-000000000001";
page(songs.CLIENTS_DS, VICTIM_CLIENT, { "Nombre Artista": title("Luna Prisma"), "Correo Electrónico": { type: "email", email: "luna@ejemplo.com" } });
page(songs.SONGS_DS, VICTIM_SONG, { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([VICTIM_CLIENT]), Entrega: sel("Mezcla entregada") });
const OTHER_CLIENT = "aaaaaaaa-0000-4000-8000-000000000002";
page(songs.CLIENTS_DS, OTHER_CLIENT, { "Nombre Artista": title("Bruma Sur"), "Correo Electrónico": { type: "email", email: "otra-cosa@ejemplo.com" } });

const prof = (id, extra) => ({ id, role: "artist", active: true, ...extra });
S.tables.profiles = [
  prof("10000000-0000-4000-8000-000000000001", { email: "intruso@ejemplo.com", display_name: "Luna Prisma", full_name: "Tomás Intruso" }),
  prof("10000000-0000-4000-8000-000000000002", { email: "bruma@ejemplo.com", display_name: "Bruma Sur", full_name: "Bruma Sur" }),
  prof("10000000-0000-4000-8000-000000000003", { email: "luna@ejemplo.com", display_name: "Luna Prisma", full_name: "Luna Pérez" }),
];
S.tables.artist_private = S.tables.profiles.map((p) => ({ profile_id: p.id, notion_page_id: null, onedrive_link: null }));
S.tables.song_approvals = [];
const call = (fn, id, extra = {}) => fn.handler({ httpMethod: extra.body ? "POST" : "GET", headers: { authorization: `Bearer tok-${id}` }, queryStringParameters: {}, ...extra });

(async () => {
  await test("cambiarse el nombre visible no muestra canciones de otro artista", async () => {
    const r = await call(songs, "10000000-0000-4000-8000-000000000001");
    const out = JSON.parse(r.body);
    assert(r.statusCode === 200, `status ${r.statusCode}`);
    assert(!out.configured && !(out.active || []).length, `vio canciones ajenas: ${JSON.stringify(out.active && out.active.map((s) => s.title))}`);
  });

  await test("cambiarse el nombre visible no deja aprobar canciones de otro artista", async () => {
    const r = await call(review, "10000000-0000-4000-8000-000000000001", { body: JSON.stringify({ song: VICTIM_SONG, kind: "mezcla", action: "aprobada" }) });
    assert(r.statusCode === 403, `status ${r.statusCode} ${r.body}`);
    assert(!S.log.some((l) => l[0] === "notion" && l[1] === "PATCH" && l[2] === VICTIM_SONG), "tocó la canción ajena en Notion");
  });

  await test("por nombre completo (que no edita el artista) se encuentra y queda fija en artist_private", async () => {
    const id = "10000000-0000-4000-8000-000000000002";
    const r = await call(songs, id);
    const out = JSON.parse(r.body);
    assert(out.configured, "no encontró su ficha por full_name");
    const row = S.tables.artist_private.find((x) => x.profile_id === id);
    assert(row.notion_page_id && row.notion_page_id.replace(/-/g, "") === OTHER_CLIENT.replace(/-/g, ""), `no la guardó: ${row.notion_page_id}`);
  });

  await test("por mail se encuentra, queda fija, y después agregarle un emoji al nombre no le saca sus canciones", async () => {
    const id = "10000000-0000-4000-8000-000000000003";
    let out = JSON.parse((await call(songs, id)).body);
    assert(out.configured && out.active.length === 1, "no vio sus canciones por mail");
    const row = S.tables.artist_private.find((x) => x.profile_id === id);
    assert(row.notion_page_id, "no guardó la ficha encontrada por mail");
    const p = S.tables.profiles.find((x) => x.id === id);
    p.display_name = "Luna Prisma ✨"; p.email = "luna-nueva@ejemplo.com"; // cambia el nombre (y hasta el mail de la cuenta)
    out = JSON.parse((await call(songs, id)).body);
    assert(out.configured && out.active.length === 1, "perdió sus canciones al cambiar el nombre");
  });

  await test("una ficha guardada a mano no se pisa", async () => {
    const id = "10000000-0000-4000-8000-000000000002";
    const row = S.tables.artist_private.find((x) => x.profile_id === id);
    row.notion_page_id = "manual00000000000000000000000000";
    await songs._findClient({ ...S.tables.profiles.find((x) => x.id === id) });
    assert(row.notion_page_id === "manual00000000000000000000000000", "pisó la ficha elegida a mano");
  });
  done();
})();
