// ZECHE GRUV — Portal: deslizar de costado para pasar de una pestaña a otra.
// En el celu con el dedo y en la compu con dos dedos en el trackpad. Vale
// para el menú que esté a la vista:
//   - administrador mirando a un artista: Mi proyecto · Canciones · Archivos ·
//     Distribución · Admin (vista-artista.js)
//   - portal del artista: su menú (artista.js)
//   - panel de administrador: Inicio · Artistas · ZG PASS · Distribución · Mi perfil
// Hacia la izquierda va a la pestaña siguiente; hacia la derecha, a la
// anterior. Mientras se desliza, el contenido acompaña el dedo un poco y,
// al soltar, la pestaña nueva entra desde ese costado. No se activa sobre
// cosas que ya se deslizan solas (tablas anchas, menús en pastillas, el
// reproductor de la mezcla), en campos de texto ni con un diálogo abierto.
// Con "reducir movimiento" activado cambia de pestaña sin animación.
(() => {
  const P = window.ZGPortal;
  const body = document.body;
  const main = document.getElementById("view-app");
  if (!main) return;
  const ADMIN = ["home", "artists", "pass", "releases", "me"];
  const ARTIST = ["proyecto", "canciones", "archivos", "escena", "invitar", "distribucion", "perfil"];
  // Paneles donde no se cambia de pestaña deslizando (se está escribiendo).
  const STILL = ["panel-lyric", "panel-release"];
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Qué menú está a la vista ----------
  function context() {
    if (window.ZGArtistView && window.ZGArtistView.on) {
      return { list: window.ZGArtistView.tabs, cur: window.ZGArtistView.tab, go: (t) => window.ZGArtistView.go(t), self: true };
    }
    if (body.classList.contains("is-artist")) {
      const list = ARTIST.filter((t) => { const b = document.querySelector(`#artistTabs [data-atab="${t}"]`); return b && !b.hidden; });
      return { list, cur: body.dataset.atab || "proyecto", go: (t) => window.ZGArtistNav.go(t) };
    }
    if (body.classList.contains("is-admin")) {
      const act = document.querySelector("#tabs .tab.is-active");
      return { list: ADMIN, cur: act ? act.dataset.tab : "home", go: (t) => P.openTab(t) };
    }
    return null;
  }

  function step(dir) {
    const c = context();
    if (!c || !c.list.length) return false;
    const i = c.list.indexOf(c.cur);
    const next = c.list[(i < 0 ? 0 : i) + dir];
    if (!next) { bump(dir); return false; }
    // El menú nuevo entra desde arriba: se sube de una (queda tapado por la
    // animación de entrada) en vez de recorrer la página nueva hacia arriba.
    window.scrollTo({ top: 0, behavior: "instant" });
    c.go(next);
    if (!c.self) slide(dir); // la vista del artista ya lo anima sola
    return true;
  }

  // ---------- Animaciones ----------
  const visiblePanel = () => [...main.children].find((n) => n.id && n.id.startsWith("panel-") && !n.hidden) || null;
  // La pestaña nueva entra desde el costado hacia donde se deslizó.
  function slide(dir) {
    if (reduced()) return;
    requestAnimationFrame(() => {
      const panel = visiblePanel();
      if (!panel) return;
      panel.classList.remove("zg-swap-next", "zg-swap-prev");
      void panel.offsetWidth;
      panel.classList.add(dir > 0 ? "zg-swap-next" : "zg-swap-prev");
      panel.addEventListener("animationend", () => panel.classList.remove("zg-swap-next", "zg-swap-prev"), { once: true });
    });
  }
  // En la primera o la última pestaña: un rebote corto, para que se sienta el borde.
  function bump(dir) {
    if (reduced()) return;
    const panel = visiblePanel();
    if (!panel) return;
    panel.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dir > 0 ? -14 : 14}px)` }, { transform: "translateX(0)" }], { duration: 360, easing: "cubic-bezier(.23, 1, .32, 1)" });
  }

  // ---------- ¿Este gesto es para cambiar de pestaña? ----------
  function blocked(target) {
    if (!body.classList.contains("is-admin") && !body.classList.contains("is-artist")) return true;
    if (document.querySelector("dialog[open]") || document.querySelector(".rv:not([hidden])")) return true;
    const panel = visiblePanel();
    if (!panel || STILL.includes(panel.id)) return true;
    if (!(target instanceof Element)) return false;
    if (target.closest("input, textarea, select, [contenteditable], [role='slider'], audio, video, .rv, .zg-fab, .zg-select-list")) return true;
    // Algo que ya se desliza de costado por su cuenta (tablas, menús en pastillas).
    for (let n = target; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 2) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
    }
    return false;
  }

  // ---------- Dedo (celu y tablet) ----------
  let t0 = null; // { x, y, at, panel, live }
  const THRESHOLD = 70;
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || blocked(e.target)) { t0 = null; return; }
    const t = e.touches[0];
    t0 = { x: t.clientX, y: t.clientY, at: performance.now(), panel: visiblePanel(), live: false, dead: false };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!t0 || t0.dead) return;
    const t = e.touches[0];
    const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    if (!t0.live) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { t0.dead = true; return; } // está scrolleando
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) t0.live = true;
      else return;
    }
    // El contenido acompaña el dedo, con resistencia.
    if (t0.panel && !reduced()) {
      const pull = Math.sign(dx) * Math.min(56, Math.abs(dx) * 0.22);
      t0.panel.style.transition = "none";
      t0.panel.style.transform = `translateX(${pull}px)`;
      t0.panel.style.opacity = String(1 - Math.min(0.25, Math.abs(dx) / 900));
    }
  }, { passive: true });

  function release(panel) {
    if (!panel) return;
    panel.style.transition = "transform 320ms cubic-bezier(.23, 1, .32, 1), opacity 240ms ease";
    panel.style.transform = "";
    panel.style.opacity = "";
    setTimeout(() => { panel.style.transition = ""; }, 340);
  }

  document.addEventListener("touchend", (e) => {
    if (!t0) return;
    const s = t0; t0 = null;
    if (!s.live) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    const fast = Math.abs(dx) > 40 && performance.now() - s.at < 260; // un toque rápido también vale
    const ok = (Math.abs(dx) > THRESHOLD || fast) && Math.abs(dx) > Math.abs(dy) * 1.4;
    if (ok) {
      if (s.panel) { s.panel.style.transition = "none"; s.panel.style.transform = ""; s.panel.style.opacity = ""; }
      if (!step(dx < 0 ? 1 : -1)) release(s.panel);
    } else release(s.panel);
  }, { passive: true });
  document.addEventListener("touchcancel", () => { if (t0) release(t0.panel); t0 = null; }, { passive: true });

  // ---------- Trackpad (dos dedos de costado) ----------
  // Se suma el movimiento horizontal de un mismo gesto; al pasar el umbral
  // cambia una sola vez y espera a que termine la inercia del trackpad.
  let acc = 0, last = 0, lockUntil = 0;
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return; // zoom con pellizco
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2 || Math.abs(e.deltaX) < 1) return;
    if (blocked(e.target)) return;
    e.preventDefault(); // que el navegador no lo tome como "atrás / adelante"
    const now = performance.now();
    if (now < lockUntil) { lockUntil = now + 220; return; } // inercia del mismo gesto
    if (now - last > 180) acc = 0;
    last = now;
    acc += e.deltaX;
    if (Math.abs(acc) > 110) {
      step(acc > 0 ? 1 : -1);
      acc = 0;
      lockUntil = now + 650;
    }
  }, { passive: false });

  window.ZGSwipe = { slide, step };
})();
