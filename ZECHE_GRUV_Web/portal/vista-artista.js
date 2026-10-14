// ZECHE GRUV — Panel de administrador: el perfil de un artista, como lo ve él.
// Cuando el administrador abre un artista (desde Artistas, el Inicio o una
// tarea), ve el mismo portal que el artista: Mi proyecto · Canciones ·
// Archivos · Distribución, con el mismo diseño (artista.css, con
// body.is-artist-view). Lo que es solo del administrador (datos internos,
// ⚙ Configuración, acceso y borrar) va en una pestaña aparte: Admin.
// La pestaña elegida queda en <body data-atab="…">, igual que en el portal
// del artista, así la misma hoja de estilos decide qué se ve.
(() => {
  const P = window.ZGPortal;
  const { $ } = P;
  const TABS = ["proyecto", "canciones", "archivos", "distribucion", "admin"];
  // Panel que se abre -> pestaña que queda marcada.
  const PANEL_TAB = { files: "archivos", lyric: "archivos", releases: "distribucion", release: "distribucion" };
  // Paneles que son parte de la vista del artista; cualquier otro la cierra.
  const KEEP = ["profile", "files", "lyric", "releases", "release"];
  const body = document.body;
  const bar = $("viewBar");
  const tabsBox = $("viewTabs");
  const ind = $("viewInd");
  let who = null;
  let tab = "proyecto";

  const on = () => body.classList.contains("is-artist-view");
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // La pastilla naranja se desliza hasta la pestaña elegida.
  function moveInd(animate) {
    const b = tabsBox.querySelector(`[data-vtab="${tab}"]`);
    if (!b || !ind) return;
    ind.style.transition = animate && !reduced() ? "" : "none";
    ind.style.width = `${b.offsetWidth}px`;
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!animate) { void ind.offsetWidth; ind.style.transition = ""; }
  }

  function mark(t, animate = true) {
    tab = t;
    body.dataset.atab = t;
    tabsBox.querySelectorAll("[data-vtab]").forEach((b) => {
      const sel = b.dataset.vtab === t;
      b.classList.toggle("is-active", sel);
      b.setAttribute("aria-selected", sel ? "true" : "false");
      if (sel && tabsBox.scrollWidth > tabsBox.clientWidth) b.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    });
    requestAnimationFrame(() => moveInd(animate));
  }

  function paintWho(p) {
    $("viewName").textContent = P.nameOf(p);
    P.paintAvatar($("viewAvatar"), $("viewAvatarEmpty"), p);
    $("viewAvatarEmpty").hidden = !$("viewAvatar").hidden;
  }

  // Lo llama showProfile (portal.js) al abrir el perfil de un artista.
  function enter(p) {
    const fresh = !who || who.id !== p.id;
    who = p;
    if (fresh) tab = "proyecto";
    const was = on();
    body.classList.add("is-artist-view");
    bar.hidden = false;
    paintWho(p);
    mark(tab, was && !fresh);
    // En la barra del admin queda marcada "Artistas".
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "artists"));
    if (!was) { bar.classList.remove("is-in"); void bar.offsetWidth; bar.classList.add("is-in"); }
  }

  function leave() {
    if (!on()) return;
    body.classList.remove("is-artist-view");
    delete body.dataset.atab;
    bar.hidden = true;
  }

  // Lo llama showPanel (portal.js) cada vez que cambia el panel.
  function sync(panel) {
    if (!on()) return;
    if (!KEEP.includes(panel)) { leave(); return; }
    if (PANEL_TAB[panel]) mark(PANEL_TAB[panel]);
    else if (panel === "profile" && tab === "distribucion") mark("proyecto");
  }

  function go(t) {
    if (!who) return;
    if (!TABS.includes(t)) t = "proyecto";
    const from = TABS.indexOf(tab), to = TABS.indexOf(t);
    if (t === "distribucion") { mark(t); window.ZGDistribution.openList(who); }
    else {
      mark(t);
      if ($("panel-profile").hidden) P.showProfile(who);
      else window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
    }
    if (window.ZGSwipe && to !== from) window.ZGSwipe.slide(to > from ? 1 : -1);
  }

  tabsBox.addEventListener("click", (e) => {
    const b = e.target.closest("[data-vtab]");
    if (b) go(b.dataset.vtab);
  });
  $("viewBack").addEventListener("click", () => P.openTab("artists"));
  // Botones de las tarjetas que llevan a otra pestaña (data-go="canciones").
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b && on()) go(b.dataset.go);
  });
  window.addEventListener("resize", () => { if (on()) moveInd(false); });

  window.ZGArtistView = {
    enter, leave, sync, go,
    get on() { return on(); },
    get tabs() { return TABS; },
    get tab() { return tab; },
  };
})();
