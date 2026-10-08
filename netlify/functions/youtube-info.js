// GET /.netlify/functions/youtube-info?id=<videoId>
// Título y canal de un video de YouTube (oEmbed público, sin clave). Lo usa
// el portal al pegar un link en Referencias. La portada no pasa por acá: se
// pide directo a i.ytimg.com con el ID del video.
const cache = new Map(); // videoId -> { info, fetchedAt }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const json = (statusCode, body, maxAge = 0) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id || "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json(400, { error: "Video de YouTube inválido." });

  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return json(200, hit.info, 3600);

  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    // 401/403: privado o con la inserción bloqueada; 404: no existe.
    if (res.status === 404 || res.status === 400) return json(404, { error: "No encontramos ese video." });
    if (res.status === 401 || res.status === 403) return json(200, { title: "", channel: "", restricted: true }, 600);
    if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
    const data = await res.json();
    const info = { title: String(data.title || "").slice(0, 300), channel: String(data.author_name || "").slice(0, 200) };
    cache.set(id, { info, fetchedAt: now });
    return json(200, info, 3600);
  } catch (err) {
    if (hit) return json(200, { ...hit.info, stale: true });
    return json(502, { error: "No pudimos consultar YouTube." });
  }
};
