// Bug 25: abrir el Inicio y la función programada procesan la misma entrega
// a la vez -> filas song_approvals duplicadas, dos mails y "✓ ✓ Entrega".
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, ev } = H;
setup();
const { SONGS_DS } = F("portal-songs");
const ae = F("_lib/auto-entregas");
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const ART = "a2500000-0000-4000-8000-000000000001";
const PROF = "22222222-2222-4222-8222-222222222222";
S.tables.profiles.push({ id: PROF, role: "artist", email: "artista@prueba.test", display_name: "Pazz" });
page("cli", ART, { Nombre: title("Pazz") });
const SONG = page(SONGS_DS, "b2500000-0000-4000-8000-000000000001", { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([ART]), "Fecha de entrega": date(add(today, 1)) });
ev("ent", "Entrega: Mix Faro Pazz", add(today, 1), add(today, 2), { transparency: "transparent" });
const file = { name: "Faro mix.wav", kind: "mezcla", fresh: true, modified: new Date(Date.now() - 60000).toISOString() };
const run = () => ae.syncArtist({ profileId: PROF, pageId: ART, folder: "x", songPages: [JSON.parse(JSON.stringify(SONG))], audios: [file] });
(async () => {
  const [a, b] = await Promise.all([run(), run()]);
  const rows = (S.tables.song_approvals || []).filter((r) => r.song_id === SONG.id && r.action === "entregada");
  check("una sola fila «entregada» en song_approvals", rows.length === 1, rows.length);
  check("un solo mail al artista", S.mails.filter((m) => (m.to || []).includes("artista@prueba.test")).length === 1, S.mails.length);
  check("el evento queda «✓ Entrega…» (un solo ✓)", /^✓ Entrega/.test(S.events.ent.summary) && !/✓\s*✓/.test(S.events.ent.summary), S.events.ent.summary);
  check("la nota del ✓ queda una sola vez en el evento", ((S.events.ent.description || "").match(/✓ Mezcla entregada/g) || []).length === 1, S.events.ent.description);
  check("una sola de las dos pasadas lo procesó", a.length + b.length === 1, { a: a.length, b: b.length });

  // Si Notion falla, el claim se suelta y la próxima pasada lo procesa.
  S.tables.song_approvals = []; S.tables.portal_reminders = []; S.mails.length = 0;
  const SONG2 = page(SONGS_DS, "b2500000-0000-4000-8000-000000000002", { "Canción": title("Nube"), "Etapa actual": sel("Mix"), Artista: relp([ART]) });
  const file2 = { name: "Nube mix.wav", kind: "mezcla", fresh: true, modified: new Date(Date.now() - 60000).toISOString() };
  const f = global.fetch; let failPatch = 1;
  global.fetch = async (u, i = {}) => (failPatch && String(u).includes(`/pages/${SONG2.id}`) && i.method === "PATCH" ? (failPatch--, { ok: false, status: 500, json: async () => ({}) }) : f(u, i));
  const once = () => ae.syncArtist({ profileId: PROF, pageId: ART, folder: "x", songPages: [JSON.parse(JSON.stringify(SONG2))], audios: [file2] });
  const r1 = await once();
  check("con Notion caído, esta pasada no la marca", r1.length === 1 && r1[0].error, r1);
  const r2 = await once();
  check("la pasada siguiente sí la marca", r2.length === 1 && !r2[0].error && S.pages[SONG2.id].properties.Entrega.select.name === "Mezcla entregada", r2);

  // Un evento que ya tenía ✓ no recibe otro.
  S.events.ya = { id: "ya", summary: "✓ Entrega: Mix Faro Pazz", start: { date: add(today, 1) }, end: { date: add(today, 2) } };
  const ce = F("_lib/cierre-etapa");
  S.events.ent.summary = "Entrega: Mix Faro Pazz";
  const orig = global.fetch;
  // Simula que otra pasada lo tildó justo entre que se leyó la lista y se escribe.
  global.fetch = async (u, i = {}) => {
    if (String(u).includes("/events/ent") && i.method === "PATCH" && !/^✓/.test(S.events.ent.summary)) S.events.ent.summary = `✓ ${S.events.ent.summary}`;
    if (String(u).includes("/events/ent") && (!i.method || i.method === "GET") && !/^✓/.test(S.events.ent.summary)) S.events.ent.summary = `✓ ${S.events.ent.summary}`;
    return orig(u, i);
  };
  await ce.tickCalendar({ id: SONG.id, title: "Faro", clientId: ART }, "mezcla", add(today, 1), new Date());
  global.fetch = orig;
  check("tildar un evento que otro ya tildó no deja «✓ ✓»", !/✓\s*✓/.test(S.events.ent.summary), S.events.ent.summary);
  done("t25 entrega doble");
})().catch((e) => { console.error(e); process.exitCode = 1; });
