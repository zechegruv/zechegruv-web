// ---------- Página de artista: stats + top canciones + preview sin autoplay ----------
// Se usa en artistas/<slug>.html (ver scripts/generate_artist_pages.py).
//
// Top canciones (nombre, portada) viene de /.netlify/functions/spotify-artist-stats
// (API oficial de Spotify) — no está disponible hasta conectar Netlify.
// Oyentes mensuales y reproducciones por canción NO los expone la API
// pública de Spotify: salen de assets/data/artist-live-stats.json, que se
// carga a mano (ver el archivo). Si un dato puntual no está cargado, esa
// parte queda oculta en vez de mostrar un error o un "0".
// ---------- Idioma ----------
// Mismos 7 idiomas y misma key de localStorage ("zg_lang") que la home,
// así elegir idioma en un lado o en el otro queda sincronizado.
const ARTIST_I18N = {
  es: {
    nav_back: "← Volver al roster", artist_role: "Artista ZECHE GRUV", label_bio: "Biografía",
    label_listeners: "Oyentes mensuales", label_top_tracks: "Top canciones", loading_tracks: "Cargando…",
    tracks_error: "No pudimos cargar el top de canciones ahora mismo.", btn_spotify: "Escuchar en Spotify ↗",
    footer_rights: "TODOS LOS DERECHOS RESERVADOS", bio_placeholder: "Biografía próximamente.",
    label_releases: "Lanzamientos con ZECHE GRUV",
  },
  en: {
    nav_back: "← Back to roster", artist_role: "ZECHE GRUV Artist", label_bio: "Biography",
    label_listeners: "Monthly listeners", label_top_tracks: "Top tracks", loading_tracks: "Loading…",
    tracks_error: "We couldn't load the top tracks right now.", btn_spotify: "Listen on Spotify ↗",
    footer_rights: "ALL RIGHTS RESERVED", bio_placeholder: "Biography coming soon.",
    label_releases: "Releases with ZECHE GRUV",
  },
  pt: {
    nav_back: "← Voltar ao elenco", artist_role: "Artista ZECHE GRUV", label_bio: "Biografia",
    label_listeners: "Ouvintes mensais", label_top_tracks: "Top músicas", loading_tracks: "Carregando…",
    tracks_error: "Não conseguimos carregar o top de músicas agora.", btn_spotify: "Ouvir no Spotify ↗",
    footer_rights: "TODOS OS DIREITOS RESERVADOS", bio_placeholder: "Biografia em breve.",
    label_releases: "Lançamentos com a ZECHE GRUV",
  },
  fr: {
    nav_back: "← Retour aux artistes", artist_role: "Artiste ZECHE GRUV", label_bio: "Biographie",
    label_listeners: "Auditeurs mensuels", label_top_tracks: "Meilleurs titres", loading_tracks: "Chargement…",
    tracks_error: "Impossible de charger les meilleurs titres pour le moment.", btn_spotify: "Écouter sur Spotify ↗",
    footer_rights: "TOUS DROITS RÉSERVÉS", bio_placeholder: "Biographie à venir.",
    label_releases: "Sorties avec ZECHE GRUV",
  },
  it: {
    nav_back: "← Torna al roster", artist_role: "Artista ZECHE GRUV", label_bio: "Biografia",
    label_listeners: "Ascoltatori mensili", label_top_tracks: "Brani più ascoltati", loading_tracks: "Caricamento…",
    tracks_error: "Non siamo riusciti a caricare i brani più ascoltati ora.", btn_spotify: "Ascolta su Spotify ↗",
    footer_rights: "TUTTI I DIRITTI RISERVATI", bio_placeholder: "Biografia in arrivo.",
    label_releases: "Uscite con ZECHE GRUV",
  },
  de: {
    nav_back: "← Zurück zum Roster", artist_role: "ZECHE GRUV Künstler:in", label_bio: "Biografie",
    label_listeners: "Monatliche Hörer:innen", label_top_tracks: "Top-Songs", loading_tracks: "Wird geladen…",
    tracks_error: "Die Top-Songs konnten gerade nicht geladen werden.", btn_spotify: "Auf Spotify hören ↗",
    footer_rights: "ALLE RECHTE VORBEHALTEN", bio_placeholder: "Biografie folgt in Kürze.",
    label_releases: "Releases mit ZECHE GRUV",
  },
  ru: {
    nav_back: "← Назад к артистам", artist_role: "Артист ZECHE GRUV", label_bio: "Биография",
    label_listeners: "Слушателей в месяц", label_top_tracks: "Топ треков", loading_tracks: "Загрузка…",
    tracks_error: "Не удалось загрузить топ треков прямо сейчас.", btn_spotify: "Слушать на Spotify ↗",
    footer_rights: "ВСЕ ПРАВА ЗАЩИЩЕНЫ", bio_placeholder: "Биография скоро появится.",
    label_releases: "Релизы с ZECHE GRUV",
  },
};
const SUPPORTED_LANGS = Object.keys(ARTIST_I18N);

function detectInitialLang() {
  try {
    const saved = localStorage.getItem("zg_lang");
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) {}
  const nav = ((navigator.language || "es").slice(0, 2) || "es").toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : "es";
}

(function () {
  const root = document.querySelector("[data-artist-id]");
  if (!root) return;
  const artistId = root.dataset.artistId;
  const artistSlug = root.dataset.artistSlug;

  const listenersBlock = document.getElementById("artistListeners");
  const listenersCount = document.getElementById("artistListenersCount");
  const tracksList = document.getElementById("topTracksList");
  const bioEl = document.getElementById("artistBio");
  const langSelect = document.getElementById("langSelect");

  let bioByLang = {};
  try {
    bioByLang = JSON.parse(document.getElementById("bioData")?.textContent || "{}");
  } catch (e) {}

  let currentLang = "es";

  function applyLanguage(lang) {
    currentLang = ARTIST_I18N[lang] ? lang : "es";
    document.documentElement.lang = currentLang;
    const t = ARTIST_I18N[currentLang];

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const val = t[el.getAttribute("data-i18n")];
      if (val !== undefined) el.textContent = val;
    });

    // Mientras no estén las 7 traducciones cargadas para todos, mostramos
    // lo que haya disponible antes que el placeholder (es -> cualquier
    // idioma cargado -> "próximamente").
    const bio = bioByLang[currentLang] || bioByLang.es || Object.values(bioByLang)[0];
    if (bioEl) {
      bioEl.textContent = bio || t.bio_placeholder;
      bioEl.classList.toggle("is-placeholder", !bio);
    }

    if (langSelect) langSelect.value = currentLang;
    try { localStorage.setItem("zg_lang", currentLang); } catch (e) {}
  }

  applyLanguage(detectInitialLang());
  langSelect?.addEventListener("change", () => applyLanguage(langSelect.value));

  function formatNumber(n) {
    if (typeof n !== "number") return null;
    return new Intl.NumberFormat("es-AR").format(n);
  }

  function renderTopTracks(tracks, trackPlays) {
    if (!tracksList) return;
    if (!tracks || !tracks.length) {
      tracksList.innerHTML = `<div class="top-tracks-empty">${ARTIST_I18N[currentLang].tracks_error}</div>`;
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

  // ---------- Lanzamientos con ZECHE GRUV ----------
  // Reusa /.netlify/functions/spotify-catalog (mismo catálogo completo que
  // la home) y se queda solo con los items donde este artista figura como
  // crédito. Si la function falla o no hay coincidencias, la sección queda
  // oculta (hidden en el HTML) en vez de mostrar un bloque vacío.
  const artistName = (root.dataset.artistName || "").trim().toLowerCase();

  async function loadArtistReleases() {
    const section = document.getElementById("artistReleasesSection");
    const grid = document.getElementById("artistReleasesGrid");
    if (!section || !grid || !artistName) return;

    try {
      const res = await fetch("/.netlify/functions/spotify-catalog");
      if (!res.ok) throw new Error("bad response");
      const { items } = await res.json();

      const matches = (items || []).filter((item) =>
        (item.artists || "").split(",").some((n) => n.trim().toLowerCase() === artistName)
      );
      if (!matches.length) return;

      grid.innerHTML = matches.map((item) => `
        <a href="${item.url}" target="_blank" rel="noopener" class="release-card"
           data-spotify-uri="spotify:${item.type === "track" ? "track" : "album"}:${item.id}" data-spotify-name="${item.name}">
          <div class="release-art"><img src="${item.cover || ""}" alt="${item.name} — cover art" loading="lazy" decoding="async"></div>
          <div class="card-info">
            <div class="card-name">${item.name}</div>
            <div class="card-meta">${item.artists}${item.appearsOn ? " · Aparece en" : ""}</div>
          </div>
        </a>
      `).join("");

      grid.querySelectorAll("[data-spotify-uri]").forEach((el) => {
        el.addEventListener("click", (event) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openPreview(el.dataset.spotifyUri);
        });
      });

      section.hidden = false;
    } catch (e) {
      // sección queda oculta
    }
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
  loadArtistReleases();
})();
