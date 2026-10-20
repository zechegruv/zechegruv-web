// Bug 1 y 2: la búsqueda de eventos por nombre no puede confundir canciones
// ("Luna" ≠ "Luna Llena", "Mar" ≠ "(Layla Mar)", "Amor" ≠ "Seu amor").
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, ev, setup, adminEvent, parse } = H;
setup();
const { TASKS_DS, SONGS_DS } = F("portal-songs");
const ce = F("_lib/cierre-etapa");
const rs = F("admin-reschedule");
const tasksFn = F("admin-tasks");
const CLI = "c0000000-0000-4000-8000-000000000000";
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const tom = add(today, 1);
const at = (d, h) => `${d}T${h}:00-03:00`;

page(CLI, "a1000000-0000-4000-8000-000000000001", { Nombre: title("Pazz") });
page(CLI, "a1000000-0000-4000-8000-000000000002", { Nombre: title("Layla Mar") });
page(CLI, "a1000000-0000-4000-8000-000000000003", { Nombre: title("Rouse Bby") });
const song = (id, t, artist, extra = {}) => page(SONGS_DS, id, { "Canción": title(t), "Etapa actual": sel("Mix"), Artista: relp([artist]), "Fecha de entrega": date(tom), ...extra });
const LUNA = song("b1000000-0000-4000-8000-000000000001", "Luna", "a1000000-0000-4000-8000-000000000001");
const MAR = song("b1000000-0000-4000-8000-000000000002", "Mar", "a1000000-0000-4000-8000-000000000002");
const AMOR = song("b1000000-0000-4000-8000-000000000003", "Amor", "a1000000-0000-4000-8000-000000000003");
const SOLT = song("b1000000-0000-4000-8000-000000000004", "Soltando Etiquetas", "a1000000-0000-4000-8000-000000000001");
const SEU = song("b1000000-0000-4000-8000-000000000005", "Seu amor", "a1000000-0000-4000-8000-000000000003");
const TAG = song("b1000000-0000-4000-8000-000000000006", "Brisa", "a1000000-0000-4000-8000-000000000001");

function seedEvents() {
  S.events = {};
  ev("lunaLlena", "Mix – Luna Llena (Pazz)", at(tom, "15:00"), at(tom, "17:00"));
  ev("entLunaLlena", "Entrega: Mix Luna Llena Pazz", tom, add(tom, 1), { transparency: "transparent" });
  ev("otra", "Mix – Otra (Layla Mar)", at(tom, "18:00"), at(tom, "20:00"));
  ev("entSeu", "Entrega: Mix Seu amor Rouse Bby", tom, add(tom, 1), { transparency: "transparent" });
  ev("corr", "Correcciones Mix Soltando Etiquetas (Pazz)", at(add(tom, 1), "15:00"), at(add(tom, 1), "17:00"));
  ev("tag", "Sesión con nombre cualquiera", at(add(tom, 2), "15:00"), at(add(tom, 2), "17:00"), { extendedProperties: { private: { zgSong: TAG.id.replace(/-/g, ""), zgStage: "mezcla", zgKind: "sesion" } } });
  ev("tagOtro", "Mix – Brisa (Pazz)", at(add(tom, 3), "15:00"), at(add(tom, 3), "17:00"), { extendedProperties: { private: { zgSong: "otracancion", zgStage: "mezcla", zgKind: "sesion" } } });
}
const songOf = (pg) => ({ id: pg.id, title: pg.properties["Canción"].title[0].plain_text, clientId: pg.properties.Artista.relation[0].id });
const ticked = () => Object.values(S.events).filter((e) => /^✓/.test(e.summary)).map((e) => e.id).sort();

(async () => {
  console.log("tickCalendar (aprobar / entregar)");
  for (const [pg, want] of [[LUNA, []], [MAR, []], [AMOR, []], [SOLT, ["corr"]], [SEU, ["entSeu"]], [TAG, ["tag"]]]) {
    seedEvents();
    await ce.tickCalendar(songOf(pg), "mezcla", tom, new Date());
    check(`«${songOf(pg).title}» tilda solo ${JSON.stringify(want)}`, JSON.stringify(ticked()) === JSON.stringify(want), ticked());
  }

  console.log("admin-reschedule (mover la entrega)");
  seedEvents();
  const r = await rs._moveDelivery({ songId: LUNA.id, song: "Luna", artist: "Pazz", stage: "Mezcla" }, tom, add(tom, 3));
  check("«Luna» no mueve «Entrega: Mix Luna Llena Pazz»", S.events.entLunaLlena.start.date === tom, S.events.entLunaLlena.start);
  const created = Object.values(S.events).find((e) => /^Entrega: Mix Luna Pazz$/.test(e.summary));
  check("crea su propia «Entrega: Mix Luna Pazz»", !!created && r.calendar === "creado", r);
  check("la entrega creada lleva la marca de la canción", !!created && created.extendedProperties && created.extendedProperties.private.zgSong === LUNA.id.replace(/-/g, "") && created.extendedProperties.private.zgKind === "entrega", created && created.extendedProperties);
  // y la segunda vez la encuentra por la marca (aunque cambien el título a mano)
  if (created) created.summary = "Entrega cambiada a mano";
  const r2 = await rs._moveDelivery({ songId: LUNA.id, song: "Luna", artist: "Pazz", stage: "Mezcla" }, add(tom, 3), add(tom, 4));
  check("la segunda vez la encuentra por la marca y la mueve", r2.calendar === "movido" && created && created.start.date === add(tom, 4), r2);

  console.log("admin-tasks ✓ de una sesión (tickSessionEvent)");
  seedEvents();
  const TMAR = page(TASKS_DS, "d1000000-0000-4000-8000-000000000001", { Nombre: title("Mix Mar Layla Mar"), Etapa: sel("Mix"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(at(tom, "18:00"), at(tom, "20:00")), "Canción": relp([MAR.id]), Cliente: relp(["a1000000-0000-4000-8000-000000000002"]) });
  const out = parse(await tasksFn.handler(adminEvent("POST", { task: TMAR.id })));
  check("tildar «Mar» no tilda «Mix – Otra (Layla Mar)»", !/^✓/.test(S.events.otra.summary) && out.body.calendar === "sin-evento", out.body);
  delete S.pages[TMAR.id];

  console.log("admin-tasks Inicio (vencidas que se movieron en el calendario)");
  seedEvents();
  const yest = add(today, -1);
  const TL = page(TASKS_DS, "d1000000-0000-4000-8000-000000000002", { Nombre: title("Mix Luna Pazz"), Etapa: sel("Mix"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(at(yest, "15:00"), at(yest, "17:00")), "Canción": relp([LUNA.id]), Cliente: relp(["a1000000-0000-4000-8000-000000000001"]) });
  const TS = page(TASKS_DS, "d1000000-0000-4000-8000-000000000003", { Nombre: title("Mix Soltando Etiquetas Pazz"), Etapa: sel("Mix"), "Estado de Tarea": sel("PENDIENTE"), "Fecha de Vencimiento": date(at(yest, "15:00"), at(yest, "17:00")), "Canción": relp([SOLT.id]), Cliente: relp(["a1000000-0000-4000-8000-000000000001"]) });
  S.log.length = 0;
  const g = parse(await tasksFn.handler(adminEvent("GET")));
  const patchedLuna = S.log.some((l) => l[0] === "notion" && l[1] === "PATCH" && l[2] === TL.id);
  check("no escribe en Notion la tarea «Luna» por «Luna Llena»", !patchedLuna);
  const rowL = (g.body.tasks || []).find((t) => t.id === TL.id);
  check("«Luna» sigue vencida (no toma el día de «Luna Llena»)", rowL && rowL.urgency === "vencida" && !rowL.fromCalendar, rowL);
  const patchedS = S.log.some((l) => l[0] === "notion" && l[1] === "PATCH" && l[2] === TS.id);
  check("«Soltando Etiquetas» sí se pone igual que el calendario", patchedS);
  done("t01 búsqueda de eventos");
})().catch((e) => { console.error(e); process.exitCode = 1; });
