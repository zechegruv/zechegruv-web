// Mini runner para las pruebas de Node (sin navegador).
const results = [];
async function test(name, body) {
  try { await body(); results.push([name, true]); console.log(`PASA  ${name}`); }
  catch (e) { results.push([name, false]); console.log(`FALLA ${name}\n      ${String((e && e.message) || e)}`); }
}
function done() { const bad = results.filter((r) => !r[1]).length; console.log(`\n${results.length - bad}/${results.length} pasan`); process.exit(bad ? 1 : 0); }
function assert(cond, msg) { if (!cond) throw new Error(msg || "falló la condición"); }
module.exports = { test, done, assert };
