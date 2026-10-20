// Bug 8: lo que cuenta es cuándo se subió el audio a OneDrive, no la fecha
// del archivo en la compu de Zeche.
const { S, page, title, relp, sel } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive, file } = require("./onedrive-fake");
const audio = require("../portal/netlify/functions/_lib/song-audio");
const songs = require("../portal/netlify/functions/portal-songs");
const auto = require("../portal/netlify/functions/_lib/auto-entregas");

const LINK = "https://1drv.ms/f/s!prueba";
const SONG = "cccccccc-0000-4000-8000-000000000001";
const CLIENT = "aaaaaaaa-0000-4000-8000-000000000009";
const PROFILE = "20000000-0000-4000-8000-000000000001";

(async () => {
  // Zeche exportó la mezcla el 15, el artista pidió cambios el 17 y Zeche
  // la subió (con las modificaciones ya hechas antes) el 18.
  S.extraFetch = oneDrive({ Exports: { "Faro mix v2.wav": file("2026-10-18T15:00:00Z", { fsModified: "2026-10-15T12:00:00Z" }) } });
  const asked = { song_id: SONG, kind: "mezcla", action: "cambios", source: "artist", created_at: "2026-10-17T12:00:00Z", marks: [] };

  await test("la mezcla subida después del pedido de cambios aparece para escuchar (aunque se haya exportado antes)", async () => {
    const base = [{ id: SONG, title: "Faro", step: 3, done: false, updated: "2026-10-17T12:00:00Z", entrega: null }];
    const got = songs._withDelivery(base, audio.matchAudio(base, await audio.listAudio(LINK)), [asked]);
    assert(got[0].delivery.state === "aprobar", `estado: ${got[0].delivery.state}`);
  });

  await test("un audio exportado antes del arranque automático pero subido después cuenta como entrega", async () => {
    S.extraFetch = oneDrive({ Exports: { "Faro mix.wav": file("2026-10-18T15:00:00Z", { fsModified: "2026-10-01T12:00:00Z" }) } });
    const list = await audio.listAudio(LINK);
    assert(list[0].fresh, "no lo tomó como subido desde el arranque");
  });

  await test("la entrega automática lo marca entregado en Notion", async () => {
    S.extraFetch = oneDrive({ Exports: { "Faro mix v2.wav": file("2026-10-18T15:00:00Z", { fsModified: "2026-10-15T12:00:00Z" }) } });
    page(songs.SONGS_DS, SONG, { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]), Entrega: sel(null) });
    S.tables.song_approvals = [{ ...asked, profile_id: PROFILE }];
    S.tables.profiles = [{ id: PROFILE, email: "faro@ejemplo.com", display_name: "Faro", active: true, role: "artist" }];
    const out = await auto.syncArtist({ profileId: PROFILE, pageId: CLIENT, folder: LINK });
    assert(out.some((d) => !d.error && d.kind === "mezcla"), `no la entregó: ${JSON.stringify(out)}`);
    assert(S.pages[SONG].properties.Entrega.select && S.pages[SONG].properties.Entrega.select.name === "Mezcla entregada", "Notion no quedó en Mezcla entregada");
  });

  await test("si se reemplaza el archivo en OneDrive, vale la fecha más nueva (subida o modificación en el servidor)", async () => {
    S.extraFetch = oneDrive({ Exports: { "Faro mix.wav": file("2026-10-18T15:00:00Z", { created: "2026-10-19T10:00:00Z", fsModified: "2026-10-01T00:00:00Z" }) } });
    const list = await audio.listAudio(LINK);
    assert(list[0].modified === "2026-10-19T10:00:00Z", `fecha: ${list[0].modified}`);
  });
  done();
})();
