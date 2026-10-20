// Bug 28: Notion devuelve 429 (demasiados pedidos) o 502/503 de vez en cuando.
// Una mezcla entregada (esperando al artista) no puede salir "Vencida" por eso.
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, adminEvent, parse } = H;
setup();
const { TASKS_DS, SONGS_DS } = F("portal-songs");
const tasksFn = F("admin-tasks");
const reviewsFn = F("portal-reviews");
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const yest = add(today, -1);
const CLI = "c0000000-0000-4000-8000-000000000000";
page(CLI, "a2000000-0000-4000-8000-000000000001", { Nombre: title("Pazz") });
// Canción con la mezcla ya entregada y fecha de entrega lejos (no entra en la consulta de entregas).
const SONG = page(SONGS_DS, "b2000000-0000-4000-8000-000000000001", { "Canción": title("Nube"), "Etapa actual": sel("Mix"), Entrega: sel("Mezcla entregada"), Artista: relp(["a2000000-0000-4000-8000-000000000001"]), "Fecha de entrega": date(add(today, 40)) });
const TASK = page(TASKS_DS, "d2000000-0000-4000-8000-000000000001", { Nombre: title("Mix Nube Pazz"), Etapa: sel("Mix"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(`${yest}T15:00:00-03:00`, `${yest}T17:00:00-03:00`), "Canción": relp([SONG.id]), Cliente: relp(["a2000000-0000-4000-8000-000000000001"]) });

// Falla N veces el pedido de esa canción (o de cualquier página, si se pide).
let failSong = 0, code = 429;
const f = global.fetch;
global.fetch = async (u, i = {}) => {
  if (String(u).includes(`api.notion.com/v1/pages/${SONG.id}`) && (!i.method || i.method === "GET") && failSong > 0) {
    failSong--; return { ok: false, status: code, headers: { get: (h) => (/retry-after/i.test(h) ? "0" : null) }, json: async () => ({}), text: async () => "" };
  }
  return f(u, i);
};
const row = (b) => (b.tasks || []).find((t) => t.id === TASK.id);

(async () => {
  failSong = 2; code = 429;
  let r = parse(await tasksFn.handler(adminEvent("GET")));
  check("429 dos veces al leer la canción: se reintenta y queda «Esperando aprobación»", row(r.body) && row(r.body).urgency === "espera", row(r.body));

  failSong = 2; code = 503;
  r = parse(await tasksFn.handler(adminEvent("GET")));
  check("503 dos veces: igual queda «Esperando aprobación»", row(r.body) && row(r.body).urgency === "espera", row(r.body));

  failSong = 99; code = 429;
  r = parse(await tasksFn.handler(adminEvent("GET")));
  failSong = 0;
  check("si no se pudo leer la canción, no sale «Vencida»", row(r.body) && row(r.body).urgency !== "vencida", row(r.body));

  S.notion429 = 2;
  r = parse(await tasksFn.handler(adminEvent("GET")));
  check("429 al consultar Tareas: se reintenta y responde bien", r.status === 200 && row(r.body), r);

  console.log("Avisos");
  S.tables.song_approvals = [{ id: "e2000000-0000-4000-8000-000000000001", profile_id: H.ADMIN, song_id: SONG.id, song_title: "Nube", kind: "mezcla", action: "cambios", source: "artist", created_at: new Date().toISOString(), marks: [] }];
  failSong = 2; code = 429;
  r = parse(await reviewsFn.handler(adminEvent("GET")));
  check("Avisos: con 429 se reintenta y no queda a medias", r.status === 200 && !r.body.partial && r.body.reviews.length === 1, r.body);
  failSong = 99;
  r = parse(await reviewsFn.handler(adminEvent("GET")));
  failSong = 0;
  check("Avisos: si Notion no responde, avisa que está a medias (el Inicio deja lo que ya mostraba)", r.body.partial === true, r.body);
  done("t28 Notion 429");
})().catch((e) => { console.error(e); process.exitCode = 1; });
