// GET /.netlify/functions/spotify-catalog
// Devuelve el catálogo completo de ZECHE GRUV (discografía propia +
// "aparece en") tal como lo ve la API pública de Spotify, para la sección
// "Catálogo completo" debajo de "Lanzamientos seleccionados". Se llama
// desde el navegador en cada carga de la home — así el catálogo se
// mantiene al día solo mientras el sitio esté online, sin que nadie tenga
// que tocar código para sumar un lanzamiento nuevo.
const { spotifyFetch } = require("./_lib/spotify-token");

const ZECHE_GRUV_ARTIST_ID = "0yIGrWjWqKnM7qJ0uyImij";
const PAGE_LIMIT = 50;

// Cache en memoria del proceso (ver nota en _lib/spotify-token.js sobre
// por qué no usamos un store externo): evita re-consultar Spotify en cada
// visita mientras la instancia de la function siga tibia.
let cache = { items: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

async function fetchAllAlbums() {
  const items = [];
  let url =
    `https://api.spotify.com/v1/artists/${ZECHE_GRUV_ARTIST_ID}/albums` +
    `?include_groups=album,single,appears_on&market=AR&limit=${PAGE_LIMIT}`;

  while (url) {
    const page = await spotifyFetch(url);
    items.push(...page.items);
    url = page.next;
  }

  // Spotify puede repetir el mismo álbum (distintas ediciones/mercados) —
  // nos quedamos con una entrada por id, la que tenga fecha más reciente.
  const byId = new Map();
  for (const album of items) {
    const existing = byId.get(album.id);
    if (!existing || album.release_date > existing.release_date) {
      byId.set(album.id, album);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => (a.release_date < b.release_date ? 1 : -1))
    .map((album) => ({
      id: album.id,
      name: album.name,
      type: album.album_type,
      appearsOn: album.album_group === "appears_on",
      releaseDate: album.release_date,
      cover: album.images?.[0]?.url || null,
      artists: album.artists.map((a) => a.name).join(", "),
      url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
    }));
}

exports.handler = async () => {
  const now = Date.now();
  if (cache.items && now - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ updatedAt: cache.fetchedAt, items: cache.items }),
    };
  }

  try {
    const items = await fetchAllAlbums();
    cache = { items, fetchedAt: now };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ updatedAt: now, items }),
    };
  } catch (err) {
    // Si hay una versión vieja en cache, mejor mostrar eso que nada.
    if (cache.items) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt: cache.fetchedAt, items: cache.items, stale: true }),
      };
    }
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
