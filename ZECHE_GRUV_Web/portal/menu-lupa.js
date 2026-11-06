// ZECHE GRUV — Portal: deslizar el dedo por el menú para ir pasando de página.
// Mantenés apretado sobre el menú (en la compu: apretás y arrastrás) y aparece
// una lente de vidrio que sigue el dedo: se estira con la velocidad, se
// acomoda al tamaño de cada pestaña y la página va cambiando a la que queda
// abajo. Al soltar, la lente se mete en la pestaña elegida.
// Vale para los tres menús: panel de administrador (#tabs), portal del
// artista (#artistTabs) y el administrador mirando a un artista (#viewTabs).
// Un toque normal sigue funcionando igual. Con "reducir movimiento" no hay
// estiramiento ni rebote, solo la lente.
(() => {
  const HOSTS = "#tabs, #artistTabs, #viewTabs";
  const HOLD_MS = 190;     // cuánto mantener el dedo para que arranque (celu)
  const SETTLE_MS = 130;   // cuánto quedarse sobre una pestaña para abrirla
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = (host) => [...host.querySelectorAll("[data-tab], [data-atab], [data-vtab]")]
    .filter((b) => !b.hidden && b.offsetParent !== null && !b.classList.contains("tab-gruvi"));
  const isOn = (b) => b.classList.contains("is-active") || b.getAttribute("aria-selected") === "true";

  let g = null;           // gesto en curso
  let swallowClick = false;

  function begin(e) {
    const host = e.target.closest(HOSTS);
    if (!host || (e.button !== undefined && e.button > 0)) return;
    const list = items(host);
    if (list.length < 2) return;
    g = { host, list, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, on: false, hover: null, opened: null };
    if (e.pointerType !== "mouse") g.timer = setTimeout(() => { if (g && !g.on) activate(); }, HOLD_MS);
  }

  function activate() {
    const { host, list } = g;
    g.on = true;
    g.vertical = getComputedStyle(host).flexDirection.startsWith("column");
    // Mientras se desliza, el menú no se corre solo (al abrir una página el
    // portal centra su pestaña y quedaría otra bajo el dedo).
    g.lockX = host.scrollLeft; g.lockY = host.scrollTop;
    host.classList.add("zg-lens-host", "is-scrubbing");
    const lens = document.createElement("span");
    lens.className = "zg-lens";
    lens.setAttribute("aria-hidden", "true");
    host.prepend(lens);
    g.lens = lens;
    const start = under(g.px, g.py) || list.find(isOn) || list[0];
    const r = rectOf(start);
    g.cur = { ...r };            // lo que se dibuja
    g.vx = 0; g.vy = 0;
    place();
    requestAnimationFrame(() => lens.classList.add("is-in"));
    setHover(start, true);
    if (navigator.vibrate) navigator.vibrate(6);
    g.raf = requestAnimationFrame(loop);
  }

  // Posición de una pestaña dentro del menú (sirve aunque el menú se deslice).
  function rectOf(b, host = g.host) {
    const hr = host.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { x: br.left - hr.left + host.scrollLeft, y: br.top - hr.top + host.scrollTop, w: br.width, h: br.height };
  }

  // La pestaña bajo el dedo (la más cercana sobre el eje del menú).
  function under(x, y) {
    let best = null, d = Infinity;
    for (const b of g.list) {
      const r = b.getBoundingClientRect();
      const c = g.vertical ? Math.abs(y - (r.top + r.height / 2)) : Math.abs(x - (r.left + r.width / 2));
      const inside = g.vertical ? y >= r.top && y <= r.bottom : x >= r.left && x <= r.right;
      if (inside) return b;
      if (c < d) { d = c; best = b; }
    }
    return best;
  }

  function setHover(b, first) {
    if (!b || b === g.hover) return;
    if (g.hover) g.hover.classList.remove("is-lensed");
    g.hover = b;
    b.classList.add("is-lensed");
    if (!first && navigator.vibrate) navigator.vibrate(4);
    clearTimeout(g.nav);
    g.nav = setTimeout(() => open(b), first ? 0 : SETTLE_MS);
  }

  function open(b, st = g) {
    if (!st || !b || st.opened === b) return;
    const from = st.list.findIndex(isOn);
    st.opened = b;
    if (isOn(b)) return;
    b.click();
    enter(st.list.indexOf(b) > from ? 1 : -1);
  }

  // La página nueva entra desde el costado hacia donde va el dedo.
  function enter(dir) {
    if (reduced()) return;
    const main = document.getElementById("view-app");
    if (!main) return;
    requestAnimationFrame(() => {
      const panel = [...main.children].find((n) => n.id && n.id.startsWith("panel-") && !n.hidden);
      if (!panel) return;
      panel.classList.remove("zg-swap-next", "zg-swap-prev");
      void panel.offsetWidth;
      panel.classList.add(dir > 0 ? "zg-swap-next" : "zg-swap-prev");
      panel.addEventListener("animationend", () => panel.classList.remove("zg-swap-next", "zg-swap-prev"), { once: true });
    });
  }

  // Cada cuadro: la lente sigue al dedo con un poco de inercia, toma el tamaño
  // de la pestaña de abajo y se estira según la velocidad.
  function loop() {
    if (!g || !g.on) return;
    if (g.host.scrollLeft !== g.lockX) g.host.scrollLeft = g.lockX;
    if (g.host.scrollTop !== g.lockY) g.host.scrollTop = g.lockY;
    const hr = g.host.getBoundingClientRect();
    const first = rectOf(g.list[0]), last = rectOf(g.list[g.list.length - 1]);
    setHover(under(g.px, g.py));
    const tgt = rectOf(g.hover);
    let cx, cy;
    if (g.vertical) {
      cx = tgt.x; cy = g.py - hr.top + g.host.scrollTop - tgt.h / 2;
      cy = Math.max(first.y - 6, Math.min(last.y + last.h - tgt.h + 6, cy));
    } else {
      cy = tgt.y; cx = g.px - hr.left + g.host.scrollLeft - tgt.w / 2;
      cx = Math.max(first.x - 6, Math.min(last.x + last.w - tgt.w + 6, cx));
      // Menú más ancho que la pantalla: se corre solo cerca de los bordes.
      if (g.host.scrollWidth > g.host.clientWidth + 2) {
        if (g.px < hr.left + 36) g.lockX = Math.max(0, g.lockX - 9);
        else if (g.px > hr.right - 36) g.lockX = Math.min(g.host.scrollWidth - g.host.clientWidth, g.lockX + 9);
      }
    }
    const k = reduced() ? 1 : 0.3;
    const nx = g.cur.x + (cx - g.cur.x) * k, ny = g.cur.y + (cy - g.cur.y) * k;
    g.vx = nx - g.cur.x; g.vy = ny - g.cur.y;
    g.cur.x = nx; g.cur.y = ny;
    g.cur.w += (tgt.w - g.cur.w) * (reduced() ? 1 : 0.25);
    g.cur.h += (tgt.h - g.cur.h) * (reduced() ? 1 : 0.25);
    place();
    g.raf = requestAnimationFrame(loop);
  }

  function place() {
    const v = Math.abs(g.vertical ? g.vy : g.vx);
    const s = reduced() ? 0 : Math.min(v / 40, 0.22);
    const sx = g.vertical ? 1 - s * 0.35 : 1 + s, sy = g.vertical ? 1 + s : 1 - s * 0.35;
    const L = g.lens.style;
    L.width = `${g.cur.w}px`;
    L.height = `${g.cur.h}px`;
    L.transform = `translate3d(${g.cur.x}px, ${g.cur.y}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
  }

  function move(e) {
    if (!g || e.pointerId !== g.id) return;
    g.px = e.clientX; g.py = e.clientY;
    const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (!g.on) {
      if (g.type === "mouse") { if (dist > 6) activate(); }
      else if (dist > 10) { clearTimeout(g.timer); g = null; } // fue un scroll, no un mantener
      return;
    }
    setHover(under(e.clientX, e.clientY));
  }

  function end(e) {
    if (!g || (e && e.pointerId !== g.id)) return;
    clearTimeout(g.timer);
    if (!g.on) { g = null; return; }
    const done = g;
    g = null;
    cancelAnimationFrame(done.raf);
    clearTimeout(done.nav);
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 80);
    const b = done.hover;
    open(b, done); // abre la de abajo si todavía no abrió
    // La lente se mete en la pestaña elegida y se apaga.
    const r = rectOf(b, done.host);
    const lens = done.lens;
    lens.style.width = `${r.w}px`;
    lens.style.height = `${r.h}px`;
    lens.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) scale(1, 1)`;
    lens.classList.add("is-out");
    setTimeout(() => {
      lens.remove();
      done.host.classList.remove("is-scrubbing");
      if (b) b.classList.remove("is-lensed");
      // Ya suelto: la pestaña elegida se centra en el menú (celu).
      if (b && done.host.scrollWidth > done.host.clientWidth + 2) b.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    }, 320);
  }

  document.addEventListener("pointerdown", begin, { passive: true });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerup", end, { passive: true });
  document.addEventListener("pointercancel", (e) => { if (g && g.on) end(e); else if (g) { clearTimeout(g.timer); g = null; } }, { passive: true });
  // Con la lente activa, el dedo no mueve la página ni el menú.
  document.addEventListener("touchmove", (e) => { if (g && g.on) e.preventDefault(); }, { passive: false });
  // El toque que suelta la lente no cuenta como otro clic.
  document.addEventListener("click", (e) => {
    if (swallowClick && e.target.closest && e.target.closest(HOSTS)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Mantener apretado en el celu no abre el menú del sistema sobre el menú.
  document.addEventListener("contextmenu", (e) => { if (g && e.target.closest && e.target.closest(HOSTS)) e.preventDefault(); });
})();
