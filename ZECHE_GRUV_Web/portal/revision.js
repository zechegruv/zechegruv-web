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
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>',
    wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h1.5M8 8v8M11.5 5v14M15 9v6M18.5 11v2"/></svg>',
  };
  const VOICE_MAX_S = 60;

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
          <div class="rv-ab" id="rvAB" role="group" aria-label="Comparar versiones" hidden></div>
          <p class="rv-ab-hint" id="rvABHint" role="status" hidden></p>
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
          <div class="rv-voice" id="rvVoice" hidden>
            <button class="rv-rec" type="button" data-rv="rec" id="rvRec">${ICON.mic}<span>O grabala con tu voz</span></button>
            <span class="rv-rec-time" id="rvRecTime" aria-live="polite"></span>
            <audio class="rv-rec-prev" id="rvRecPrev" controls hidden></audio>
          </div>
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

  let cur = null; // { song, kind, own, mode, file, notes, sentMarks, key, onSent, sources, srcIdx }
  let peaks = null;
  const rmsCache = new Map(); // url -> nivel promedio (para igualar el volumen al comparar)
  let pendingSeek = null;     // al cambiar de versión: seguir en el mismo segundo
  let lastFocus = null;
  let composeAt = 0;
  let activeNote = -1;
  const peakCache = new Map();

  // Las notas sin mandar se guardan por canción, archivo y fecha del audio.
  // Antes esa fecha era la del archivo en la compu de Zeche; ahora es la de
  // subida a OneDrive (_lib/song-audio.js). Si quedaron guardadas con la
  // fecha vieja, se pasan a la nueva para que no se pierdan.
  function draftKey(song) {
    const f = song.delivery.file;
    const key = `zg-notas:${song.id}:${f.name}:${f.modified || ""}`;
    try {
      if (localStorage.getItem(key) == null) {
        const prefix = `zg-notas:${song.id}:${f.name}:`;
        const old = Object.keys(localStorage).find((k) => k.startsWith(prefix) && k !== key && !k.endsWith(":g"));
        if (old) {
          localStorage.setItem(key, localStorage.getItem(old));
          if (localStorage.getItem(`${old}:g`) != null) localStorage.setItem(`${key}:g`, localStorage.getItem(`${old}:g`));
          localStorage.removeItem(old);
          localStorage.removeItem(`${old}:g`);
        }
      }
    } catch (e) { /* sin almacenamiento: no hay nada que pasar */ }
    return key;
  }

  // ---------- Abrir y cerrar ----------
  // mode: "review" (el artista puede dejar notas y aprobar), "view" (solo escuchar y leer).
  function open(song, { own = false, onSent = null } = {}) {
    const d = song.delivery;
    if (!d || !d.file) return;
    const review = d.review || null;
    const mode = own && d.state === "aprobar" ? "review" : "view";
    const key = draftKey(song);
    cur = {
      song, kind: d.kind, own, mode, file: d.file, key, onSent, state: d.state, review,
      notes: mode === "review" ? (store.get(key) || []) : ((review && review.marks) || []).map((m) => ({ ...m })),
      general: mode === "review" ? (store.get(key + ":g") || "") : ((review && review.note) || ""),
    };
    // Para comparar: esta versión, las anteriores (A/B) y la maqueta (antes y después).
    const total = (d.versions || []).length + 1;
    cur.sources = [{ label: total > 1 ? "Nueva" : NOUN[d.kind], file: d.file, kind: "now" }]
      .concat((d.versions || []).map((v, i) => ({ label: total === 2 ? "Anterior" : `Versión ${total - 1 - i}`, file: v, kind: "old" })))
      .concat(d.demo ? [{ label: "Maqueta", file: d.demo, kind: "demo" }] : []);
    cur.srcIdx = 0;
    cur.lastOther = 1;
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
    paintAB();
    root.hidden = false;
    document.documentElement.classList.add("rv-lock");
    root.classList.remove("is-other");
    requestAnimationFrame(() => { root.classList.add("is-open"); resize(); glide(); });
    $("rvPlay").focus({ preventScroll: true });
    if (window.zgTrack && own) window.zgTrack("portal_escuchar", { etapa: d.kind });
  }

  function close() {
    if (root.hidden) return;
    audio.pause();
    stopVoice();
    stopRec(true);
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
    pendingSeek = null;
    audio.volume = 1;
    audio.src = file.url;
    audio.currentTime = 0;
    $("rvNow").textContent = "0:00";
    $("rvTotal").textContent = "–:––";
    $("rvLoading").textContent = "";
    setPlaying(false);
    draw();
    loadPeaks(file).then(() => {
      // Con la onda de esta versión lista, se miden las otras (para igualar el volumen).
      if (cur && cur.sources && cur.sources.length > 1) cur.sources.slice(1).reduce((p, s) => p.then(() => loadPeaks(s.file)), Promise.resolve()).then(applyLevel);
    });
  }

  // Onda y nivel promedio de un audio. La onda se dibuja con el audio real
  // cuando el archivo no es enorme y OneDrive deja leerlo; si no, queda una
  // línea y se escucha igual.
  function loadPeaks(file) {
    const known = peakCache.get(file.url);
    if (known) { if (cur && audio.src === file.url) { peaks = known; draw(); } return Promise.resolve(); }
    if (file.size && file.size > WAVE_MAX_BYTES) return Promise.resolve();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve();
    const url = file.url;
    return fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => new Promise((ok, no) => { const ctx = new Ctx(); ctx.decodeAudioData(buf, (b) => { ok(b); ctx.close && ctx.close(); }, no); }))
      .then((buffer) => {
        const data = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const out = [];
        let sum = 0, count = 0;
        for (let j = 0; j < data.length; j += 64) { sum += data[j] * data[j]; count++; }
        if (count) rmsCache.set(url, Math.sqrt(sum / count));
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 16) { const v = Math.abs(data[j]); if (v > max) max = v; }
          out.push(max);
        }
        const top = Math.max(...out) || 1;
        const norm = out.map((v) => Math.max(0.06, Math.pow(v / top, 0.8)));
        peakCache.set(url, norm);
        if (cur && audio.src === url) { peaks = norm; draw(); }
        applyLevel();
      })
      .catch(() => {});
  }

  // ---------- Comparar versiones (A/B) y antes y después ----------
  // Se cambia de versión en el mismo segundo, sin cortar. Si las ondas están
  // medidas, el volumen se iguala (la más fuerte se baja un poco) para que
  // se compare el sonido y no cuál suena más alto.
  function applyLevel() {
    if (!cur || !cur.sources || cur.sources.length < 2) { audio.volume = 1; paintABHint(); return; }
    const levels = cur.sources.map((s) => rmsCache.get(s.file.url)).filter(Boolean);
    const mine = rmsCache.get(cur.sources[cur.srcIdx].file.url);
    let v = 1;
    if (mine && levels.length >= 2) v = Math.min(1, Math.max(0.05, Math.min(...levels) / mine));
    try { audio.volume = v; } catch (e) { /* algunos celulares no dejan */ }
    cur.leveled = levels.length >= 2;
    paintABHint();
  }
  function paintAB() {
    const box = $("rvAB");
    const list = (cur && cur.sources) || [];
    box.hidden = list.length < 2;
    if (box.hidden) { $("rvABHint").hidden = true; return; }
    box.innerHTML = list.map((s, i) => `<button type="button" class="rv-ab-btn${s.kind === "demo" ? " is-demo" : ""}" data-src="${i}" aria-pressed="${i === cur.srcIdx}">${s.kind === "now" ? ICON.wave : ""}<span>${esc(s.label)}</span></button>`).join("") + '<span class="rv-ab-glide" aria-hidden="true"></span>';
    glide();
    paintABHint();
  }
  function glide() {
    const box = $("rvAB");
    const on = box.querySelector('[aria-pressed="true"]');
    const g = box.querySelector(".rv-ab-glide");
    if (!on || !g) return;
    g.style.width = `${on.offsetWidth}px`;
    g.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function paintABHint() {
    const h = $("rvABHint");
    if (!cur || !cur.sources || cur.sources.length < 2) { h.hidden = true; return; }
    const s = cur.sources[cur.srcIdx];
    const level = cur.leveled ? ' <span class="rv-ab-level">Volumen igualado</span>' : "";
    let txt;
    if (s.kind === "demo") txt = `<b>Antes y después.</b> Estás escuchando la maqueta: así arrancó «${esc(cur.song.title)}». Volvé a «Nueva» en el mismo segundo.`;
    else if (s.kind === "old") txt = `<b>Versión anterior.</b> Compará en el mismo segundo. ${cur.mode === "review" ? "Las notas se dejan sobre la nueva." : ""}`;
    else txt = `<b>Compará.</b> Tocá ${cur.sources.length === 2 ? `«${esc(cur.sources[1].label)}»` : "otra versión"} y seguís en el mismo segundo${window.matchMedia("(hover: hover)").matches ? " (o apretá A)" : ""}.`;
    h.innerHTML = txt + level;
    h.hidden = false;
  }
  function switchSource(i) {
    if (!cur || !cur.sources[i] || i === cur.srcIdx) return;
    pendingSeek = { t: audio.currentTime, play: !audio.paused };
    if (i !== 0) cur.lastOther = i;
    cur.srcIdx = i;
    const f = cur.sources[i].file;
    $("rvFile").textContent = f.name;
    root.classList.toggle("is-other", i !== 0);
    peaks = peakCache.get(f.url) || null;
    audio.src = f.url;
    draw();
    loadPeaks(f);
    applyLevel();
    $("rvMark").hidden = cur.mode !== "review" || i !== 0;
    if (i !== 0 && !$("rvCompose").hidden) closeCompose();
    $("rvAB").querySelectorAll("[data-src]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.src === i)));
    glide();
    paintABHint();
    if (window.zgTrack) window.zgTrack("portal_comparar", { version: cur.sources[i].kind });
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
  window.addEventListener("resize", () => { if (!root.hidden) { resize(); glide(); } });

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
      // Con barras muy finas el radio podía dar negativo y Chromium cortaba el dibujo.
      const r = Math.max(0, Math.min(bw / 2, 3));
      if (bw <= 0) continue;
      if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill(); } else g.fillRect(x, y, bw, bh);
    }
    $("rvLine").style.left = `${pos * 100}%`;
    const wave = $("rvWave");
    wave.setAttribute("aria-valuemax", String(Math.round(dur)));
    wave.setAttribute("aria-valuenow", String(Math.round(audio.currentTime)));
    wave.setAttribute("aria-valuetext", `${clock(audio.currentTime)} de ${clock(dur)}`);
  }

  audio.addEventListener("loadedmetadata", () => {
    $("rvTotal").textContent = clock(duration());
    if (pendingSeek) {
      const { t, play } = pendingSeek;
      pendingSeek = null;
      audio.currentTime = Math.min(t, Math.max(0, duration() - 0.1));
      if (play) audio.play().catch(() => {});
    }
    paintPins();
    draw();
  });
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
        <p class="rv-note-text">${n.voice ? `<button class="rv-note-voice" type="button" data-voice="${i}">${ICON.play}<span>Nota de voz</span></button>` : ""}${n.voice && n.text === "Nota de voz" ? "" : esc(n.text)}</p>
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
    resetRec();
    $("rvVoice").hidden = !canRecord();
    $("rvCompose").hidden = false;
    $("rvMark").hidden = true;
    $("rvComposeText").focus();
    $("rvCompose").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function closeCompose() {
    stopRec(true);
    resetRec();
    $("rvCompose").hidden = true;
    $("rvMark").hidden = !cur || cur.mode !== "review";
  }

  $("rvCompose").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("rvComposeText").value.trim();
    if (rec && rec.state === "recording") { stopRec(); return; }
    if (!text && !recBlob) { $("rvComposeText").focus(); return; }
    const note = { t: Math.round(composeAt * 10) / 10, text: (text || "Nota de voz").slice(0, 500) };
    if (recBlob) {
      const btn = $("rvCompose").querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Subiendo tu voz…";
      const type = (recBlob.type || "audio/webm").split(";")[0];
      const ext = /mp4|aac|m4a/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
      const path = `${P.me.id}/${String(cur.song.id).replace(/-/g, "").slice(0, 12)}-${Date.now()}.${ext}`;
      const { error } = await db.storage.from("notas-voz").upload(path, recBlob, { contentType: type });
      btn.disabled = false;
      btn.textContent = "Guardar nota";
      if (error) { $("rvRecTime").textContent = "No pudimos subir la nota de voz. Probá de nuevo o escribila."; return; }
      note.voice = path;
    }
    cur.notes.push(note);
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

  // ---------- Notas de voz ----------
  // El artista graba lo que quiere (tararear, explicar un sonido) en vez de
  // escribirlo: hasta 1 minuto, queda en un espacio privado (026_notas_de_voz.sql)
  // y Zeche la escucha en el portal o desde el mail.
  let rec = null, recBlob = null, recStream = null, recTimer = null, recChunks = [];
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  function resetRec() {
    recBlob = null;
    const prev = $("rvRecPrev");
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.removeAttribute("src");
    prev.hidden = true;
    $("rvRecTime").textContent = "";
    $("rvRec").classList.remove("is-on");
    $("rvRec").querySelector("span").textContent = "O grabala con tu voz";
    $("rvRec").innerHTML = `${ICON.mic}<span>O grabala con tu voz</span>`;
  }
  async function startRec() {
    audio.pause();
    stopVoice();
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } }); }
    catch (e) { $("rvRecTime").textContent = "Para grabar, permití el micrófono en el navegador."; return; }
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
    recChunks = [];
    rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(recTimer);
      if (recStream) recStream.getTracks().forEach((t) => t.stop());
      recStream = null;
      if (rec && rec._discard) { rec = null; return; }
      recBlob = new Blob(recChunks, { type: (rec && rec.mimeType) || mime || "audio/webm" });
      rec = null;
      const prev = $("rvRecPrev");
      prev.src = URL.createObjectURL(recBlob);
      prev.hidden = false;
      $("rvRec").classList.remove("is-on");
      $("rvRec").innerHTML = `${ICON.mic}<span>Grabar de nuevo</span>`;
      $("rvRecTime").textContent = "Escuchala y guardá la nota.";
    };
    const started = Date.now();
    rec.start();
    $("rvRec").classList.add("is-on");
    $("rvRec").innerHTML = `${ICON.stop}<span>Terminar</span>`;
    $("rvRecPrev").hidden = true;
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      $("rvRecTime").innerHTML = `<i class="rv-rec-dot"></i>Grabando ${clock(s)} / ${clock(VOICE_MAX_S)}`;
      if (s >= VOICE_MAX_S) stopRec();
    }, 250);
  }
  function stopRec(discard) {
    if (!rec) return;
    if (discard) rec._discard = true;
    if (rec.state !== "inactive") rec.stop();
    else if (discard) rec = null;
  }
  let voicePlayer = null;
  function stopVoice() { if (voicePlayer) { voicePlayer.pause(); voicePlayer = null; } root.querySelectorAll(".rv-note-voice.is-on").forEach((b) => b.classList.remove("is-on")); }
  async function playVoice(i, btn) {
    const n = cur && cur.notes[i];
    if (!n || !n.voice) return;
    if (btn.classList.contains("is-on")) { stopVoice(); return; }
    stopVoice();
    audio.pause();
    btn.classList.add("is-on");
    const { data, error } = await db.storage.from("notas-voz").createSignedUrl(n.voice, 3600);
    if (error || !data) { btn.classList.remove("is-on"); return; }
    voicePlayer = new Audio(data.signedUrl);
    voicePlayer.addEventListener("ended", stopVoice);
    voicePlayer.play().catch(stopVoice);
  }

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

  // Si el artista cierra el reproductor mientras se manda, el envío termina
  // igual en segundo plano: todo se hace sobre esta revisión (c), no sobre la
  // que esté abierta en ese momento. Así se borran las notas guardadas, la
  // canción pasa a aprobada o a "cambios" (onSent) y no queda nada para
  // mandar dos veces. (El servidor además ignora el mismo envío repetido.)
  async function send(action) {
    const c = cur;
    if (!c || c.sending) return;
    c.sending = true;
    const msg = $("rvMsg");
    const buttons = $("rvFoot").querySelectorAll("button");
    buttons.forEach((b) => { b.disabled = true; });
    P.setMsg(msg, "Enviando…");
    const gen = $("rvGenText");
    if (gen) c.general = gen.value.trim();
    try {
      const res = await P.authFetch("/.netlify/functions/portal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          song: c.song.id, kind: c.kind, action, version: c.file.name,
          note: action === "cambios" ? (c.general || null) : null,
          marks: action === "cambios" ? c.notes : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviarlo. Probá de nuevo.");
      store.set(c.key, null);
      store.set(c.key + ":g", null);
      if (window.zgTrack) window.zgTrack("portal_aprobacion", { etapa: c.kind, accion: action, notas: c.notes.length });
      if (c.onSent) c.onSent(data.review, data);
      c.sending = false;
      if (cur !== c) return; // ya lo cerró: la canción igual quedó actualizada
      const n = c.notes.length;
      audio.pause();
      $("rvDone").innerHTML = action === "aprobada"
        ? `<img class="rv-done-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true"><span class="rv-done-ico">${ICON.check}</span><h3>¡${NOUN[c.kind]} aprobad${c.kind === "mezcla" ? "a" : "o"}!</h3><p>${c.kind === "mezcla" ? "Seguimos con el master. Te avisamos apenas esté para escucharlo." : "Tu canción está terminada. Ahora, a prepararla para que salga."}</p><button class="btn btn-primary" type="button" data-rv="close">Listo</button>`
        : `<img class="rv-done-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true"><span class="rv-done-ico">${ICON.check}</span><h3>Zeche ya tiene tus notas</h3><p>${n ? `${n === 1 ? "Le llegó tu nota" : `Le llegaron tus ${n} notas`}, cada una en su momento exacto.` : "Le llegó tu pedido."} Cuando suba la versión nueva, te aparece acá para escuchar${c.kind === "mezcla" ? "la" : "lo"}.</p><button class="btn btn-primary" type="button" data-rv="close">Listo</button>`;
      $("rvDone").hidden = false;
    } catch (err) {
      c.sending = false;
      if (cur !== c) return; // ya lo cerró: las notas siguen guardadas para mandarlas después
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
    const src = e.target.closest("[data-src]");
    if (src) { switchSource(+src.dataset.src); return; }
    const vo = e.target.closest("[data-voice]");
    if (vo) { playVoice(+vo.dataset.voice, vo); return; }
    const del = e.target.closest("[data-del]");
    if (del) { cur.notes.splice(+del.dataset.del, 1); saveDraft(); paintNotes(); paintFoot(); return; }
    const b = e.target.closest("[data-rv]");
    if (!b) return;
    const act = b.dataset.rv;
    if (act === "close") close();
    else if (act === "back") seek(audio.currentTime - 5);
    else if (act === "fwd") seek(audio.currentTime + 5);
    else if (act === "cancel") closeCompose();
    else if (act === "rec") { if (rec) stopRec(); else startRec(); }
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
    if ((e.key === "n" || e.key === "N") && cur && cur.mode === "review" && cur.srcIdx === 0) { e.preventDefault(); openCompose(); }
    // A: alternar entre la nueva y la que se estaba comparando.
    if ((e.key === "a" || e.key === "A") && cur && cur.sources && cur.sources.length > 1) { e.preventDefault(); switchSource(cur.srcIdx === 0 ? cur.lastOther || 1 : 0); }
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
    const n = store.get(draftKey(song));
    return Array.isArray(n) ? n.length : 0;
  }

  window.ZGReview = { open, close, drafts, clock };
})();
