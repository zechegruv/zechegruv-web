// Conexión del panel de administrador con Google Calendar (una sola vez).
//   GET  (administrador)            -> { configured, connected, account }
//   POST { action: "start" } (adm.) -> { url } a donde ir para dar permiso
//   GET  ?code=…&state=…            -> vuelta desde Google: guarda la llave y
//                                      vuelve al panel (/portal/?google=ok)
const { json, siteUrl } = require("./_lib/pass");
const gc = require("./_lib/gcal");
const { _isAdmin: isAdmin } = require("./admin-tasks");

const back = (event, result) => ({ statusCode: 302, headers: { Location: `${siteUrl(event)}/portal/?google=${result}`, "Cache-Control": "no-store" }, body: "" });
const redirectUri = (event) => `${siteUrl(event)}/.netlify/functions/admin-google`;

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (event.httpMethod === "GET" && (q.code || q.error)) {
    if (q.error || !gc.validState(q.state)) return back(event, "error");
    const r = await gc.exchangeCode(q.code, redirectUri(event));
    return back(event, r.ok ? "ok" : "error");
  }
  if (!(await isAdmin(event))) return json(403, { error: "Solo para el administrador." });
  if (event.httpMethod === "POST") {
    if (!gc.configured()) return json(400, { error: "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Netlify." });
    return json(200, { url: gc.authUrl(redirectUri(event)) });
  }
  return json(200, await gc.status());
};
