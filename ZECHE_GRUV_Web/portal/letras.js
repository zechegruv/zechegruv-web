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
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
  };

  let profile = null;  // dueño del cuaderno que se está viendo
  let lyrics = [];     // sus letras, la más reciente primero
  let doc = null;      // la letra abierta en el editor
  let listTicket = 0;  // para descartar respuestas viejas si se cambia de perfil rápido
  let timer = null;
  let saving = null;
  let dirty = false;
  let openPop = null;  // { i, what: "kind" | "more" }

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
    renderList();
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
    doc = { id: item.id, title: item.title || "", sections: (item.sections || []).map((s) => ({ kind: KIND_LABEL[s.kind] ? s.kind : "otra", text: String(s.text || "") })) };
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

  function partHtml(s, i, label, count) {
    const pop = openPop && openPop.i === i ? openPop.what : null;
    const m = meter(s.text);
    return `
      <section class="lp k-${s.kind}${pop ? " has-pop" : ""}" data-i="${i}" id="lp-${i}">
        <header class="lp-head">
          <button class="lp-kind" type="button" data-act="kind" aria-expanded="${pop === "kind"}" aria-label="${esc(label)}: cambiar tipo de parte"><i aria-hidden="true"></i><span>${esc(label)}</span>${IC.chev}</button>
          <button class="lp-more" type="button" data-act="more" aria-expanded="${pop === "more"}" aria-label="Opciones de ${esc(label)}">${IC.more}</button>
        </header>
        ${pop === "kind" ? `<div class="lp-pop" role="group" aria-label="Tipo de parte">${KINDS.map(([k, name]) => `<button type="button" class="lp-chip k-${k}${k === s.kind ? " is-on" : ""}" data-kind="${k}" aria-pressed="${k === s.kind}"><i aria-hidden="true"></i>${name}</button>`).join("")}</div>` : ""}
        ${pop === "more" ? `<div class="lp-pop lp-menu" role="group" aria-label="Opciones">
          <button type="button" data-act="up"${i === 0 ? " disabled" : ""}>${IC.up}Subir</button>
          <button type="button" data-act="down"${i === count - 1 ? " disabled" : ""}>${IC.down}Bajar</button>
          <button type="button" data-act="dup">${IC.dup}Duplicar</button>
          <button type="button" data-act="remove" class="is-danger">${IC.del}<span>Quitar</span></button>
        </div>` : ""}
        <textarea class="lyric-text" rows="1" spellcheck="true" aria-label="${esc(label)}" placeholder="${esc(PLACEHOLDER[s.kind])}">${esc(s.text)}</textarea>
        <span class="lp-meta" aria-live="off">${esc(m)}</span>
      </section>`;
  }

  function renderMap() {
    const names = shortLabels(doc.sections);
    const full = labels(doc.sections);
    $("lyricMap").innerHTML = doc.sections.map((s, i) => `<a class="le-map-chip k-${s.kind}" href="#lp-${i}" data-jump="${i}" title="${esc(full[i])}"><i aria-hidden="true"></i>${esc(names[i])}</a>`).join("");
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
    if (act === "kind" || act === "more") { togglePop(i, act); return; }
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
    if (!doc || !dirty) return true;
    dirty = false;
    const id = doc.id;
    const changes = { title: doc.title.trim(), sections: doc.sections.map((s) => ({ kind: s.kind, text: s.text })) };
    let ok = true;
    saving = (async () => {
      const { data, error } = await db.from("lyrics").update(changes).eq("id", id).select("updated_at").single();
      if (error) {
        ok = false;
        if (doc && doc.id === id) {
          dirty = true;
          setSave("Sin conexión: lo volvemos a intentar solo", true);
          clearTimeout(timer);
          timer = setTimeout(save, 5000);
        }
        return;
      }
      const item = lyrics.find((l) => l.id === id);
      if (item) Object.assign(item, changes, { updated_at: data.updated_at });
      if (doc && doc.id === id && !dirty) setSave("Guardado", false, true);
    })();
    await saving;
    saving = null;
    return ok;
  }

  // Al salir del editor se guarda lo pendiente; si quedó vacía, se borra.
  async function closeEditor() {
    if (!doc) return;
    const ok = await save();
    if (!ok) return; // queda en el editor con el aviso de error
    const leaving = doc;
    doc = null;
    setReading(false);
    if (isEmpty(leaving)) {
      lyrics = lyrics.filter((l) => l.id !== leaving.id);
      db.from("lyrics").delete().eq("id", leaving.id).then(() => {});
    }
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
    const body = doc.sections.map((s, i) => [s, names[i]]).filter(([s]) => s.text.trim()).map(([s, name]) => `[${name}]\n${s.text.trim()}`).join("\n\n");
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
  // Si se sale del editor por otro lado (pestañas, cerrar sesión), se guarda igual.
  new MutationObserver(() => {
    if ($("panel-lyric").hidden && doc) { const d = doc; setReading(false); save().then(() => { if (doc === d) doc = null; }); }
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
