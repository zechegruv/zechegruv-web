// ZECHE GRUV — Panel de administrador: menú del perfil de un artista.
// Cuando el administrador abre el perfil de un artista, arriba aparece un
// menú fijo (Canciones · Carpeta y letras · Datos · Acceso) para saltar a
// cada parte sin recorrer toda la página. Marca solo la parte que se ve.
(() => {
  const P = window.ZGPortal;
  const nav = document.getElementById("profileNav");
  if (!nav) return;
  const ids = [...nav.querySelectorAll("[data-pf]")].map((b) => b.dataset.pf);
  let observer = null;

  function mark(id) {
    nav.querySelectorAll("[data-pf]").forEach((b) => {
      const on = b.dataset.pf === id;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }

  function sync() {
    const me = P.me;
    const panel = document.getElementById("panel-profile");
    const back = document.getElementById("backToArtists");
    // Visible solo para el admin mirando a otro (el botón "Volver a artistas" lo indica).
    const show = !!me && me.role === "admin" && panel && !panel.hidden && back && !back.hidden;
    nav.hidden = !show;
    if (observer) { observer.disconnect(); observer = null; }
    if (!show) return;
    mark(ids[0]);
    observer = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) mark(seen.target.id);
    }, { rootMargin: "-30% 0px -60% 0px" });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pf]");
    if (!b) return;
    const el = document.getElementById(b.dataset.pf);
    if (!el || el.hidden) return;
    const offset = nav.getBoundingClientRect().height + (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--nav-h"), 10) || 0) + 16;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
    mark(b.dataset.pf);
  });

  const panel = document.getElementById("panel-profile");
  const back = document.getElementById("backToArtists");
  const mo = new MutationObserver(sync);
  if (panel) mo.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  if (back) mo.observe(back, { attributes: true, attributeFilter: ["hidden"] });
})();
