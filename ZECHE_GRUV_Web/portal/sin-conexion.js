// ZECHE GRUV — Portal de artistas: instalable en el celu y sin conexión.
//
// - Instalar: en Mi proyecto aparece un aviso discreto para sumar el portal
//   a la pantalla de inicio del celu (en Android/Chrome con el botón del
//   navegador; en iPhone, con los pasos de Safari). Se cierra con ✕ y no
//   vuelve a aparecer. Si ya está instalado, no se muestra.
(() => {
  // ---------- Guardado en el dispositivo ----------
  // En modo privado o con el almacenamiento bloqueado, localStorage puede
  // tirar error: todo pasa por acá y, si falla, el portal sigue igual.
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } },
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const P = () => window.ZGPortal || null;
  const isArtist = () => { const p = P(); return !!(p && p.me && p.me.role === "artist"); };

  // ---------- Instalar el portal ----------
  const INSTALL_KEY = "zg-instalar-cerrado";
  const standalone = () => {
    try { if (window.matchMedia("(display-mode: standalone)").matches) return true; } catch (e) { /* nada */ }
    return window.navigator.standalone === true; // iPhone: abierto desde el ícono de inicio
  };
  // iPhone y iPad (los iPad nuevos dicen ser una Mac, pero tienen pantalla táctil).
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  let deferred = null; // el pedido de instalación que guarda Chrome (beforeinstallprompt)

  const SHARE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7 11H5.5v9h13v-9H17"/></svg>';
  const PHONE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/></svg>';
  const X_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

  function hideInstall(animate) {
    const card = document.getElementById("zgInstall");
    if (!card || card.hidden) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { card.hidden = true; return; }
    card.classList.add("is-out");
    setTimeout(() => { card.hidden = true; card.classList.remove("is-out"); }, 220);
  }

  function paintInstall() {
    const card0 = document.getElementById("zgInstall");
    const can = isArtist() && !standalone() && !store.get(INSTALL_KEY) && (deferred || isIOS());
    if (!can) { if (card0) card0.hidden = true; return; }
    const anchor = document.getElementById("projectCards");
    if (!anchor) return;
    const card = card0 || document.createElement("section");
    card.id = "zgInstall";
    card.className = "zgi";
    card.setAttribute("aria-label", "Instalar el portal");
    const ios = !deferred;
    card.innerHTML = `
      <span class="zgi-ico">${PHONE_IC}</span>
      <div class="zgi-text">
        <b>Instalá el portal en tu celu</b>
        ${ios
          ? `<span>Tocá <i class="zgi-share">${SHARE_IC}</i> <b>Compartir</b> y después <b>Agregar a inicio</b>. Lo abrís como una app, también sin señal.</span>`
          : "<span>Lo abrís como una app y escuchás lo que guardes, también sin señal.</span>"}
      </div>
      ${ios ? "" : '<button class="btn btn-primary zgi-btn" type="button" data-install>Instalar</button>'}
      <button class="zgi-x" type="button" data-install-close aria-label="Cerrar aviso de instalación">${X_IC}</button>`;
    card.hidden = false;
    if (!card0) anchor.after(card); // debajo de Mi proyecto: discreto, no tapa el saludo
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sin el cartel propio de Chrome: lo ofrecemos nosotros, en Mi proyecto
    deferred = e;
    paintInstall();
  });
  window.addEventListener("appinstalled", () => { deferred = null; store.set(INSTALL_KEY, 1); hideInstall(true); });

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-install-close]")) {
      store.set(INSTALL_KEY, 1);
      hideInstall(true);
      return;
    }
    if (e.target.closest("[data-install]") && deferred) {
      const ask = deferred;
      deferred = null;
      hideInstall(true);
      try { await ask.prompt(); await ask.userChoice; } catch (err) { /* lo cerró: Chrome vuelve a ofrecerlo más adelante */ }
    }
  });

  // Lo llama portal.js cada vez que entra alguien (enter).
  function ready() {
    paintInstall();
  }

  window.ZGOffline = { ready, store, esc };
})();
