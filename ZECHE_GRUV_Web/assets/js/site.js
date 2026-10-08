// ZECHE GRUV — código del inicio (antes estaba dentro de index.html).
// Los bloques van en el mismo orden en que estaban en la página.
// ---------- Artist roster ----------
// El array vive en assets/data/artists.js (también lo usa el generador
// de páginas de artista) — editalo ahí para agregar/sacar artistas.
const ARTISTS = window.ZG_ARTISTS || [];

const grid = document.getElementById("artists-grid");
grid.innerHTML = ARTISTS.map(a => `
  <a class="artist-card" href="artistas/${a.slug}.html">
    <div class="artist-photo-wrap">
      <img class="artist-photo" src="${a.photo || `https://i.scdn.co/image/${a.img}`}" alt="${a.name}" loading="lazy">
    </div>
    <div class="artist-name">${a.name}</div>
  </a>
`).join("");

// ---------- Banner del estudio ----------
// Editá este array para agregar/sacar fotos: alcanza con soltar el
// archivo en assets/studio/ y sumar su nombre acá. Si un archivo no
// existe todavía (roster recién armado), el slide muestra un
// placeholder punteado en su lugar en vez de romper el layout.
const STUDIO_PHOTOS = [
  "assets/studio/studio-1.webp",
  "assets/studio/studio-2.webp",
  "assets/studio/studio-3.webp",
  "assets/studio/studio-4.webp",
  "assets/studio/studio-5.webp",
];

(function () {
  const gallery = document.getElementById("studioGallery");
  const dotsWrap = document.getElementById("studioDots");
  if (!gallery) return;

  gallery.innerHTML = STUDIO_PHOTOS.map((src) => `
    <div class="studio-slide">
      <img src="${src.replace(".webp", "-800.webp")}" srcset="${src.replace(".webp", "-800.webp")} 800w, ${src} 1600w" sizes="(max-width: 1400px) 90vw, 1260px" alt="ZECHE GRUV — estudio" loading="lazy" decoding="async"
           onerror="this.closest('.studio-slide').innerHTML = '<div class=&quot;studio-photo-placeholder&quot;></div>';">
    </div>
  `).join("");

  if (dotsWrap) {
    dotsWrap.innerHTML = STUDIO_PHOTOS.map((_, i) => `
      <button class="studio-dot${i === 0 ? " is-active" : ""}" type="button" aria-label="Foto ${i + 1}"></button>
    `).join("");
  }
  const dots = dotsWrap ? Array.from(dotsWrap.children) : [];

  const slideCount = STUDIO_PHOTOS.length;
  let current = 0;

  function goTo(index) {
    current = (index + slideCount) % slideCount;
    gallery.scrollTo({ left: current * gallery.clientWidth, behavior: "smooth" });
  }

  document.getElementById("studioPrev")?.addEventListener("click", () => goTo(current - 1));
  document.getElementById("studioNext")?.addEventListener("click", () => goTo(current + 1));
  dots.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));

  // Actualiza el punto activo también cuando el usuario desliza a mano
  // (touch/drag), no solo cuando usa las flechas.
  let scrollRaf = null;
  gallery.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      current = Math.round(gallery.scrollLeft / gallery.clientWidth);
      dots.forEach((d, i) => d.classList.toggle("is-active", i === current));
    });
  }, { passive: true });
})();

// ---------- Musical Services ----------
const WHATSAPP_NUMBER = "5491133287422"; // ZECHE GRUV — +54 9 11 3328-7422

function waLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// Servicios de precio fijo (y los 3 de presupuesto variable al final).
// El precio y el mensaje de WhatsApp quedan siempre en español (así el
// dueño del sello puede leer cualquier consulta sin importar en qué
// idioma haya estado viendo la página quien escribe). Nombre y
// descripción visibles en pantalla salen del diccionario I18N por key.
// Editá este array para agregar/sacar/reordenar servicios y precios.
const SERVICES = [
  { key: "session", name: "Hora de sesión de grabación", price: "$50.000 ARS / hora" },
  { key: "mastering", name: "Mastering", price: "$60.000 ARS" },
  { key: "mixtering", name: "Mixtering (mezcla por stems, hasta 8 stems)", price: "$50.000 ARS" },
  { key: "instrumental_catalogo", name: "Instrumental de catálogo", price: "$60.000 ARS" },
  { key: "instrumental_personalizada", name: "Instrumental personalizada (4 revisiones)", price: "$90.000 ARS" },
  { key: "coverart", name: "Portada / Coverart", price: "$45.000 ARS" },
  { key: "videoclip", name: "Videoclip (grabación y edición)", price: "$160.000 ARS" },
  { key: "videolyrics", name: "VideoLyrics", price: "$50.000 ARS" },
  { key: "session_musicians", name: "Grabación de guitarras / bajo / batería / coros", price: "$25.000 ARS / hora" },
];

// Catálogo de beats (card "Instrumental de catálogo").
//  - url: link público de untitled para ESCUCHAR el catálogo (sin
//    vencimiento y con las descargas desactivadas).
//  - beats: nombres de los beats, tal cual figuran en untitled. Hay que
//    mantener esta lista a mano cada vez que se suma o se vende un beat.
// Mientras "url" esté vacío no se muestra el botón "Ver catálogo", y
// mientras "beats" esté vacío no se muestra el buscador.
const BEAT_CATALOG = {
  url: "https://untitled.stream/library/project/C7PxptukoEKLShhj4DQ6K",
  beats: [
    "FUTUR3 - F#m 154 bpm @prodyeiko",
    "Bouncy - Bbmin 102Bpm @prodyeiko",
    "OMG - Cmin 130bpm @prodyeiko",
  ],
};
let selectedBeat = null;
let beatPanelOpen = false;
let beatListOpen = false; // lista completa, se abre con la flecha

const escHtml = (str) => String(str).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Para buscar sin importar mayúsculas ni tildes.
const normText = (str) => String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function beatPickerHtml(t) {
  const viewBtn = BEAT_CATALOG.url
    ? `<a class="service-btn" href="${escHtml(BEAT_CATALOG.url)}" target="_blank" rel="noopener">${t.beat_view_catalog}</a>`
    : "";
  const picker = BEAT_CATALOG.beats.length ? `
        <button class="service-btn" type="button" data-action="toggle-beats" aria-expanded="${beatPanelOpen}">${t.beat_pick_btn}</button>
        <div class="beat-panel" id="beat-panel" ${beatPanelOpen ? "" : "hidden"}>
          <div class="service-field beat-search">
            <input type="text" id="beat-search" placeholder="${t.beat_search_placeholder}" autocomplete="off" spellcheck="false">
            <button type="button" class="beat-arrow" data-action="toggle-beat-list" aria-label="${t.beat_show_all}" title="${t.beat_show_all}" aria-expanded="${beatListOpen}">
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true"><path d="M1 1.5l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="beat-list" id="beat-list" hidden></div>
        </div>
        <div class="beat-selected" id="beat-selected"></div>
        <p class="package-hint" id="beat-hint">${t.beat_pick_hint}</p>` : "";
  return viewBtn || picker ? `<div class="beat-picker">${viewBtn}${picker}</div>` : "";
}

// Distancia de edición (Levenshtein), para tolerar errores de tipeo.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Buscador de beats: cada palabra escrita tiene que aparecer en el
// nombre (en cualquier orden; sirve buscar por BPM o tonalidad, ej.
// "102" o "bbmin"). Ordena por qué tan bien coincide: palabra exacta >
// empieza igual > la contiene > se parece (1-2 letras de diferencia).
function searchBeats(query) {
  const all = BEAT_CATALOG.beats.map((name, i) => ({ name, i }));
  const tokens = normText(query).split(/[^a-z0-9#]+/).filter(Boolean);
  if (!tokens.length) return all;
  return all
    .map((b) => {
      const words = normText(b.name).split(/[^a-z0-9#]+/).filter(Boolean);
      let score = 0;
      for (const tok of tokens) {
        let best = 0;
        for (const w of words) {
          if (w === tok) best = Math.max(best, 4);
          else if (w.startsWith(tok)) best = Math.max(best, 3);
          else if (w.includes(tok)) best = Math.max(best, 2);
          else if (tok.length >= 4) {
            // compara contra el comienzo de la palabra, con una letra de más o de menos
            const dist = Math.min(...[-1, 0, 1].map((d) => editDistance(tok, w.slice(0, tok.length + d))));
            if (dist <= (tok.length >= 7 ? 2 : 1)) best = Math.max(best, 1);
          }
        }
        if (!best) return null;
        score += best;
      }
      return { ...b, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.i - b.i);
}

// La lista solo se muestra si se está escribiendo (sugerencias) o si
// se abrió la lista completa con la flecha.
function renderBeatList() {
  const listEl = document.getElementById("beat-list");
  if (!listEl) return;
  const t = I18N[currentLang];
  const query = document.getElementById("beat-search").value;
  const visible = beatListOpen || normText(query) !== "";
  const items = visible ? searchBeats(query) : [];
  listEl.toggleAttribute("hidden", !visible);
  listEl.innerHTML = items.length
    ? items.map((b) => `<button type="button" class="beat-item${b.name === selectedBeat ? " is-active" : ""}" data-action="pick-beat" data-index="${b.i}">${escHtml(b.name)}</button>`).join("")
    : `<div class="beat-empty">${t.beat_none}</div>`;
  servicesGrid.querySelector(".beat-arrow")?.setAttribute("aria-expanded", beatListOpen);
  document.getElementById("beat-selected").textContent = selectedBeat ? `${t.beat_selected} ${selectedBeat}` : "";
}

function pickBeat(index) {
  selectedBeat = BEAT_CATALOG.beats[index];
  beatListOpen = false;
  document.getElementById("beat-search").value = "";
  document.getElementById("beat-hint").classList.remove("is-visible");
  renderBeatList();
}

function setBeatPanelOpen(open) {
  beatPanelOpen = open;
  const panel = document.getElementById("beat-panel");
  if (!panel) return;
  panel.toggleAttribute("hidden", !open);
  servicesGrid.querySelector('[data-action="toggle-beats"]')?.setAttribute("aria-expanded", open);
}

const servicesGrid = document.getElementById("services-grid");

// El botón "Catálogo de beats" del menú lleva a la tarjeta y abre el buscador.
document.getElementById("navBeatsLink")?.addEventListener("click", () => setBeatPanelOpen(true));

function renderServiceCards() {
  const t = I18N[currentLang];

  const fixedCards = SERVICES.map((s, i) => `
    <div class="service-card"${s.key === "instrumental_catalogo" ? ' id="beat-catalog"' : ""}>
      <div class="service-top">
        <div class="service-name">${t.svc[s.key].name}</div>
      </div>
      <div class="service-desc">${t.svc[s.key].desc}</div>
      <div class="service-price">${s.price}</div>
      ${s.key === "instrumental_catalogo" ? beatPickerHtml(t) : ""}
      <button class="service-btn" type="button" data-action="reserve-fixed" data-index="${i}">${t.svc_cta_reserve}</button>
    </div>
  `).join("");

  const mezclaCard = `
    <div class="service-card">
      <div class="service-top">
        <div class="service-name">${t.svc.mezcla.name}</div>
      </div>
      <div class="service-desc">${t.svc.mezcla.desc}</div>
      <div class="service-price">${t.svc_price_quote}</div>
      <div class="service-form">
        <div class="service-field">
          <label for="mezcla-canales">${t.mezcla_canales_label}</label>
          <input type="number" id="mezcla-canales" min="1" placeholder="Ej: 24">
        </div>
        <div class="service-field">
          <label for="mezcla-duracion">${t.mezcla_duracion_label}</label>
          <input type="text" id="mezcla-duracion" placeholder="Ej: 3:30">
        </div>
      </div>
      <button class="service-btn" type="button" data-action="quote-mezcla">${t.svc_cta_quote}</button>
    </div>
  `;

  const distribucionCard = `
    <div class="service-card">
      <div class="service-top">
        <div class="service-name">${t.svc.distro.name}</div>
      </div>
      <div class="service-desc">${t.svc.distro.desc}</div>
      <div class="service-price">${t.svc_price_quote}</div>
      <div class="service-form">
        <div class="service-field">
          <label for="distro-canciones">${t.distro_canciones_label}</label>
          <input type="number" id="distro-canciones" min="1" placeholder="Ej: 5">
        </div>
        <div class="service-field">
          <label for="distro-estrenadas">${t.distro_estrenadas_label}</label>
          <select id="distro-estrenadas">
            <option value="">${t.select_choose}</option>
            <option value="Sí">${t.yes}</option>
            <option value="No">${t.no}</option>
          </select>
        </div>
        <div class="service-field">
          <label for="distro-migrando">${t.distro_migrando_label}</label>
          <select id="distro-migrando">
            <option value="">${t.select_choose}</option>
            <option value="Sí">${t.yes}</option>
            <option value="No">${t.no}</option>
          </select>
        </div>
        <div class="service-field" id="distro-motivo-wrap" style="display:none;">
          <label for="distro-motivo">${t.distro_motivo_label}</label>
          <textarea id="distro-motivo" placeholder="${t.distro_motivo_placeholder}"></textarea>
        </div>
      </div>
      <button class="service-btn" type="button" data-action="quote-distro">${t.svc_cta_quote}</button>
    </div>
  `;

  const playbackCard = `
    <div class="service-card">
      <div class="service-top">
        <div class="service-name">${t.svc.playback.name}</div>
      </div>
      <div class="service-desc">${t.svc.playback.desc}</div>
      <div class="service-price">${t.svc_price_quote}</div>
      <button class="service-btn" type="button" data-action="quote-playback">${t.svc_cta_consult}</button>
    </div>
  `;

  servicesGrid.innerHTML = fixedCards + mezclaCard + distribucionCard + playbackCard;
  renderBeatList();
}

// Un solo listener delegado en el contenedor: como el HTML de adentro se
// vuelve a generar cada vez que cambia el idioma, delegar evita tener
// que reenganchar listeners sueltos (y evita que queden duplicados).
servicesGrid.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "reserve-fixed") {
    const s = SERVICES[+btn.dataset.index];
    // Instrumental de catálogo: si hay lista de beats, hay que elegir
    // uno para que el nombre viaje en el mensaje.
    if (s.key === "instrumental_catalogo" && BEAT_CATALOG.beats.length) {
      if (!selectedBeat) {
        setBeatPanelOpen(true);
        document.getElementById("beat-hint").classList.add("is-visible");
        return;
      }
      window.open(waLink(`Hola! Quiero reservar el beat "${selectedBeat}" del catálogo (${s.name}, ${s.price}).`), "_blank", "noopener");
      return;
    }
    window.open(waLink(`Hola! Quiero reservar: ${s.name} (${s.price}).`), "_blank", "noopener");
  } else if (action === "toggle-beats") {
    setBeatPanelOpen(!beatPanelOpen);
    if (beatPanelOpen) document.getElementById("beat-search").focus();
  } else if (action === "toggle-beat-list") {
    beatListOpen = !beatListOpen;
    renderBeatList();
  } else if (action === "pick-beat") {
    pickBeat(+btn.dataset.index);
  } else if (action === "quote-mezcla") {
    const canales = document.getElementById("mezcla-canales")?.value || "sin especificar";
    const duracion = document.getElementById("mezcla-duracion")?.value || "sin especificar";
    const msg = `Hola! Quiero cotizar una Mezcla.\nCantidad de canales: ${canales}\nDuración de la canción: ${duracion}`;
    window.open(waLink(msg), "_blank", "noopener");
  } else if (action === "quote-distro") {
    const canciones = document.getElementById("distro-canciones")?.value || "sin especificar";
    const estrenadas = document.getElementById("distro-estrenadas")?.value || "sin especificar";
    const migrando = document.getElementById("distro-migrando")?.value || "sin especificar";
    const motivo = document.getElementById("distro-motivo")?.value;
    let msg = `Hola! Quiero cotizar Distribución.\nCantidad de canciones: ${canciones}\n¿Ya se habían estrenado?: ${estrenadas}\n¿Migrando de otra distribuidora?: ${migrando}`;
    if (migrando === "Sí" && motivo) msg += `\nMotivo del cambio: ${motivo}`;
    window.open(waLink(msg), "_blank", "noopener");
  } else if (action === "quote-playback") {
    window.open(waLink("Hola! Quiero consultar sobre Playback y Tune."), "_blank", "noopener");
  }
});

// Buscador de beats — filtra la lista mientras se escribe.
servicesGrid.addEventListener("input", (event) => {
  if (event.target.id === "beat-search") renderBeatList();
});

// Enter elige la primera sugerencia; Escape cierra la lista.
servicesGrid.addEventListener("keydown", (event) => {
  if (event.target.id !== "beat-search") return;
  if (event.key === "Enter") {
    event.preventDefault();
    const first = searchBeats(event.target.value)[0];
    if (first && (beatListOpen || normText(event.target.value))) pickBeat(first.i);
  } else if (event.key === "Escape") {
    beatListOpen = false;
    event.target.value = "";
    renderBeatList();
  }
});

// Distribución — muestra el campo "motivo" solo si está migrando
// (delegado también, por la misma razón que arriba).
servicesGrid.addEventListener("change", (event) => {
  if (event.target.id === "distro-migrando") {
    const wrap = document.getElementById("distro-motivo-wrap");
    if (wrap) wrap.style.display = event.target.value === "Sí" ? "block" : "none";
  }
});

// ---------- Packages: Armá tu paquete / Single / EP-Álbum ----------
const customListEl = document.getElementById("custom-service-list");
const customToggleBtn = document.getElementById("custom-toggle-btn");
const customHintEl = document.getElementById("custom-hint");

customToggleBtn.addEventListener("click", () => {
  const willShow = customListEl.hasAttribute("hidden");
  if (willShow) customListEl.removeAttribute("hidden");
  else customListEl.setAttribute("hidden", "");
});

// Cantidad elegida de cada servicio (mismo orden que SERVICES). Se guarda
// acá para que no se pierda al cambiar de idioma.
const customQty = SERVICES.map(() => 0);
const CUSTOM_QTY_MAX = 20;
// Beats del catálogo elegidos dentro del pack personalizado: como mucho
// tantos como "Instrumental de catálogo" se hayan sumado.
const CUSTOM_BEAT_INDEX = SERVICES.findIndex((sv) => sv.key === "instrumental_catalogo");
let customBeats = [];

function renderCustomBeats() {
  const box = document.getElementById("custom-beats");
  if (!box) return;
  const t = I18N[currentLang];
  const limit = customQty[CUSTOM_BEAT_INDEX] || 0;
  customBeats = customBeats.filter((name) => BEAT_CATALOG.beats.includes(name)).slice(0, limit);
  box.toggleAttribute("hidden", !limit || !BEAT_CATALOG.beats.length);
  if (!limit) { box.innerHTML = ""; return; }
  const full = customBeats.length >= limit;
  const viewLink = BEAT_CATALOG.url
    ? `<a class="package-beats-link" href="${escHtml(BEAT_CATALOG.url)}" target="_blank" rel="noopener">${t.beat_view_catalog}</a>`
    : "";
  box.innerHTML = `
    <div class="package-beats-head">
      <span>${t.custom_beats_label} <b>${customBeats.length} / ${limit}</b></span>
      ${viewLink}
    </div>
    <div class="beat-list">
      ${BEAT_CATALOG.beats.map((name, k) => {
        const on = customBeats.includes(name);
        return `<button type="button" class="beat-item custom-beat-item${on ? " is-active" : ""}" data-beat="${k}" aria-pressed="${on}"${!on && full ? " disabled" : ""}>${escHtml(name)}</button>`;
      }).join("")}
    </div>`;
}

function renderCustomChecklist() {
  const t = I18N[currentLang];
  customListEl.innerHTML = SERVICES.map((s, i) => `
    <div class="package-qty-row${customQty[i] ? " is-picked" : ""}" data-index="${i}">
      <div class="package-qty-info">
        <span>${t.svc[s.key].name}</span>
        <span class="pc-price">${s.price}</span>
      </div>
      <div class="package-qty" role="group" aria-label="${t.svc[s.key].name}">
        <button type="button" class="package-qty-btn" data-step="-1" aria-label="−"${customQty[i] ? "" : " disabled"}>−</button>
        <output class="package-qty-value" aria-live="polite">${customQty[i]}</output>
        <button type="button" class="package-qty-btn" data-step="1" aria-label="+"${customQty[i] >= CUSTOM_QTY_MAX ? " disabled" : ""}>+</button>
      </div>
    </div>${i === CUSTOM_BEAT_INDEX ? '<div class="package-beats" id="custom-beats" hidden></div>' : ""}
  `).join("");
  renderCustomBeats();
}

customListEl.addEventListener("click", (event) => {
  const beatBtn = event.target.closest(".custom-beat-item");
  if (beatBtn) {
    const name = BEAT_CATALOG.beats[+beatBtn.dataset.beat];
    if (customBeats.includes(name)) customBeats = customBeats.filter((n) => n !== name);
    else if (customBeats.length < customQty[CUSTOM_BEAT_INDEX]) customBeats.push(name);
    renderCustomBeats();
    return;
  }
  const btn = event.target.closest(".package-qty-btn");
  if (!btn) return;
  const row = btn.closest(".package-qty-row");
  const i = +row.dataset.index;
  customQty[i] = Math.max(0, Math.min(CUSTOM_QTY_MAX, customQty[i] + (+btn.dataset.step)));
  row.classList.toggle("is-picked", customQty[i] > 0);
  row.querySelector(".package-qty-value").textContent = customQty[i];
  row.querySelector('[data-step="-1"]').disabled = customQty[i] === 0;
  row.querySelector('[data-step="1"]').disabled = customQty[i] >= CUSTOM_QTY_MAX;
  if (i === CUSTOM_BEAT_INDEX) renderCustomBeats();
  if (customQty.some(Boolean)) customHintEl.classList.remove("is-visible");
});

document.getElementById("custom-quote-btn").addEventListener("click", () => {
  const picked = SERVICES.map((sv, i) => ({ name: sv.name, qty: customQty[i], i })).filter((x) => x.qty > 0);
  if (!picked.length) {
    customHintEl.classList.add("is-visible");
    if (customListEl.hasAttribute("hidden")) customListEl.removeAttribute("hidden");
    return;
  }
  customHintEl.classList.remove("is-visible");
  const lines = picked.map((x) => {
    const beats = x.i === CUSTOM_BEAT_INDEX && customBeats.length ? ` (beats: ${customBeats.join(", ")})` : "";
    return `- ${x.qty} × ${x.name}${beats}`;
  });
  const msg = `Hola! Quiero armar un paquete con estos servicios:\n${lines.join("\n")}\n\n¿Me pasás una cotización?`;
  window.open(waLink(msg), "_blank", "noopener");
});

// Extras opcionales de los packs (video y portada). El precio base es
// el mismo que el del servicio individual (ver SERVICES) y cada pack le
// aplica su propio descuento: Single sin descuento, EP 35%, Álbum 40%.
const ADDONS = {
  video: { price: 160000, label: "Video" },
  cover: { price: 45000, label: "Portada" },
};
const PACK_DISCOUNT = { single: 0, ep: 0.35, album: 0.40 };
const SINGLE_PRICE = 400000;

const fmtARS = (n) => "$" + Math.round(n).toLocaleString("es-AR");
// Precios redondeados a mano: pisan el cálculo por porcentaje.
const ADDON_PRICE_OVERRIDE = {
  single: { video: 130000, cover: 40000 },
  ep: { video: 120000, cover: 30000 },
  album: { video: 100000, cover: 30000 },
};
const addonPrice = (key, pack) =>
  ADDON_PRICE_OVERRIDE[pack]?.[key] ?? ADDONS[key].price * (1 - (PACK_DISCOUNT[pack] || 0));

// Devuelve los extras tildados de un pack, con su precio ya descontado,
// y de paso actualiza el precio que se ve al lado de cada checkbox.
// En Álbum la portada queda bonificada si además se suma el video
// (la portada sola se cobra con el descuento normal).
function readAddons(containerEl, pack) {
  const t = I18N[currentLang];
  const picked = [];
  const withVideo = !!containerEl.querySelector('input[data-addon="video"]')?.checked;
  containerEl.querySelectorAll("input[data-addon]").forEach((input) => {
    const key = input.dataset.addon;
    const free = pack === "album" && key === "cover" && withVideo;
    const price = free ? 0 : addonPrice(key, pack);
    const priceEl = input.closest(".package-check-row").querySelector(".pc-price");
    // Sin formato elegido (EP / Álbum) todavía no se muestra ningún precio.
    if (!pack) priceEl.innerHTML = "";
    else if (free) priceEl.innerHTML = `<s>${fmtARS(ADDONS[key].price)}</s>${t.pkg_addon_free}`;
    else if (price < ADDONS[key].price) priceEl.innerHTML = `<s>${fmtARS(ADDONS[key].price)}</s>+${fmtARS(price)}`;
    else priceEl.innerHTML = `+${fmtARS(price)}`;
    if (input.checked) picked.push({ label: ADDONS[key].label, price });
  });
  return picked;
}
const addonsTotal = (picked) => picked.reduce((sum, a) => sum + a.price, 0);
const addonsText = (picked) => picked.map(a => `${a.label} (${a.price ? "+" + fmtARS(a.price) : "bonificada"})`).join(", ");

// Single — reserva directa, precio fijo (+ extras si los suma)
const singlePriceEl = document.getElementById("single-price");
const singleAddonsEl = document.getElementById("single-addons");

function renderSingle() {
  const t = I18N[currentLang];
  const total = SINGLE_PRICE + addonsTotal(readAddons(singleAddonsEl, "single"));
  singlePriceEl.innerHTML = `${fmtARS(total)} <span>${t.pkg_currency}</span>`;
}
singleAddonsEl.addEventListener("change", renderSingle);

document.getElementById("single-quote-btn").addEventListener("click", () => {
  const picked = readAddons(singleAddonsEl, "single");
  let msg = `Hola! Quiero reservar el pack Single (${fmtARS(SINGLE_PRICE)} ARS).`;
  if (picked.length) {
    msg += `\nExtras: ${addonsText(picked)}\nTotal: ${fmtARS(SINGLE_PRICE + addonsTotal(picked))} ARS`;
  }
  window.open(waLink(msg), "_blank", "noopener");
});

// EP / Álbum — el precio es fijo por formato (no depende de la cantidad
// de canciones, esa cantidad solo viaja como dato en el mensaje), pero
// es una MENSUALIDAD: se cobra ese monto cada mes (con sus 4 sesiones)
// hasta terminar el proyecto — no se muestra ningún formato por
// defecto, el precio solo aparece una vez que el cliente elige EP o
// Álbum, para no dar la impresión de un precio único ya elegido.
const EPALBUM = {
  ep: { price: "$370.000", saveKey: "pkg_ep_save", placeholder: "Ej: 5", label: "EP" },
  album: { price: "$350.000", saveKey: "pkg_album_save", placeholder: "Ej: 10", label: "Álbum" },
};
let epalbumFormat = null; // null hasta que el cliente elige EP o Álbum
// Mínimos de canciones: un EP lleva al menos 3 y un Álbum al menos 8.
const EP_MIN_SONGS = 3;
const ALBUM_MIN_SONGS = 8;
let epalbumSongsNote = null; // key de I18N del popup de rangos (EP 3-7 / Álbum 8+)
let epalbumPopupTimer = null;

const epBtn = document.getElementById("ep-btn");
const albumBtn = document.getElementById("album-btn");
const epalbumPriceEl = document.getElementById("epalbum-price");
const epalbumSaveEl = document.getElementById("epalbum-save");
const epalbumSongsInput = document.getElementById("epalbum-songs");
const epalbumHintEl = document.getElementById("epalbum-hint");
const epalbumExtrasEl = document.getElementById("epalbum-extras");
const epalbumAddonsEl = document.getElementById("epalbum-addons");
const epalbumPopupEl = document.getElementById("epalbum-songs-popup");

// El formato lo define la cantidad de canciones: de 3 a 7 es un EP y
// de 8 en adelante un Álbum. Se respeta el número que escribió la
// persona y lo que se ajusta es la selección de formato; menos de 3 no
// se permite (sube a 3). El popup explica los rangos cuando el ajuste
// pisa algo que la persona había elegido.
function enforceSongLimits() {
  let n = parseInt(epalbumSongsInput.value, 10);
  epalbumSongsNote = null;
  if (Number.isNaN(n)) return;
  if (n < EP_MIN_SONGS) {
    n = EP_MIN_SONGS;
    epalbumSongsInput.value = n;
    epalbumSongsNote = "pkg_range_min";
  }
  const format = n >= ALBUM_MIN_SONGS ? "album" : "ep";
  if (epalbumFormat && epalbumFormat !== format) {
    epalbumSongsNote = format === "ep" ? "pkg_range_to_ep" : "pkg_range_to_album";
  }
  epalbumFormat = format;
  epalbumHintEl.classList.remove("is-visible");
  if (epalbumSongsNote) {
    clearTimeout(epalbumPopupTimer);
    epalbumPopupTimer = setTimeout(closeSongsPopup, 7000);
  }
}

function closeSongsPopup() {
  clearTimeout(epalbumPopupTimer);
  epalbumSongsNote = null;
  epalbumPopupEl.hidden = true;
}
epalbumPopupEl.addEventListener("click", closeSongsPopup);

function renderEpAlbum() {
  const t = I18N[currentLang];
  epBtn.classList.toggle("is-active", epalbumFormat === "ep");
  albumBtn.classList.toggle("is-active", epalbumFormat === "album");

  epalbumPopupEl.innerHTML = epalbumSongsNote ? `${t[epalbumSongsNote]}<b>${t.pkg_range_legend_html}</b>` : "";
  epalbumPopupEl.hidden = !epalbumSongsNote;

  // Video y portada no se pueden sumar hasta elegir EP o Álbum.
  epalbumAddonsEl.querySelectorAll("input[data-addon]").forEach((input) => {
    input.disabled = !epalbumFormat;
    if (!epalbumFormat) input.checked = false;
  });

  // Los extras (video / portada) se pagan una sola vez, aparte de la
  // mensualidad, con el descuento del formato elegido.
  const picked = readAddons(epalbumAddonsEl, epalbumFormat);
  epalbumExtrasEl.textContent = epalbumFormat && picked.length
    ? `+ ${fmtARS(addonsTotal(picked))} ${t.pkg_currency} · ${t.pkg_addons_once}`
    : "";

  if (!epalbumFormat) {
    epalbumPriceEl.innerHTML = `<span class="package-price-placeholder">${t.pkg_epalbum_choose_hint}</span>`;
    epalbumSaveEl.textContent = "";
    epalbumSongsInput.placeholder = "Ej: 5";
    return;
  }

  const cfg = EPALBUM[epalbumFormat];
  epalbumPriceEl.innerHTML = `<span>${cfg.price}</span> <span>${t.pkg_currency_monthly}</span>`;
  epalbumSaveEl.textContent = t[cfg.saveKey];
  epalbumSongsInput.placeholder = cfg.placeholder;
}

epalbumAddonsEl.addEventListener("change", renderEpAlbum);
// Si tocan un extra sin haber elegido formato, se les avisa que falta.
epalbumAddonsEl.addEventListener("click", () => {
  if (!epalbumFormat) epalbumHintEl.classList.add("is-visible");
});

epBtn.addEventListener("click", () => {
  epalbumFormat = "ep";
  epalbumHintEl.classList.remove("is-visible");
  enforceSongLimits();
  renderEpAlbum();
});
albumBtn.addEventListener("click", () => {
  epalbumFormat = "album";
  epalbumHintEl.classList.remove("is-visible");
  enforceSongLimits();
  renderEpAlbum();
});
// Se valida al terminar de escribir (no en cada tecla, para poder
// tipear "10" sin que el "1" cambie el formato).
epalbumSongsInput.addEventListener("change", () => {
  enforceSongLimits();
  renderEpAlbum();
});

document.getElementById("epalbum-quote-btn").addEventListener("click", () => {
  if (!epalbumFormat) {
    epalbumHintEl.classList.add("is-visible");
    return;
  }
  enforceSongLimits();
  // La cantidad de canciones es obligatoria: hace falta para el contrato.
  if (!epalbumSongsInput.value) {
    epalbumSongsNote = "pkg_songs_required";
    clearTimeout(epalbumPopupTimer);
    epalbumPopupTimer = setTimeout(closeSongsPopup, 7000);
    renderEpAlbum();
    epalbumSongsInput.focus();
    return;
  }
  renderEpAlbum();
  const cfg = EPALBUM[epalbumFormat];
  const songs = epalbumSongsInput.value;
  let msg = `Hola! Quiero cotizar un ${cfg.label} (${cfg.price} ARS por mes, hasta terminar el proyecto).\nCantidad de canciones: ${songs}`;
  const picked = readAddons(epalbumAddonsEl, epalbumFormat);
  if (picked.length) {
    msg += `\nExtras (pago único, con descuento de pack): ${addonsText(picked)}\nTotal extras: ${fmtARS(addonsTotal(picked))} ARS`;
  }
  window.open(waLink(msg), "_blank", "noopener");
});

// ---------- Sonido de los videos de shows / open mic ----------
// Arrancan muteados. El botón activa el audio de un solo video a la
// vez: al activar uno, el otro se silencia y queda así hasta que lo
// vuelvan a activar a mano.
const eventVideos = Array.from(document.querySelectorAll(".event-video video"));

function renderEventVideoSound() {
  const t = I18N[currentLang];
  eventVideos.forEach((v) => {
    const btn = v.parentElement.querySelector(".event-video-sound");
    btn.setAttribute("aria-pressed", !v.muted);
    btn.setAttribute("aria-label", v.muted ? t.video_sound_on : t.video_sound_off);
  });
}

eventVideos.forEach((v) => {
  v.parentElement.querySelector(".event-video-sound").addEventListener("click", () => {
    v.muted = !v.muted;
    if (!v.muted) v.play().catch(() => {});
  });
  // También cubre el caso de que el audio se active desde los
  // controles nativos del video.
  v.addEventListener("volumechange", () => {
    if (!v.muted) eventVideos.forEach((o) => { if (o !== v) o.muted = true; });
    renderEventVideoSound();
  });
});

// ---------- Traducción de la página ----------
// No se traducen nombres de artistas, canciones ni productores (viven
// en ARTISTS / .card-name / .card-meta / .credits, fuera de este
// diccionario). Los mensajes de WhatsApp quedan siempre en español,
// para que el sello pueda leer cualquier consulta sin importar en qué
// idioma haya estado viendo la página quien escribe.
const SUPPORTED_LANGS = ["es", "en", "pt", "fr", "it", "de", "ru"];
let currentLang = "es";

// Español viene con la página; los demás idiomas están en
// assets/i18n/<idioma>.json y se bajan solo cuando hacen falta.
const I18N = {
  es: {
    // --- Textos web 2026-09 ---
    meta_title: "ZECHE GRUV — Sello Discográfico Independiente",
    meta_desc: "Sello Discográfico independiente y productora. Desarrollo artístico integral, composición, grabación, producción, mezcla, mastering, distribución, portada y video, sesión a sesión, con Yaco Santana.",
    nav_about: "Nosotros",
    nav_session: "La sesión",
    nav_artists: "Artistas",
    nav_releases: "Lanzamientos",
    nav_camps: "Camps",
    nav_opps: "Oportunidades",
    nav_events: "Shows y open mic",
    nav_pass: "ZG PASS · Conseguí tu entrada",
    nav_tickets: "Entradas",
    next_event_label: "Próxima fecha",
    tickets_cta: "Conseguí tu entrada",
    nav_services: "Servicios",
    nav_memberships: "Desarrollo artístico",
    nav_individual: "Servicios individuales",
    nav_beats: "Catálogo de beats",
    custom_beats_label: "Elegí tus beats",
    nav_contact: "Contacto",
    hero_title: "Encontrá tu ADN sonoro.",
    hero_desc_html: "Sello Discográfico independiente y productora. Desarrollo artístico integral, composición, grabación, producción, mezcla, mastering, distribución, portada y video, sesión a sesión, con <a href=\"https://open.spotify.com/intl-es/artist/0yIGrWjWqKnM7qJ0uyImij\" target=\"_blank\" rel=\"noopener\">Yaco Santana</a>.",
    hero_cta_primary: "Vení a conocer el estudio ↗",
    visit_eyebrow: "Visita al estudio",
    visit_title: "Vení a conocer el estudio",
    visit_intro: "Contanos quién sos y en el siguiente paso elegís día y horario.",
    visit_name: "Nombre artístico",
    visit_phone: "Teléfono (WhatsApp)",
    visit_email: "Mail",
    visit_ig: "Instagram",
    visit_reason: "Motivo de la visita",
    visit_news: "Quiero recibir novedades de ZECHE GRUV por mail.",
    visit_submit: "Continuar y elegir horario ↗",
    visit_sending: "Enviando…",
    hero_cta_secondary: "Escuchá el sello",
    sl_label: "Quiénes somos",
    st_label_html: "Un estudio que<br>se siente casa.",
    label_intro_html: "ZECHE GRUV nació en una habitación. Para hacer lugar, el colchón iba parado contra la pared y, de paso, servía de aislante. No era el estudio más profesional del mundo, pero se grababa igual, con lo que había y muchas ganas. Hoy somos un sello independiente con créditos en más de 35 canciones publicadas, y por el estudio ya pasaron más de 200 artistas.",
    label_side: "<p>Lo que no cambió es la forma de trabajar: no venimos a cambiar tu idea, venimos a traducirla. Si algo está fuera de tiempo, lo acomodamos para que suene como lo escuchás en tu cabeza. Buscamos el equilibrio entre lo orgánico, lo experimental y una vuelta que haga que tu canción llegue a más gente.</p><p>Acá hay plantas, luces cálidas, desayuno o merienda. Y no vivimos corriendo contra el reloj: si estamos cerca de la toma perfecta, nos tomamos unos minutos más para encontrarla.</p>",
    label_director_role: "Fundador y director",
    label_director_bio: "<p>Yaco Santana nació en Brasil y creció viajando por Latinoamérica, entre tambores y las canciones que le cantaba su madre. Se formó en el conservatorio, estudió Producción Musical en la Escuela de Música de Buenos Aires y profundizó su aprendizaje de manera autodidacta. Tras varios años en otros trabajos, decidió dedicarse por completo a la música, y hoy vive de ella.</p><p>Su formación y su escucha van del clásico al folclore y del trap al metal; de ahí su afinidad por las fusiones poco convencionales. Acompaña personalmente cada sesión, desde la primera idea hasta el lanzamiento.</p>",
    sl_session: "Cómo es una sesión",
    st_session_html: "Tu canción,<br>sesión a sesión.",
    session_intro: "Una vez por semana, dos horas, un tema por mes. Sin apuro, con dirección.",
    session_week_1: "Semana 1",
    session_week_2: "Semana 2",
    session_week_3: "Semana 3",
    session_week_4: "Semana 4",
    session_step1_title: "La charla y el beat",
    session_step1_text: "Escuchamos tus referencias, hablamos de lo que querés contar y arrancamos la base.",
    session_step2_title: "La letra y la melodía",
    session_step2_text: "Trabajamos juntos las ideas. Si ya las tenés, las pulimos.",
    session_step3_title: "La grabación",
    session_step3_text: "Te acompaño en cada toma: sacar más la voz, ponerle aire, encontrar el flow.",
    session_step4_title: "La forma final",
    session_step4_text: "Arreglos, detalles y la canción lista para mezcla y mastering.",
    session_outro: "Después viene la distribución y, si querés, el video.",
    session_photo_soon: "Foto próximamente",
    sl_testimonials: "Lo que dicen los artistas",
    st_testimonials_html: "Lo que dicen<br>los artistas.",
    testimonials_intro: "Reseñas reales de Google. Pronto, las historias completas.",
    sl_artists: "Artistas",
    st_artists_html: "Los<br>artistas.",
    sl_releases: "Lanzamientos",
    st_releases_html: "Lo último<br>que salió.",
    sl_catalogue: "Catálogo",
    st_catalogue_html: "Lanzamientos<br>elegidos.",
    sl_full_catalogue: "Catálogo completo",
    st_full_catalogue_html: "Todo el<br>catálogo.",
    sl_camps: "Camps y eventos",
    st_camps_html: "Nos juntamos<br>a crear.",
    st_events_html: "El escenario<br>es tuyo.",
    camp_eyebrow: "Camp",
    camp_title: "ZECHE GRUV Campamento Creativo",
    camp_text: "Nos vamos unos días a crear juntos: varios estudios, artistas de todos lados y música a toda hora. Estamos armando la próxima fecha; muy pronto vas a poder anotarte acá.",
    camp_lineup_label: "Algunos de los artistas del primer camp",
    camp_press_label: "Prensa",
    camp_food_label: "Comida japonesa, cortesía de",
    camp_hair_label: "Cortes de pelo",
    camp_video_1: "La juntada",
    camp_video_2: "Así se vive el camp",
    camp_video_3: "Se come rico",
    events_eyebrow: "Eventos",
    events_title: "Shows y open mics",
    events_shows_label: "Shows anteriores",
    events_openmic_label: "Open mic · algunos de los que se presentaron",
    events_text: "El open mic es nuestra forma de escuchar nuevos talentos. Es el espacio que desde ZECHE GRUV les damos a los artistas que trabajan con nosotros para que se expresen, y una puerta abierta para los que todavía no nos conocen: vení, conectate y mostrá lo que hacés. Si cantás en el open mic, podés ser parte del próximo show.",
    sl_services: "Servicios y valores",
    st_services_html: "Elegí cómo<br>querés arrancar.",
    services_intro: "Trabajamos por proyecto porque las canciones necesitan tiempo.",
    pkg_custom_subtitle: "Armá tu proyecto a medida",
    pkg_custom_cta: "Armemos tu plan ↗",
    pkg_cta_reserve: "Quiero arrancar ↗",
    pkg_cta_quote: "Hagamos tu disco ↗",
    svc_cta_reserve: "Quiero arrancar ↗",
    svc_cta_quote: "Contanos tu idea ↗",
    pkg_single_desc: "Tu canción de punta a punta, en cuatro sesiones: la creamos, la grabamos, la mezclamos, la masterizamos y la subimos a todas las plataformas.",
    pkg_epalbum_desc: "Para quienes quieren construir algo más grande. Elegí EP o álbum, contanos cuántos temas y armamos el camino juntos.",
    includes_title: "Todo proyecto incluye:",
    includes_1: "4 sesiones de 2 horas, una por semana",
    includes_2: "Mezcla y mastering",
    includes_3: "Distribución a todas las plataformas (pitch a playlists editoriales únicamente incluido en PROYECTO)",
    includes_4: "Pistas para tus shows en vivo, entregadas con el máster entre 7 y 15 días después de grabar las voces finales",
    includes_5: "Seguimiento por WhatsApp entre sesión y sesión",
    includes_6: "Backup en la nube de tus proyectos",
    includes_7: "Desayuno o merienda en cada sesión",
    sl_contact: "Contacto",
    contact_title_html: "MAKE<br><span>NOISE.</span>",
    contact_intro: "¿Tenés algo para decir y no sabés cómo querés que suene? Escribinos. La primera visita al estudio es para conocernos.",
    btn_demo: "Mandá tu demo ↗",
    // --- Resto ---
    hero_eyebrow: "Sello Discográfico Independiente",
    hero_scroll: "Scroll para explorar",
    label_studio_title: "Un vistazo al estudio",
    release_out_now: "YA DISPONIBLE", release_copy_html: "ENY B. Producido por ZECHE GRUV.",
    full_catalogue_intro: "Cargando desde Spotify…",
    full_catalogue_error: "No pudimos cargar el catálogo ahora — mirá todo en Spotify ↗",
    btn_spotify: "Spotify ↗", btn_instagram: "Instagram ↗", btn_playlist: "Playlist ↗",
    spotify_bar_label: "Preview", footer_rights: "TODOS LOS DERECHOS RESERVADOS", footer_portal: "ACCESO ARTISTAS",
    pkg_custom_name: "🧩 PERSONALIZADO", 
    pkg_custom_desc: "¿Ya sabés qué necesitás? Elegí los servicios que quieras combinar de la lista y te armamos una cotización a medida, directo por WhatsApp.",
    pkg_custom_toggle_btn: "Elegir servicios", 
    pkg_custom_empty_hint: "Elegí al menos un servicio para cotizar.",
    pkg_single_name: "💿 SINGLE",
    pkg_epalbum_name: "📀 PROYECTO", pkg_ep_label: "EP", pkg_album_label: "Álbum",
    pkg_ep_save: "Ahorrás +35% vs. contratar todo por separado.",
    pkg_album_save: "Ahorrás +40% vs. contratar todo por separado.",
    pkg_songs_label: "Cantidad de canciones",
    pkg_epalbum_choose_hint: "Elegí un formato para ver el precio",
    pkg_range_min: "El mínimo para un proyecto son 3 canciones.",
    pkg_songs_required: "Contanos cuántas canciones va a tener tu proyecto: lo necesitamos para armar el contrato antes de comenzar.",
    pkg_range_to_ep: "Con menos de 8 canciones, tu proyecto es un EP.",
    pkg_range_to_album: "Con 8 canciones o más, tenés un <strong>40% de descuento</strong>.",
    pkg_range_legend_html: "EP: 3 a 7 canciones<br>Álbum: 8 o más",
    video_sound_on: "Activar sonido", video_sound_off: "Silenciar",
    pkg_currency: "ARS", pkg_currency_monthly: "ARS / mes",
    pkg_addon_video: "Video", pkg_addon_cover: "Portada", pkg_addons_once: "pago único", pkg_addon_free: "Bonificada",
    beat_view_catalog: "Ver catálogo ↗", beat_pick_btn: "Elegir beat", beat_search_placeholder: "Buscá el beat por nombre…",
    beat_none: "No encontramos un beat con ese nombre.", beat_pick_hint: "Elegí un beat del catálogo para reservarlo.", beat_selected: "Beat elegido:", beat_show_all: "Ver todos los beats",
    alacarte_title: "¿Preferís armar todo por tu cuenta? Elegí servicios sueltos:",
    svc_cta_consult: "Consultar por WhatsApp ↗", svc_price_quote: "Consultar presupuesto",
    mezcla_canales_label: "Cantidad de canales", mezcla_duracion_label: "Duración de la canción (min:seg)",
    distro_canciones_label: "Cantidad de canciones a distribuir",
    distro_estrenadas_label: "¿Ya se habían estrenado antes?",
    distro_migrando_label: "¿Estás migrando de otra distribuidora?",
    distro_motivo_label: "¿Por qué buscás cambiar de distribuidora?",
    distro_motivo_placeholder: "Contanos brevemente...", select_choose: "Elegir...", yes: "Sí", no: "No",
    lang_aria: "Idioma",
    svc: {
      session: { name: "Hora de sesión de grabación", desc: "Una hora de estudio con ingeniero en sala, espacio acustizado para grabar voces y/o instrumentos. Ideal si ya tenés el tema armado y necesitás capturarlo con calidad y asistencia profesional." },
      mastering: { name: "Mastering", desc: "El último paso antes de publicar: balanceamos niveles, dinámica y sonoridad para que tu canción suene pareja y competitiva en cualquier plataforma." },
      mixtering: { name: "Mixtering (mezcla por stems, hasta 8 stems)", desc: "Mezclamos tu canción de hasta 8 stems, ideal si ya tenés una buena producción avanzada y buscás una mezcla y master rápidos y prolijos sin pasar por el proceso completo y ahorrando +40%." },
      instrumental_catalogo: { name: "Instrumental de catálogo", desc: "Elegís una base ya compuesta de nuestro catálogo y la hacemos tuya, lista para grabar tus voces encima." },
      instrumental_personalizada: { name: "Instrumental personalizada (4 revisiones)", desc: "Componemos una base desde cero según tu estilo y referencias, con hasta 4 rondas de ajustes hasta que quede como la imaginás." },
      coverart: { name: "Portada / Coverart", desc: "Diseño de arte de tapa para tu single, EP o álbum, pensado para que se destaque tanto en Spotify como en redes." },
      videoclip: { name: "Videoclip (grabación y edición)", desc: "Grabación y edición de un videoclip para tu canción, de punta a punta — desde el rodaje hasta el corte final listo para publicar." },
      videolyrics: { name: "VideoLyrics", desc: "Video con letras animadas sincronizadas a tu canción, una opción más accesible para tener contenido audiovisual en redes y YouTube." },
      session_musicians: { name: "Grabación de guitarras / bajo / batería / coros", desc: "Sumamos músicos de sesión para grabar sobre tu tema, con el instrumento y la sala ya preparados." },
      mezcla: { name: "Mezcla", desc: "Mezcla profesional de tu canción; el precio varía según la cantidad de canales y la duración del tema — lo cotizás completando esos datos." },
      distro: { name: "Distribución a todas las plataformas", desc: "Subimos tu música a Spotify, Apple Music, YouTube Music y el resto de las plataformas." },
      playback: { name: "Playback y Tune", desc: "No es solo armar la pista de playback: el día de tu show, estamos ahí con vos. Te entregamos las pistas listas y hacemos el tune en tiempo real, en vivo, acompañando cada matiz de tu interpretación arriba del escenario. Es el estándar ZECHE GRUV para shows en directo: cero baches, cero sustos, sonido con nivel de gira profesional de punta a punta." },
    },
  },
};
// ---------- Idioma inicial ----------
// 1) Si la persona ya eligió un idioma a mano en el selector, se respeta.
// 2) Si no, se usa el país desde donde entra (lo informa Netlify, así que
//    funciona también con VPN): países hispanohablantes → español,
//    Brasil/Portugal → portugués, etc. Cualquier otro país → inglés.
// 3) Si no se puede saber el país (ej. probando en la compu), se usa el
//    idioma del navegador, y si no está entre los 7, español.
const COUNTRY_LANG = {
  es: "AR UY PY CL BO PE EC CO VE PA CR NI HN SV GT MX CU DO PR ES GQ",
  pt: "BR PT AO MZ CV GW ST TL",
  fr: "FR BE LU MC SN CI ML BF NE TG BJ GN CD CG GA CM MG HT TN MA DZ",
  it: "IT SM VA",
  de: "DE AT CH LI",
  ru: "RU BY KZ KG",
};
function langForCountry(code) {
  if (!code) return null;
  code = String(code).toUpperCase();
  for (const [lang, list] of Object.entries(COUNTRY_LANG)) {
    if (list.split(" ").includes(code)) return lang;
  }
  return "en";
}

function savedLang() {
  try {
    const saved = localStorage.getItem("zg_lang");
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) {}
  return null;
}

function browserLang() {
  const nav = ((navigator.language || "es").slice(0, 2) || "es").toLowerCase();
  return SUPPORTED_LANGS.includes(nav) ? nav : "es";
}

function detectInitialLang() {
  return savedLang() || browserLang();
}

// Baja (una sola vez) el archivo de un idioma y después lo aplica.
const langLoads = {};
function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = "es";
  if (I18N[lang]) return applyLanguage(lang);
  if (!langLoads[lang]) {
    langLoads[lang] = fetch(`assets/i18n/${lang}.json?v=__BUILD__`)
      .then((res) => { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then((dict) => { I18N[lang] = dict; })
      .catch(() => { delete langLoads[lang]; });
  }
  langLoads[lang].then(() => { if (I18N[lang]) applyLanguage(lang); });
}

function applyLanguage(lang) {
  if (!I18N[lang]) lang = "es";
  currentLang = lang;
  document.documentElement.lang = lang;
  if (I18N[lang].meta_title) document.title = I18N[lang].meta_title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && I18N[lang].meta_desc) metaDesc.setAttribute("content", I18N[lang].meta_desc);

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const val = I18N[lang][el.getAttribute("data-i18n")];
    if (val !== undefined) el.textContent = val;
  });

  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const val = I18N[lang][el.getAttribute("data-i18n-html")];
    if (val !== undefined) el.innerHTML = val;
  });

  // Contenido armado por JS: hay que volver a generarlo para que
  // tome el texto del nuevo idioma.
  renderServiceCards();
  renderCustomChecklist();
  renderSingle();
  renderEpAlbum();
  renderEventVideoSound();

  langSelect.value = lang;
}

const langSelect = document.getElementById("langSelect");
langSelect.setAttribute("aria-label", "Language / Idioma");
// Solo se guarda el idioma cuando la persona lo elige a mano.
langSelect.addEventListener("change", () => {
  setLanguage(langSelect.value);
  try { localStorage.setItem("zg_lang", langSelect.value); } catch (e) {}
});

applyLanguage("es");
if (detectInitialLang() !== "es") setLanguage(detectInitialLang());

if (!savedLang()) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), 2500);
  fetch("/.netlify/functions/geo", { signal: ctrl ? ctrl.signal : undefined, cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const lang = langForCountry(data && data.country);
      if (lang && lang !== currentLang && !savedLang()) setLanguage(lang);
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

// ---------- Catálogo completo (discografía + "aparece en") ----------
// Se pide a /.netlify/functions/spotify-catalog en cada carga de la
// página — así se mantiene al día solo mientras el sitio esté online,
// sin tocar código para sumar un lanzamiento nuevo. Si la function
// todavía no está desplegada (o falla), se muestra un aviso con link
// directo a Spotify en vez de dejar la sección vacía o rota.
(function () {
  const grid = document.getElementById("fullCatalogueGrid");
  const status = document.getElementById("fullCatalogueStatus");
  if (!grid || !status) return;

  fetch("/.netlify/functions/spotify-catalog")
    .then((res) => {
      if (!res.ok) throw new Error("bad response");
      return res.json();
    })
    .then(({ items }) => {
      if (!items || !items.length) throw new Error("empty");

      grid.innerHTML = items.map((item) => `
        <a href="${item.url}" target="_blank" rel="noopener" class="release-card"
           data-spotify-uri="spotify:${item.type === "track" ? "track" : "album"}:${item.id}" data-spotify-name="${item.name}">
          <div class="release-art"><img src="${item.cover || ""}" alt="${item.name} — cover art" loading="lazy" decoding="async"></div>
          <div class="card-info">
            <div class="card-name">${item.name}</div>
            <div class="card-meta">${item.artists}${item.appearsOn ? " · Aparece en" : ""}</div>
          </div>
        </a>
      `).join("");

      document.querySelectorAll("#fullCatalogueGrid [data-spotify-uri]").forEach((el) => {
        el.addEventListener("click", (event) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openSpotifyPreview(el.dataset.spotifyUri, el.dataset.spotifyName);
        });
      });

      status.remove();
    })
    .catch(() => {
      status.removeAttribute("data-i18n");
      status.textContent = I18N[currentLang].full_catalogue_error;
      const link = document.createElement("a");
      link.href = "https://open.spotify.com/intl-es/artist/0yIGrWjWqKnM7qJ0uyImij";
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "btn";
      link.style.marginTop = "16px";
      link.style.display = "inline-block";
      link.textContent = I18N[currentLang].btn_spotify;
      status.after(link);
    });
})();

// ---------- Spotify preview (a pedido del usuario, sin autoplay) ----------
// Antes se abría y reproducía solo con el hover. Ahora un click abre la
// barra con el track/álbum cargado pero pausado — el usuario le da play
// desde los controles del propio reproductor embebido de Spotify.
(function () {
  const bar = document.getElementById("spotify-bar");
  const mount = document.getElementById("spotify-bar-mount");
  const label = document.getElementById("spotify-bar-label");
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

  function openPreview(uri, name) {
    bar.classList.add("active");
    label.textContent = name || I18N[currentLang].spotify_bar_label;
    pendingUri = uri;

    if (controller) {
      controller.loadUri(uri);
      return;
    }
    if (!creating) {
      creating = true;
      if (apiReady) createNow();
      else if (!document.getElementById("spotify-api")) {
        // El reproductor de Spotify se baja recién la primera vez que
        // alguien toca un tema, no en cada visita.
        const tag = document.createElement("script");
        tag.id = "spotify-api";
        tag.src = "https://open.spotify.com/embed/iframe-api/v1";
        tag.async = true;
        document.head.append(tag);
      }
    }
  }

  // Expuesto para contenido armado dinámicamente después de esta carga
  // (ej. el catálogo completo, que llega por fetch) — así reusa la
  // misma barra/controller en vez de duplicar la lógica.
  window.openSpotifyPreview = openPreview;

  document.querySelectorAll("[data-spotify-uri]").forEach((el) => {
    el.addEventListener("click", (event) => {
      // Click simple sin modificadores: abrimos la vista previa acá
      // mismo. Con ctrl/cmd/shift o click del medio, dejamos que el
      // link se comporte normal (abrir Spotify en pestaña nueva).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openPreview(el.dataset.spotifyUri, el.dataset.spotifyName);
    });
  });

  closeBtn.addEventListener("click", () => {
    bar.classList.remove("active");
    if (controller) controller.pause();
  });
})();
  
;
// ---------- Logo: pausar animaciones fuera de pantalla ----------
(function () {
  const logo = document.getElementById("zgLogo");
  if (!logo || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => {
    logo.classList.toggle("zg-paused", !entry.isIntersecting);
  }).observe(logo);
})();

// ---------- Navbar ----------
const nav = document.getElementById("nav");

window.addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", window.scrollY > 40);
}, { passive: true });

// ---------- Menú hamburguesa (mobile) ----------
(function () {
  const hamburger = document.getElementById("navHamburger");
  const navRight = document.querySelector(".nav-right");
  if (!hamburger || !navRight) return;

  function closeMenu() {
    navRight.classList.remove("is-open");
    hamburger.setAttribute("aria-expanded", "false");
  }

  hamburger.addEventListener("click", () => {
    const willOpen = !navRight.classList.contains("is-open");
    navRight.classList.toggle("is-open", willOpen);
    hamburger.setAttribute("aria-expanded", String(willOpen));
  });

  // Al elegir una sección o cerrar el select de idioma, se cierra solo.
  navRight.querySelectorAll(".nav-links a").forEach((a) => {
    a.addEventListener("click", closeMenu);
  });
})();

// ---------- Menús desplegables del nav (Oportunidades, Servicios) ----------
(function () {
  const drops = Array.from(document.querySelectorAll(".nav-drop"));
  if (!drops.length) return;

  function setOpen(drop, open) {
    drop.classList.toggle("is-open", open);
    drop.querySelector(".nav-drop-btn").setAttribute("aria-expanded", String(open));
  }
  const closeAll = (except) => drops.forEach((d) => { if (d !== except) setOpen(d, false); });

  drops.forEach((drop) => {
    drop.querySelector(".nav-drop-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      closeAll(drop);
      setOpen(drop, !drop.classList.contains("is-open"));
    });
    drop.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(drop, false)));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-drop")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
})();

// ---------- Visita al estudio: formulario y agenda ----------
// Link de la agenda (Calendly / Cal.com). Mientras esté vacío, al enviar
// el formulario se abre WhatsApp con los datos cargados, para no perder
// la consulta.
const VISIT_BOOKING_URL = "";

(function () {
  const modal = document.getElementById("visitModal");
  const form = document.getElementById("visitForm");
  if (!modal || !form) return;
  const submitBtn = document.getElementById("visitSubmit");
  let lastFocus = null;

  function openVisit() {
    lastFocus = document.activeElement;
    document.getElementById("visitLang").value = document.documentElement.lang || "es";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => form.elements.nombre_artistico.focus(), 60);
  }

  function closeVisit() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.querySelectorAll("[data-visit-open]").forEach((el) => {
    el.addEventListener("click", (event) => { event.preventDefault(); openVisit(); });
  });
  document.getElementById("visitClose").addEventListener("click", closeVisit);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeVisit(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) closeVisit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const t = I18N[document.documentElement.lang] || I18N.es;
    const data = new FormData(form);
    submitBtn.disabled = true;
    submitBtn.textContent = t.visit_sending;

    // Guarda los datos (Netlify Forms). Si falla o tarda, igual se sigue
    // a la agenda: no se le traba el turno a nadie por un error de red.
    try {
      await Promise.race([
        fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(data).toString(),
        }),
        new Promise((resolve) => setTimeout(resolve, 6000)),
      ]);
    } catch (e) {}

    if (VISIT_BOOKING_URL) {
      window.location.href = VISIT_BOOKING_URL;
      return;
    }
    const msg = `Hola ZECHE GRUV! Quiero ir a conocer el estudio 🙌\n`
      + `Nombre artístico: ${data.get("nombre_artistico")}\n`
      + `Teléfono: ${data.get("telefono")}\n`
      + `Mail: ${data.get("email")}\n`
      + `Instagram: ${data.get("instagram") || "-"}\n`
      + `Motivo de la visita: ${data.get("motivo")}`;
    window.location.href = `https://wa.me/5491133287422?text=${encodeURIComponent(msg)}`;
  });

  // Si la persona vuelve atrás desde la agenda, el botón queda usable.
  window.addEventListener("pageshow", () => {
    submitBtn.disabled = false;
    submitBtn.textContent = (I18N[document.documentElement.lang] || I18N.es).visit_submit;
  });
})();

// ---------- Sol chico del nav ----------
// Aparece exactamente cuando el sol grande del hero sale del viewport,
// y desaparece apenas vuelve a entrar — así nunca se ven los dos a la vez.
(function () {
  const bigSun = document.querySelector(".zg-sun");
  const navSun = document.getElementById("navSun");
  if (!bigSun || !navSun) return;

  const observer = new IntersectionObserver(([entry]) => {
    navSun.classList.toggle("is-visible", !entry.isIntersecting);
  }, { threshold: 0 });

  observer.observe(bigSun);
})();

// ---------- Custom cursor + logo parallax ----------
// Un solo listener de mousemove que guarda la posición y actualiza todo
// (cursor + parallax del logo) una sola vez por frame con rAF, en vez de
// escribir estilos en cada evento crudo del mouse (que puede dispararse
// muchas más veces por segundo de las que la pantalla puede pintar).
// Además solo se toca `transform`, que el navegador puede animar en el
// compositor sin recalcular layout — esto es lo que sacaba el lag del
// scroll y las animaciones al mover el mouse.
const cursor = document.querySelector(".cursor");
const logo = document.querySelector(".hero-logo-wrap");

let zgMouseX = window.innerWidth / 2;
let zgMouseY = window.innerHeight / 2;
let zgPointerRaf = null;

function zgApplyPointerEffects() {
  zgPointerRaf = null;
  cursor.style.transform = `translate3d(${zgMouseX}px, ${zgMouseY}px, 0) translate(-50%, -50%)`;

  if (window.innerWidth >= 800) {
    const x = (zgMouseX / window.innerWidth - .5) * 8;
    const y = (zgMouseY / window.innerHeight - .5) * 8;
    logo.style.transform = `translate(${x}px, ${y}px)`;
  }
}

window.addEventListener("mousemove", (event) => {
  zgMouseX = event.clientX;
  zgMouseY = event.clientY;
  if (zgPointerRaf === null) {
    zgPointerRaf = requestAnimationFrame(zgApplyPointerEffects);
  }
}, { passive: true });

document.querySelectorAll("a").forEach(link => {
  link.addEventListener("mouseenter", () => {
    cursor.style.width = "32px";
    cursor.style.height = "32px";
  });

  link.addEventListener("mouseleave", () => {
    cursor.style.width = "14px";
    cursor.style.height = "14px";
  });
});

// ---------- Logo: controles de pausa / velocidad ----------
// El texto ya no lleva distorsión animada (se sacó porque generaba un
// "salto" de píxeles poco prolijo). Se deja solo la pausa global y el
// control de velocidad del sol, por si se quieren usar en otro lado.
(function () {
  const zgWrapper = document.getElementById("zgLogo");
  if (!zgWrapper) return;

  let zgPaused = false;

  // Ejemplo: llamar window.zgSetPaused(true) desde cualquier lado del
  // sitio (ej. un botón de "reducir movimiento") para pausar el logo.
  window.zgSetPaused = function (next) {
    zgPaused = !!next;
    zgWrapper.classList.toggle("is-paused", zgPaused);
  };

  // Ejemplo: window.zgSetSpeed(1.5) acelera la rotación del sol 1.5x
  // (la duración por defecto es 26s a velocidad 1x).
  window.zgSetSpeed = function (multiplier) {
    zgWrapper.style.setProperty("--zg-sun-duration", (26 / multiplier) + "s");
  };
})();
  
;
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  // Fondo: resplandor cálido que se mueve según la sección visible.
  const ambient = document.createElement("div");
  ambient.className = "ambient";
  ambient.setAttribute("aria-hidden", "true");
  document.body.prepend(ambient);

  const GLOW = {
    label: ["20%", "25%", .55], session: ["85%", "35%", .8], testimonials: ["15%", "70%", .7],
    artists: ["75%", "20%", .75], releases: ["30%", "40%", .8], catalogue: ["70%", "60%", .6],
    "full-catalogue": ["20%", "80%", .6], camps: ["80%", "50%", .5], services: ["25%", "30%", .75],
    contact: ["60%", "55%", 1],
  };

  if (!("IntersectionObserver" in window)) return;
  root.classList.add("js-motion");

  // Aparición de textos y tarjetas (con un pequeño escalonado en grillas).
  const sel = [
    ".section-label", ".section-title", ".section-intro", ".label-text", ".label-photo", ".label-side",
    ".label-director", ".label-studio", ".session-card", ".session-outro", ".testimonial-card",
    ".artist-card", ".release", ".release-card", ".camp-copy", ".camp-media > *",
    ".package-card", ".includes-block", ".services-alacarte-title", ".contact-title",
    ".contact-intro", ".contact .buttons",
  ].join(",");
  const items = Array.from(document.querySelectorAll("main, body")[0].querySelectorAll(sel))
    .filter((el) => !el.closest(".hero"));
  items.forEach((el) => {
    el.classList.add("reveal");
    const parent = el.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((c) => c.matches(sel)) : [];
    const i = siblings.indexOf(el);
    if (siblings.length > 2 && i > 0) el.style.setProperty("--reveal-delay", Math.min(i % 8, 6) * 0.07 + "s");
  });

  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const el = e.target;
        el.classList.add("is-visible");
        revealIO.unobserve(el);
        // Al terminar, se limpia para que los hovers de siempre sigan andando.
        const delay = parseFloat(el.style.getPropertyValue("--reveal-delay")) || 0;
        setTimeout(() => el.classList.remove("reveal", "is-visible"), 1000 + delay * 1000);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  items.forEach((el) => revealIO.observe(el));

  // Cards armadas después por JS (servicios sueltos, catálogo completo).
  const lateMO = new MutationObserver((muts) => {
    muts.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      [n, ...n.querySelectorAll(sel + ",.service-card")].forEach((el) => {
        if (!(el.matches && (el.matches(sel) || el.matches(".service-card"))) || el.classList.contains("reveal")) return;
        el.classList.add("reveal"); revealIO.observe(el);
      });
    }));
  });
  ["services-grid", "fullCatalogueGrid", "artists-grid"].forEach((id) => {
    const g = document.getElementById(id); if (g) lateMO.observe(g, { childList: true });
  });
  document.querySelectorAll("#services-grid > *, #fullCatalogueGrid > *").forEach((el) => {
    if (!el.classList.contains("reveal")) { el.classList.add("reveal"); revealIO.observe(el); }
  });

  // Secciones oscuras que se "encienden" al entrar, y resplandor por sección.
  const sections = Array.from(document.querySelectorAll("section[id]"));
  const sectionIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.target.matches(".label-section, .camps-section")) e.target.classList.toggle("is-lit", e.isIntersecting);
      if (e.isIntersecting) {
        const g = GLOW[e.target.id];
        if (g) {
          root.style.setProperty("--glow-x", g[0]);
          root.style.setProperty("--glow-y", g[1]);
          ambient.style.opacity = g[2];
        }
      }
    });
  }, { rootMargin: "-35% 0px -35% 0px" });
  sections.forEach((s) => sectionIO.observe(s));

  // Fotos del camp: efecto de acercamiento que sigue al mouse.
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 801px)");
  [
    [".camp-media-4", "img", 0.3, 1.35],
    [".session-grid", ".session-card", 0.07, 1.1],
  ].forEach(([rowSel, itemSel, amount, reach]) => document.querySelectorAll(rowSel).forEach((row) => {
    const imgs = Array.from(row.querySelectorAll(itemSel));
    let raf = null, lastX = 0;
    function update() {
      raf = null;
      imgs.forEach((img) => {
        const r = img.getBoundingClientRect();
        const center = r.left + r.width / 2;
        const dist = Math.abs(lastX - center) / (r.width * reach);
        const t = Math.max(0, 1 - dist);
        const e = t * t * (3 - 2 * t); // suavizado
        img.style.setProperty("--s", (1 + amount * e).toFixed(3));
        img.style.setProperty("--lift", e.toFixed(3));
        img.style.setProperty("--b", (0.8 + 0.2 * e).toFixed(3));
        img.style.zIndex = String(Math.round(e * 10));
      });
    }
    row.addEventListener("pointermove", (ev) => {
      if (reduce || !canHover.matches || ev.pointerType !== "mouse") return;
      lastX = ev.clientX;
      if (!raf) raf = requestAnimationFrame(update);
    });
    row.addEventListener("pointerleave", () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      imgs.forEach((img) => {
        ["--s", "--lift", "--b"].forEach((p) => img.style.removeProperty(p));
        img.style.zIndex = "";
      });
    });
  }));

  // Portada: la foto se desvanece y se acerca apenas al bajar.
  if (reduce) return;
  const hero = document.querySelector(".hero");
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const h = hero ? hero.offsetHeight : window.innerHeight;
      const p = Math.min(1, Math.max(0, window.scrollY / h));
      root.style.setProperty("--hero-p", p.toFixed(3));
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
  
;
(function () {
  const imgs = Array.from(document.querySelectorAll(".camp-media-4 img"));
  if (!imgs.length) return;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = `
    <div class="lightbox-track">${imgs.map((img) => `
      <div class="lightbox-slide"><img src="${img.getAttribute("src").replace("-600.webp", ".webp")}" alt="${img.alt}" loading="lazy" decoding="async"></div>`).join("")}
    </div>
    <button class="lightbox-btn lightbox-close" type="button" aria-label="Cerrar">✕</button>
    <button class="lightbox-btn lightbox-prev" type="button" aria-label="Anterior">←</button>
    <button class="lightbox-btn lightbox-next" type="button" aria-label="Siguiente">→</button>
    <div class="lightbox-count"></div>`;
  document.body.appendChild(box);
  const track = box.querySelector(".lightbox-track");
  const count = box.querySelector(".lightbox-count");
  let current = 0, lastFocus = null;

  function go(i, smooth = true) {
    current = (i + imgs.length) % imgs.length;
    track.scrollTo({ left: current * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    count.textContent = `${current + 1} / ${imgs.length}`;
  }
  function open(i) {
    lastFocus = document.activeElement;
    box.classList.add("is-open");
    box.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => go(i, false));
    box.querySelector(".lightbox-close").focus({ preventScroll: true });
  }
  function close() {
    box.classList.remove("is-open");
    box.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  imgs.forEach((img, i) => {
    img.setAttribute("tabindex", "0");
    img.addEventListener("click", () => open(i));
    img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); } });
  });
  box.querySelector(".lightbox-close").addEventListener("click", close);
  box.querySelector(".lightbox-prev").addEventListener("click", () => go(current - 1));
  box.querySelector(".lightbox-next").addEventListener("click", () => go(current + 1));
  box.addEventListener("click", (e) => { if (e.target.classList.contains("lightbox-slide")) close(); });
  document.addEventListener("keydown", (e) => {
    if (!box.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") go(current + 1);
    if (e.key === "ArrowLeft") go(current - 1);
  });
  let t = null;
  track.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      current = Math.round(track.scrollLeft / track.clientWidth);
      count.textContent = `${current + 1} / ${imgs.length}`;
    }, 80);
  }, { passive: true });
})();
  
;
// Si se llega con un ancla en la dirección (por ejemplo desde el portal
// de artistas a #memberships), se vuelve a ubicar la sección cuando la
// página terminó de cargar: varias grillas se arman por JS y corren el
// contenido después del salto inicial del navegador.
window.addEventListener("load", () => {
  const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
});
  
;
// Videos del camp: entran en abanico, se mueven apenas con el scroll y
// se reproducen solo mientras se ven (sin audio, salvo que se active
// a mano en los de shows; al salir de pantalla vuelven a silenciarse).
(() => {
  const stage = document.querySelector(".camp-videos");
  if (!stage) return;
  const cards = Array.from(stage.querySelectorAll(".camp-video"));
  const vids = cards.map((c) => c.querySelector("video"))
    .concat(Array.from(document.querySelectorAll(".events-videos video")));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    vids.forEach((v) => { v.controls = true; });
    return;
  }

  // En el celu el carrusel arranca centrado en el compilado.
  const main = stage.querySelector(".camp-video-main");
  const center = () => {
    if (stage.scrollWidth > stage.clientWidth + 4) {
      stage.scrollLeft = main.offsetLeft - (stage.clientWidth - main.offsetWidth) / 2;
    }
  };
  center();
  window.addEventListener("load", center, { once: true });
  window.matchMedia("(max-width: 800px)").addEventListener("change", () => requestAnimationFrame(center));

  // Entrada.
  stage.classList.add("is-armed");
  const enterIO = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    stage.classList.add("is-in");
    setTimeout(() => stage.classList.add("is-settled"), 1300);
    enterIO.disconnect();
  }, { threshold: 0.2 });
  enterIO.observe(stage);

  // Reproducción + barrita de progreso.
  const playing = new Set();
  let raf = null;
  function tick() {
    playing.forEach((v) => {
      if (v.duration) v.parentElement.style.setProperty("--prog", (v.currentTime / v.duration).toFixed(4));
    });
    raf = playing.size ? requestAnimationFrame(tick) : null;
  }
  const playIO = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) { target.play().catch(() => {}); playing.add(target); }
      else { target.pause(); target.muted = true; playing.delete(target); }
    });
    if (playing.size && !raf) raf = requestAnimationFrame(tick);
  }, { threshold: 0.6 });
  vids.forEach((v) => playIO.observe(v));

  // Parallax suave: los laterales y el central se cruzan al scrollear.
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const r = stage.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.bottom < -100 || r.top > vh + 100) return;
      const p = ((r.top + r.height / 2) - vh / 2) / vh;
      stage.style.setProperty("--p", Math.max(-1, Math.min(1, p)).toFixed(3));
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
  
;
(() => {
  const TZ = "America/Argentina/Buenos_Aires";
  const clean = (t) => t.replace(/[.,]/g, "");
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const fmtDate = (iso) => cap(clean(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))));
  const fmtTime = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) + " h";

  fetch("/.netlify/functions/pass-events")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const ev = data && (data.events || []).find((e) => e.on_sale || e.sold_out);
      if (!ev) return;
      const url = `/pass/?e=${encodeURIComponent(ev.slug)}`;
      if (window.ZGPass) window.ZGPass.eventSchema(ev);
      const when = `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`;

      // Tarjeta "Próxima fecha"
      const card = document.getElementById("nextEvent");
      document.getElementById("nextEventName").textContent = ev.name;
      document.getElementById("nextEventMeta").textContent = [when, ev.venue_name].filter(Boolean).join(" · ");
      const lineup = document.getElementById("nextEventLineup");
      lineup.replaceChildren(...(ev.lineup || []).map((n) => { const b = document.createElement("b"); b.textContent = n; return b; }));
      lineup.hidden = !(ev.lineup || []).length;
      document.getElementById("nextEventText").textContent = ev.description || "";
      const btn = document.getElementById("nextEventBtn");
      btn.href = url;
      const note = document.getElementById("nextEventNote");
      if (ev.sold_out) note.textContent = "Agotado";
      else if (ev.few_left) note.textContent = `¡Últimas ${ev.few_left}!`;
      card.hidden = false;

      if (ev.sold_out) return;
      const cta = document.querySelector(".promo-cta [data-i18n]").textContent;

      // En la portada, un botón más al lado de los otros dos.
      const heroButtons = document.querySelector(".hero-buttons");
      if (heroButtons) {
        const heroBtn = document.createElement("a");
        heroBtn.className = "btn hero-ticket";
        heroBtn.href = url;
        heroBtn.textContent = `${cta} · ${fmtDate(ev.starts_at)}`;
        heroButtons.append(heroBtn);
      }

      // Franja fija arriba de todo.
      const bar = document.getElementById("promoBar");
      bar.href = url;
      document.getElementById("promoWhen").textContent = when;
      document.getElementById("promoVenue").textContent = ev.venue_name || "";
      document.getElementById("promoName").textContent = ev.name;
      document.getElementById("promoLineup").textContent = (ev.lineup || []).join(" · ");
      bar.hidden = false;
      document.body.classList.add("has-promo");
    })
    .catch(() => {});
})();
  