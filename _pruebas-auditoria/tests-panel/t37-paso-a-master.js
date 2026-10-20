// Bug 37: al aprobar la mezcla, el paso a Master se anotaba en song_stage_log
// DESPUÉS de cambiar la Etapa en Notion; si la función programada pasaba en el
// medio, también lo procesaba (dos veces lo mismo).
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup } = H;
setup({ google: false });
const { SONGS_DS } = F("portal-songs");
const ce = F("_lib/cierre-etapa");
const et = F("_lib/auto-etapas");
const OLD = "2026-10-01T12:00:00.000Z";
const SONG = page(SONGS_DS, "b3700000-0000-4000-8000-000000000001", { "Canción": title("Faro"), "Etapa actual": sel("Mix"), Artista: relp([]) });
const OTHER = page(SONGS_DS, "b3700000-0000-4000-8000-000000000002", { "Canción": title("Otra"), "Etapa actual": sel("Rec"), Artista: relp([]) });
const reset = () => {
  SONG.properties["Etapa actual"] = sel("Mix");
  S.tables.song_stage_log = [{ song_id: SONG.id, stage: "Mix", changed_at: OLD, vocals_at: OLD }, { song_id: OTHER.id, stage: "Rec", changed_at: OLD, vocals_at: null }];
};
let during = null, failNotion = 0, watched = null;
const f = global.fetch;
global.fetch = async (u, i = {}) => {
  if (String(u).includes(`api.notion.com/v1/pages/${SONG.id}`) && i.method === "PATCH" && /Etapa actual/.test(i.body || "")) {
    if (during === null) during = (S.tables.song_stage_log.find((r) => r.song_id === SONG.id) || {}).stage;
    if (failNotion > 0) { failNotion--; return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }; }
    const res = await f(u, i);
    // Justo ahora corre la función programada (cada 15 minutos).
    if (!watched) watched = await et.watchStages();
    return res;
  }
  return f(u, i);
};
(async () => {
  reset();
  await ce.closeStage({ page: JSON.parse(JSON.stringify(SONG)), kind: "mezcla" });
  check("el paso a Master ya está anotado cuando se cambia Notion", during === "Master", during);
  const twice = (watched && watched.done || []).filter((d) => d.song === "Faro");
  check("la función programada no lo vuelve a procesar", twice.length === 0, watched && watched.done);

  // Si Notion no deja cambiar la canción, la anotación vuelve atrás.
  reset(); during = null; watched = {}; failNotion = 5;
  const out = await ce.closeStage({ page: JSON.parse(JSON.stringify(SONG)), kind: "mezcla" });
  const row = S.tables.song_stage_log.find((r) => r.song_id === SONG.id);
  check("Notion falló: no se cerró", out.notion === false, out);
  check("Notion falló: song_stage_log vuelve a Mix con su fecha", row.stage === "Mix" && row.changed_at === OLD, row);
  done("t37 paso a Master");
})().catch((e) => { console.error(e); process.exitCode = 1; });
