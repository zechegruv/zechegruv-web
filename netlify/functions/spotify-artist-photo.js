// GET /.netlify/functions/spotify-artist-photo?id=<spotifyArtistId>
// Foto de perfil de un artista en Spotify (API oficial, catálogo público).
// La usa el portal para los artistas que tienen Spotify vinculado pero no
// están en el roster de la web (assets/data/artists.js), que es de donde
// salen las fotos del resto.
const { spotifyFetch } = require("./_lib/spotify-token");

const cache = new Map(); // artistId -> { url, fetchedAt }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const json = (statusCode, body, maxAge = 0) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id || "";
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return json(400, { error: "Artista de Spotify inválido." });

  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return json(200, { url: hit.url }, 3600);

  try {
    const artist = await spotifyFetch(`https://api.spotify.com/v1/artists/${id}`);
    // Spotify manda las fotos de la más grande a la más chica: para el
    // avatar alcanza la mediana (~320 px).
    const images = (artist && artist.images) || [];
    const url = (images[1] || images[0] || {}).url || null;
    cache.set(id, { url, fetchedAt: now });
    return json(200, { url }, 3600);
  } catch (err) {
    if (hit) return json(200, { url: hit.url, stale: true });
    return json(502, { error: "No pudimos traer la foto de Spotify." });
  }
};
