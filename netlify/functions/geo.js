// GET /.netlify/functions/geo
// Devuelve el país desde donde entra la persona ({ country: "AR" }), según
// la geolocalización por IP que hace Netlify (respeta VPNs). La home lo usa
// para elegir el idioma inicial cuando la persona todavía no eligió uno a mano.
exports.handler = async (event) => {
  const h = event.headers || {};
  let country = h["x-country"] || null;
  if (!country && h["x-nf-geo"]) {
    try {
      const geo = JSON.parse(Buffer.from(h["x-nf-geo"], "base64").toString("utf8"));
      country = (geo.country && geo.country.code) || null;
    } catch (e) {}
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    body: JSON.stringify({ country: country ? String(country).toUpperCase() : null }),
  };
};
