// ZECHE GRUV — Portal de artistas: cuaderno de letras.
// Dentro de la sección Letras, además de los archivos de OneDrive, cada
// artista tiene un cuaderno: escribe la letra en el portal, le pone el
// título de la canción y la arma por partes (Intro, Verso, Estribillo…).
// Se guarda sola mientras escribe, en la tabla "lyrics" de Supabase
// (supabase/010_letras.sql). El administrador ve y puede editar las de
// cada artista desde su perfil.
//
// Pensado para el celu: cada parte lleva su etiqueta de color (se cambia
// tocándola), arriba está el mapa de la canción para saltar entre partes,
// debajo de cada parte cuántos versos y sílabas tiene, y el "Modo
// estudio" deja la letra grande y la pantalla prendida para leerla en la
// cabina mientras graba.
//
// Feats: desde el menú de cada parte (el de Subir / Bajar), «Quién canta»
// elige qué voz canta esa parte: el artista, los del feat (salen del Feat
// de la canción en Notion), «Todos juntos» o una voz nueva que se escribe
// ahí. Se guarda en la parte ({ kind, text, voice }) y aparece en el
// encabezado, en el mapa, en el Modo estudio y al copiar la letra.
//
// Orden: cada parte tiene a la izquierda una manija (seis puntitos) para
// agarrarla y arrastrarla adonde quieras; las demás se corren solas para
// hacerle lugar. Con el teclado, la manija se mueve con ↑ / ↓.
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;

  const KINDS = [
    ["intro", "Intro", "In"],
    ["verso", "Verso", "V"],
    ["pre", "Pre-estribillo", "Pre"],
    ["estribillo", "Estribillo", "E"],
    ["hook", "Hook", "H"],
    ["puente", "Puente", "P"],
    ["outro", "Outro", "Out"],
    ["otra", "Otra parte", "+"],
  ];
  const KIND_LABEL = Object.fromEntries(KINDS.map(([k, n]) => [k, n]));
  const KIND_SHORT = Object.fromEntries(KINDS.map(([k, , s]) => [k, s]));
  // Los estribillos y hooks se repiten iguales: no se numeran.
  const REPEATS = new Set(["estribillo", "hook"]);
  const PLACEHOLDER = {
    intro: "Cómo arranca…",
    verso: "Escribí acá. Cada renglón, un verso.",
    pre: "Lo que levanta antes del estribillo…",
    estribillo: "La parte que todos van a cantar…",
    puente: "El giro de la canción…",
    hook: "La frase que se queda pegada…",
    outro: "Cómo se despide…",
    otra: "Lo que quieras anotar…",
  };
  const SAVE_DELAY = 900;
  const COLUMNS = "id, title, sections, updated_at";
  const IC = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    dup: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 012-2h8"/></svg>',
    del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
  };

  let profile = null;  // dueño del cuaderno que se está viendo
  let lyrics = [];     // sus letras, la más reciente primero
  let doc = null;      // la letra abierta en el editor
  let listTicket = 0;  // para descartar respuestas viejas si se cambia de perfil rápido
  let timer = null;
  let saving = null;
  let dirty = false;
  let openPop = null;  // { i, what: "kind" | "more" | "voice" }
  let extraVoices = []; // voces sumadas a mano en esta letra que todavía no cantan ninguna parte

  // ---------- Quién canta (feats) ----------
  const ALL = "todos";
  const voiceName = (v) => (v === ALL ? "Todos juntos" : v);
  const cleanVoice = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 40);
  // Voces posibles: el dueño del cuaderno, los del feat de la canción en
  // Notion, las que ya cantan alguna parte y las sumadas a mano.
  function voices() {
    const out = [];
    const add = (v) => { v = cleanVoice(v); if (v && v !== ALL && !out.some((x) => norm(x) === norm(v))) out.push(v); };
    add(P.nameOf(profile));
    const feat = window.ZGSongs && window.ZGSongs.feat ? window.ZGSongs.feat(profile.id, norm(doc.title)) : null;
    if (feat) feat.split(/\s*(?:,|&|\+|\/|\by\b|\bx\b|\bft\.?|\bfeat\.?)\s*/i).forEach(add);
    doc.sections.forEach((x) => add(x.voice));
    extraVoices.forEach(add);
    return out;
  }
  // Cada voz con su color (siempre el mismo para el mismo nombre).
  const VOICE_COLORS = ["#F5A623", "#9FD49A", "#8EC5E8", "#E8A0C8", "#F0E0C0", "#D9963A"];
  function voiceColor(v) {
    if (v === ALL) return "#FFF4DC";
    const list = voices();
    const i = list.findIndex((x) => norm(x) === norm(v));
    return VOICE_COLORS[(i < 0 ? list.length : i) % VOICE_COLORS.length];
  }
  const initials = (v) => v === ALL ? "★" : cleanVoice(v).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
  const isEmpty = (l) => !String(l.title || "").trim() && !(l.sections || []).some((s) => String(s.text || "").trim());
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  // Verso 1, Verso 2… solo cuando hay más de uno del mismo tipo.
  function labels(sections) {
    const total = {};
    sections.forEach((s) => { total[s.kind] = (total[s.kind] || 0) + 1; });
    const seen = {};
    return sections.map((s) => {
      seen[s.kind] = (seen[s.kind] || 0) + 1;
      const base = KIND_LABEL[s.kind] || KIND_LABEL.otra;
      return total[s.kind] > 1 && !REPEATS.has(s.kind) ? `${base} ${seen[s.kind]}` : base;
    });
  }
  function shortLabels(sections) {
    const total = {};
    sections.forEach((s) => { total[s.kind] = (total[s.kind] || 0) + 1; });
    const seen = {};
    return sections.map((s) => {
      seen[s.kind] = (seen[s.kind] || 0) + 1;
      const base = KIND_SHORT[s.kind] || "+";
      return total[s.kind] > 1 && !REPEATS.has(s.kind) && s.kind !== "otra" ? `${base}${seen[s.kind]}` : base;
    });
  }

  // ---------- Sílabas (aproximadas, para ver la métrica) ----------
  // Cada grupo de vocales es una sílaba, salvo que junte dos vocales
  // fuertes (a, e, o, o una í/ú acentuada): ahí es hiato y son dos.
  function syllables(line) {
    const groups = norm(line).replace(/[^a-zñü\s]/g, " ").match(/[aeiouüy]+/g);
    if (!groups) return 0;
    const raw = String(line).toLowerCase();
    let n = 0;
    groups.forEach((g) => { n += Math.max(1, (g.match(/[aeo]/g) || []).length); });
    // í / ú con tilde rompen el diptongo ("día", "Raúl").
    n += (raw.match(/[íú][aeo]|[aeo][íú]/g) || []).length;
    // "y" final suena a vocal ("hoy", "muy"): ya cuenta por el grupo; "y" sola tampoco suma de más.
    return n;
  }
  function meter(text) {
    const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    const counts = lines.map(syllables).filter(Boolean);
    const v = `${lines.length} ${lines.length === 1 ? "verso" : "versos"}`;
    if (!counts.length) return v;
    const min = Math.min(...counts), max = Math.max(...counts);
    return `${v} · ${min === max ? min : `${min} a ${max}`} sílabas`;
  }

  // ---------- Lista ----------
  async function load(who) {
    profile = who;
    const ticket = ++listTicket;
    const own = who.id === P.me.id;
    $("lyricsSub").textContent = own
      ? "Escribí tus letras acá, por partes. Se guardan solas y las vemos juntos en la sesión."
      : `Las letras que ${P.nameOf(who)} escribió en el portal. Podés leerlas y corregirlas.`;
    $("lyricsStatus").textContent = "Cargando…";
    $("lyricsList").replaceChildren();
    P.setMsg($("lyricsMsg"), "");

    const { data, error } = await db.from("lyrics").select(COLUMNS).eq("artist_id", who.id).order("updated_at", { ascending: false });
    if (ticket !== listTicket) return;
    if (error) {
      $("lyricsStatus").textContent = P.me.role === "admin" && /lyrics/.test(error.message)
        ? "Falta crear la tabla de letras: corré supabase/010_letras.sql en Supabase."
        : "No pudimos cargar las letras. Probá de nuevo en un momento.";
      return;
    }
    lyrics = data || [];
    // Lo que quedó sin guardar en este dispositivo (p. ej. se cortó la
    // conexión y se cerró el portal): se muestra y se vuelve a mandar.
    const waiting = pendingList();
    lyrics.forEach((l) => { if (waiting[l.id]) Object.assign(l, waiting[l.id].changes); });
    renderList();
    if (Object.keys(waiting).length) flushPending();
  }

  function previewLines(l) {
    const out = [];
    for (const s of l.sections || []) {
      for (const line of String(s.text || "").split("\n")) {
        if (line.trim()) out.push(line.trim());
        if (out.length === 2) return out;
      }
    }
    return out;
  }

  // La canción del estudio con el mismo título (para mostrar en qué etapa está).
  function songOf(title) {
    const t = norm(title);
    if (!t || !window.ZGSongs || !window.ZGSongs.find) return null;
    return window.ZGSongs.find(profile.id, t);
  }

  function renderList() {
    const own = profile.id === P.me.id;
    $("lyricsStatus").textContent = lyrics.length ? "" : own
      ? "Tu cuaderno está vacío. Tocá «Nueva letra» y arrancá como te salga."
      : "Todavía no escribió ninguna letra en el portal.";
    $("lyricsList").innerHTML = lyrics.map((l, n) => {
      const lines = previewLines(l);
      const secs = (l.sections || []).filter((s) => KIND_LABEL[s.kind]);
      const shorts = shortLabels(secs);
      const song = songOf(l.title);
      return `
      <li style="animation-delay:${Math.min(n, 8) * 50}ms"><button class="nb-card" type="button" data-lyric="${esc(l.id)}">
        <span class="nb-card-top">
          <b class="nb-card-title${l.title.trim() ? "" : " is-empty"}">${esc(l.title.trim() || "Sin título")}</b>
          ${song ? `<span class="nb-song">${esc(song)}</span>` : ""}
        </span>
        <span class="nb-lines">${lines.length ? lines.map((x) => `<span>${esc(x)}</span>`).join("") : '<span class="is-empty">Todavía sin letra</span>'}</span>
        <span class="nb-foot">
          <span class="nb-struct" aria-label="Estructura">${secs.slice(0, 9).map((s, i) => `<i class="k-${s.kind}">${esc(shorts[i])}</i>`).join("")}${secs.length > 9 ? "<i>…</i>" : ""}</span>
          <span class="nb-date">${fmtDate(l.updated_at)}</span>
        </span>
      </button></li>`;
    }).join("");
  }

  $("lyricsList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-lyric]");
    const item = btn && lyrics.find((l) => l.id === btn.dataset.lyric);
    if (item) openEditor(item);
  });

  $("lyricsNew").addEventListener("click", async () => {
    $("lyricsNew").disabled = true;
    P.setMsg($("lyricsMsg"), "");
    const { data, error } = await db.from("lyrics")
      .insert({ artist_id: profile.id, title: "", sections: [{ kind: "verso", text: "" }, { kind: "estribillo", text: "" }] })
      .select(COLUMNS).single();
    $("lyricsNew").disabled = false;
    if (error) { P.setMsg($("lyricsMsg"), "No pudimos crear la letra. Probá de nuevo en un momento.", true); return; }
    lyrics.unshift(data);
    openEditor(data, true);
  });

  // ---------- Editor ----------
  function openEditor(item, isNew) {
    doc = { id: item.id, title: item.title || "", sections: (item.sections || []).map((s) => ({ kind: KIND_LABEL[s.kind] ? s.kind : "otra", text: String(s.text || ""), voice: cleanVoice(s.voice) })) };
    extraVoices = [];
    dirty = false;
    openPop = null;
    setReading(false);
    P.showPanel("lyric");
    $("lyricEyebrow").textContent = `${P.nameOf(profile)} · Cuaderno de letras`;
    $("lyricTitle").value = doc.title;
    $("lyricSongs").innerHTML = (window.ZGSongs && window.ZGSongs.titles ? window.ZGSongs.titles(profile.id) : [])
      .map((t) => `<option value="${esc(t)}"></option>`).join("");
    setSave(isNew ? "Se guarda sola" : "Guardado", false, true);
    disarm($("lyricDelete"), "Borrar esta letra");
    closePicker();
    renderParts();
    if (isNew) $("lyricTitle").focus();
  }

  function setSave(text, isError, idle) {
    const el = $("lyricSave");
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
    el.classList.toggle("is-saving", !isError && !idle && /Guardando/.test(text));
  }

  function voicePop(s) {
    const list = voices();
    const chip = (v) => `<button type="button" class="lp-chip lp-vchip${norm(s.voice) === norm(v) ? " is-on" : ""}" data-voice="${esc(v)}" aria-pressed="${norm(s.voice) === norm(v)}" style="--k:${voiceColor(v)}"><b aria-hidden="true">${esc(initials(v))}</b>${esc(voiceName(v))}</button>`;
    return `<div class="lp-pop lp-voices" role="group" aria-label="Quién canta esta parte">
      <span class="lp-pop-label">${IC.mic}¿Quién canta esta parte?</span>
      ${list.map(chip).join("")}
      ${list.length > 1 ? chip(ALL) : ""}
      <form class="lp-vadd" data-act="voice-add"><input type="text" maxlength="40" placeholder="${list.length > 1 ? "Otra voz…" : "¿Con quién es el feat?"}" aria-label="Sumar otra voz" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Sumar voz">+</button></form>
      ${s.voice ? `<button type="button" class="lp-vnone" data-voice="">Sacar</button>` : ""}
    </div>`;
  }

  function partHtml(s, i, label, count) {
    const pop = openPop && openPop.i === i ? openPop.what : null;
    const m = meter(s.text);
    return `
      <section class="lp k-${s.kind}${pop ? " has-pop" : ""}" data-i="${i}" id="lp-${i}">
        <header class="lp-head">
          <button class="lp-grip" type="button" aria-label="Mover ${esc(label)}: arrastrá, o usá las flechas ↑ ↓" title="Arrastrá para mover">${IC.grip}</button>
          <button class="lp-kind" type="button" data-act="kind" aria-expanded="${pop === "kind"}" aria-label="${esc(label)}: cambiar tipo de parte"><i aria-hidden="true"></i><span>${esc(label)}</span>${IC.chev}</button>
          ${s.voice ? `<button class="lp-voice" type="button" data-act="voice" style="--v:${voiceColor(s.voice)}" aria-expanded="${pop === "voice"}" aria-label="La canta ${esc(voiceName(s.voice))}: cambiar"><b aria-hidden="true">${esc(initials(s.voice))}</b><span>${esc(voiceName(s.voice))}</span></button>` : ""}
          <button class="lp-more" type="button" data-act="more" aria-expanded="${pop === "more"}" aria-label="Opciones de ${esc(label)}">${IC.more}</button>
        </header>
        ${pop === "kind" ? `<div class="lp-pop" role="group" aria-label="Tipo de parte">${KINDS.map(([k, name]) => `<button type="button" class="lp-chip k-${k}${k === s.kind ? " is-on" : ""}" data-kind="${k}" aria-pressed="${k === s.kind}"><i aria-hidden="true"></i>${name}</button>`).join("")}</div>` : ""}
        ${pop === "more" ? `<div class="lp-pop lp-menu" role="group" aria-label="Opciones">
          <button type="button" data-act="voice">${IC.mic}${s.voice ? "Cambiar quién canta" : "Quién canta"}</button>
          <button type="button" data-act="dup">${IC.dup}Duplicar</button>
          <button type="button" data-act="remove" class="is-danger">${IC.del}<span>Quitar</span></button>
        </div>` : ""}
        ${pop === "voice" ? voicePop(s) : ""}
        <textarea class="lyric-text" rows="1" spellcheck="true" aria-label="${esc(label)}" placeholder="${esc(PLACEHOLDER[s.kind])}">${esc(s.text)}</textarea>
        <span class="lp-meta" aria-live="off">${esc(m)}</span>
      </section>`;
  }

  function renderMap() {
    const names = shortLabels(doc.sections);
    const full = labels(doc.sections);
    $("lyricMap").innerHTML = doc.sections.map((s, i) => `<a class="le-map-chip k-${s.kind}" href="#lp-${i}" data-jump="${i}" title="${esc(full[i])}${s.voice ? ` · ${esc(voiceName(s.voice))}` : ""}"><i aria-hidden="true"></i>${esc(names[i])}${s.voice ? `<b class="le-map-v" style="--v:${voiceColor(s.voice)}" aria-hidden="true">${esc(initials(s.voice))}</b>` : ""}</a>`).join("");
    $("lyricMap").hidden = doc.sections.length < 2;
  }

  function renderParts(focusIndex) {
    const names = labels(doc.sections);
    $("lyricSections").innerHTML = doc.sections.map((s, i) => partHtml(s, i, names[i], doc.sections.length)).join("")
      || '<p class="le-empty">Sin partes todavía. Tocá «Agregar parte».</p>';
    document.querySelectorAll("#lyricSections .lyric-text").forEach(fit);
    renderMap();
    if (focusIndex != null) {
      const box = document.querySelector(`#lyricSections [data-i="${focusIndex}"] .lyric-text`);
      if (box) { box.focus({ preventScroll: true }); box.closest(".lp").scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
  }

  // El cuadro de texto crece con la letra, sin barra de desplazamiento.
  function fit(box) {
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight + 2}px`;
  }

  $("lyricTitle").addEventListener("input", () => { doc.title = $("lyricTitle").value; schedule(); });

  $("lyricSections").addEventListener("input", (event) => {
    const box = event.target.closest(".lyric-text");
    if (!box) return;
    const part = box.closest(".lp");
    const i = +part.dataset.i;
    doc.sections[i].text = box.value;
    fit(box);
    part.querySelector(".lp-meta").textContent = meter(box.value);
    schedule();
  });

  function togglePop(i, what) {
    openPop = openPop && openPop.i === i && openPop.what === what ? null : { i, what };
    renderParts();
    const btn = document.querySelector(`#lyricSections [data-i="${i}"] [data-act="${what}"]`);
    if (btn) btn.focus({ preventScroll: true });
  }

  $("lyricSections").addEventListener("click", (event) => {
    const part = event.target.closest(".lp");
    if (!part) return;
    const i = +part.dataset.i;
    const vchip = event.target.closest("[data-voice]");
    if (vchip) {
      doc.sections[i].voice = vchip.dataset.voice;
      openPop = null;
      renderParts();
      part.classList.remove("is-flash");
      document.querySelector(`#lyricSections [data-i="${i}"]`)?.classList.add("is-flash");
      schedule();
      return;
    }
    if (event.target.closest(".lp-vadd")) return; // el formulario se maneja en submit
    const chip = event.target.closest("[data-kind]");
    if (chip) {
      doc.sections[i].kind = chip.dataset.kind;
      openPop = null;
      renderParts();
      document.querySelector(`#lyricSections [data-i="${i}"] .lp-kind`)?.focus({ preventScroll: true });
      schedule();
      return;
    }
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "kind" || act === "more" || act === "voice") {
      togglePop(i, act);
      // Si todavía no hay feat, directo a escribir con quién es.
      if (act === "voice" && openPop && voices().length < 2) document.querySelector(`#lyricSections [data-i="${i}"] .lp-vadd input`)?.focus({ preventScroll: true });
      return;
    }
    if (act === "remove") {
      // Si la parte tiene texto, se pide un segundo toque.
      if (doc.sections[i].text.trim() && !btn.classList.contains("is-armed")) {
        btn.classList.add("is-armed");
        btn.querySelector("span").textContent = "¿Seguro? Tocá de nuevo";
        return;
      }
      doc.sections.splice(i, 1);
      openPop = null;
      renderParts();
    } else if (act === "dup") {
      doc.sections.splice(i + 1, 0, { ...doc.sections[i] });
      openPop = null;
      renderParts(i + 1);
    } else {
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= doc.sections.length) return;
      [doc.sections[i], doc.sections[j]] = [doc.sections[j], doc.sections[i]];
      openPop = { i: j, what: "more" };
      renderParts();
      const again = document.querySelector(`#lyricSections [data-i="${j}"] [data-act="${act}"]:not(:disabled)`)
        || document.querySelector(`#lyricSections [data-i="${j}"] [data-act="more"]`);
      if (again) again.focus({ preventScroll: true });
      document.querySelector(`#lyricSections [data-i="${j}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    schedule();
  });

  // ---------- Arrastrar para ordenar ----------
  // Pointer events: anda igual con el dedo y con el mouse. La parte que
  // agarrás se levanta y sigue al dedo; las otras se corren con una
  // transición suave; cerca del borde de la pantalla la página se desplaza.
  let drag = null;
  const pageY = (e) => e.clientY + window.scrollY;
  function movePart(from, to) {
    if (from === to) return;
    const [moved] = doc.sections.splice(from, 1);
    doc.sections.splice(to, 0, moved);
    openPop = null;
    renderParts();
    const el = document.querySelector(`#lyricSections [data-i="${to}"]`);
    if (el) { el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash"); }
    schedule();
  }
  function dragTarget() {
    const center = drag.rects[drag.from].top + drag.dy + drag.rects[drag.from].height / 2;
    let to = drag.from;
    drag.rects.forEach((r, j) => {
      const mid = r.top + r.height / 2;
      if (j < drag.from && center < mid) to = Math.min(to, j);
      if (j > drag.from && center > mid) to = Math.max(to, j);
    });
    return to;
  }
  function paintDrag() {
    const { from, to, parts, rects, gap } = drag;
    const shift = rects[from].height + gap;
    parts.forEach((el, j) => {
      if (j === from) { el.style.transform = `translateY(${drag.dy}px) scale(1.02)`; return; }
      const off = from < to && j > from && j <= to ? -shift : from > to && j >= to && j < from ? shift : 0;
      el.style.transform = off ? `translateY(${off}px)` : "";
    });
  }
  function autoScroll() {
    if (!drag) return;
    const edge = 90, y = drag.clientY, h = window.innerHeight;
    const v = y < edge ? -Math.ceil((edge - y) / 6) : y > h - edge ? Math.ceil((y - (h - edge)) / 6) : 0;
    if (v) {
      window.scrollBy(0, v);
      drag.dy = drag.clientY + window.scrollY - drag.startY;
      drag.to = dragTarget();
      paintDrag();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  $("lyricSections").addEventListener("pointerdown", (event) => {
    const grip = event.target.closest(".lp-grip");
    if (!grip || document.body.classList.contains("le-reading") || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    if (openPop) { openPop = null; renderParts(); }
    const parts = [...document.querySelectorAll("#lyricSections .lp")];
    const from = +grip.closest(".lp").dataset.i;
    if (parts.length < 2) return;
    const rects = parts.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, height: r.height }; });
    const gap = parts.length > 1 ? rects[1].top - (rects[0].top + rects[0].height) : 12;
    const g = parts[from].querySelector(".lp-grip");
    g.setPointerCapture(event.pointerId);
    drag = { from, to: from, parts, rects, gap, startY: pageY(event), clientY: event.clientY, dy: 0, id: event.pointerId };
    document.body.classList.add("lp-sorting");
    parts.forEach((el, j) => el.classList.add(j === from ? "is-dragging" : "is-shifting"));
    if (navigator.vibrate) navigator.vibrate(8);
    paintDrag();
    drag.raf = requestAnimationFrame(autoScroll);
  });
  $("lyricSections").addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.clientY = event.clientY;
    drag.dy = pageY(event) - drag.startY;
    const to = dragTarget();
    if (to !== drag.to && navigator.vibrate) navigator.vibrate(4);
    drag.to = to;
    paintDrag();
  });
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { from, to, parts, rects, gap } = drag;
    cancelAnimationFrame(drag.raf);
    drag = null;
    // La parte se acomoda en su lugar nuevo y recién ahí se reordena.
    const dest = from < to ? rects[to].top + rects[to].height - rects[from].height : rects[to].top;
    const el = parts[from];
    el.classList.add("is-dropping");
    el.style.transform = `translateY(${dest - rects[from].top}px)`;
    const done = () => {
      document.body.classList.remove("lp-sorting");
      parts.forEach((p) => { p.classList.remove("is-dragging", "is-shifting", "is-dropping"); p.style.transform = ""; });
      if (from !== to) movePart(from, to);
    };
    if (reduced()) done(); else setTimeout(done, 220);
  }
  $("lyricSections").addEventListener("pointerup", endDrag);
  $("lyricSections").addEventListener("pointercancel", endDrag);
  // Teclado: la manija con ↑ / ↓.
  $("lyricSections").addEventListener("keydown", (event) => {
    const grip = event.target.closest(".lp-grip");
    if (!grip || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const i = +grip.closest(".lp").dataset.i;
    const j = event.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= doc.sections.length) return;
    movePart(i, j);
    document.querySelector(`#lyricSections [data-i="${j}"] .lp-grip`)?.focus({ preventScroll: true });
  });

  // Sumar una voz nueva (alguien del feat que no está en Notion).
  $("lyricSections").addEventListener("submit", (event) => {
    const form = event.target.closest(".lp-vadd");
    if (!form) return;
    event.preventDefault();
    const v = cleanVoice(form.querySelector("input").value);
    if (!v) return;
    const i = +form.closest(".lp").dataset.i;
    if (!voices().some((x) => norm(x) === norm(v))) extraVoices.push(v);
    doc.sections[i].voice = voices().find((x) => norm(x) === norm(v)) || v;
    openPop = null;
    renderParts();
    document.querySelector(`#lyricSections [data-i="${i}"]`)?.classList.add("is-flash");
    schedule();
  });

  // Mapa de la canción: tocar una parte lleva a esa parte.
  $("lyricMap").addEventListener("click", (event) => {
    const a = event.target.closest("[data-jump]");
    if (!a) return;
    event.preventDefault();
    const part = document.querySelector(`#lyricSections [data-i="${a.dataset.jump}"]`);
    if (!part) return;
    part.scrollIntoView({ block: "center", behavior: "smooth" });
    if (!document.body.classList.contains("le-reading")) part.querySelector(".lyric-text").focus({ preventScroll: true });
    part.classList.remove("is-flash"); void part.offsetWidth; part.classList.add("is-flash");
  });

  // ---------- Agregar parte ----------
  function renderPicker() {
    const chorus = doc.sections.find((s) => s.kind === "estribillo" && s.text.trim());
    $("lyricAdd").innerHTML = `
      ${chorus ? `<button type="button" class="lp-chip k-estribillo is-repeat" data-add="estribillo" data-copy="1"><i aria-hidden="true"></i>Repetir estribillo</button>` : ""}
      ${KINDS.map(([k, name]) => `<button type="button" class="lp-chip k-${k}" data-add="${k}"><i aria-hidden="true"></i>${name}</button>`).join("")}`;
  }
  function closePicker() {
    $("lyricAdd").hidden = true;
    $("lyricAddBtn").setAttribute("aria-expanded", "false");
  }
  $("lyricAddBtn").addEventListener("click", () => {
    const opening = $("lyricAdd").hidden;
    if (opening) { renderPicker(); $("lyricAdd").hidden = false; $("lyricAddBtn").setAttribute("aria-expanded", "true"); $("lyricAdd").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    else closePicker();
  });
  $("lyricAdd").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-add]");
    if (!btn) return;
    const kind = btn.dataset.add;
    const chorus = btn.dataset.copy && doc.sections.find((s) => s.kind === "estribillo" && s.text.trim());
    doc.sections.push({ kind, text: chorus ? chorus.text : "" });
    closePicker();
    openPop = null;
    renderParts(doc.sections.length - 1);
    schedule();
  });

  // ---------- Modo estudio ----------
  // La letra grande, sin botones, y la pantalla que no se apaga: para tener
  // el celu en la cabina mientras graba.
  let wakeLock = null;
  async function setReading(on) {
    document.body.classList.toggle("le-reading", on);
    $("lyricRead").setAttribute("aria-pressed", on ? "true" : "false");
    $("lyricRead").querySelector("span").textContent = on ? "Editar" : "Estudio";
    document.querySelectorAll("#lyricSections .lyric-text").forEach((t) => { t.readOnly = on; fit(t); });
    $("lyricTitle").readOnly = on;
    try {
      if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  $("lyricRead").addEventListener("click", () => {
    const on = !document.body.classList.contains("le-reading");
    openPop = null;
    if (on) { renderParts(); closePicker(); }
    setReading(on);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (on && window.zgTrack) window.zgTrack("portal_modo_estudio", {});
  });

  // Botones que piden confirmación con un segundo toque.
  function arm(btn, text) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = text;
    btn.classList.add("is-armed");
    clearTimeout(btn._disarm);
    btn._disarm = setTimeout(() => disarm(btn), 4000);
  }
  function disarm(btn, label) {
    clearTimeout(btn._disarm);
    btn.classList.remove("is-armed");
    btn.textContent = label || btn.dataset.label || btn.textContent;
  }

  // ---------- Guardado ----------
  // Lo que todavía no se pudo guardar (sin conexión) queda en este
  // dispositivo hasta que la base lo confirma: aunque se salga del editor,
  // se cambie de letra o se cierre el portal, se reintenta solo y, al
  // volver a entrar, se recupera. Si el navegador no deja guardar nada
  // (modo privado), se sigue reintentando mientras la página esté abierta.
  const PENDING_KEY = "zg-letras-pendientes"; // { id de la letra: { artist, changes, at } }
  function pendingAll() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function pendingWrite(all) {
    try { if (Object.keys(all).length) localStorage.setItem(PENDING_KEY, JSON.stringify(all)); else localStorage.removeItem(PENDING_KEY); } catch (e) { /* nada */ }
  }
  const memoryPending = {}; // por si el dispositivo no deja guardar
  function setPending(id, changes) {
    const entry = { artist: profile && profile.id, changes, at: Date.now() };
    memoryPending[id] = entry;
    const all = pendingAll();
    all[id] = entry;
    pendingWrite(all);
  }
  // Se borra solo si lo que se confirmó es lo último que había pendiente.
  function clearPending(id, changes) {
    const same = (e) => e && JSON.stringify(e.changes) === JSON.stringify(changes);
    if (same(memoryPending[id])) delete memoryPending[id];
    const all = pendingAll();
    if (same(all[id])) { delete all[id]; pendingWrite(all); }
  }
  const pendingList = () => ({ ...memoryPending, ...pendingAll() });

  // Manda los cambios de una letra a la base (de a uno por vez, en orden).
  async function push(id, changes) {
    while (saving) await saving;
    setPending(id, changes);
    let ok = true;
    saving = (async () => {
      const { data, error } = await db.from("lyrics").update(changes).eq("id", id).select("updated_at").single();
      if (error || !data) { ok = false; return; }
      clearPending(id, changes);
      const item = lyrics.find((l) => l.id === id);
      if (item) Object.assign(item, changes, { updated_at: data.updated_at });
    })();
    await saving;
    saving = null;
    if (!ok) retrySoon();
    return ok;
  }

  // Reintento de todo lo pendiente (también de letras que ya no están abiertas).
  let retryTimer = null;
  function retrySoon() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flushPending, 5000);
  }
  async function flushPending() {
    clearTimeout(retryTimer);
    retryTimer = null;
    const all = pendingList();
    for (const [id, entry] of Object.entries(all)) {
      // La letra abierta con cambios nuevos se guarda por su cuenta (save).
      if (doc && doc.id === id && dirty) continue;
      const ok = await push(id, entry.changes);
      if (!ok) return; // sigue sin conexión: retrySoon ya quedó programado
      if (doc && doc.id === id && !dirty) setSave("Guardado", false, true);
    }
  }
  window.addEventListener("online", () => { if (Object.keys(pendingList()).length) flushPending(); });

  function schedule() {
    dirty = true;
    setSave("Guardando…");
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  }

  async function save() {
    clearTimeout(timer);
    timer = null;
    while (saving) await saving;
    if (!doc) return true;
    if (!dirty) {
      // Sin cambios nuevos, pero con algo que no se pudo guardar antes: se reintenta ya.
      const waiting = pendingList()[doc.id];
      if (!waiting) return true;
      const ok = await push(doc.id, waiting.changes);
      if (ok && doc && !dirty) setSave("Guardado", false, true);
      return ok;
    }
    dirty = false;
    const id = doc.id;
    const changes = { title: doc.title.trim(), sections: doc.sections.map((s) => (s.voice ? { kind: s.kind, text: s.text, voice: s.voice } : { kind: s.kind, text: s.text })) };
    // La lista ya muestra lo último escrito, aunque todavía no se haya guardado.
    const item = lyrics.find((l) => l.id === id);
    if (item) Object.assign(item, changes);
    const ok = await push(id, changes);
    if (doc && doc.id === id && !dirty) {
      if (ok) setSave("Guardado", false, true);
      else setSave("Sin conexión: lo volvemos a intentar solo", true);
    }
    return ok;
  }

  // Una letra que quedó vacía (sin título ni texto) no se guarda: se borra,
  // así no quedan tarjetas "Sin título" en el cuaderno.
  function dropIfEmpty(leaving) {
    if (!isEmpty(leaving)) return;
    lyrics = lyrics.filter((l) => l.id !== leaving.id);
    db.from("lyrics").delete().eq("id", leaving.id).then(() => {});
  }

  // Al salir del editor se guarda lo pendiente; si quedó vacía, se borra.
  async function closeEditor() {
    if (!doc) return;
    const ok = await save();
    if (!ok) return; // queda en el editor con el aviso de error
    const leaving = doc;
    doc = null;
    setReading(false);
    dropIfEmpty(leaving);
    window.ZGFiles.open("letras", profile);
  }

  $("lyricBack").addEventListener("click", closeEditor);

  $("lyricDelete").addEventListener("click", async () => {
    const btn = $("lyricDelete");
    if (!btn.classList.contains("is-armed")) { arm(btn, "Tocá de nuevo para borrarla"); return; }
    disarm(btn);
    clearTimeout(timer);
    dirty = false;
    const id = doc.id;
    const { error } = await db.from("lyrics").delete().eq("id", id);
    if (error) { setSave("No pudimos borrarla. Probá de nuevo en un momento.", true); return; }
    lyrics = lyrics.filter((l) => l.id !== id);
    doc = null;
    setReading(false);
    window.ZGFiles.open("letras", profile);
  });

  // Copia la letra entera, con las partes entre corchetes: lista para
  // pegar en un mensaje o en el formulario de distribución.
  $("lyricCopy").addEventListener("click", async () => {
    const names = labels(doc.sections);
    const body = doc.sections.map((s, i) => [s, names[i]]).filter(([s]) => s.text.trim()).map(([s, name]) => `[${name}${s.voice ? ` · ${voiceName(s.voice)}` : ""}]\n${s.text.trim()}`).join("\n\n");
    const text = [doc.title.trim(), body].filter(Boolean).join("\n\n");
    const label = $("lyricCopy").querySelector("span");
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = "Copiada";
    } catch (e) {
      label.textContent = "No se pudo";
    }
    setTimeout(() => { label.textContent = "Copiar"; }, 2200);
  });

  // Que no se pierda nada al cerrar la pestaña o pasar a otra app.
  window.addEventListener("beforeunload", (event) => {
    if (doc && (dirty || saving)) { save(); event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) save();
    // La pantalla prendida se suelta sola al cambiar de app: se pide de nuevo al volver.
    if (document.visibilityState === "visible" && document.body.classList.contains("le-reading") && navigator.wakeLock) {
      navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {});
    }
  });
  // Si se sale del editor por otro lado (pestañas, cerrar sesión), se guarda
  // igual. El editor se vacía solo si se guardó bien; si no, lo pendiente
  // queda en el dispositivo y se reintenta solo (flushPending). Si quedó
  // vacía, se borra igual que al volver con «←».
  new MutationObserver(() => {
    if ($("panel-lyric").hidden && doc) { const d = doc; setReading(false); save().then((ok) => { if (ok && doc === d) { doc = null; dropIfEmpty(d); } }); }
  }).observe($("panel-lyric"), { attributes: true, attributeFilter: ["hidden"] });

  // Alto de la barra de arriba del portal cuando queda fija (celu): las
  // barras pegajosas del editor y del menú de secciones van justo debajo.
  function navOffset() {
    const n = document.querySelector("body > nav");
    if (!n) return;
    const cs = getComputedStyle(n);
    const pinned = (cs.position === "sticky" || cs.position === "fixed") && n.getBoundingClientRect().width > window.innerWidth * 0.6;
    document.documentElement.style.setProperty("--nav-h", `${pinned ? Math.round(n.getBoundingClientRect().height) : 0}px`);
  }
  window.addEventListener("resize", navOffset);
  new MutationObserver(navOffset).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  navOffset();

  window.ZGLyrics = { load, _syllables: syllables };
})();
