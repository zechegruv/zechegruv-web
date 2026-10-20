// La entrega del master quedó en un día que ya pasó y la sesión de master está agendada para después:
// tiene que verse UNA sola fila (la sesión, con "Atrasada · era el …") y la fecha de entrega pasa al día de la sesión.
const { S, page, title, sel, relp, date, dayAR } = require("../tests-shared/mock");
const F = __dirname + "/../" + (process.env.ZG_REPO || "panel") + "/netlify/functions";
const ps = require(F + "/portal-songs");
const tasks = require(F + "/admin-tasks").handler;
let fails = 0;
const ok = (c, w) => { console.log(`${c ? "PASA " : "FALLA"} ${w}`); if (!c) fails++; };
const today = dayAR(new Date());
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const yest = add(today, -1), tom = add(today, 1);
const ADMIN = "ad000000-0000-4000-8000-000000000000", C = "c1000000-0000-4000-8000-000000000001", SG = "51000000-0000-4000-8000-000000000001", T = "71000000-0000-4000-8000-000000000001";
(async () => {
  page(ps.CLIENTS_DS, C, { "Nombre Artista": title("Artista Prueba") });
  page(ps.SONGS_DS, SG, { "Canción": title("Tema Prueba"), Artista: relp([C]), "Etapa actual": sel("Master"), Entrega: sel("Mezcla aprobada"), "Fecha de entrega": date(yest) });
  page(ps.TASKS_DS, T, { Nombre: title("Master Tema Prueba Artista Prueba"), Etapa: sel("Master"), "Estado de Tarea": sel("SIN EMPEZAR"), "Canción": relp([SG]), Cliente: relp([C]), "Fecha de Vencimiento": date(`${tom}T18:00:00.000Z`, `${tom}T20:00:00.000Z`) });
  S.tables = { profiles: [{ id: ADMIN, role: "admin" }], app_tokens: [{ provider: "google_calendar", refresh_token: "r" }], song_stage_log: [], song_approvals: [], portal_reminders: [], task_reschedules: [] };
  S.events = { E: { id: "E", summary: "Entrega: Master Tema Prueba Artista Prueba", start: { date: yest }, end: { date: today }, transparency: "transparent" } };
  const r = await tasks({ httpMethod: "GET", headers: { authorization: `Bearer tok-${ADMIN}` }, queryStringParameters: {} });
  const out = JSON.parse(r.body);
  const rows = (out.tasks || []).filter((x) => x.song === "Tema Prueba" || x.name === "Tema Prueba");
  ok(rows.length === 1 && rows[0].kind === "sesion", `una sola fila para el master (vinieron ${rows.length}: ${rows.map((x) => x.kind + "/" + x.urgency).join(", ")})`);
  ok(rows[0] && rows[0].urgency !== "vencida" && rows[0].late && rows[0].late.slice(0, 10) <= yest, `la sesión dice Atrasada desde la entrega vieja (late=${rows[0] && rows[0].late})`);
  const fe = S.pages[SG].properties["Fecha de entrega"].date.start;
  ok(fe === tom, `la fecha de entrega pasó al día de la sesión (${fe})`);
  ok(S.events.E.start.date === tom, `el evento "Entrega:" del calendario también (${S.events.E.start.date})`);
  console.log(fails ? `${fails} FALLAN` : "TODAS PASAN"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
