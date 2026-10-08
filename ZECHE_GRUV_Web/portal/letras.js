// ZECHE GRUV — Portal de artistas: cuaderno de letras.
// Dentro de la sección Letras, además de los archivos de OneDrive, cada
// artista tiene un cuaderno: escribe la letra en el portal, le pone el
// título de la canción y la arma por partes (Intro, Verso, Estribillo…).
// Se guarda sola mientras escribe, en la tabla "lyrics" de Supabase
// (supabase/010_letras.sql). El administrador ve y puede editar las de
// cada artista desde su perfil.
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;

  const KINDS = [
    ["intro", "Intro"],
    ["verso", "Verso"],
    ["pre", "Pre-estribillo"],
    ["estribillo", "Estribillo"],
    ["puente", "Puente"],
    ["hook", "Hook"],
    ["outro", "Outro"],
    ["otra", "Otra parte"],
  ];
  const KIND_LABEL = Object.fromEntries(KINDS);
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

  let profile = null;  // dueño del cuaderno que se está viendo
  let lyrics = [];     // sus letras, la más reciente primero
  let doc = null;      // la letra abierta en el editor
  let listTicket = 0;  // para descartar respuestas viejas si se cambia de perfil rápido
  let timer = null;
  let saving = null;
  let dirty = false;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
  const isEmpty = (l) => !String(l.title || "").trim() && !(l.sections || []).some((s) => String(s.text || "").trim());

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

  function preview(l) {
    for (const s of l.sections || []) {
      const line = String(s.text || "").split("\n").map((x) => x.trim()).find(Boolean);
      if (line) return line;
    }
    return "Todavía sin letra";
  }

  function renderList() {
    const own = profile.id === P.me.id;
    $("lyricsStatus").textContent = lyrics.length ? "" : own
      ? "Tu cuaderno está vacío. Tocá “Nueva letra” y arrancá como te salga: un título, un verso, una idea suelta."
      : "Todavía no escribió ninguna letra en el portal.";
    $("lyricsList").innerHTML = lyrics.map((l) => `
      <li><button class="lyric-item" type="button" data-lyric="${esc(l.id)}">
        <b>${esc(l.title.trim() || "Sin título")}</b>
        <span class="lyric-preview">${esc(preview(l))}</span>
        <span class="lyric-date">Editada ${fmtDate(l.updated_at)}</span>
      </button></li>`).join("");
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
    P.showPanel("lyric");
    $("lyricEyebrow").textContent = `${P.nameOf(profile)} · Letras`;
    $("lyricTitle").value = doc.title;
    $("lyricSongs").innerHTML = (window.ZGSongs && window.ZGSongs.titles ? window.ZGSongs.titles(profile.id) : [])
      .map((t) => `<option value="${esc(t)}"></option>`).join("");
    setSave(isNew ? "Se guarda sola mientras escribís" : `Editada ${fmtDate(item.updated_at)}`);
    disarm($("lyricDelete"), "Borrar esta letra");
    $("lyricCopy").textContent = "Copiar letra";
    renderParts();
    if (isNew) $("lyricTitle").focus();
  }

  function setSave(text, isError) {
    $("lyricSave").textContent = text;
    $("lyricSave").classList.toggle("is-error", !!isError);
  }

  function partHtml(s, i, label, count) {
    const options = KINDS.map(([k, name]) => `<option value="${k}"${k === s.kind ? " selected" : ""}>${k === s.kind ? esc(label) : name}</option>`).join("");
    return `
      <section class="lyric-part" data-i="${i}">
        <div class="lyric-part-head">
          <span class="lyric-kind-wrap"><select class="lyric-kind" aria-label="Tipo de parte">${options}</select></span>
          <div class="lyric-tools">
            <button class="lyric-tool" type="button" data-act="up" aria-label="Subir ${esc(label)}"${i === 0 ? " disabled" : ""}>↑</button>
            <button class="lyric-tool" type="button" data-act="down" aria-label="Bajar ${esc(label)}"${i === count - 1 ? " disabled" : ""}>↓</button>
            <button class="lyric-tool" type="button" data-act="remove" aria-label="Quitar ${esc(label)}">✕</button>
          </div>
        </div>
        <textarea class="lyric-text" rows="3" spellcheck="true" aria-label="${esc(label)}" placeholder="${esc(PLACEHOLDER[s.kind])}">${esc(s.text)}</textarea>
      </section>`;
  }

  function renderParts(focusIndex) {
    const names = labels(doc.sections);
    $("lyricSections").innerHTML = doc.sections.map((s, i) => partHtml(s, i, names[i], doc.sections.length)).join("");
    document.querySelectorAll("#lyricSections .lyric-text").forEach(fit);
    if (focusIndex != null) {
      const box = document.querySelector(`#lyricSections [data-i="${focusIndex}"] .lyric-text`);
      if (box) { box.focus(); box.closest(".lyric-part").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
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
    doc.sections[+box.closest(".lyric-part").dataset.i].text = box.value;
    fit(box);
    schedule();
  });

  $("lyricSections").addEventListener("change", (event) => {
    const select = event.target.closest(".lyric-kind");
    if (!select) return;
    const i = +select.closest(".lyric-part").dataset.i;
    doc.sections[i].kind = select.value;
    renderParts();
    document.querySelector(`#lyricSections [data-i="${i}"] .lyric-kind`)?.focus();
    schedule();
  });

  $("lyricSections").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const i = +btn.closest(".lyric-part").dataset.i;
    const act = btn.dataset.act;
    if (act === "remove") {
      // Si la parte tiene texto, se pide un segundo toque.
      if (doc.sections[i].text.trim() && !btn.classList.contains("is-armed")) {
        arm(btn, "¿Quitar?");
        return;
      }
      doc.sections.splice(i, 1);
      renderParts();
    } else {
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= doc.sections.length) return;
      [doc.sections[i], doc.sections[j]] = [doc.sections[j], doc.sections[i]];
      renderParts();
      document.querySelector(`#lyricSections [data-i="${j}"] [data-act="${act}"]:not(:disabled)`)?.focus();
    }
    schedule();
  });

  $("lyricAdd").innerHTML = KINDS.map(([k, name]) => `<button class="btn" type="button" data-add="${k}">+ ${name}</button>`).join("");
  $("lyricAdd").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-add]");
    if (!btn) return;
    doc.sections.push({ kind: btn.dataset.add, text: "" });
    renderParts(doc.sections.length - 1);
    schedule();
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
          setSave("No se pudo guardar. Revisá la conexión: lo volvemos a intentar solo.", true);
          clearTimeout(timer);
          timer = setTimeout(save, 5000);
        }
        return;
      }
      const item = lyrics.find((l) => l.id === id);
      if (item) Object.assign(item, changes, { updated_at: data.updated_at });
      if (doc && doc.id === id && !dirty) setSave("Guardado");
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
    window.ZGFiles.open("letras", profile);
  });

  // Copia la letra entera, con las partes entre corchetes: lista para
  // pegar en un mensaje o en el formulario de distribución.
  $("lyricCopy").addEventListener("click", async () => {
    const names = labels(doc.sections);
    const body = doc.sections.filter((s) => s.text.trim()).map((s) => `[${names[doc.sections.indexOf(s)]}]\n${s.text.trim()}`).join("\n\n");
    const text = [doc.title.trim(), body].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      $("lyricCopy").textContent = "Copiada ✓";
    } catch (e) {
      $("lyricCopy").textContent = "No se pudo copiar";
    }
    setTimeout(() => { $("lyricCopy").textContent = "Copiar letra"; }, 2200);
  });

  // Que no se pierda nada al cerrar la pestaña o pasar a otra app.
  window.addEventListener("beforeunload", (event) => {
    if (doc && (dirty || saving)) { save(); event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty) save(); });
  // Si se sale del editor por otro lado (pestañas, cerrar sesión), se guarda igual.
  new MutationObserver(() => { if ($("panel-lyric").hidden && doc) { const d = doc; save().then(() => { if (doc === d) doc = null; }); } })
    .observe($("panel-lyric"), { attributes: true, attributeFilter: ["hidden"] });

  window.ZGLyrics = { load };
})();
