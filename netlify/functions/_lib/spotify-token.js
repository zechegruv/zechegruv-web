// Client Credentials Flow oficial de Spotify (acceso solo a catálogo
// público, sin login de usuario). Necesita SPOTIFY_CLIENT_ID y
// SPOTIFY_CLIENT_SECRET como variables de entorno en Netlify (Site
// settings → Environment variables) — nunca hardcodeadas acá.
//
// El token se cachea en memoria del proceso: mientras la instancia de la
// function siga "tibia" entre invocaciones, evita pedir un token nuevo en
// cada request. Si la instancia se recicla, se pide uno nuevo sin más.
let cachedToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET en las variables de entorno de Netlify.");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`No se pudo obtener el token de Spotify (${res.status}).`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Restamos un margen de 60s para no usarlo justo cuando expira.
  cachedExpiresAt = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function spotifyFetch(url) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify API respondió ${res.status} para ${url}`);
  }
  return res.json();
}

module.exports = { getAccessToken, spotifyFetch };
