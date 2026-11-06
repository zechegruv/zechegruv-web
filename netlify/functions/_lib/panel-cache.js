// Copia de lo último que armó el panel (mezclas y masters, ingresos), para
// mostrarlo al instante mientras se lee Notion de nuevo
// (supabase/040_panel_cache.sql). Si la tabla no existe o la base no
// responde, no pasa nada: el panel espera a Notion como antes.
const { db } = require("./pass");

async function get(key) {
  try {
    const r = await db(`panel_cache?key=eq.${encodeURIComponent(key)}&select=data,updated_at`);
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    return row ? { data: row.data, at: row.updated_at } : null;
  } catch (e) { return null; }
}

async function set(key, data) {
  try {
    await db("panel_cache?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, data, updated_at: new Date().toISOString() } });
  } catch (e) { /* sin copia: la próxima vez se lee Notion */ }
}

module.exports = { get, set };
