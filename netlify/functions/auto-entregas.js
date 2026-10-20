// Función programada (netlify.toml → cada 15 minutos). Corre todas las
// automatizaciones del portal:
//   1. Entregas: mezclas y masters subidos a las carpetas se marcan
//      entregados solos (_lib/auto-entregas.js).
//   2. Recordatorios: al artista que lleva 3 (y 7) días sin escuchar su
//      mezcla o master le llega un mail cálido (de 10 a 20 h).
//   3. Etapas: al pasar a Mix se agenda la mezcla en tu primer hueco libre;
//      al pasar a Master se ajusta la entrega a la regla de 15 días; al
//      pasar a Distribución se crea la tarea y se avisa al equipo
//      (_lib/auto-etapas.js).
//   4. Regla de 15 días: un mail por día (desde las 10 h) con lo que está
//      por vencer.
// No se abre por link: la corre Netlify sola. Para correr las entregas al
// momento está el Inicio del panel.
// Cada corrida queda anotada en automation_runs (supabase/034_estado.sql):
// el panel la muestra en "Estado del sistema" y avisa si deja de correr.
const { syncAll } = require("./_lib/auto-entregas");
const { watchStages, ruleDigest } = require("./_lib/auto-etapas");
const { startRun, finishRun } = require("./_lib/automation-runs");

const count = (x) => (Array.isArray(x) ? x.length : 0);

exports.handler = async () => {
  const runId = await startRun("auto-entregas");
  const [entregas, etapas] = await Promise.all([
    syncAll({ remind: true }).catch((e) => ({ ok: false, error: e.message })),
    watchStages().catch((e) => ({ ok: false, error: e.message })),
  ]);
  const regla = await ruleDigest().catch((e) => ({ error: e.message }));
  const log = { entregas: entregas.delivered, recordatorios: entregas.reminders, etapas: etapas.done, regla };
  console.log("automatizaciones:", JSON.stringify(log));
  if (!entregas.ok || (entregas.errors && entregas.errors.length)) console.error("auto-entregas:", entregas.error || JSON.stringify(entregas.errors));
  if (!etapas.ok) console.error("auto-etapas:", etapas.error);

  // Resumen corto para el panel: cuántas entregas se marcaron (y a cuántos
  // artistas se les avisó), recordatorios, cambios de etapa y mails de la
  // regla de 15 días. Los errores, en una línea legible.
  const errores = [
    entregas.error ? `Entregas: ${entregas.error}` : null,
    ...(entregas.errors || []).map((e) => `${e.artist || "?"}${e.song ? ` · ${e.song}` : ""}: ${e.error}`),
    etapas.error ? `Etapas: ${etapas.error}` : null,
    ...(etapas.done || []).filter((d) => d && d.error).map((d) => `Etapa de ${d.song || "?"}: ${d.error}`),
    regla && regla.error ? `Regla de 15 días: ${regla.error}` : null,
  ].filter(Boolean);
  await finishRun(runId, {
    ok: !errores.length && entregas.ok !== false && etapas.ok !== false,
    summary: {
      entregas: count(entregas.delivered),
      avisos: (entregas.delivered || []).filter((d) => d.notified).length,
      recordatorios: count(entregas.reminders),
      etapas: (etapas.done || []).filter((d) => d && !d.error).length,
      regla: (regla && regla.sent) || 0,
    },
    error: errores.join(" · ") || null,
  });
  return { statusCode: 200 };
};
