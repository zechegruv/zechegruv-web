// Bug 3: reprogramar que falla a mitad de camino tiene que deshacer también
// lo que creó (tarea nueva en Notion, eventos nuevos) y, si no puede, decirlo.
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, adminEvent, parse } = H;
setup();
const { SONGS_DS, TASKS_DS } = F("portal-songs");
const fn = F("admin-reschedule");
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const OLD = add(today, -2);
const NEW = add(today, 2);
page("cli", "a3000000-0000-4000-8000-000000000001", { Nombre: title("Pazz") });

let failPost = 0, failArchive = false;
const f = global.fetch;
global.fetch = async (u, i = {}) => {
  const s = String(u);
  if (s.includes("googleapis.com") && /\/events$/.test(new URL(s).pathname) && i.method === "POST") {
    failPost--;
    if (failPost === 0) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
  }
  if (failArchive && s.includes("api.notion.com/v1/pages/") && i.method === "PATCH" && /"archived":true/.test(i.body || "")) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
  return f(u, i);
};
const fresh = (n) => {
  S.events = {};
  Object.keys(S.pages).filter((k) => S.pages[k].parent.data_source_id === TASKS_DS).forEach((k) => delete S.pages[k]);
  return page(SONGS_DS, `b300000${n}-0000-4000-8000-000000000001`, { "Canción": title(`Faro ${n}`), "Etapa actual": sel("Mix"), Artista: relp(["a3000000-0000-4000-8000-000000000001"]), "Fecha de entrega": date(OLD) });
};
const liveTasks = () => Object.values(S.pages).filter((p) => p.parent.data_source_id === TASKS_DS && !p.archived);
(async () => {
  // Sin sesión abierta ni eventos: se crea la tarea, se crea la "Entrega:" y falla crear la sesión.
  let song = fresh(1);
  failPost = 2;
  let r = parse(await fn.handler(adminEvent("POST", { task: song.id, kind: "entrega", date: NEW, time: "16:00", dur: 120 })));
  check("responde con error", r.status === 502, r);
  check("la tarea nueva queda archivada en Notion", liveTasks().length === 0, liveTasks().map((p) => p.id));
  check("la «Entrega:» recién creada se borra del calendario", Object.keys(S.events).length === 0, Object.values(S.events).map((e) => e.summary));
  check("la fecha de entrega vuelve a la de antes", S.pages[song.id].properties["Fecha de entrega"].date.start === OLD, S.pages[song.id].properties["Fecha de entrega"].date);
  check("dice que se dejó todo como estaba", /Se dejó todo como estaba/.test(r.body.error || ""), r.body.error);

  // Igual, pero tampoco se puede archivar la tarea: el mensaje no puede decir que quedó todo igual.
  song = fresh(2);
  failPost = 2; failArchive = true;
  r = parse(await fn.handler(adminEvent("POST", { task: song.id, kind: "entrega", date: NEW, time: "16:00", dur: 120 })));
  failArchive = false;
  check("si deshacer falla, no dice «Se dejó todo como estaba»", !/Se dejó todo como estaba/.test(r.body.error || ""), r.body.error);
  check("y avisa qué quedó sin deshacer", /no se pudo (deshacer|volver)/i.test(r.body.error || "") && /Notion/.test(r.body.error || ""), r.body.error);
  done("t03 reprogramar deshace lo creado");
})().catch((e) => { console.error(e); process.exitCode = 1; });
