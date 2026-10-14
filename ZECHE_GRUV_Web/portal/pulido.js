// ZECHE GRUV — Portal: degradé en los bordes de lo que se desliza de costado
// (pestañas en el celu, carpetas, atajos de nota). Marca data-fade="start",
// "end" o "both" según de qué lado queda contenido escondido; pulido.css
// dibuja el degradé. Así se nota que hay más pestañas sin taparlas.
(() => {
  const SEL = ["#tabs", "#artistTabs", "#viewTabs", "#filesNav", "#rvQuick", ".zgp-menu"];
  const watched = new WeakSet();

  function update(el) {
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 2) { delete el.dataset.fade; return; }
    const start = el.scrollLeft > 2, end = el.scrollLeft < max - 2;
    const v = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (v) el.dataset.fade = v; else delete el.dataset.fade;
  }

  function scan() {
    SEL.forEach((s) => document.querySelectorAll(s).forEach((el) => {
      if (!watched.has(el)) {
        watched.add(el);
        el.addEventListener("scroll", () => update(el), { passive: true });
        if (window.ResizeObserver) new ResizeObserver(() => update(el)).observe(el);
      }
      update(el);
    }));
  }

  scan();
  // Menús que aparecen después (la hoja del reproductor, ZG PASS) y cambios de tamaño.
  new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 120); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", scan);
})();
