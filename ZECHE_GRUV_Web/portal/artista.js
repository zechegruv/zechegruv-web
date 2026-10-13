// ZECHE GRUV — Portal del artista: menú propio (diseño del preview
// "Rediseño web"). Solo para cuentas de artista; el administrador y el
// equipo de distribución siguen como estaban.
//
// Pestañas: Mi proyecto · Canciones · Archivos · Distribución · Mi perfil.
// Mi proyecto, Canciones, Archivos y Mi perfil son partes del mismo panel
// del perfil: la pestaña elegida queda en <body data-atab="…"> y
// artista.css muestra solo lo de esa pestaña. Así toda la lógica de
// siempre (canciones, carpetas, letras, perfil) sigue igual.
(() => {
  const P = window.ZGPortal;
  const { $ } = P;
  const TABS = ["proyecto", "canciones", "archivos", "distribucion", "perfil"];
  // Panel que se abre -> pestaña que queda marcada.
  const PANEL_TAB = { files: "archivos", lyric: "archivos", releases: "distribucion", release: "distribucion" };

  function mark(tab) {
    document.body.dataset.atab = tab;
    document.querySelectorAll("#artistTabs [data-atab]").forEach((b) => {
      const on = b.dataset.atab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function paintWho() {
    const me = P.me;
    if (!me) return;
    $("sideWhoName").textContent = P.nameOf(me);
    P.paintAvatar($("sideWhoImg"), $("sideWhoEmpty"), me);
    $("sideWhoEmpty").hidden = !$("sideWhoImg").hidden;
  }

  function go(tab) {
    if (!TABS.includes(tab)) tab = "proyecto";
    if (tab === "distribucion") { mark(tab); window.ZGDistribution.openList(P.me); return; }
    mark(tab);
    if ($("panel-profile").hidden) P.showProfile(P.me);
    else window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.zgTrack) window.zgTrack("portal_seccion", { seccion: tab, tipo_cuenta: "artist" });
  }

  // Lo llama showPanel (portal.js) cada vez que cambia el panel.
  function sync(panel) {
    if (!document.body.classList.contains("is-artist")) return;
    if (PANEL_TAB[panel]) mark(PANEL_TAB[panel]);
    // Volviendo al perfil desde Distribución: a Mi proyecto.
    else if (panel === "profile" && (!document.body.dataset.atab || document.body.dataset.atab === "distribucion")) mark("proyecto");
    paintWho();
  }

  // Cantidad de mezclas o masters esperando su aprobación (canciones.js).
  function setPending(n) {
    const b = $("atabBadge");
    b.hidden = !n;
    b.textContent = n ? String(n) : "";
  }

  $("artistTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-atab]");
    if (b) go(b.dataset.atab);
  });
  // Botones dentro de las tarjetas que llevan a otra pestaña (data-go="canciones").
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b && document.body.classList.contains("is-artist")) go(b.dataset.go);
  });

  window.ZGArtistNav = { go, sync, setPending };
})();
