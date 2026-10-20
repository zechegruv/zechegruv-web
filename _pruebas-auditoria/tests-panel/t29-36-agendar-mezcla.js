// Bug 29: una canción que pasa a Mezcla y no se puede agendar (sin hueco, o
// falla la tarea) quedaba olvidada y sin mail.
// Bug 36: con Google conectado pero freeBusy fallando, se mandaba "falta
// conectar Google Calendar" (o "no encontré hueco"): mail engañoso.
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, ev } = H;
setup();
const { SONGS_DS } = F("portal-songs");
const et = F("_lib/auto-etapas");
const ce = F("_lib/cierre-etapa");
const today = dayAR(new Date());
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const now = new Date().toISOString();
let n = 0;
const mk = (t) => { n++; const pg = page(SONGS_DS, `b2900000-0000-4000-8000-00000000000${n}`, { "Canción": title(t), "Etapa actual": sel("Mix"), Artista: relp([]) }); S.tables.song_stage_log.push({ song_id: pg.id, stage: "Mix", changed_at: now, vocals_at: now }); return { id: pg.id, title: t, stage: "Mix", clientId: null, delivery: null }; };
const subj = () => S.mails.map((m) => m.subject);
const reset = () => { S.mails.length = 0; S.events = {}; S.failFreeBusy = false; };
S.tables.song_stage_log = [];
(async () => {
  console.log("36: Google conectado pero no responde");
  reset();
  const a = mk("Faro");
  S.failFreeBusy = true;
  const r1 = await et._onMix(a, { vocals_at: now });
  check("no dice «falta conectar Google Calendar»", !subj().some((s) => /conectar Google/i.test(s)), subj());
  check("no dice que no encontró hueco", !subj().some((s) => /hueco|No pude agendar/i.test(s)), subj());
  check("queda pendiente para la próxima pasada", (S.tables.portal_reminders || []).some((r) => r.song_id === a.id && r.kind === "pendiente-agenda"), S.tables.portal_reminders);
  S.failFreeBusy = false;
  await et.watchStages();
  check("en la próxima pasada se agenda y avisa", subj().some((s) => /Agendé la mezcla de «Faro»/.test(s)), subj());
  check("y ya no queda pendiente", !(S.tables.portal_reminders || []).some((r) => r.song_id === a.id && r.kind === "pendiente-agenda"));

  reset();
  S.failFreeBusy = true;
  const pg = page(SONGS_DS, "b2900000-0000-4000-8000-000000000099", { "Canción": title("Ola"), "Etapa actual": sel("Mix"), Artista: relp([]) });
  const re = await ce.reopenStage({ page: pg, kind: "mezcla" });
  check("modificaciones: no responde «Google no conectado»", re.google !== false && re.error === "google", re);
  S.failFreeBusy = false;

  console.log("29: sin hueco en 21 días");
  reset();
  ev("lleno", "Gira", `${today}T00:00:00-03:00`, `${add(today, 40)}T00:00:00-03:00`);
  const b = mk("Nube");
  await et._onMix(b, { vocals_at: now });
  check("le llega «No pude agendar la mezcla de «Nube»»", subj().some((s) => /No pude agendar la mezcla de «Nube»/.test(s)), subj());
  check("queda pendiente para reintentar", (S.tables.portal_reminders || []).some((r) => r.song_id === b.id && r.kind === "pendiente-agenda"));
  await et.watchStages();
  check("al reintentar sin hueco, no repite el mail", subj().filter((s) => /No pude agendar la mezcla de «Nube»/.test(s)).length === 1, subj());
  check("y sigue pendiente", (S.tables.portal_reminders || []).some((r) => r.song_id === b.id && r.kind === "pendiente-agenda"));
  delete S.events.lleno;
  await et.watchStages();
  check("cuando aparece un hueco, se agenda sola", subj().some((s) => /Agendé la mezcla de «Nube»/.test(s)), subj());

  console.log("29: Notion no deja crear la tarea");
  reset();
  const c = mk("Brisa");
  const f = global.fetch; let failCreate = true;
  global.fetch = async (u, i = {}) => (failCreate && String(u).endsWith("api.notion.com/v1/pages") && i.method === "POST" ? { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) } : f(u, i));
  await et._onMix(c, { vocals_at: now });
  failCreate = false;
  check("le llega «No pude agendar la mezcla de «Brisa»»", subj().some((s) => /No pude agendar la mezcla de «Brisa»/.test(s)), subj());
  check("queda pendiente para reintentar", (S.tables.portal_reminders || []).some((r) => r.song_id === c.id && r.kind === "pendiente-agenda"));
  done("t29-36 agendar la mezcla");
})().catch((e) => { console.error(e); process.exitCode = 1; });
