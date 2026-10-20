// Bug 35: dos entregas con el botón «Entregado» en la misma hora -> un solo mail
// (la versión era "manual|<hora>"). Pero un doble clic no puede mandar dos.
const H = require("./h");
const { S, page, title, sel, relp, F, check, done, setup, adminEvent, parse } = H;
setup();
const { SONGS_DS } = F("portal-songs");
const fn = F("portal-mark");
const PROF = "33333333-3333-4333-8333-333333333333";
S.tables.profiles.push({ id: PROF, role: "artist", email: "artista@prueba.test", display_name: "Pazz" });
const SONG = page(SONGS_DS, "b3500000-0000-4000-8000-000000000001", { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([]) });
const mark = () => fn.handler(adminEvent("POST", { song: SONG.id, kind: "mezcla", action: "entregada", artist: PROF })).then(parse);
const mails = () => S.mails.filter((m) => (m.to || []).includes("artista@prueba.test")).length;
(async () => {
  await mark();
  check("primera entrega: un mail", mails() === 1, mails());
  // El artista pide modificaciones y 10 minutos después le entregás la versión nueva (misma hora).
  S.tables.song_approvals.forEach((r) => { r.created_at = new Date(Date.now() - 10 * 60000).toISOString(); });
  S.tables.song_approvals.push({ id: "x1", profile_id: PROF, song_id: SONG.id, kind: "mezcla", action: "cambios", source: "artist", created_at: new Date(Date.now() - 5 * 60000).toISOString(), marks: [] });
  const r = await mark();
  check("segunda entrega 10 min después: le llega otro mail", mails() === 2, { mails: mails(), r: r.body });
  // Doble clic: dos pedidos a la vez.
  S.tables.song_approvals.forEach((x) => { x.created_at = new Date(Date.now() - 30 * 60000).toISOString(); });
  await Promise.all([mark(), mark()]);
  check("doble clic: un solo mail más", mails() === 3, mails());
  done("t35 aviso de Entregado");
})().catch((e) => { console.error(e); process.exitCode = 1; });
