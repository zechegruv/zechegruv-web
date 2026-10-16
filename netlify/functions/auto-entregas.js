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
const { syncAll } = require("./_lib/auto-entregas");
const { watchStages, ruleDigest } = require("./_lib/auto-etapas");

exports.handler = async () => {
  const [entregas, etapas] = await Promise.all([
    syncAll({ remind: true }).catch((e) => ({ ok: false, error: e.message })),
    watchStages().catch((e) => ({ ok: false, error: e.message })),
  ]);
  const regla = await ruleDigest().catch((e) => ({ error: e.message }));
  const log = { entregas: entregas.delivered, recordatorios: entregas.reminders, etapas: etapas.done, regla };
  console.log("automatizaciones:", JSON.stringify(log));
  if (!entregas.ok || (entregas.errors && entregas.errors.length)) console.error("auto-entregas:", entregas.error || JSON.stringify(entregas.errors));
  if (!etapas.ok) console.error("auto-etapas:", etapas.error);
  return { statusCode: 200 };
};
