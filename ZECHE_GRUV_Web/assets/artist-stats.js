// ---------- Página de artista: stats + top canciones + preview sin autoplay ----------
// Se usa en artistas/<slug>.html (ver scripts/generate_artist_pages.py).
//
// Top canciones (nombre, portada) viene de /.netlify/functions/spotify-artist-stats
// (API oficial de Spotify) — no está disponible hasta conectar Netlify.
// Oyentes mensuales y reproducciones por canción NO los expone la API
// pública de Spotify: salen de assets/data/artist-live-stats.json, que se
// carga a mano (ver el archivo). Si un dato puntual no está cargado, esa
// parte queda oculta en vez de mostrar un error o un "0".
(function () {
  const root = document.querySelector("[data-artist-id]");
  if (!root) return;
  const artistId = root.dataset.artistId;
  const artistSlug = root.dataset.artistSlug;

  const listenersBlock = document.getElementById("artistListeners");
  const listenersCount = document.getElementById("artistListenersCount");
  const tracksList = document.getElementById("topTracksList");

  function formatNumber(n) {
    if (typeof n !== "number") return null;
    return new Intl.NumberFormat("es-AR").format(n);
  }

  function renderTopTracks(tracks, trackPlays) {
    if (!tracksList) return;
    if (!tracks || !tracks.length) {
      tracksList.innerHTML = '<div class="top-tracks-empty">No pudimos cargar el top de canciones ahora mismo.</div>';
      return;
    }
    tracksList.innerHTML = tracks.slice(0, 3).map((t, i) => {
      const plays = (trackPlays && trackPlays[t.id]) || t.plays;
      return `
      <div class="top-track" data-spotify-uri="spotify:track:${t.id}" data-spotify-name="${t.name}">
        <div class="top-track-index">${i + 1}</div>
        <img class="top-track-cover" src="${t.cover || ""}" alt="" loading="lazy">
        <div class="top-track-info">
          <div class="top-track-name">${t.name}</div>
          <div class="top-track-artists">${t.artists || ""}</div>
        </div>
        ${plays ? `<div class="top-track-plays">${formatNumber(plays)}</div>` : ""}
      </div>
    `;
    }).join("");
    attachPreviewHandlers();
  }

  async function loadLiveStats() {
    try {
      const res = await fetch("../assets/data/artist-live-stats.json");
      if (!res.ok) throw new Error("bad response");
      const all = await res.json();
      return all[artistSlug] || null;
    } catch (e) {
      return null;
    }
  }

  async function loadTopTracks() {
    try {
      const res = await fetch(`/.netlify/functions/spotify-artist-stats?id=${encodeURIComponent(artistId)}`);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      return data.topTracks || null;
    } catch (e) {
      return null;
    }
  }

  async function loadStats() {
    const [liveStats, topTracks] = await Promise.all([loadLiveStats(), loadTopTracks()]);

    if (listenersBlock && listenersCount && typeof liveStats?.monthlyListeners === "number") {
      listenersCount.textContent = formatNumber(liveStats.monthlyListeners);
      listenersBlock.classList.add("is-visible");
    }

    renderTopTracks(topTracks, liveStats?.trackPlays);
  }

  // ---------- Preview sin autoplay (mismo criterio que la home) ----------
  const bar = document.getElementById("spotify-bar");
  const mount = document.getElementById("spotify-bar-mount");
  const closeBtn = document.getElementById("spotify-bar-close");
  let apiReady = null;
  let controller = null;
  let creating = false;
  let pendingUri = null;

  function createNow() {
    apiReady.createController(mount, { uri: pendingUri, width: "100%", height: "80" }, (EmbedController) => {
      controller = EmbedController;
    });
  }

  window.onSpotifyIframeApiReady = (IFrameAPI) => {
    apiReady = IFrameAPI;
    if (creating) createNow();
  };

  function openPreview(uri) {
    bar.classList.add("active");
    pendingUri = uri;
    if (controller) {
      controller.loadUri(uri);
      return;
    }
    if (!creating) {
      creating = true;
      if (apiReady) createNow();
    }
  }

  function attachPreviewHandlers() {
    document.querySelectorAll("[data-spotify-uri]").forEach((el) => {
      el.addEventListener("click", () => openPreview(el.dataset.spotifyUri));
    });
  }

  closeBtn?.addEventListener("click", () => {
    bar.classList.remove("active");
    if (controller) controller.pause();
  });

  attachPreviewHandlers();
  loadStats();
})();
