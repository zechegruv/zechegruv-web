// ZECHE GRUV — Portal de artistas: escuchar y aprobar la mezcla o el master.
// Se abre desde "Canciones" (o desde Mi proyecto) cuando Zeche ya entregó
// el audio: un archivo con "mix" o "master" en el nombre en la carpeta del
// artista (lo detecta netlify/functions/_lib/song-audio.js).
//
// El artista escucha, frena en el segundo exacto y deja una nota ("acá la
// voz está baja"). Las notas quedan marcadas sobre la onda del audio y se
// guardan en este dispositivo hasta que las manda; al mandarlas le llegan a
// Zeche con su minuto y segundo (mail, Notion y el portal). Si está todo
// bien, aprueba.
//
// El administrador abre lo mismo desde el perfil del artista: ve las notas
// que le dejaron sobre la onda y, tocando una, el audio salta a ese momento.
(() => {
  const P = window.ZGPortal;
  const { db } = P;

  const WHAT = { mezcla: "la mezcla", master: "el master" };
  const NOUN = { mezcla: "Mezcla", master: "Master" };
  const QUICK = ["Subir la voz", "Bajar la voz", "Más graves", "Menos efecto en la voz", "Más fuerte acá", "Me encanta esta parte"];
  const WAVE_MAX_BYTES = 25 * 1024 * 1024; // más grande (WAV largos): sin onda, se escucha igual
  const BARS = 140;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const clock = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const fmtDay = (iso) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } },
  };
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 001.5.86l10.6-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8.5L9 12l3.5 3.5M15.5 8.5L12 12l3.5 3.5"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 8.5L15 12l-3.5 3.5M8.5 8.5L12 12l-3.5 3.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
  };

  // ---------- La hoja (se arma una sola vez) ----------
  const root = document.createElement("div");
  root.className = "rv";
  root.hidden = true;
  root.innerHTML = `
    <div class="rv-backdrop" data-rv="close"></div>
    <section class="rv-sheet" role="dialog" aria-modal="true" aria-labelledby="rvTitle">
      <header class="rv-head">
        <div class="rv-head-text">
          <span class="rv-eyebrow" id="rvEyebrow"></span>
          <h2 class="rv-title" id="rvTitle"></h2>
          <span class="rv-file" id="rvFile"></span>
        </div>
        <button class="rv-icon rv-x" type="button" data-rv="close" aria-label="Cerrar">${ICON.close}</button>
      </header>
      <div class="rv-body">
        <div class="rv-banner" id="rvBanner" hidden></div>
        <div class="rv-player">
          <div class="rv-wave" id="rvWave" role="slider" tabindex="0" aria-label="Posición del audio" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
            <canvas id="rvCanvas" aria-hidden="true"></canvas>
            <span class="rv-head-line" id="rvLine" aria-hidden="true"></span>
            <div class="rv-pins" id="rvPins"></div>
          </div>
          <div class="rv-controls">
            <span class="rv-time" id="rvNow">0:00</span>
            <div class="rv-transport">
              <button class="rv-icon rv-skip" type="button" data-rv="back" aria-label="Volver 5 segundos">${ICON.back}<small>5</small></button>
              <button class="rv-play" type="button" id="rvPlay" aria-label="Reproducir">${ICON.play}</button>
              <button class="rv-icon rv-skip" type="button" data-rv="fwd" aria-label="Adelantar 5 segundos">${ICON.fwd}<small>5</small></button>
            </div>
            <span class="rv-time rv-total" id="rvTotal">0:00</span>
          </div>
          <p class="rv-loading" id="rvLoading" role="status"></p>
        </div>

        <button class="rv-mark" type="button" id="rvMark" hidden>
          <span class="rv-mark-ico">${ICON.pin}</span>
          <span>Dejar una nota en <b id="rvMarkAt">0:00</b></span>
        </button>

        <form class="rv-compose" id="rvCompose" hidden>
          <div class="rv-compose-top">
            <span class="rv-chip-time"><button type="button" data-rv="nudge" data-d="-2" aria-label="2 segundos antes">‹</button><b id="rvComposeAt">0:00</b><button type="button" data-rv="nudge" data-d="2" aria-label="2 segundos después">›</button></span>
            <span class="rv-compose-hint">¿Qué pasa en este momento?</span>
          </div>
          <label class="sr-only" for="rvComposeText">Tu nota</label>
          <textarea id="rvComposeText" rows="2" maxlength="500" placeholder="Ej.: acá la voz queda tapada por la guitarra"></textarea>
          <div class="rv-quick" id="rvQuick">${QUICK.map((q) => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join("")}</div>
          <div class="rv-compose-actions">
            <button class="btn" type="button" data-rv="cancel">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar nota</button>
          </div>
        </form>

        <div class="rv-notes-wrap">
          <div class="rv-notes-head"><h3 id="rvNotesTitle">Tus notas</h3><span id="rvNotesCount"></span></div>
          <ol class="rv-notes" id="rvNotes"></ol>
          <p class="rv-empty" id="rvEmpty"></p>
          <p class="rv-general" id="rvGeneral" hidden></p>
        </div>
      </div>
      <footer class="rv-foot" id="rvFoot"></footer>
      <div class="rv-done" id="rvDone" hidden></div>
      <audio id="rvAudio" preload="metadata"></audio>
    </section>`;
  document.body.append(root);
  const $ = (id) => root.querySelector(`#${id}`);
  const audio = $("rvAudio");

  let cur = null; // { song, kind, own, mode, file, notes, sentMarks, key, onSent }
  let peaks = null;
  let lastFocus = null;
  let composeAt = 0;
  let activeNote = -1;
  const peakCache = new Map();

  // ---------- Abrir y cerrar ----------
  // mode: "review" (el artista puede dejar notas y aprobar), "view" (solo escuchar y leer).
  function open(song, { own = false, onSent = null } = {}) {
    const d = song.delivery;
    if (!d || !d.file) return;
    const review = d.review || null;
    const mode = own && d.state === "aprobar" ? "review" : "view";
    const key = `zg-notas:${song.id}:${d.file.name}:${d.file.modified || ""}`;
    cur = {
      song, kind: d.kind, own, mode, file: d.file, key, onSent, state: d.state, review,
      notes: mode === "review" ? (store.get(key) || []) : ((review && review.marks) || []).map((m) => ({ ...m })),
      general: mode === "review" ? (store.get(key + ":g") || "") : ((review && review.note) || ""),
    };
    lastFocus = document.activeElement;
    $("rvEyebrow").textContent = `${NOUN[d.kind]}${song.feat ? ` · feat. ${song.feat}` : ""}`;
    $("rvTitle").textContent = song.title;
    $("rvFile").textContent = d.file.name;
    $("rvDone").hidden = true;
    $("rvCompose").hidden = true;
    $("rvMark").hidden = mode !== "review";
    root.classList.toggle("is-view", mode !== "review");
    paintBanner();
    paintNotes();
    paintFoot();
    loadAudio(d.file);
    root.hidden = false;
    document.documentElement.classList.add("rv-lock");
    requestAnimationFrame(() => { root.classList.add("is-open"); resize(); });
    $("rvPlay").focus({ preventScroll: true });
    if (window.zgTrack && own) window.zgTrack("portal_escuchar", { etapa: d.kind });
  }

  function close() {
    if (root.hidden) return;
    audio.pause();
    root.classList.remove("is-open");
    document.documentElement.classList.remove("rv-lock");
    setTimeout(() => { root.hidden = true; audio.removeAttribute("src"); audio.load(); }, 260);
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    cur = null;
  }

  // ---------- Audio y onda ----------
  function loadAudio(file) {
    peaks = null;
    activeNote = -1;
    audio.src = file.url;
    audio.currentTime = 0;
    $("rvNow").textContent = "0:00";
    $("rvTotal").textContent = "–:––";
    $("rvLoading").textContent = "";
    setPlaying(false);
    draw();
    const known = peakCache.get(file.url);
    if (known) { peaks = known; draw(); return; }
    // La onda se dibuja con el audio real cuando el archivo no es enorme y
    // OneDrive deja leerlo; si no, queda una línea y se escucha igual.
    if (file.size && file.size > WAVE_MAX_BYTES) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const url = file.url;
    fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => new Promise((ok, no) => { const ctx = new Ctx(); ctx.decodeAudioData(buf, (b) => { ok(b); ctx.close && ctx.close(); }, no); }))
      .then((buffer) => {
        const data = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const out = [];
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 16) { const v = Math.abs(data[j]); if (v > max) max = v; }
          out.push(max);
        }
        const top = Math.max(...out) || 1;
        const norm = out.map((v) => Math.max(0.06, Math.pow(v / top, 0.8)));
        peakCache.set(url, norm);
        if (cur && cur.file.url === url) { peaks = norm; draw(); }
      })
      .catch(() => {});
  }

  function setPlaying(on) {
    $("rvPlay").innerHTML = on ? ICON.pause : ICON.play;
    $("rvPlay").setAttribute("aria-label", on ? "Pausar" : "Reproducir");
    root.classList.toggle("is-playing", on);
  }

  const duration = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

  function resize() {
    const c = $("rvCanvas");
    const box = $("rvWave").getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(box.width * dpr));
    c.height = Math.max(1, Math.round(box.height * dpr));
    draw();
    paintPins();
  }
  window.addEventListener("resize", () => { if (!root.hidden) resize(); });

  function draw() {
    const c = $("rvCanvas");
    const g = c.getContext("2d");
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const dur = duration();
    const pos = dur ? audio.currentTime / dur : 0;
    const n = BARS;
    const gap = Math.max(1, w / n * 0.38);
    const bw = w / n - gap;
    for (let i = 0; i < n; i++) {
      const v = peaks ? peaks[i] : 0.12;
      const bh = Math.max(2, v * h * 0.92);
      const x = i * (bw + gap) + gap / 2;
      g.fillStyle = (i + 0.5) / n <= pos ? "#F07800" : peaks ? "rgba(240,224,192,.26)" : "rgba(240,224,192,.16)";
      const y = (h - bh) / 2;
      const r = Math.min(bw / 2, 3);
      if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill(); } else g.fillRect(x, y, bw, bh);
    }
    $("rvLine").style.left = `${pos * 100}%`;
    const wave = $("rvWave");
    wave.setAttribute("aria-valuemax", String(Math.round(dur)));
    wave.setAttribute("aria-valuenow", String(Math.round(audio.currentTime)));
    wave.setAttribute("aria-valuetext", `${clock(audio.currentTime)} de ${clock(dur)}`);
  }

  audio.addEventListener("loadedmetadata", () => { $("rvTotal").textContent = clock(duration()); paintPins(); draw(); });
  audio.addEventListener("timeupdate", () => {
    $("rvNow").textContent = clock(audio.currentTime);
    $("rvMarkAt").textContent = clock(audio.currentTime);
    draw();
    highlightNear();
  });
  audio.addEventListener("play", () => setPlaying(true));
  audio.addEventListener("pause", () => setPlaying(false));
  audio.addEventListener("ended", () => setPlaying(false));
  audio.addEventListener("waiting", () => { $("rvLoading").textContent = "Cargando audio…"; });
  audio.addEventListener("playing", () => { $("rvLoading").textContent = ""; });
  audio.addEventListener("error", () => {
    if (!cur) return;
    $("rvLoading").textContent = "No pudimos abrir el audio. Cerrá y volvé a abrir (el link se renueva cada tanto).";
  });

  function toggle() { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
  function seek(t, play) {
    const dur = duration();
    if (!dur) return;
    audio.currentTime = Math.min(Math.max(0, t), dur - 0.05);
    draw();
    if (play) audio.play().catch(() => {});
  }

  // Tocar o arrastrar sobre la onda para moverse.
  const wave = $("rvWave");
  let dragging = false;
  const tAt = (e) => { const b = wave.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * duration(); };
  wave.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".rv-pin")) return;
    dragging = true;
    wave.setPointerCapture(e.pointerId);
    seek(tAt(e));
  });
  wave.addEventListener("pointermove", (e) => { if (dragging) seek(tAt(e)); });
  wave.addEventListener("pointerup", () => { dragging = false; });
  wave.addEventListener("pointercancel", () => { dragging = false; });
  wave.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { seek(audio.currentTime - 5); e.preventDefault(); }
    if (e.key === "ArrowRight") { seek(audio.currentTime + 5); e.preventDefault(); }
  });

  // ---------- Notas ----------
  const sortNotes = () => cur.notes.sort((a, b) => a.t - b.t);
  const saveDraft = () => { if (cur && cur.mode === "review") { store.set(cur.key, cur.notes.length ? cur.notes : null); store.set(cur.key + ":g", cur.general || null); } };

  function paintPins() {
    const box = $("rvPins");
    const dur = duration();
    if (!cur || !dur) { box.innerHTML = ""; return; }
    box.innerHTML = cur.notes.map((n, i) => `
      <button class="rv-pin${i === activeNote ? " is-on" : ""}" type="button" data-pin="${i}" style="left:${Math.min(100, (n.t / dur) * 100)}%" aria-label="Nota ${i + 1} en ${clock(n.t)}: ${esc(n.text)}"><span>${i + 1}</span></button>`).join("");
  }

  function paintNotes() {
    const own = cur.own;
    const list = cur.notes;
    $("rvNotesTitle").textContent = cur.mode === "review" ? "Tus notas" : own ? "Las notas que mandaste" : "Notas del artista";
    $("rvNotesCount").textContent = list.length ? String(list.length) : "";
    $("rvNotes").innerHTML = list.map((n, i) => `
      <li class="rv-note${i === activeNote ? " is-on" : ""}" data-i="${i}">
        <button class="rv-note-time" type="button" data-jump="${i}" aria-label="Escuchar desde ${clock(n.t)}"><span class="rv-note-n">${i + 1}</span>${clock(n.t)}</button>
        <p class="rv-note-text">${esc(n.text)}</p>
        ${cur.mode === "review" ? `<button class="rv-icon rv-note-del" type="button" data-del="${i}" aria-label="Borrar nota de ${clock(n.t)}">${ICON.trash}</button>` : ""}
      </li>`).join("");
    let empty = "";
    if (!list.length) {
      if (cur.mode === "review") empty = "Escuchá tranquilo. Si algo no te cierra, frená en ese momento y tocá «Dejar una nota»: a Zeche le llega en el segundo exacto.";
      else if (!own) empty = cur.state === "aprobar" ? "Todavía no dejó notas." : "Sin notas en el tiempo.";
      else empty = "No dejaste notas en el tiempo.";
    }
    $("rvEmpty").textContent = empty;
    $("rvEmpty").hidden = !empty;
    const g = cur.mode !== "review" && cur.general;
    $("rvGeneral").hidden = !g;
    if (g) $("rvGeneral").innerHTML = `<span>Comentario general</span>${esc(cur.general)}`;
    paintPins();
  }

  function highlightNear() {
    if (!cur || !cur.notes.length) return;
    const t = audio.currentTime;
    const i = cur.notes.findIndex((n) => t >= n.t - 0.4 && t < n.t + 3);
    if (i === activeNote) return;
    activeNote = i;
    root.querySelectorAll(".rv-note").forEach((li) => li.classList.toggle("is-on", +li.dataset.i === i));
    root.querySelectorAll(".rv-pin").forEach((b) => b.classList.toggle("is-on", +b.dataset.pin === i));
  }

  function jump(i) {
    const n = cur.notes[i];
    if (!n) return;
    seek(Math.max(0, n.t - 1.5), true); // un toque antes, para escuchar qué pasa
    activeNote = -1;
    highlightNear();
    const li = root.querySelector(`.rv-note[data-i="${i}"]`);
    if (li) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function openCompose() {
    audio.pause();
    composeAt = Math.max(0, audio.currentTime - 0.5);
    $("rvComposeAt").textContent = clock(composeAt);
    $("rvComposeText").value = "";
    $("rvCompose").hidden = false;
    $("rvMark").hidden = true;
    $("rvComposeText").focus();
    $("rvCompose").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function closeCompose() {
    $("rvCompose").hidden = true;
    $("rvMark").hidden = !cur || cur.mode !== "review";
  }

  $("rvCompose").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("rvComposeText").value.trim();
    if (!text) { $("rvComposeText").focus(); return; }
    cur.notes.push({ t: Math.round(composeAt * 10) / 10, text: text.slice(0, 500) });
    sortNotes();
    saveDraft();
    closeCompose();
    paintNotes();
    paintFoot();
    if (window.zgTrack) window.zgTrack("portal_nota_audio", { etapa: cur.kind });
  });
  $("rvQuick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b) return;
    const box = $("rvComposeText");
    box.value = box.value.trim() ? `${box.value.trim()}. ${b.dataset.quick.toLowerCase()}` : b.dataset.quick;
    box.focus();
  });

  // ---------- Banner y botones de abajo ----------
  function paintBanner() {
    const b = $("rvBanner");
    const r = cur.review;
    let html = "", tone = "";
    if (cur.mode === "review") {
      html = r && r.action === "cambios"
        ? `<b>Versión nueva.</b> Zeche ya trabajó lo que le pediste el ${esc(fmtDay(r.at))}. Escuchala y contanos.`
        : `<b>${cur.kind === "mezcla" ? "Mezcla lista" : "Master listo"}.</b> ${cur.kind === "mezcla" ? "Escuchala" : "Escuchalo"} con auriculares o en un buen parlante, de principio a fin.`;
    } else if (cur.state === "cambios") {
      tone = "wait";
      html = cur.own
        ? `<b>Zeche está trabajando tus cambios.</b> Le mandaste ${cur.notes.length ? `${cur.notes.length} ${cur.notes.length === 1 ? "nota" : "notas"}` : "tu pedido"} el ${esc(fmtDay(r.at))}. Cuando suba la versión nueva, te aparece acá para escucharla.`
        : `<b>Pidió cambios el ${esc(fmtDay(r.at))}.</b> Tocá cada nota y el audio salta a ese momento.`;
    } else if (cur.state === "aprobada") {
      tone = "ok";
      html = r ? `<b>${cur.own ? "Aprobaste" : "Aprobó"} ${WHAT[cur.kind]} el ${esc(fmtDay(r.at))}.</b>` : `<b>${cur.kind === "mezcla" ? "Mezcla aprobada" : "Master aprobado"}.</b>`;
    } else if (!cur.own) {
      tone = "wait";
      html = r && r.action === "cambios"
        ? `<b>Versión nueva entregada.</b> Esperando que la escuche. Abajo, las notas que dejó sobre la anterior.`
        : `<b>${cur.kind === "mezcla" ? "Mezcla entregada" : "Master entregado"}.</b> Esperando que ${cur.kind === "mezcla" ? "la" : "lo"} escuche y ${cur.kind === "mezcla" ? "la" : "lo"} apruebe.`;
    }
    b.className = `rv-banner${tone ? ` is-${tone}` : ""}`;
    b.innerHTML = html;
    b.hidden = !html;
    // Admin con versión nueva: las notas de la anterior siguen a la vista.
    if (!cur.own && cur.state === "aprobar" && r && r.action === "cambios") { cur.notes = (r.marks || []).map((m) => ({ ...m })); cur.general = r.note || ""; }
  }

  function paintFoot() {
    const f = $("rvFoot");
    if (cur.mode !== "review") {
      f.innerHTML = `<button class="btn rv-wide" type="button" data-rv="close">Cerrar</button>`;
      return;
    }
    const n = cur.notes.length;
    if (n) {
      f.innerHTML = `
        <details class="rv-gen"${cur.general ? " open" : ""}>
          <summary>${cur.general ? "Comentario general" : "Sumar un comentario general (opcional)"}</summary>
          <label class="sr-only" for="rvGenText">Comentario general</label>
          <textarea id="rvGenText" rows="2" maxlength="1000" placeholder="Algo que valga para toda la canción">${esc(cur.general)}</textarea>
        </details>
        <button class="btn btn-primary rv-wide" type="button" data-rv="send">Mandar ${n === 1 ? "la nota" : `las ${n} notas`} a Zeche</button>
        <p class="rv-foot-hint">Zeche las recibe con el minuto exacto y te avisa cuando esté la versión nueva.</p>
        <p class="msg rv-msg" id="rvMsg" role="status"></p>`;
    } else {
      f.innerHTML = `
        <button class="btn btn-primary rv-wide" type="button" data-rv="approve">${ICON.check}<span>Aprobar ${WHAT[cur.kind]}</span></button>
        <p class="rv-foot-hint">¿Algo para cambiar? Frená en el momento justo y dejá una nota.</p>
        <p class="msg rv-msg" id="rvMsg" role="status"></p>`;
    }
  }

  function armApprove(btn) {
    if (btn.classList.contains("is-armed")) return true;
    btn.classList.add("is-armed");
    btn.querySelector("span").textContent = `Tocá de nuevo para aprobar ${WHAT[cur.kind]}`;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { if (btn.isConnected) { btn.classList.remove("is-armed"); btn.querySelector("span").textContent = `Aprobar ${WHAT[cur.kind]}`; } }, 4000);
    return false;
  }

  async function send(action) {
    const msg = $("rvMsg");
    const buttons = $("rvFoot").querySelectorAll("button");
    buttons.forEach((b) => { b.disabled = true; });
    P.setMsg(msg, "Enviando…");
    const gen = $("rvGenText");
    if (gen) cur.general = gen.value.trim();
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          song: cur.song.id, kind: cur.kind, action, version: cur.file.name,
          note: action === "cambios" ? (cur.general || null) : null,
          marks: action === "cambios" ? cur.notes : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviarlo. Probá de nuevo.");
      store.set(cur.key, null);
      store.set(cur.key + ":g", null);
      if (window.zgTrack) window.zgTrack("portal_aprobacion", { etapa: cur.kind, accion: action, notas: cur.notes.length });
      const n = cur.notes.length;
      audio.pause();
      $("rvDone").innerHTML = action === "aprobada"
        ? `<img class="rv-done-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true"><span class="rv-done-ico">${ICON.check}</span><h3>¡${NOUN[cur.kind]} aprobad${cur.kind === "mezcla" ? "a" : "o"}!</h3><p>${cur.kind === "mezcla" ? "Seguimos con el master. Te avisamos apenas esté para escucharlo." : "Tu canción está terminada. Ahora, a prepararla para que salga."}</p><button class="btn btn-primary" type="button" data-rv="close">Listo</button>`
        : `<img class="rv-done-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true"><span class="rv-done-ico">${ICON.check}</span><h3>Zeche ya tiene tus notas</h3><p>${n ? `${n === 1 ? "Le llegó tu nota" : `Le llegaron tus ${n} notas`}, cada una en su momento exacto.` : "Le llegó tu pedido."} Cuando suba la versión nueva, te aparece acá para escuchar${cur.kind === "mezcla" ? "la" : "lo"}.</p><button class="btn btn-primary" type="button" data-rv="close">Listo</button>`;
      $("rvDone").hidden = false;
      if (cur.onSent) cur.onSent(data.review);
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      P.setMsg(msg, err.message, true);
    }
  }

  // ---------- Eventos ----------
  root.addEventListener("click", (e) => {
    const pin = e.target.closest("[data-pin]");
    if (pin) { jump(+pin.dataset.pin); return; }
    const j = e.target.closest("[data-jump]");
    if (j) { jump(+j.dataset.jump); return; }
    const del = e.target.closest("[data-del]");
    if (del) { cur.notes.splice(+del.dataset.del, 1); saveDraft(); paintNotes(); paintFoot(); return; }
    const b = e.target.closest("[data-rv]");
    if (!b) return;
    const act = b.dataset.rv;
    if (act === "close") close();
    else if (act === "back") seek(audio.currentTime - 5);
    else if (act === "fwd") seek(audio.currentTime + 5);
    else if (act === "cancel") closeCompose();
    else if (act === "nudge") { composeAt = Math.min(Math.max(0, composeAt + +b.dataset.d), duration() || composeAt + 2); $("rvComposeAt").textContent = clock(composeAt); seek(composeAt); }
    else if (act === "send") send("cambios");
    else if (act === "approve") { if (armApprove(b)) send("aprobada"); }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "rvGenText" && cur) { cur.general = e.target.value; saveDraft(); } });
  $("rvPlay").addEventListener("click", toggle);
  $("rvMark").addEventListener("click", openCompose);
  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") { if (!$("rvCompose").hidden) closeCompose(); else close(); return; }
    const typing = /^(TEXTAREA|INPUT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if (e.key === " " && !(document.activeElement && document.activeElement.tagName === "BUTTON")) { e.preventDefault(); toggle(); }
    if ((e.key === "n" || e.key === "N") && cur && cur.mode === "review") { e.preventDefault(); openCompose(); }
  });
  // Foco atrapado dentro de la hoja.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...root.querySelectorAll("button, textarea, summary, [tabindex='0']")].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  // Cuántas notas sin mandar tiene guardadas en este dispositivo.
  function drafts(song) {
    const d = song.delivery;
    if (!d || !d.file) return 0;
    const n = store.get(`zg-notas:${song.id}:${d.file.name}:${d.file.modified || ""}`);
    return Array.isArray(n) ? n.length : 0;
  }

  window.ZGReview = { open, close, drafts, clock };
})();
