// ZECHE GRUV — Portal del artista: menú propio (diseño del preview
// "Rediseño web"). Solo para cuentas de artista; el administrador y el
// equipo de distribución siguen como estaban.
//
// Pestañas: Mi proyecto · Canciones · Archivos · La escena · Invitá a un
// amigo · Distribución · Mi perfil. Casi todas son partes del mismo panel
// del perfil: la pestaña elegida queda en <body data-atab="…"> y
// artista.css muestra solo lo de esa pestaña. Así toda la lógica de
// siempre (canciones, carpetas, letras, perfil) sigue igual.
(() => {
  const P = window.ZGPortal;
  const { $ } = P;
  const TZ = "America/Argentina/Buenos_Aires";
  const TABS = ["proyecto", "canciones", "archivos", "escena", "invitar", "distribucion", "perfil"];
  // Panel que se abre -> pestaña que queda marcada.
  const PANEL_TAB = { files: "archivos", lyric: "archivos", releases: "distribucion", release: "distribucion" };
  const FORMAT_SUB = { album: "Álbum en proceso", ep: "EP en proceso", single: "Single en proceso" };
  const SEEN_KEY = "zg-escena-tab-vista";

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const fmtDay = (iso) => cap(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso)).replace(",", ""));
  const fmtTime = (iso) => `${new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} h`;
  const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nada */ } } };

  function mark(tab) {
    document.body.dataset.atab = tab;
    document.querySelectorAll("#artistTabs [data-atab]").forEach((b) => {
      const on = b.dataset.atab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      // En el celu el menú se desliza: la pestaña elegida queda a la vista.
      if (on && window.matchMedia("(max-width: 900px)").matches) b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
  }

  function paintWho() {
    const me = P.me;
    if (!me) return;
    $("sideWhoName").textContent = P.nameOf(me);
    $("sideWhoSub").textContent = FORMAT_SUB[me.format] || "Artista ZECHE GRUV";
    P.paintAvatar($("sideWhoImg"), $("sideWhoEmpty"), me);
    $("sideWhoEmpty").hidden = !$("sideWhoImg").hidden;
  }

  function go(tab) {
    if (!TABS.includes(tab)) tab = "proyecto";
    if (tab === "distribucion") { mark(tab); window.ZGDistribution.openList(P.me); return; }
    mark(tab);
    if (tab === "escena") { renderSceneTab(); seenScene(); }
    if (tab === "invitar") renderInvite();
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
    loadEvent();
  }

  // Cantidad de mezclas o masters esperando su aprobación (canciones.js).
  function setPending(n) {
    const b = $("atabBadge");
    b.hidden = !n;
    b.textContent = n ? String(n) : "";
  }

  // ---------- La escena: el próximo evento del sello ----------
  let eventPromise = null;
  function loadEvent() {
    if (!eventPromise) {
      eventPromise = fetch("/.netlify/functions/pass-events")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d && (d.events || []).filter((e) => e.on_sale || e.sold_out).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]) || null)
        .catch(() => null);
      eventPromise.then((ev) => {
        $("atabEscena").hidden = !ev;
        $("atabNew").hidden = !ev || store.get(SEEN_KEY) === ev.slug;
      });
    }
    return eventPromise;
  }
  function seenScene() { loadEvent().then((ev) => { if (ev) { store.set(SEEN_KEY, ev.slug); $("atabNew").hidden = true; } }); }

  function sceneInfo(ev) {
    const me = norm(P.me && P.me.display_name);
    const plays = !!me && (ev.lineup || []).some((n) => norm(n) === me);
    const url = `/pass/?e=${encodeURIComponent(ev.slug)}`;
    let cta = "Conseguí tu entrada";
    if (plays) cta = "Compartí tu fecha";
    else if (ev.sold_out) cta = "Ver el evento";
    else if (ev.openmic_open) cta = "Anotate al open mic";
    return { plays, url, cta, kind: ev.kind === "camp" ? "Campamento creativo" : "La escena" };
  }

  // Tarjeta naranja: chica en Mi proyecto, grande en su pestaña.
  function sceneHtml(ev, size) {
    const s = sceneInfo(ev);
    const big = size === "big";
    const lineup = (ev.lineup || []).length
      ? `<div class="sc-lineup">${ev.lineup.map((n) => `<span${norm(n) === norm(P.me.display_name) ? ' class="is-me"' : ""}>${esc(n)}</span>`).join("")}</div>` : "";
    return `
      <section class="ap-card ap-scene${big ? " is-big" : ""}" aria-label="Próximo evento">
        <img class="ap-todo-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true">
        <div class="sc-main">
          <span class="ap-eyebrow">${s.plays ? "¡Tocás en esta fecha!" : esc(s.kind)}</span>
          <span class="sc-name">${esc(ev.name)}</span>
          <span class="sc-meta">${esc([fmtDay(ev.starts_at), big ? fmtTime(ev.starts_at) : null, ev.venue_name, big ? ev.venue_address : null].filter(Boolean).join(" · "))}</span>
          ${big && ev.openmic_open && ev.openmic_deadline ? `<span class="sc-note">La inscripción al open mic cierra el ${esc(fmtDay(ev.openmic_deadline).toLowerCase())} a las ${esc(fmtTime(ev.openmic_deadline))}.</span>` : ""}
          ${big ? lineup : ""}
        </div>
        <div class="sc-actions">
          <a class="btn ap-dark" href="${s.url}" target="_blank" rel="noopener">${esc(s.cta)}</a>
          ${big ? `<a class="sc-friends" href="${s.url}" target="_blank" rel="noopener">Comprar entradas para amigos</a>` : ""}
        </div>
      </section>`;
  }

  function fillScene(el, size) {
    if (!el) return;
    loadEvent().then((ev) => {
      if (!el.isConnected) return;
      if (!ev) { el.remove(); return; }
      el.outerHTML = sceneHtml(ev, size);
    });
  }

  function renderSceneTab() {
    const box = $("sceneTab");
    loadEvent().then((ev) => {
      box.innerHTML = `<h1 class="ap-hello ap-tab-title">La escena</h1>${ev ? sceneHtml(ev, "big") : '<p class="ap-lead">Por ahora no hay eventos a la venta. Apenas anunciemos el próximo, aparece acá.</p>'}
        <p class="ap-foot">En cada open mic elegimos a un artista para el line up de la fecha siguiente.</p>`;
    });
  }

  // ---------- Invitá a un amigo ----------
  // Link propio de cada artista: zechegruv.com/v/<su-nombre>. Lleva al
  // inicio del sitio marcado como recomendación suya (Netlify lo redirige
  // con utm_campaign=<su-nombre>, y Google Analytics lo cuenta).
  const slugOf = (p) => norm(P.nameOf(p)).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artista";
  function renderInvite() {
    const link = `https://www.zechegruv.com/v/${slugOf(P.me)}`;
    const wa = "https://wa.me/?text=" + encodeURIComponent(`Estoy grabando mi música en ZECHE GRUV y está buenísimo. Si querés arrancar la tuya, la primera visita al estudio no se cobra: ${link}`);
    $("inviteTab").innerHTML = `
      <h1 class="ap-hello ap-tab-title">Invitá a un amigo</h1>
      <section class="ap-card ap-invite">
        <span class="ap-eyebrow">Padrino ZG</span>
        <p class="iv-big">¿Tenés un amigo con canciones guardadas en el celu? Pasale tu link y que venga a conocer el estudio.</p>
        <div class="iv-link">
          <span class="iv-url">${esc(link.replace("https://www.", ""))}</span>
          <button class="btn btn-primary" type="button" id="ivCopy">Copiar link</button>
          <a class="btn" href="${wa}" target="_blank" rel="noopener">Mandar por WhatsApp</a>
        </div>
        <ol class="iv-steps">
          <li><span>01</span><b>Compartí tu link</b><small>Por WhatsApp o en tu historia.</small></li>
          <li><span>02</span><b>Tu amigo visita el estudio</b><small>La primera visita no se cobra.</small></li>
          <li><span>03</span><b>Arranca su proyecto</b><small>Y nos cuenta que vino de tu parte.</small></li>
        </ol>
        <p class="msg" id="ivMsg" role="status"></p>
      </section>`;
    $("ivCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); P.setMsg($("ivMsg"), "Link copiado. Pasalo por WhatsApp."); $("ivCopy").textContent = "Copiado"; }
      catch (e) { P.setMsg($("ivMsg"), link); }
      if (window.zgTrack) window.zgTrack("portal_invitar", { accion: "copiar" });
    });
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

  window.ZGArtistNav = { go, sync, setPending, fillScene };
})();
