// GET /.netlify/functions/spotify-catalog
// Devuelve el catálogo completo de ZECHE GRUV (discografía propia +
// "aparece en") tal como lo ve la API pública de Spotify, para la sección
// "Catálogo completo" debajo de "Lanzamientos seleccionados". Se llama
// desde el navegador en cada carga de la home — así el catálogo se
// mantiene al día solo mientras el sitio esté online, sin que nadie tenga
// que tocar código para sumar un lanzamiento nuevo.
const { spotifyFetch } = require("./_lib/spotify-token");

const ZECHE_GRUV_ARTIST_ID = "0yIGrWjWqKnM7qJ0uyImij";
// La API de Spotify limita este endpoint puntual a 10 por página (a
// diferencia de otros que permiten hasta 50) — con más, devuelve 400.
const PAGE_LIMIT = 10;

// A pedido: álbumes/singles que no tienen que aparecer en el catálogo
// (aunque la API de Spotify los devuelva como crédito de ZECHE GRUV).
const EXCLUDED_ALBUM_IDS = new Set([
  "20dAwPjVuSMbigrTjSdSKJ", // Dispárame
  "27SG9pqFdvHL6IDBef5fBy", // Lágrimas
  "5GKtNfwn9iDvFd7aYHwoNJ", // Duelo
  "0gdYHXKIPspbs1KfMA9nho", // Hilo Rojo
  "4FOsGOqDjKkF5plimz3GGN", // RANGOS
]);

// A pedido: álbumes que sí tienen que estar pero la API no los devuelve
// solos (ej. ZECHE GRUV acredita solo como producción, no como artista).
const EXTRA_ALBUM_IDS = [
  "0tclMzv83XAOpRtTZduBKy", // A.M.03 (Rouse bby)
  "6YmySpzsNXMuxekqcmdlGJ", // TACÚ
  "2G5d3XEXsb0Nnk7N9LRa77", // Plutão
];

// Mismo criterio que EXTRA_ALBUM_IDS pero para canciones sueltas que no
// tienen álbum propio de ZECHE GRUV (sessions en vivo, versiones, etc.).
const EXTRA_TRACK_IDS = [
  "63mKI1UeGMKru5x0i5haz5", // Midel // ALL STZ Live Session #6
  "0zmLTTEbr4gtDFxJkgcuYc", // ALL IN - Versión Acústica
  "4cWNQP2GEDsivcFyqsqtCf", // Vum Bora
  "0iB6esiqMK4QmDRhheQPQK", // A veces
  "2PC3Oz8EyFLAlCl3FGWJfw", // El Mundo Está Jodido
];

// Cache en memoria del proceso (ver nota en _lib/spotify-token.js sobre
// por qué no usamos un store externo): evita re-consultar Spotify en cada
// visita mientras la instancia de la function siga tibia.
let cache = { items: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

function normalizeAlbum(album, appearsOn) {
  return {
    id: album.id,
    name: album.name,
    type: album.album_type,
    appearsOn,
    releaseDate: album.release_date,
    cover: album.images?.[0]?.url || null,
    artists: album.artists.map((a) => a.name).join(", "),
    url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
  };
}

function normalizeTrack(track) {
  return {
    id: track.id,
    name: track.name,
    type: "track",
    appearsOn: false,
    releaseDate: track.album?.release_date || null,
    cover: track.album?.images?.[0]?.url || null,
    artists: track.artists.map((a) => a.name).join(", "),
    url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
  };
}

async function fetchArtistAlbums() {
  const items = [];
  let url =
    `https://api.spotify.com/v1/artists/${ZECHE_GRUV_ARTIST_ID}/albums` +
    `?include_groups=album,single,appears_on,compilation&market=AR&limit=${PAGE_LIMIT}`;

  while (url) {
    const page = await spotifyFetch(url);
    items.push(...page.items);
    url = page.next;
  }
  return items;
}

async function fetchExtraAlbums(ids) {
  if (!ids.length) return [];
  const data = await spotifyFetch(`https://api.spotify.com/v1/albums?ids=${ids.join(",")}&market=AR`);
  return data.albums.filter(Boolean);
}

// Uno por uno (no en batch): así, si a Spotify no le gusta un id puntual
// (403/404 por el motivo que sea), los demás igual se cargan en vez de
// tirar abajo el catálogo entero.
async function fetchExtraTracks(ids) {
  const results = await Promise.allSettled(
    ids.map((id) => spotifyFetch(`https://api.spotify.com/v1/tracks/${id}?market=AR`))
  );
  return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

async function fetchAllAlbums() {
  // La discografía propia es el contenido principal: si falla, sí queremos
  // que se note (cae al catch de más abajo). Los extras manuales son un
  // agregado — si alguno falla, seguimos con lo que sí se pudo traer.
  const artistAlbums = await fetchArtistAlbums();
  const [extraAlbumsResult, extraTracksResult] = await Promise.allSettled([
    fetchExtraAlbums(EXTRA_ALBUM_IDS),
    fetchExtraTracks(EXTRA_TRACK_IDS),
  ]);
  const extraAlbums = extraAlbumsResult.status === "fulfilled" ? extraAlbumsResult.value : [];
  const extraTracks = extraTracksResult.status === "fulfilled" ? extraTracksResult.value : [];

  // Spotify puede repetir el mismo álbum (distintas ediciones/mercados, o
  // estar tanto en la discografía propia como en los extras manuales) —
  // nos quedamos con una entrada por id, la que tenga fecha más reciente.
  const byId = new Map();
  for (const album of artistAlbums) {
    if (EXCLUDED_ALBUM_IDS.has(album.id)) continue;
    const existing = byId.get(album.id);
    if (!existing || album.release_date > existing.release_date) {
      byId.set(album.id, normalizeAlbum(album, album.album_group === "appears_on"));
    }
  }
  for (const album of extraAlbums) {
    if (!byId.has(album.id)) {
      byId.set(album.id, normalizeAlbum(album, false));
    }
  }
  for (const track of extraTracks) {
    if (!byId.has(track.id)) {
      byId.set(track.id, normalizeTrack(track));
    }
  }

  return Array.from(byId.values()).sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
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
