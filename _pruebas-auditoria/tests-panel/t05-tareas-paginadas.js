// Bug 5: el Inicio pedía 100 tareas sin filtrar por etapa y sin seguir
// has_more; con muchas sesiones de grabación, las de mezcla quedaban afuera.
// Lo mismo con las canciones.
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, adminEvent, parse } = H;
setup({ google: false });
const { TASKS_DS, SONGS_DS } = F("portal-songs");
const tasksFn = F("admin-tasks");
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const id = (p, n) => `${p}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
// 130 sesiones de grabación (no se muestran) antes que la de mezcla.
for (let i = 0; i < 130; i++) page(TASKS_DS, id("e", i), { Nombre: title(`Rec Tema ${i}`), Etapa: sel("Rec"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(`${add(today, 1)}T10:00:00-03:00`) });
// 104 canciones con la mezcla ya aprobada (no se muestran) antes que la que falta.
for (let i = 0; i < 104; i++) page(SONGS_DS, id("f", i), { "Canción": title(`Tema ${i}`), "Etapa actual": sel("Mix"), Entrega: sel("Mezcla aprobada"), "Fecha de entrega": date(add(today, 2)) });
const SONG = page(SONGS_DS, id("a", 1), { "Canción": title("Faro"), "Etapa actual": sel("Mix"), "Fecha de entrega": date(add(today, 5)) });
const SONG2 = page(SONGS_DS, id("a", 2), { "Canción": title("Ola"), "Etapa actual": sel("Master"), "Fecha de entrega": date(add(today, 9)) });
const MIX = page(TASKS_DS, id("b", 1), { Nombre: title("Mix Faro Pazz"), Etapa: sel("Mix"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(`${add(today, 3)}T15:00:00-03:00`, `${add(today, 3)}T17:00:00-03:00`), "Canción": relp([SONG.id]) });
const NOETAPA = page(TASKS_DS, id("b", 2), { Nombre: title("Master Ola Pazz"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(`${add(today, 4)}T15:00:00-03:00`, `${add(today, 4)}T17:00:00-03:00`), "Canción": relp([SONG2.id]) });
const OTRA = page(TASKS_DS, id("b", 3), { Nombre: title("Comprar cuerdas"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(add(today, 2)) });
(async () => {
  const r = parse(await tasksFn.handler(adminEvent("GET")));
  const ids = (r.body.tasks || []).map((t) => t.id);
  check("aparece la sesión de mezcla aunque haya 130 de grabación antes", ids.includes(MIX.id), ids.length);
  check("aparece la sesión de master sin Etapa (por el nombre)", ids.includes(NOETAPA.id));
  check("no aparece una tarea que no es de mezcla ni master", !ids.includes(OTRA.id));
  // La entrega de «Ola» (master, día 9) no tiene sesión el mismo día: tiene que verse.
  check("aparece la entrega de «Ola» aunque haya 104 canciones antes", ids.includes(SONG2.id), ids);
  done("t05 tareas y canciones paginadas");
})().catch((e) => { console.error(e); process.exitCode = 1; });
