// Cuenta de Productor (036_productor.sql): solo ve a los artistas que tiene
// asignados, en solo lectura, sin lo que dijo el artista y sin poder tocar nada.
const { S, page, title, relp, sel } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive, file } = require("./onedrive-fake");
const FN = "../portal/netlify/functions/";
const songs = require(FN + "portal-songs");
const files = require(FN + "portal-files");
const upload = require(FN + "portal-upload");
const review = require(FN + "portal-review");
const mark = require(FN + "portal-mark");

const ART = "20000000-0000-4000-8000-000000000001";   // asignado
const OTRO = "20000000-0000-4000-8000-000000000002";  // no asignado
const PROD = "30000000-0000-4000-8000-000000000001";
const PROD_OFF = "30000000-0000-4000-8000-000000000002";
const DUAL = "20000000-0000-4000-8000-000000000003";     // Productor/Artista
const CLIENT3 = "aaaaaaaa-0000-4000-8000-0000000000a3";
const SONG3 = "bbbbbbbb-0000-4000-8000-0000000000b3";
const CLIENT = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLIENT2 = "aaaaaaaa-0000-4000-8000-0000000000a2";
const SONG = "bbbbbbbb-0000-4000-8000-0000000000b1";
const SONG2 = "bbbbbbbb-0000-4000-8000-0000000000b2";
const LINK = "https://1drv.ms/f/s!prueba";

page(songs.CLIENTS_DS, CLIENT, { "Nombre Artista": title("Luna Prisma"), "Correo Electrónico": { type: "email", email: "luna@ejemplo.com" } });
page(songs.CLIENTS_DS, CLIENT2, { "Nombre Artista": title("Bruma Sur"), "Correo Electrónico": { type: "email", email: "bruma@ejemplo.com" } });
page(songs.SONGS_DS, SONG, { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]) });
page(songs.CLIENTS_DS, CLIENT3, { "Nombre Artista": title("Nico Beats"), "Correo Electrónico": { type: "email", email: "nico@ejemplo.com" } });
page(songs.SONGS_DS, SONG3, { "Canción": title("Propia"), "Etapa actual": sel("Prod"), Artista: relp([CLIENT3]) });
page(songs.SONGS_DS, SONG2, { "Canción": title("Niebla"), "Etapa actual": sel("Rec"), Artista: relp([CLIENT2]) });

S.tables.profiles = [
  { id: ART, role: "artist", active: true, email: "luna@ejemplo.com", full_name: "Luna Pérez", display_name: "Luna Prisma" },
  { id: OTRO, role: "artist", active: true, email: "bruma@ejemplo.com", full_name: "Bruma Sur", display_name: "Bruma Sur" },
  { id: PROD, role: "producer", active: true, email: "prod@ejemplo.com", display_name: "Prod" },
  { id: PROD_OFF, role: "producer", active: false, email: "prod2@ejemplo.com", display_name: "Prod 2" },
  { id: DUAL, role: "artist", also_producer: true, active: true, email: "nico@ejemplo.com", full_name: "Nico Beats", display_name: "Nico Beats" },
];
S.tables.artist_private = [
  { profile_id: ART, notion_page_id: CLIENT.replace(/-/g, ""), onedrive_link: LINK, onedrive_edit_link: LINK },
  { profile_id: DUAL, notion_page_id: CLIENT3.replace(/-/g, ""), onedrive_link: LINK, onedrive_edit_link: LINK },
  { profile_id: OTRO, notion_page_id: CLIENT2.replace(/-/g, ""), onedrive_link: LINK, onedrive_edit_link: LINK },
];
S.tables.producer_artists = [
  { producer_id: PROD, artist_id: ART },
  { producer_id: PROD_OFF, artist_id: ART },
  { producer_id: DUAL, artist_id: ART },
];
// El artista pidió modificaciones con una nota privada.
S.tables.song_approvals = [{ id: "r1", profile_id: ART, song_id: SONG, kind: "mezcla", action: "cambios", note: "subí la voz en el estribillo", marks: [{ t: 42, text: "acá" }], source: "artist", created_at: "2026-10-19T12:00:00Z" }];
S.extraFetch = oneDrive({ Exports: { "Faro - Mix.wav": file("2026-10-18T12:00:00Z") }, Membresía: { "contrato.pdf": file("2026-10-01T12:00:00Z") }, Referencias: { "idea.mp3": file("2026-10-01T12:00:00Z") } });

const call = (fn, id, extra = {}) => fn.handler({ httpMethod: extra.body ? "POST" : "GET", headers: { authorization: `Bearer tok-${id}` }, queryStringParameters: {}, ...extra });
const q = (o) => ({ queryStringParameters: o });

(async () => {
  await test("ve las canciones del artista asignado, sin la nota ni el pedido del artista", async () => {
    const r = await call(songs, PROD, q({ artist: ART }));
    assert(r.statusCode === 200, `status ${r.statusCode} ${r.body}`);
    const out = JSON.parse(r.body);
    assert(out.active.length === 1 && out.active[0].title === "Faro", JSON.stringify(out.active));
    const txt = r.body;
    assert(!/subí la voz|"marks"|"review"|"note"/.test(txt), `se filtró lo del artista: ${txt}`);
    assert(out.next === null, "le mostró la próxima sesión");
    assert(out.active[0].delivery && out.active[0].delivery.state === "proceso", `estado: ${JSON.stringify(out.active[0].delivery)}`);
  });

  await test("no ve a un artista que no tiene asignado", async () => {
    const r = await call(songs, PROD, q({ artist: OTRO }));
    assert(r.statusCode === 403, `status ${r.statusCode}`);
    const f = await call(files, PROD, q({ artist: OTRO, section: "exports" }));
    assert(f.statusCode === 403, `archivos status ${f.statusCode}`);
  });

  await test("productor inactivo no ve nada", async () => {
    const r = await call(songs, PROD_OFF, q({ artist: ART }));
    assert(r.statusCode === 403, `status ${r.statusCode}`);
  });

  await test("sin artista no tiene canciones propias (y no busca una ficha con su mail)", async () => {
    const r = await call(songs, PROD);
    const out = JSON.parse(r.body);
    assert(r.statusCode === 200 && !out.configured, r.body);
  });

  await test("archivos: ve Exports y Referencias del asignado, sin poder subir", async () => {
    const r = await call(files, PROD, q({ artist: ART, section: "exports" }));
    const out = JSON.parse(r.body);
    assert(r.statusCode === 200 && out.files.some((f) => f.name === "Faro - Mix.wav"), r.body);
    const ref = JSON.parse((await call(files, PROD, q({ artist: ART, section: "referencias" }))).body);
    assert(ref.canUpload === false, "le ofreció subir a Referencias");
  });

  await test("archivos: Membresía no", async () => {
    const r = await call(files, PROD, q({ artist: ART, section: "membresia" }));
    assert(r.statusCode === 403, `status ${r.statusCode}`);
  });

  await test("no puede subir, ni aprobar, ni marcar entregas", async () => {
    const u = await call(upload, PROD, { body: JSON.stringify({ action: "start", section: "referencias", name: "x.mp3", size: 10, artist: ART }) });
    assert(u.statusCode === 403, `subir: ${u.statusCode}`);
    const before = S.log.length;
    const a = await call(review, PROD, { body: JSON.stringify({ song: SONG, kind: "mezcla", action: "aprobada" }) });
    assert(a.statusCode === 403, `aprobar: ${a.statusCode}`);
    const m = await call(mark, PROD, { body: JSON.stringify({ song: SONG, kind: "mezcla", state: "entregada", artist: ART }) });
    assert(m.statusCode === 403 || m.statusCode === 400, `marcar: ${m.statusCode}`);
    assert(!S.log.slice(before).some((l) => (l[0] === "notion" && l[1] === "PATCH") || (l[0] === "db" && l[1] !== "PATCH")), `tocó algo: ${JSON.stringify(S.log.slice(before))}`);
  });

  await test("el artista sigue viendo lo suyo igual (con su pedido de cambios)", async () => {
    const out = JSON.parse((await call(songs, ART)).body);
    assert(out.active[0].delivery.state === "cambios" && out.active[0].review, JSON.stringify(out.active[0].delivery));
  });
  await test("Productor/Artista: ve sus propias canciones completas, como cualquier artista", async () => {
    const out = JSON.parse((await call(songs, DUAL)).body);
    assert(out.configured && out.active.length === 1 && out.active[0].title === "Propia", JSON.stringify(out));
    const f = JSON.parse((await call(files, DUAL, q({ section: "membresia" }))).body);
    assert(f.configured, "no ve su propia Membresía");
    const ref = JSON.parse((await call(files, DUAL, q({ section: "referencias" }))).body);
    assert(ref.canUpload === true, "no puede subir a su propia carpeta");
  });

  await test("Productor/Artista: al artista asignado lo ve en solo seguimiento; a otro no", async () => {
    const r = await call(songs, DUAL, q({ artist: ART }));
    assert(r.statusCode === 200 && !/subí la voz|"review"/.test(r.body), r.body);
    assert((await call(songs, DUAL, q({ artist: OTRO }))).statusCode === 403, "vio a uno no asignado");
    assert((await call(files, DUAL, q({ artist: ART, section: "membresia" }))).statusCode === 403, "vio Membresía ajena");
    const ex = JSON.parse((await call(files, DUAL, q({ artist: ART, section: "referencias" }))).body);
    assert(ex.canUpload === false, "le ofreció subir a la carpeta ajena");
  });

  await test("si el admin le saca la vista de productor, deja de ver al asignado", async () => {
    S.tables.profiles.find((p) => p.id === DUAL).also_producer = false;
    assert((await call(songs, DUAL, q({ artist: ART }))).statusCode === 403, "sigue viendo");
    S.tables.profiles.find((p) => p.id === DUAL).also_producer = true;
  });
  done();
})();
