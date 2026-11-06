/* Íconos de las secciones (Referencias, Letras, Exports, Masters, Membresía,
   Distribución): objetos del estudio que se mueven al pasar o tocar.
   Un <use href="#ic-…"> no deja animar sus partes (el casete que rebobina,
   el vinilo que gira), así que acá se copia el dibujo adentro de cada svg.
   El <use> queda escondido al lado: si alguien le cambia el href (archivos.js
   lo hace con el ícono del encabezado), se vuelve a copiar solo. */
(() => {
  const SEL = 'svg > use[href^="#ic-"]';

  function paint(use) {
    const href = use.getAttribute("href");
    const sym = href && document.querySelector(href);
    const svg = use.parentNode;
    if (!sym || !svg) return;
    // El ícono del encabezado hace su movimiento una vez cada vez que se abre una sección.
    if (svg.closest(".section-head")) { svg.classList.remove("ic-once"); void svg.getBoundingClientRect(); svg.classList.add("ic-once"); }
    let g = svg.querySelector(":scope > g.ic-live");
    if (g && g.dataset.k === href) return;
    if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "ic-live"); svg.appendChild(g); }
    g.dataset.k = href;
    g.replaceChildren(...[...sym.childNodes].map((n) => n.cloneNode(true)));
    use.style.display = "none";
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SEL)) paint(root);
    root.querySelectorAll(SEL).forEach(paint);
  }

  scan(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") { if (m.target.matches(SEL)) paint(m.target); }
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
})();
