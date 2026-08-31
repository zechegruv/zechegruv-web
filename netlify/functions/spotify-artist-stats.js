// GET /.netlify/functions/spotify-artist-stats?id=<spotifyArtistId>
// Top 3 canciones de un artista (API oficial de Spotify — nombre, portada,
// featurings). Oyentes mensuales y reproducciones por canción NO están acá
// porque la API pública no los expone: esos salen de
// assets/data/artist-live-stats.json, que se pide aparte desde el propio
// navegador (ver assets/artist-stats.js).
const { spotifyFetch } = require("./_lib/spotify-token");

const cache = new Map(); // artistId -> { tracks, fetchedAt }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

async function fetchTopTracks(artistId) {
  const data = await spotifyFetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=AR`
  );
  return data.tracks.slice(0, 3).map((t) => ({
    id: t.id,
    name: t.name,
    cover: t.album?.images?.[0]?.url || null,
    artists: t.artists.map((a) => a.name).join(", "),
  }));
}

exports.handler = async (event) => {
  const artistId = event.queryStringParameters?.id;
  if (!artistId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Falta el parámetro id" }),
    };
  }

  const now = Date.now();
  const cached = cache.get(artistId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ topTracks: cached.tracks }),
    };
  }

  try {
    const tracks = await fetchTopTracks(artistId);
    cache.set(artistId, { tracks, fetchedAt: now });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ topTracks: tracks }),
    };
  } catch (err) {
    if (cached) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topTracks: cached.tracks, stale: true }),
      };
    }
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
