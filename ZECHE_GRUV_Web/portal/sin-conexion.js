// ZECHE GRUV — Portal de artistas: instalable en el celu y sin conexión.
//
// - Instalar: en Mi proyecto aparece un aviso discreto para sumar el portal
//   a la pantalla de inicio del celu (en Android/Chrome con el botón del
//   navegador; en iPhone, con los pasos de Safari). Se cierra con ✕ y no
//   vuelve a aparecer. Si ya está instalado, no se muestra.
// - Escuchar sin señal: en Referencias, Exports y Masters cada audio tiene
//   «Guardar en el celu». Se baja una vez (con su avance) y queda en el
//   dispositivo (Cache Storage "zg-audios", fuera del service worker). En Mi
//   proyecto aparece «Guardados en este celu» para escucharlos, y la misma
//   lista sale en la pantalla de «No pudimos conectarnos» cuando no hay
//   señal. Si en OneDrive hay una versión más nueva del archivo, el botón
//   dice «Actualizar». Al cerrar sesión se borra todo lo guardado.
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

  // ---------- Service worker (portal/sw.js) ----------
  // Guarda la página, los estilos y el código del portal para que abra sin
  // conexión. Se registra cuando la página ya cargó, para no competir con
  // lo que el artista vino a ver.
  if ("serviceWorker" in navigator && location.pathname.startsWith("/portal/")) {
    const register = () => navigator.serviceWorker.register("/portal/sw.js", { scope: "/portal/" }).catch(() => { /* sin SW: el portal anda igual, solo que no abre sin conexión */ });
    if (document.readyState === "complete") register(); else window.addEventListener("load", register);
  }
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
          ? `<span>Tocá <i class="zgi-share">${SHARE_IC}</i> <b>Compartir</b> y después <b>Agregar a inicio</b>. Lo abrís como una app, te llegan los avisos y funciona sin señal.</span>`
          : "<span>Lo abrís como una app, te llegan los avisos de tu mezcla y escuchás lo que guardes, también sin señal.</span>"}
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

  // ---------- Guardar audios para escuchar sin señal ----------
  const AUDIOS = "zg-audios";            // Cache Storage: los audios
  const IDX_KEY = "zg-audios";           // localStorage: qué hay guardado
  const OWNER_KEY = "zg-audios-de";      // de qué cuenta es lo guardado
  const SEC_LABEL = { referencias: "Referencias", exports: "Exports", masters: "Masters", letras: "Letras", membresia: "Membresía" };
  const canCache = () => { try { return "caches" in window && window.isSecureContext !== false; } catch (e) { return false; } };
  const keyOf = (id) => `/portal/__guardados/${encodeURIComponent(id)}`;
  const idOf = (sec, group, name) => [sec, group || "", name].join("/");
  const index = () => { const v = store.get(IDX_KEY); return Array.isArray(v) ? v : []; };
  const setIndex = (list) => store.set(IDX_KEY, list.length ? list : null);
  const busy = new Map(); // id -> { pct, abort }
  // «celu» en el teléfono o la tablet; «compu» en una computadora.
  const touch = (() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return true; } })();
  const EL = touch ? "el celu" : "la compu", ESTE = touch ? "este celu" : "esta compu";

  function fmtSize(bytes) {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(mb >= 100 ? 0 : 1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  const SAVE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M12 7.5v7m0 0l-3-3m3 3l3-3"/></svg>';
  const SAVED_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M9.2 11.8l2 2 3.8-4"/></svg>';
  const PLAY_IC = '<svg class="zgo-i-play" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg><svg class="zgo-i-pause" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z"/></svg>';

  function canSave(profile) {
    const p = P();
    return canCache() && isArtist() && !!profile && !!p && profile.id === p.me.id;
  }

  // Estado de un archivo de la lista: "" (sin guardar), "saved", "old"
  // (hay una versión más nueva en OneDrive) o "busy".
  function stateOf(id, modified) {
    if (busy.has(id)) return "busy";
    const hit = index().find((x) => x.id === id);
    if (!hit) return "";
    return modified && hit.modified && modified !== hit.modified ? "old" : "saved";
  }

  const LABEL = { "": `Guardar en ${EL}`, saved: `En ${EL}`, old: "Actualizar", busy: "Guardando…" };
  function btnInner(state, pct) {
    const ic = state === "saved" ? SAVED_IC : SAVE_IC;
    const ring = state === "busy" ? `<i class="zgo-ring" style="--p:${Math.round(pct || 0)}"></i>` : "";
    return `${ring}${ic}<span>${state === "busy" && pct ? `${Math.round(pct)}%` : LABEL[state]}</span>`;
  }

  function saveBtn(f, sec, group) {
    const id = idOf(sec, group, f.name);
    const st = stateOf(id, f.modified);
    const aria = st === "saved" ? `Quitar ${f.name} de ${EL}` : st === "old" ? `Actualizar ${f.name} en ${EL}` : `Guardar ${f.name} en ${EL} para escuchar sin señal`;
    return `<button class="btn zgo-save" type="button" data-zgo-save="${esc(id)}" data-url="${esc(f.url)}" data-name="${esc(f.name)}" data-sec="${esc(sec)}" data-group="${esc(group)}" data-size="${f.size || 0}" data-mod="${esc(f.modified || "")}" data-state="${st}" aria-label="${esc(aria)}">${btnInner(st, busy.get(id) && busy.get(id).pct)}</button>`;
  }

  function syncButtons(id) {
    document.querySelectorAll(`[data-zgo-save="${CSS.escape(id)}"]`).forEach((b) => {
      const st = stateOf(id, b.dataset.mod);
      b.dataset.state = st;
      b.innerHTML = btnInner(st, busy.get(id) && busy.get(id).pct);
      b.setAttribute("aria-label", st === "saved" ? `Quitar ${b.dataset.name} de ${EL}` : st === "old" ? `Actualizar ${b.dataset.name} en ${EL}` : st === "busy" ? `Guardando ${b.dataset.name}` : `Guardar ${b.dataset.name} en ${EL} para escuchar sin señal`);
    });
  }

  function toast(text) {
    let t = document.getElementById("zgoToast");
    if (!t) { t = document.createElement("div"); t.id = "zgoToast"; t.className = "zgo-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = text;
    t.classList.remove("is-on"); void t.offsetWidth; t.classList.add("is-on");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-on"), 3200);
  }

  async function save(b) {
    const id = b.dataset.zgoSave;
    if (busy.has(id)) return;
    const meta = { id, name: b.dataset.name, sec: b.dataset.sec, group: b.dataset.group, size: +b.dataset.size || 0, modified: b.dataset.mod || "", at: new Date().toISOString() };
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    busy.set(id, { pct: 0, abort: ctrl });
    syncButtons(id);
    try {
      // Que el navegador no borre lo guardado cuando necesite espacio (si lo permite).
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }
      const res = await fetch(b.dataset.url, ctrl ? { signal: ctrl.signal } : {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = +res.headers.get("content-length") || meta.size;
      let blob;
      if (res.body && res.body.getReader && total) {
        const reader = res.body.getReader();
        const parts = []; let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); got += value.length;
          const st = busy.get(id); if (st) { st.pct = Math.min(99, (got / total) * 100); syncButtons(id); }
        }
        blob = new Blob(parts, { type: res.headers.get("content-type") || "audio/mpeg" });
      } else blob = await res.blob();
      meta.size = blob.size || meta.size;
      const cache = await caches.open(AUDIOS);
      await cache.put(keyOf(id), new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg", "Content-Length": String(blob.size) } }));
      setIndex([meta, ...index().filter((x) => x.id !== id)]);
      const p = P(); if (p && p.me) store.set(OWNER_KEY, p.me.id);
      busy.delete(id);
      syncButtons(id);
      paintSaved();
      toast(`«${meta.name}» quedó en ${EL}: lo escuchás sin señal desde Mi proyecto.`);
    } catch (e) {
      busy.delete(id);
      syncButtons(id);
      const full = e && (e.name === "QuotaExceededError" || /quota/i.test(String(e.message)));
      toast(full ? `No hay lugar en ${EL} para guardar este audio. Quitá alguno de «Guardados en ${ESTE}» y probá de nuevo.`
        : "No pudimos guardar el audio. Revisá tu conexión y probá de nuevo.");
    }
  }

  async function remove(id, quiet) {
    if (player.id === id) stopPlayer();
    try { await (await caches.open(AUDIOS)).delete(keyOf(id)); } catch (e) { /* nada */ }
    setIndex(index().filter((x) => x.id !== id));
    syncButtons(id);
    paintSaved();
    if (!quiet) toast(`Lo quitamos de ${EL}. Sigue en tu carpeta del portal.`);
  }

  async function clear() {
    stopPlayer();
    try { await caches.delete(AUDIOS); } catch (e) { /* nada */ }
    store.set(IDX_KEY, null);
    store.set(OWNER_KEY, null);
    document.querySelectorAll(".zgo-saved").forEach((el) => el.remove());
  }

  // ---------- Reproductor de lo guardado ----------
  const player = { audio: null, id: null, url: null };
  function stopPlayer() {
    if (player.audio) { player.audio.pause(); player.audio.removeAttribute("src"); player.audio.load(); }
    if (player.url) URL.revokeObjectURL(player.url);
    player.id = null; player.url = null;
    syncRows();
  }
  function fmtTime(t) { if (!isFinite(t)) return "0:00"; const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; }
  function syncRows() {
    const a = player.audio;
    document.querySelectorAll(".zgo-row").forEach((row) => {
      const on = row.dataset.id === player.id;
      const playing = on && a && !a.paused;
      row.classList.toggle("is-current", on);
      row.classList.toggle("is-playing", !!playing);
      const btn = row.querySelector("[data-zgo-play]");
      if (btn) btn.setAttribute("aria-label", `${playing ? "Pausar" : "Escuchar"} ${row.dataset.name}`);
      const bar = row.querySelector(".zgo-bar");
      if (bar) bar.style.setProperty("--p", on && a && a.duration ? (a.currentTime / a.duration) * 100 : 0);
      const time = row.querySelector(".zgo-time");
      if (time) time.textContent = on && a ? `${fmtTime(a.currentTime)} / ${fmtTime(a.duration)}` : row.dataset.size;
    });
  }
  async function play(id) {
    if (!player.audio) {
      player.audio = new Audio();
      ["play", "pause", "ended", "timeupdate", "loadedmetadata"].forEach((t) => player.audio.addEventListener(t, syncRows));
    }
    const a = player.audio;
    if (player.id === id) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    stopPlayer();
    const hit = await (await caches.open(AUDIOS)).match(keyOf(id)).catch(() => null);
    if (!hit) { toast(`Este audio ya no está en ${EL}. Guardalo de nuevo desde su sección.`); remove(id, true); return; }
    player.url = URL.createObjectURL(await hit.blob());
    player.id = id;
    a.src = player.url;
    a.play().catch(() => {});
    syncRows();
  }

  // ---------- «Guardados en este celu» ----------
  // En Mi proyecto (artista con sesión) y en la pantalla de «No pudimos
  // conectarnos», que es donde cae el portal cuando no hay señal.
  function savedHtml(list) {
    const rows = list.map((x) => `
      <li class="zgo-row" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-size="${esc(fmtSize(x.size))}">
        <button class="zgo-play" type="button" data-zgo-play="${esc(x.id)}" aria-label="Escuchar ${esc(x.name)}">${PLAY_IC}</button>
        <div class="zgo-meta">
          <b>${esc(x.name.replace(/\.[a-z0-9]+$/i, ""))}</b>
          <span><i class="zgo-tag">${esc(SEC_LABEL[x.sec] || x.sec)}</i>${x.group ? ` ${esc(x.group)} ·` : ""} <em class="zgo-time">${esc(fmtSize(x.size))}</em></span>
          <i class="zgo-bar" aria-hidden="true"></i>
        </div>
        <button class="zgo-del" type="button" data-zgo-del="${esc(x.id)}" aria-label="Quitar ${esc(x.name)} de ${EL}">${X_IC}</button>
      </li>`).join("");
    const total = list.reduce((n, x) => n + (x.size || 0), 0);
    return `
      <header class="zgo-head">
        <span class="zgi-ico">${SAVED_IC}</span>
        <div><b>Guardados en ${ESTE}</b><span>${list.length === 1 ? "1 audio" : `${list.length} audios`} · ${fmtSize(total)} · se escuchan sin señal</span></div>
      </header>
      <ul class="zgo-list">${rows}</ul>`;
  }

  function paintSaved() {
    const list = index();
    document.querySelectorAll(".zgo-saved").forEach((el) => { if (!list.length) el.remove(); });
    if (!list.length) return;
    const spots = [];
    const retry = document.querySelector("#view-loading .load-retry");
    if (retry) spots.push([retry, "after"]);
    if (isArtist()) {
      const vis = (id) => { const n = document.getElementById(id); return n && !n.hidden ? n : null; };
      const anchor = vis("zgPush") || vis("zgInstall") || document.getElementById("projectCards");
      if (anchor) spots.push([anchor, "after"]);
    }
    spots.forEach(([anchor]) => {
      let box = anchor.parentElement.querySelector(":scope > .zgo-saved");
      if (!box) { box = document.createElement("section"); box.className = "zgo-saved"; box.setAttribute("aria-label", `Guardados en ${ESTE}`); }
      box.innerHTML = savedHtml(list);
      if (box.previousElementSibling !== anchor) anchor.after(box);
    });
    syncRows();
  }

  document.addEventListener("click", (e) => {
    const s = e.target.closest("[data-zgo-save]");
    if (s) {
      const st = stateOf(s.dataset.zgoSave, s.dataset.mod);
      if (st === "busy") return;
      if (st === "saved") remove(s.dataset.zgoSave); else save(s);
      return;
    }
    const pl = e.target.closest("[data-zgo-play]");
    if (pl) { play(pl.dataset.zgoPlay); return; }
    const del = e.target.closest("[data-zgo-del]");
    if (del) remove(del.dataset.zgoDel);
  });

  // La pantalla de «No pudimos conectarnos» la arma portal.js: cuando
  // aparece, se suma la lista de lo guardado.
  const watchRetry = () => {
    const box = document.getElementById("view-loading");
    if (!box) return;
    new MutationObserver(() => { if (box.querySelector(".load-retry")) paintSaved(); }).observe(box, { childList: true });
    if (box.querySelector(".load-retry")) paintSaved();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchRetry); else watchRetry();

  // Lo llama portal.js cada vez que entra alguien (enter).
  function ready(me) {
    // Si entra otra cuenta en este dispositivo, lo guardado de la anterior se borra.
    const owner = store.get(OWNER_KEY);
    if (owner && me && owner !== me.id) clear();
    document.querySelectorAll("#view-loading .zgo-saved").forEach((el) => el.remove());
    paintInstall();
    paintSaved();
  }

  window.ZGOffline = { ready, store, esc, canSave, saveBtn, clear, paintSaved };
})();
