// Registro de las automatizaciones programadas (supabase/034_estado.sql).
// Cada corrida de auto-entregas (cada 15 min) y de zil-sync (cada hora)
// queda anotada: cuándo empezó, cuándo terminó, si salió bien, un resumen
// corto de lo que hizo y el error, si hubo. El panel lo lee en "Estado del
// sistema" (admin-status.js) para decir "hace cuánto corrió" y avisar si la
// programada dejó de correr.
//
// Anotar nunca puede frenar una automatización: si la tabla todavía no
// existe (falta correr 034) o Supabase no contesta, se sigue igual y solo
// no queda anotado. Por eso acá nada tira error para afuera.
const { db } = require("./pass");

// Anota el arranque. Devuelve el id de la fila (o null si no se pudo).
async function startRun(job) {
  try {
    const r = await db("automation_runs", { method: "POST", prefer: "return=representation", body: { job, started_at: new Date().toISOString() } });
    return (r.ok && Array.isArray(r.data) && r.data[0] && r.data[0].id) || null;
  } catch (e) {
    return null;
  }
}

// Anota el final: ok, resumen y error (cortito, para leerlo en el celu).
async function finishRun(id, { ok, summary, error } = {}) {
  if (!id) return false;
  try {
    const r = await db(`automation_runs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { finished_at: new Date().toISOString(), ok: !!ok, summary: summary || {}, error: error ? String(error).slice(0, 500) : null },
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = { startRun, finishRun };
