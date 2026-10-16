// Función programada (netlify.toml → cada 15 minutos): revisa las carpetas
// de OneDrive de todos los artistas activos y marca solas las mezclas y los
// masters que Zeche subió (ver _lib/auto-entregas.js). No se abre por link:
// la corre Netlify sola. Para correrla al momento está el Inicio del panel.
const { syncAll } = require("./_lib/auto-entregas");

exports.handler = async () => {
  const r = await syncAll();
  if (r.delivered && r.delivered.length) console.log("auto-entregas:", JSON.stringify(r.delivered));
  if (r.errors && r.errors.length) console.error("auto-entregas errores:", JSON.stringify(r.errors));
  if (!r.ok) console.error("auto-entregas:", r.error);
  return { statusCode: 200 };
};
