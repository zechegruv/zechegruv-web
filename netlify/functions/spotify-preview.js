// GET /.netlify/functions/spotify-preview?t=album|track&id=<id de Spotify>
// Lleva al adelanto de 30 s de esa canción (el mismo que suena en el
// reproductor público de Spotify). Lo usan los discos del inicio y la
// bandeja de lanzamientos: el <audio> de la página apunta acá y sigue la
// redirección al mp3, así cada lanzamiento nuevo suena solo, sin subir nada.
// La API de Spotify dejó de dar estos adelantos (preview_url) en 2024; el
// reproductor público los sigue mostrando, por eso se leen de ahí.
// Si no hay adelanto, responde 404 y la página ofrece abrirlo en Spotify.

const cache = new Map(); // "album:id" → { url, at }
const TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const ID_RE = /^[A-Za-z0-9]{22}$/;
const PREVIEW_RE = /"audioPreview":\{[^}]*?"url":"(https:\/\/p\.scdn\.co\/mp3-preview\/[A-Za-z0-9]+)/;

async function findPreview(type, id) {
  const key = type + ":" + id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "es-AR,es;q=0.9",
    },
  });
  if (!res.ok) throw new Error("spotify " + res.status);
  const html = await res.text();
  const m = PREVIEW_RE.exec(html);
  const url = m ? m[1] : null;
  cache.set(key, { url, at: Date.now() });
  return url;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const type = q.t === "track" ? "track" : "album";
  const id = String(q.id || "");
  if (!ID_RE.test(id)) return { statusCode: 400, body: "id inválido" };
  try {
    const url = await findPreview(type, id);
    if (!url) return { statusCode: 404, headers: { "Cache-Control": "public, max-age=600" }, body: "sin adelanto" };
    return { statusCode: 302, headers: { Location: url, "Cache-Control": "public, max-age=3600" }, body: "" };
  } catch (e) {
    console.error("spotify-preview", type, id, e.message);
    return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: "no se pudo consultar Spotify" };
  }
};
