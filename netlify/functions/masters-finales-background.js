// Función de fondo (Netlify la deja correr hasta 15 minutos): arma la
// carpeta del master aprobado con sus versiones finales (_lib/masters-finales.js).
// No se abre por link: la piden el portal al aprobar el artista, el paso a
// Distribución (auto-etapas.js) y los reintentos de cada 15 minutos, con la
// clave interna en el encabezado x-zg-finales.
// Body: { song: "<id de Notion>", version?: "<archivo aprobado>", force?: true }
const { build, validKey } = require("./_lib/masters-finales");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST" || !validKey(event)) return { statusCode: 401, body: "" };
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "" }; }
  const out = await build(body.song, { version: body.version || null, force: body.force === true });
  console.log("masters-finales:", body.song, JSON.stringify(out));
  return { statusCode: 200, body: "" };
};
