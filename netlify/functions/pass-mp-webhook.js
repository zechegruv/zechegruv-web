// POST /.netlify/functions/pass-mp-webhook?data.id=…&type=payment
// Aviso de Mercado Pago cuando cambia un pago. Primero se comprueba la
// firma del aviso; después el pago se consulta directamente a Mercado Pago
// y recién ahí se emiten las entradas (ver settlePayment).
//
// Si algo falla se responde con error para que Mercado Pago reintente.
const { json, siteUrl, validWebhookSignature, settlePayment } = require("./_lib/pass");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });

  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const type = q.type || body.type || q.topic;
  const dataId = q["data.id"] || (body.data && body.data.id) || q.id;
  if (type !== "payment" || !dataId) return json(200, { ok: true });  // otros avisos no interesan

  if (!validWebhookSignature(event, dataId)) return json(401, { error: "Firma inválida." });

  try {
    const done = await settlePayment(dataId, siteUrl(event));
    return json(200, { ok: true, result: done.result });
  } catch (e) {
    console.error("ZG PASS: fallo al procesar el aviso de pago", dataId, e);
    return json(500, { error: "Reintentar." });
  }
};
