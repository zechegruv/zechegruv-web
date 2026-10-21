// ZECHE GRUV — Portal: cuenta de Productor (solo seguimiento).
// Un productor que trabaja con artistas del sello entra y ve SOLO los
// artistas que el administrador le asignó (supabase/036_productor.sql). De
// cada uno: en qué etapa está cada canción, la mezcla o el master entregado
// para escuchar, y las carpetas Referencias, Letras, Exports y Masters para
// escuchar o bajar. Nada más: no aprueba, no deja notas, no sube, no ve
// Membresía, ni lo que dijo el artista, ni fechas de entrega, ni sesiones.
// Escuchar acá no cuenta como escucha del artista (no toca los recordatorios
// ni la medición de "portal_escuchar"): el reproductor es propio.
// Los servidores (portal-songs.js y portal-files.js) son los que deciden qué
// ve: este archivo solo lo muestra.
//
// "Novedades": el portal recuerda en este dispositivo (solo para él) cómo
// estaba cada canción la última vez que la vio; si avanzó de etapa o hay
// una entrega nueva, la marca como Nueva.
//
// Productor/Artista (037_productor_artista.sql): un artista que además es
// productor. Entra a su portal de artista de siempre y arriba tiene el
// interruptor Artista · Productor para pasar a esta vista (y volver). Lo
// último que eligió queda recordado en ese dispositivo.
//
// Para el administrador: en el perfil de un productor, la tarjeta "Artistas
// que sigue" para elegirle los artistas (se guarda al tocar); en el de un
// artista (pestaña Admin), además el interruptor "También es productor".
(() => {
  const P = window.ZGPortal;
  if (!P) return;
  const { db, $ } = P;

  const STAGES = [["estructura", "Estructura"], ["produccion", "Producción"], ["grabacion", "Grabación"], ["mezcla", "Mezcla"], ["master", "Master"]];
  const WHAT = { mezcla: "la mezcla", master: "el master" };
  const NOUN = { mezcla: "Mezcla", master: "Master" };
  const SECTIONS = [
    ["referencias", "Referencias", "Maquetas e ideas de cada canción"],
    ["letras", "Letras", "La letra de cada canción"],
    ["exports", "Exports", "Versiones de trabajo"],
    ["masters", "Masters", "Versiones finales"],
  ];
  const TAG = { master: "Master", mezcla: "Mezcla", rec: "Rec", vivo: "Vivo" };
  const AUDIO = /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const dayOf = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const fmtDay = (d) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : b ? `${b} B` : "");
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  const IC = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- Novedades (solo en este dispositivo) ----------
  const seenKey = () => `zg-prod-visto-${P.me ? P.me.id : ""}`;
  function readSeen() { try { return JSON.parse(localStorage.getItem(seenKey()) || "{}") || {}; } catch (e) { return {}; } }
  function writeSeen(map) { try { localStorage.setItem(seenKey(), JSON.stringify(map)); } catch (e) { /* sin almacenamiento: sin novedades */ } }
  const sig = (s) => [s.stage, s.delivery ? s.delivery.state : "", s.delivery && s.delivery.file ? s.delivery.file.modified : ""].join("|");
  // Nueva: ya la había visto y cambió. La primera vez no se marca nada.
  const isNew = (s, seen) => seen[s.id] !== undefined && seen[s.id] !== sig(s);
  function markSeen(songs) {
    const seen = readSeen();
    songs.forEach((s) => { seen[s.id] = sig(s); });
    writeSeen(seen);
  }

  // ---------- Datos ----------
  const songsCache = new Map(); // artista -> Promise<datos>
  function fetchSongs(artistId, fresh) {
    if (!fresh && songsCache.has(artistId)) return songsCache.get(artistId);
    const p = P.authFetch(`/.netlify/functions/portal-songs?artist=${encodeURIComponent(artistId)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No pudimos traer las canciones."); return d; });
    songsCache.set(artistId, p);
    p.catch(() => { if (songsCache.get(artistId) === p) songsCache.delete(artistId); });
    return p;
  }
  const filesCache = new Map(); // "artista|sección" -> Promise
  function fetchFiles(artistId, section, fresh) {
    const key = `${artistId}|${section}`;
    if (!fresh && filesCache.has(key)) return filesCache.get(key);
    const p = P.authFetch(`/.netlify/functions/portal-files?section=${section}&artist=${encodeURIComponent(artistId)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No pudimos leer la carpeta."); return d; });
    filesCache.set(key, p);
    p.catch(() => { if (filesCache.get(key) === p) filesCache.delete(key); });
    return p;
  }
  const allSongs = (d) => [...((d && d.active) || []), ...((d && d.done) || [])];

  // ---------- Estado de la pantalla ----------
  let artists = [];
  let current = null;   // artista abierto
  let tab = "canciones";
  let section = "referencias";
  let ticket = 0;
  let root = null;

  function panel() {
    if (!root) root = $("panel-producer");
    return root;
  }

  // ---------- Reproductor propio (no cuenta como escucha del artista) ----------
  const audio = new Audio();
  audio.preload = "none";
  let playing = null; // { key, title, sub, url, refresh }
  let bar = null;

  function ensureBar() {
    if (bar) return bar;
    bar = el("div", "pr-player", `
      <button class="pr-pbtn" type="button" aria-label="Reproducir">${IC.play}</button>
      <div class="pr-pmain">
        <div class="pr-pinfo"><b class="pr-ptitle"></b><span class="pr-psub"></span></div>
        <div class="pr-pbar"><input type="range" min="0" max="1000" value="0" aria-label="Posición"><span class="pr-ptime">0:00</span></div>
      </div>
      <button class="pr-pclose" type="button" aria-label="Cerrar reproductor">✕</button>`);
    bar.hidden = true;
    document.body.append(bar);
    const btn = bar.querySelector(".pr-pbtn");
    const range = bar.querySelector("input");
    btn.addEventListener("click", () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
    bar.querySelector(".pr-pclose").addEventListener("click", stop);
    range.addEventListener("input", () => { if (audio.duration) audio.currentTime = (range.value / 1000) * audio.duration; });
    const paint = () => {
      btn.innerHTML = audio.paused ? IC.play : IC.pause;
      btn.setAttribute("aria-label", audio.paused ? "Reproducir" : "Pausar");
      document.querySelectorAll(".pr-play").forEach((b) => {
        const on = playing && b.dataset.key === playing.key && !audio.paused;
        b.classList.toggle("is-on", !!on);
        b.innerHTML = on ? IC.pause : IC.play;
      });
    };
    ["play", "pause", "ended"].forEach((e) => audio.addEventListener(e, paint));
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) range.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      bar.querySelector(".pr-ptime").textContent = `${clock(audio.currentTime)}${audio.duration ? ` / ${clock(audio.duration)}` : ""}`;
    });
    // Los links de OneDrive vencen al rato: se piden de nuevo y se sigue.
    audio.addEventListener("error", async () => {
      if (!playing || !playing.refresh || playing.retried) return;
      playing.retried = true;
      try {
        const url = await playing.refresh();
        if (url) { audio.src = url; audio.play().catch(() => {}); }
      } catch (e) { /* queda el botón para probar de nuevo */ }
    });
    bar.paint = paint;
    return bar;
  }

  function play(item) {
    ensureBar();
    if (playing && playing.key === item.key) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
    playing = { ...item, retried: false };
    audio.src = item.url;
    bar.querySelector(".pr-ptitle").textContent = item.title;
    bar.querySelector(".pr-psub").textContent = item.sub || "";
    bar.querySelector("input").value = "0";
    if (bar.hidden) { bar.hidden = false; bar.classList.remove("is-in"); void bar.offsetWidth; bar.classList.add("is-in"); }
    audio.play().catch(() => {});
    bar.paint();
  }
  function stop() {
    audio.pause();
    audio.removeAttribute("src");
    playing = null;
    if (bar) { bar.hidden = true; bar.paint(); }
  }

  const playBtn = (key) => `<button class="pr-play" type="button" data-key="${esc(key)}" aria-label="Escuchar">${playing && playing.key === key && !audio.paused ? IC.pause : IC.play}</button>`;
  const downBtn = (url, name) => (url ? `<a class="pr-down" href="${esc(url)}" download="${esc(name || "")}" target="_blank" rel="noopener" aria-label="Descargar ${esc(name || "")}">${IC.down}</a>` : "");

  // ---------- Inicio del productor: sus artistas ----------
  async function open(me) {
    current = null;
    P.showPanel("producer");
    const tag = document.querySelector(".nav-tag");
    if (tag) tag.textContent = "Portal de productores";
    const box = panel();
    const first = String(P.nameOf(me) || "").trim().split(/\s+/)[0];
    box.innerHTML = `
      <header class="pr-head">
        <div class="eyebrow">Portal de productores</div>
        <h1 class="title title-sm">Hola${first ? `, ${esc(first)}` : ""}.</h1>
        <p class="pr-lead">Acá ves cómo avanza cada canción de los artistas con los que trabajamos juntos, y tenés sus archivos a mano para escuchar o bajar.</p>
      </header>
      <div class="pr-grid" id="prArtists" aria-live="polite"><p class="muted">Cargando…</p></div>
      <details class="card pr-account"${me.role === "producer" ? "" : " hidden"}>
        <summary>Mi cuenta</summary>
        <form class="form" id="prPassword" novalidate>
          <div class="field"><label for="prNewPass">Contraseña nueva</label><input type="password" id="prNewPass" autocomplete="new-password" minlength="8"></div>
          <p class="msg" role="status"></p>
          <button class="btn" type="submit">Cambiar contraseña</button>
        </form>
      </details>`;
    box.querySelector("#prPassword").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = e.target.querySelector(".msg");
      const pass = $("prNewPass").value;
      if (pass.length < 8) { P.setMsg(msg, "La contraseña tiene que tener al menos 8 caracteres.", true); return; }
      const { error } = await db.auth.updateUser({ password: pass });
      if (error) { P.setMsg(msg, "No pudimos cambiar la contraseña. Probá de nuevo.", true); return; }
      $("prNewPass").value = "";
      P.setMsg(msg, "Contraseña cambiada.");
    });

    const list = $("prArtists");
    let data = null, error = null;
    try { ({ data, error } = await db.rpc("producer_my_artists")); } catch (e) { error = e; }
    if (error) { list.innerHTML = `<p class="muted">No pudimos cargar tus artistas. Recargá la página en un momento.</p>`; return; }
    artists = Array.isArray(data) ? data : [];
    if (!artists.length) {
      list.innerHTML = `<div class="card pr-empty"><img src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true"><p>Todavía no tenés artistas asignados. Apenas te sume a un proyecto, aparece acá.</p></div>`;
      return;
    }
    list.replaceChildren(...artists.map((a, i) => {
      const card = el("button", "pr-artist");
      card.type = "button";
      card.style.setProperty("--i", i);
      card.innerHTML = `
        <span class="pr-av-wrap"><img class="avatar pr-av" alt="" hidden><span class="avatar avatar-empty pr-av" aria-hidden="true"></span></span>
        <span class="pr-artist-text"><b>${esc(a.display_name || "Artista")}</b><small class="pr-artist-sub">Cargando canciones…</small></span>
        <span class="pr-badge" hidden></span>
        <span class="pr-arrow" aria-hidden="true">→</span>`;
      P.paintAvatar(card.querySelector("img"), card.querySelector(".avatar-empty"), a);
      card.addEventListener("click", () => openArtist(a));
      return card;
    }));
    // Las canciones de cada artista se traen por detrás (de a dos), para el
    // resumen de la tarjeta y para que al abrirlo esté al instante.
    const queue = artists.slice();
    const work = async () => {
      while (queue.length) {
        const a = queue.shift();
        try { paintSummary(a, await fetchSongs(a.id)); } catch (e) { paintSummary(a, null); }
      }
    };
    work(); work();
  }

  function paintSummary(a, d) {
    const i = artists.indexOf(a);
    const card = $("prArtists") && $("prArtists").children[i];
    if (!card || current) return;
    const sub = card.querySelector(".pr-artist-sub");
    if (!d) { sub.textContent = "Tocá para ver sus canciones"; return; }
    if (!d.configured) { sub.textContent = "Todavía sin canciones cargadas"; return; }
    const act = (d.active || []).length, done = (d.done || []).length;
    const parts = [];
    if (act) parts.push(act === 1 ? "1 en proceso" : `${act} en proceso`);
    if (done) parts.push(done === 1 ? "1 terminada" : `${done} terminadas`);
    sub.textContent = parts.join(" · ") || "Todavía sin canciones";
    const seen = readSeen();
    const n = allSongs(d).filter((s) => isNew(s, seen)).length;
    const badge = card.querySelector(".pr-badge");
    badge.hidden = !n;
    badge.textContent = n === 1 ? "1 novedad" : `${n} novedades`;
  }

  // ---------- Un artista ----------
  function openArtist(a) {
    current = a;
    tab = "canciones";
    const box = panel();
    box.innerHTML = `
      <div class="pr-bar">
        <button class="pr-back" type="button">${IC.back}<span>Mis artistas</span></button>
        <span class="pr-who"><img class="pr-who-av" alt="" hidden><span class="pr-who-av pr-who-empty" aria-hidden="true"></span><b>${esc(a.display_name || "Artista")}</b></span>
      </div>
      <div class="pr-tabs" role="tablist" aria-label="${esc(a.display_name || "Artista")}">
        <span class="pr-ind" aria-hidden="true"></span>
        <button class="pr-tab is-active" type="button" role="tab" data-ptab="canciones" aria-selected="true">Canciones</button>
        <button class="pr-tab" type="button" role="tab" data-ptab="archivos" aria-selected="false">Archivos</button>
      </div>
      <div class="pr-body" id="prBody"></div>`;
    P.paintAvatar(box.querySelector("img.pr-who-av"), box.querySelector(".pr-who-empty"), a);
    box.querySelector(".pr-who-empty").hidden = !box.querySelector("img.pr-who-av").hidden;
    box.querySelector(".pr-back").addEventListener("click", () => open(P.me));
    box.querySelector(".pr-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ptab]");
      if (b && b.dataset.ptab !== tab) goTab(b.dataset.ptab);
    });
    window.scrollTo(0, 0);
    goTab("canciones", false);
  }

  function moveInd(animate) {
    const box = panel();
    const b = box.querySelector(`[data-ptab="${tab}"]`);
    const ind = box.querySelector(".pr-ind");
    if (!b || !ind) return;
    ind.style.transition = animate && !reduced() ? "" : "none";
    ind.style.width = `${b.offsetWidth}px`;
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
  }

  function goTab(t, animate = true) {
    tab = t;
    panel().querySelectorAll("[data-ptab]").forEach((b) => {
      const on = b.dataset.ptab === t;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    requestAnimationFrame(() => moveInd(animate));
    if (t === "canciones") showSongs(); else showFiles();
  }
  window.addEventListener("resize", () => { if (current) moveInd(false); });

  // ---------- Canciones ----------
  function deliveryHtml(s, who) {
    const d = s.delivery;
    if (!d) return "";
    const key = `song:${s.id}:${d.kind}`;
    const file = d.file;
    const listen = file && file.url ? `<span class="pr-acts">${playBtn(key)}${downBtn(file.url, file.name)}</span>` : "";
    if (d.state === "proceso") return `<div class="pr-dv"><span class="pr-dot is-work"></span><span>Zeche está trabajando ${WHAT[d.kind]}.</span></div>`;
    if (d.state === "aprobar") return `<div class="pr-dv is-ready"><span class="pr-dot is-ready"></span><span><b>${NOUN[d.kind]} entregad${d.kind === "mezcla" ? "a" : "o"}</b> · esperando que ${esc(who)} l${d.kind === "mezcla" ? "a" : "o"} apruebe.</span>${listen}</div>`;
    if (d.state === "aprobada") return `<div class="pr-dv is-ok"><span class="pr-dot is-ok"></span><span><b>${NOUN[d.kind]} aprobad${d.kind === "mezcla" ? "a" : "o"}.</b>${d.kind === "mezcla" ? " Sigue el master." : ""}</span>${listen}</div>`;
    return "";
  }

  function songHtml(s, i, seen, who) {
    const fresh = isNew(s, seen);
    const steps = STAGES.map(([, name], k) => `<li class="${k < s.step ? "is-done" : k === s.step ? "is-current" : ""}"${k === s.step ? ' aria-current="step"' : ""}><span>${name}</span></li>`).join("");
    return `
      <li class="pr-song${fresh ? " is-new" : ""}" style="--i:${i}">
        <div class="pr-song-top">
          <div class="pr-song-name"><b>${esc(s.title)}</b>${s.feat ? `<span>feat. ${esc(s.feat)}</span>` : ""}</div>
          ${fresh ? '<span class="pr-new">Nuevo</span>' : ""}
          <span class="pr-stage">${s.step >= 0 ? esc(STAGES[s.step][1]) : "Por arrancar"}</span>
        </div>
        <ol class="pr-steps" aria-label="${s.step >= 0 ? `Etapa ${s.step + 1} de ${STAGES.length}: ${STAGES[s.step][1]}` : "Todavía sin etapa"}">${steps}</ol>
        ${deliveryHtml(s, who)}
      </li>`;
  }

  function doneHtml(s, i, seen) {
    const fresh = isNew(s, seen);
    const rel = dayOf(s.release);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const when = rel ? (rel >= today ? `Sale el ${fmtDay(rel)}` : `Salió el ${fmtDay(rel)}`) : (s.stage === "publicada" ? "Publicada" : "Master aprobado");
    const f = s.delivery && s.delivery.file;
    return `
      <li class="pr-done-row${fresh ? " is-new" : ""}" style="--i:${i}">
        <span class="pr-song-name"><b>${esc(s.title)}</b>${s.feat ? `<span>feat. ${esc(s.feat)}</span>` : ""}</span>
        <span class="pr-when">${esc(when)}</span>
        ${f && f.url ? `<span class="pr-acts">${playBtn(`song:${s.id}:master`)}${downBtn(f.url, f.name)}</span>` : ""}
      </li>`;
  }

  async function showSongs(fresh) {
    const a = current;
    const my = ++ticket;
    const body = $("prBody");
    body.innerHTML = `<p class="muted pr-loading">Cargando canciones…</p>`;
    let d;
    try { d = await fetchSongs(a.id, fresh); }
    catch (e) {
      if (my !== ticket) return;
      body.innerHTML = `<div class="card pr-msg"><p>${esc(e.message)}</p><button class="btn" type="button">Reintentar</button></div>`;
      body.querySelector("button").addEventListener("click", () => showSongs(true));
      return;
    }
    if (my !== ticket || current !== a) return;
    if (!d.configured) { body.innerHTML = `<div class="card pr-msg"><p>Todavía no hay canciones cargadas de ${esc(a.display_name || "este artista")}.</p></div>`; return; }
    const seen = readSeen();
    const who = a.display_name || "el artista";
    const act = d.active || [], done = d.done || [];
    const news = allSongs(d).filter((s) => isNew(s, seen)).length;
    body.innerHTML = `
      ${news ? `<p class="pr-news">${news === 1 ? "1 canción se movió" : `${news} canciones se movieron`} desde tu última visita.</p>` : ""}
      <section class="card pr-card">
        <div class="pr-card-head"><h2 class="card-title">En proceso</h2><span class="songs-count">${act.length}</span></div>
        ${act.length ? `<ul class="pr-songs">${act.map((s, i) => songHtml(s, i, seen, who)).join("")}</ul>` : `<p class="muted">No hay canciones en proceso ahora.</p>`}
      </section>
      ${done.length ? `
      <details class="card pr-card pr-done"${act.length ? "" : " open"}>
        <summary><span class="card-title">Terminadas</span><span class="songs-count">${done.length}</span></summary>
        <ul class="pr-done-list">${done.map((s, i) => doneHtml(s, i, seen)).join("")}</ul>
      </details>` : ""}
      <p class="pr-foot">Vista de solo seguimiento: las aprobaciones y las modificaciones las maneja ${esc(who)} con Zeche.</p>`;
    // Lo que vio queda como visto (la marca de Nuevo se ve esta vez).
    markSeen(allSongs(d));
    const byKey = {};
    allSongs(d).forEach((s) => { if (s.delivery && s.delivery.file) byKey[`song:${s.id}:${s.delivery.kind}`] = s; });
    body.querySelectorAll(".pr-play").forEach((b) => b.addEventListener("click", () => {
      const s = byKey[b.dataset.key];
      if (!s) return;
      play({
        key: b.dataset.key, url: s.delivery.file.url, title: s.title, sub: `${NOUN[s.delivery.kind]} · ${who}`,
        refresh: async () => {
          const nd = await fetchSongs(a.id, true);
          const ns = allSongs(nd).find((x) => x.id === s.id);
          return ns && ns.delivery && ns.delivery.file ? ns.delivery.file.url : null;
        },
      });
    }));
  }

  // ---------- Archivos ----------
  function fileHtml(f, key) {
    const date = f.modified ? fmtDay(new Date(f.modified)) : "";
    const meta = [f.tag ? TAG[f.tag] : "", date, fmtSize(f.size)].filter(Boolean).join(" · ");
    return `
      <li class="pr-file">
        <span class="pr-file-name"><b>${esc(f.name)}</b><small>${esc(meta)}</small></span>
        <span class="pr-acts">${AUDIO.test(f.name) && f.url ? playBtn(key) : ""}${downBtn(f.url, f.name)}</span>
      </li>`;
  }

  async function showFiles(fresh) {
    const a = current;
    const my = ++ticket;
    const body = $("prBody");
    body.innerHTML = `
      <div class="pr-sections" role="tablist" aria-label="Carpetas">
        ${SECTIONS.map(([k, name]) => `<button type="button" role="tab" class="pr-sec${k === section ? " is-active" : ""}" data-sec="${k}" aria-selected="${k === section}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-${k}"/></svg>${name}</button>`).join("")}
      </div>
      <div id="prFiles"><p class="muted pr-loading">Abriendo ${esc(SECTIONS.find((s) => s[0] === section)[1])}…</p></div>`;
    body.querySelector(".pr-sections").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sec]");
      if (b && b.dataset.sec !== section) { section = b.dataset.sec; showFiles(); }
    });
    const sec = section;
    let d;
    try { d = await fetchFiles(a.id, sec, fresh); }
    catch (e) {
      if (my !== ticket) return;
      $("prFiles").innerHTML = `<div class="card pr-msg"><p>${esc(e.message)}</p><button class="btn" type="button">Reintentar</button></div>`;
      $("prFiles").querySelector("button").addEventListener("click", () => showFiles(true));
      return;
    }
    if (my !== ticket || current !== a || sec !== section) return;
    const box = $("prFiles");
    const hint = SECTIONS.find((s) => s[0] === sec)[2];
    if (!d.configured || !d.exists || (!(d.files || []).length && !(d.groups || []).some((g) => g.files.length))) {
      box.innerHTML = `<div class="card pr-msg"><p>${d.configured ? `Todavía no hay nada en ${esc(SECTIONS.find((s) => s[0] === sec)[1])}.` : "Todavía no está conectada la carpeta de este artista."}</p></div>`;
      return;
    }
    const files = {};
    let n = 0;
    const row = (f) => { const key = `file:${sec}:${n++}`; files[key] = f; return fileHtml(f, key); };
    const loose = (d.files || []).map(row).join("");
    const groups = (d.groups || []).filter((g) => g.files.length).map((g, i) => `
      <details class="pr-group" style="--i:${i}"${(d.groups || []).length <= 2 ? " open" : ""}>
        <summary><b>${esc(g.name)}</b><span class="songs-count">${g.files.length}</span></summary>
        <ul class="pr-files">${g.files.map(row).join("")}</ul>
      </details>`).join("");
    box.innerHTML = `
      <section class="card pr-card">
        <p class="pr-sec-hint">${esc(hint)}. Para escuchar o bajar.</p>
        ${loose ? `<ul class="pr-files">${loose}</ul>` : ""}
        ${groups}
      </section>`;
    box.querySelectorAll(".pr-play").forEach((b) => b.addEventListener("click", () => {
      const f = files[b.dataset.key];
      if (!f) return;
      play({
        key: b.dataset.key, url: f.url, title: f.name.replace(/\.[a-z0-9]{2,5}$/i, ""), sub: `${SECTIONS.find((s) => s[0] === sec)[1]} · ${a.display_name || ""}`,
        refresh: async () => {
          const nd = await fetchFiles(a.id, sec, true);
          const all = [...(nd.files || []), ...(nd.groups || []).flatMap((g) => g.files)];
          const hit = all.find((x) => x.name === f.name);
          return hit ? hit.url : null;
        },
      });
    }));
  }

  // ---------- Administrador: en el perfil de un productor o de un artista ----------
  let zone = null;
  async function adminZone(p, show) {
    if (!zone) {
      zone = el("div", "card pr-admin");
      const anchor = $("accessZone");
      anchor.parentNode.insertBefore(zone, anchor);
    }
    const asArtist = p.role === "artist";
    zone.hidden = !show || !(asArtist || p.role === "producer");
    if (zone.hidden) return;
    const target = p;
    const name = P.nameOf(target);
    zone.innerHTML = `
      ${asArtist ? `
      <div class="pr-switch-row">
        <div>
          <h2 class="card-title">Productor/Artista <span class="chip ${target.also_producer ? "chip-on" : "chip-off"}">${target.also_producer ? "Sí" : "No"}</span></h2>
          <p class="hint">${target.also_producer
            ? `Además de su portal de artista, tiene arriba el interruptor para pasar a la Vista de productor y seguir a los artistas que marques acá abajo.`
            : `Prendelo si ${esc(name)} también produce: suma el interruptor Artista · Productor a su portal, para seguir proyectos que hagan juntos.`}</p>
        </div>
        <button class="btn${target.also_producer ? "" : " btn-primary"}" type="button" data-toggle>${target.also_producer ? "Sacar vista de productor" : "También es productor"}</button>
      </div>` : ""}
      <div class="pr-follow"${asArtist && !target.also_producer ? " hidden" : ""}>
        <h2 class="card-title">Artistas que sigue</h2>
        <p class="hint">Solo ve las canciones (etapa y la mezcla/master entregado para escuchar) y las carpetas Referencias, Letras, Exports y Masters de los artistas que marques. No ve lo que te dice el artista, ni fechas de entrega, sesiones, Membresía ni datos personales, y no puede aprobar, dejar notas ni subir nada${asArtist ? " en lo de ellos" : ". Tampoco recibe avisos"}.</p>
        <div class="pr-pick" aria-live="polite"><p class="muted">Cargando…</p></div>
      </div>
      <p class="msg" role="status"></p>`;
    const msg = zone.querySelector(".msg");
    const toggle = zone.querySelector("[data-toggle]");
    if (toggle) toggle.addEventListener("click", async () => {
      const next = !target.also_producer;
      toggle.disabled = true;
      P.setMsg(msg, "Guardando…");
      const { data, error } = await db.from("profiles").update({ also_producer: next }).eq("id", target.id).select().single();
      toggle.disabled = false;
      if (error || !data) { P.setMsg(msg, "No pudimos guardarlo. ¿Ya corriste supabase/037_productor_artista.sql?", true); return; }
      target.also_producer = data.also_producer;
      await adminZone(target, true);
      P.setMsg(zone.querySelector(".msg"), next ? `Listo: ${name} ya tiene la Vista de productor. Marcá qué artistas sigue.` : `Listo: ${name} vuelve a ser solo artista.`);
    });
    if (asArtist && !target.also_producer) return;

    const pick = zone.querySelector(".pr-pick");
    const [all, mine] = await Promise.all([
      db.from("profiles").select("id, display_name, full_name, active, role").eq("role", "artist"),
      db.from("producer_artists").select("artist_id").eq("producer_id", target.id),
    ]);
    if (!P.me || zone.hidden || !zone.contains(pick)) return;
    if (all.error || mine.error) { pick.innerHTML = `<p class="muted">No pudimos cargar los artistas. ¿Ya corriste supabase/036_productor.sql?</p>`; return; }
    const on = new Set((mine.data || []).map((r) => r.artist_id));
    const list = (all.data || []).filter((x) => x.id !== target.id && (x.active !== false || on.has(x.id)))
      .sort((x, y) => P.nameOf(x).localeCompare(P.nameOf(y), "es", { sensitivity: "base" }));
    if (!list.length) { pick.innerHTML = `<p class="muted">Todavía no hay otros artistas con cuenta.</p>`; return; }
    pick.replaceChildren(...list.map((x) => {
      const b = el("button", `pr-chip${on.has(x.id) ? " is-on" : ""}`);
      b.type = "button";
      b.setAttribute("aria-pressed", on.has(x.id) ? "true" : "false");
      b.innerHTML = `<span class="pr-chip-box" aria-hidden="true"></span>${esc(P.nameOf(x))}`;
      b.addEventListener("click", async () => {
        if (b.getAttribute("aria-busy") === "true") return;
        const next = !on.has(x.id);
        b.setAttribute("aria-busy", "true");
        b.classList.toggle("is-on", next);
        b.setAttribute("aria-pressed", next ? "true" : "false");
        const res = next
          ? await db.from("producer_artists").insert({ producer_id: target.id, artist_id: x.id })
          : await db.from("producer_artists").delete().eq("producer_id", target.id).eq("artist_id", x.id);
        b.removeAttribute("aria-busy");
        if (res.error) {
          b.classList.toggle("is-on", !next);
          b.setAttribute("aria-pressed", !next ? "true" : "false");
          P.setMsg(msg, "No pudimos guardarlo. Probá de nuevo.", true);
          return;
        }
        if (next) on.add(x.id); else on.delete(x.id);
        P.setMsg(msg, next ? `Listo: ${name} ya ve a ${P.nameOf(x)}.` : `Listo: ${name} ya no ve a ${P.nameOf(x)}.`);
      });
      return b;
    }));
  }

  // ---------- Productor/Artista: interruptor Artista · Productor ----------
  const modeKey = () => `zg-modo-${P.me ? P.me.id : ""}`;
  let mode = "artist";
  let sw = null;

  function paintSwitch() {
    if (!sw) return;
    sw.dataset.mode = mode;
    sw.querySelectorAll("[data-mode]").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function setMode(next, remember = true) {
    const me = P.me;
    if (!me || me.role !== "artist" || !me.also_producer) return;
    mode = next === "producer" ? "producer" : "artist";
    if (remember) { try { localStorage.setItem(modeKey(), mode); } catch (e) { /* sin almacenamiento */ } }
    paintSwitch();
    const body = document.body;
    body.classList.add("pr-switching");
    setTimeout(() => body.classList.remove("pr-switching"), 450);
    if (mode === "producer") {
      body.classList.remove("is-artist");
      body.classList.add("is-producer", "is-dual");
      delete body.dataset.atab;
      $("artistTabs").hidden = true;
      open(me);
    } else {
      stop();
      current = null;
      body.classList.remove("is-producer");
      body.classList.add("is-artist", "is-dual");
      $("artistTabs").hidden = false;
      const tag = document.querySelector(".nav-tag");
      if (tag) tag.textContent = "Portal de artistas";
      if (window.ZGArtistNav && window.ZGArtistNav.go) window.ZGArtistNav.go("proyecto");
      else P.showProfile(me);
    }
    if (window.zgTrack) window.zgTrack("portal_modo", { modo: mode });
  }

  // Lo llama portal.js al entrar con una cuenta de artista.
  function ready(me) {
    if (sw) { sw.remove(); sw = null; }
    document.body.classList.remove("is-dual");
    if (!me || me.role !== "artist" || !me.also_producer) return;
    sw = el("div", "pr-mode", `
      <span class="pr-mode-thumb" aria-hidden="true"></span>
      <button type="button" role="radio" data-mode="artist">Artista</button>
      <button type="button" role="radio" data-mode="producer">Productor</button>`);
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", "Vista");
    const right = document.querySelector("nav .nav-right");
    right.insertBefore(sw, $("logoutBtn"));
    sw.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b && b.dataset.mode !== mode) setMode(b.dataset.mode);
    });
    let saved = "artist";
    try { saved = localStorage.getItem(modeKey()) || "artist"; } catch (e) { saved = "artist"; }
    mode = "artist";
    document.body.classList.add("is-dual");
    paintSwitch();
    if (saved === "producer") setMode("producer", false);
  }

  // Al salir se corta lo que esté sonando.
  const logout = $("logoutBtn");
  if (logout) logout.addEventListener("click", () => {
    stop(); songsCache.clear(); filesCache.clear();
    if (sw) { sw.remove(); sw = null; }
    document.body.classList.remove("is-dual", "is-producer");
  });

  window.ZGProducer = { open, adminZone, stop, ready, setMode, get mode() { return mode; } };
})();
