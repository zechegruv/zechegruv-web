// ZECHE GRUV — Portal de artistas (etapa 3: archivos de OneDrive).
// Muestra, dentro del portal, lo que hay en cada sección de la carpeta del
// artista: las subcarpetas se ven como grupos (una por canción) y cada
// archivo con su fecha de creación, de modificación y un botón para
// descargarlo. Es solo lectura: la carpeta se lee desde
// netlify/functions/portal-files.js, que nunca sube ni borra nada.
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;

  const TITLES = { referencias: "Referencias", letras: "Letras", exports: "Exports", masters: "Masters", membresia: "Membresía" };
  const EMPTY = {
    referencias: "Todavía no hay referencias ni maquetas cargadas.",
    letras: "Todavía no hay letras cargadas.",
    exports: "Todavía no hay exports cargados.",
    masters: "Todavía no hay masters cargados.",
    membresia: "Todavía no hay documentos cargados.",
  };

  let profile = null;
  let section = null;
  let current = 0; // para descartar respuestas viejas si se cambia de sección rápido

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
  function fmtSize(bytes) {
    if (!bytes) return "—";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(mb >= 100 ? 0 : 1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  // Formatos que los navegadores reproducen sin descargar.
  const PLAYABLE = /\.(mp3|wav|m4a|aac|flac|ogg|oga)$/i;
  const PLAY_ICONS = '<svg class="icon-play" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg><svg class="icon-pause" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/></svg>';

  // Orden de los archivos: se elige tocando el título de una columna y vale
  // para todas las tablas de la sección (y se recuerda entre secciones).
  const SORT_KEY = "zg-portal-orden";
  const COLUMNS = [["name", "Archivo"], ["created", "Creado"], ["modified", "Modificado"], ["size", "Tamaño"]];
  let sort = { key: "modified", dir: "desc" };
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    if (saved && COLUMNS.some(([k]) => k === saved.key) && ["asc", "desc"].includes(saved.dir)) sort = saved;
  } catch (e) {}
  let listing = null; // lo último que devolvió la carpeta, para reordenar sin volver a pedirlo

  function sorted(files) {
    const sign = sort.dir === "asc" ? 1 : -1;
    const byName = (a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
    return [...files].sort((a, b) => {
      let diff;
      if (sort.key === "name") diff = byName(a, b);
      else if (sort.key === "size") diff = (a.size || 0) - (b.size || 0);
      else diff = String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""));
      return (diff || byName(a, b) * sign) * sign;
    });
  }

  function headHtml() {
    return COLUMNS.map(([key, label]) => {
      const active = sort.key === key;
      const aria = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th aria-sort="${aria}"><button class="sort-btn${active ? " is-active" : ""}" type="button" data-sort="${key}">${label}<span aria-hidden="true">${active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span></button></th>`;
    }).join("");
  }

  function tableHtml(files) {
    return `
      <div class="table-wrap">
        <table class="table files-table">
          <thead><tr>${headHtml()}<th></th></tr></thead>
          <tbody>
            ${sorted(files).map((f) => `
              <tr>
                <td><div class="file-name">${f.url && PLAYABLE.test(f.name)
                  ? `<button class="play-btn" type="button" data-play="${esc(f.url)}" data-name="${esc(f.name)}" aria-label="Escuchar ${esc(f.name)}">${PLAY_ICONS}</button>`
                  : ""}<span>${esc(f.name)}</span></div></td>
                <td>${fmtDate(f.created)}</td>
                <td>${fmtDate(f.modified)}</td>
                <td>${fmtSize(f.size)}</td>
                <td>${f.url ? `<a class="btn" href="${esc(f.url)}" download="${esc(f.name)}">Descargar</a>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  const countLabel = (n) => (n === 1 ? "1 archivo" : `${n} archivos`);

  async function open(sectionKey, who) {
    section = sectionKey;
    profile = who;
    const ticket = ++current;
    P.showPanel("files");

    $("filesEyebrow").textContent = P.nameOf(who);
    $("filesTitle").textContent = TITLES[section];
    const chips = $("filesChips");
    chips.replaceChildren();
    if (section === "membresia" && who.format) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `Formato: ${P.FORMAT_LABEL[who.format]}`;
      chips.append(chip);
    }
    const status = $("filesStatus");
    const list = $("filesList");
    listing = null;
    closePlayer();
    status.textContent = "Cargando…";
    list.replaceChildren();
    $("filesTools").hidden = true;
    $("uploadBox").hidden = true;

    let data = null;
    try {
      const { data: { session } } = await db.auth.getSession();
      const params = new URLSearchParams({ section });
      if (who.id !== P.me.id) params.set("artist", who.id);
      const res = await fetch(`/.netlify/functions/portal-files?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
    } catch (err) {
      if (ticket === current) status.textContent = "No pudimos cargar los archivos. Probá de nuevo en un momento.";
      return;
    }
    if (ticket !== current) return;

    if (!data.configured) {
      status.textContent = P.me.role === "admin"
        ? "Este artista todavía no tiene cargada su carpeta de OneDrive. Pegá el link en su perfil."
        : "Tu carpeta todavía no está conectada. Escribinos y lo resolvemos.";
      return;
    }
    setupUpload(data);
    const total = data.files.length + data.groups.reduce((n, g) => n + g.files.length, 0);
    if (!total) { status.textContent = EMPTY[section]; return; }
    status.textContent = "";

    listing = data;
    renderList();
    $("filesTools").hidden = data.groups.length < 2;
  }

  // Dibuja la sección con el orden elegido. Los grupos que estaban
  // desplegados siguen desplegados.
  function renderList() {
    const openGroups = new Set(groupsEls().filter((d) => d.open).map((d) => d.dataset.group));
    const loose = listing.files.length ? tableHtml(listing.files) : "";
    const groups = listing.groups.map((g) => `
      <details class="file-group" data-group="${esc(g.name)}"${openGroups.has(g.name) ? " open" : ""}>
        <summary><span class="group-name">${esc(g.name)}</span><span class="group-count">${countLabel(g.files.length)}</span></summary>
        ${g.files.length ? tableHtml(g.files) : ""}
      </details>`).join("");
    $("filesList").innerHTML = loose + groups;
    syncToggle();
    syncPlayer();
  }

  // Tocar una columna ordena por ella; tocarla de nuevo invierte el orden.
  $("filesList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-sort]");
    if (!btn || !listing) return;
    const key = btn.dataset.sort;
    // Nombre arranca de la A a la Z; fechas y tamaño, de mayor a menor.
    sort = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" };
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch (e) {}
    renderList();
    $("filesList").querySelector(`[data-sort="${key}"]`)?.focus();
  });

  // ---------- Subir archivos (Referencias y Letras) ----------
  // El archivo se manda en partes a OneDrive (netlify/functions/portal-upload.js).
  // Acá no existe borrar, mover ni renombrar: solo agregar.
  const UPLOAD = {
    referencias: { max: 300, accept: ".mp3,.wav,.m4a,.aac,.flac,.ogg,.aif,.aiff,.mp4,.mov,.pdf,.txt,.jpg,.jpeg,.png", hint: "Audios (MP3, WAV, M4A, FLAC…), videos, imágenes, PDF o texto. Hasta 300 MB." },
    letras: { max: 25, accept: ".txt,.doc,.docx,.pdf,.rtf,.md,.pages,.odt", hint: "Texto, Word o PDF. Hasta 25 MB." },
  };
  const CHUNK = 10 * 320 * 1024; // 3,2 MB: múltiplo de 320 KB, como pide OneDrive
  let uploading = false;

  function setupUpload(data) {
    const cfg = UPLOAD[section];
    $("uploadBox").hidden = !(cfg && data.canUpload);
    if (!cfg || !data.canUpload) return;
    $("uploadFile").accept = cfg.accept;
    $("uploadHint").textContent = `${cfg.hint} Los archivos no se pueden borrar desde acá: si subís algo por error, avisanos.`;
    // Se puede subir suelto o a una canción (subcarpeta) que ya exista.
    $("uploadGroup").innerHTML = '<option value="">Sin canción (suelto en la sección)</option>'
      + data.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("");
    $("uploadGroupField").hidden = !data.groups.length;
    $("uploadProgress").hidden = true;
    P.setMsg($("uploadMsg"), "");
  }

  async function uploadCall(body) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch("/.netlify/functions/portal-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((out.error || "No pudimos subir el archivo.") + (out.detail ? ` (${out.detail})` : ""));
    return out;
  }

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
    reader.readAsDataURL(blob);
  });

  async function uploadFile(file) {
    const cfg = UPLOAD[section];
    const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (!cfg.accept.split(",").includes(ext)) throw new Error("Ese tipo de archivo no se puede subir a esta sección.");
    if (!file.size) throw new Error("El archivo está vacío.");
    if (file.size > cfg.max * 1024 * 1024) throw new Error(`El archivo pesa más de ${cfg.max} MB.`);

    const base = { section, name: file.name, group: $("uploadGroup").value || undefined };
    if (profile.id !== P.me.id) base.artist = profile.id;
    const progress = (done) => { $("uploadBar").style.width = `${Math.round((done / file.size) * 100)}%`; };

    const started = await uploadCall({ action: "start", size: file.size, ...base });
    if (started.mode === "simple") {
      await uploadCall({ action: "simple", data: await toBase64(file), ...base });
      progress(file.size);
      return;
    }

    // Partes directo a OneDrive; si el navegador no puede, a través del servidor.
    let direct = true;
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK, file.size) - 1;
      const part = file.slice(offset, end + 1);
      if (direct) {
        try {
          const res = await fetch(started.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${offset}-${end}/${file.size}` }, body: part });
          if (!res.ok) throw new Error(`OneDrive respondió ${res.status}`);
          offset = end + 1;
          progress(offset);
          continue;
        } catch (err) {
          // Puede que la parte haya llegado igual: se pregunta desde dónde seguir.
          direct = false;
          const state = await uploadCall({ action: "status", uploadUrl: started.uploadUrl }).catch(() => null);
          const next = state && state.nextExpectedRanges && parseInt(state.nextExpectedRanges[0], 10);
          if (Number.isFinite(next)) { offset = next; progress(offset); }
          if (offset >= file.size) break;
          continue;
        }
      }
      await uploadCall({ action: "chunk", uploadUrl: started.uploadUrl, start: offset, end, total: file.size, data: await toBase64(part) });
      offset = end + 1;
      progress(offset);
    }
  }

  $("uploadBtn").addEventListener("click", () => { if (!uploading) $("uploadFile").click(); });
  $("uploadFile").addEventListener("change", async () => {
    const file = $("uploadFile").files[0];
    $("uploadFile").value = "";
    if (!file || uploading) return;
    uploading = true;
    $("uploadBtn").disabled = true;
    $("uploadProgress").hidden = false;
    $("uploadBar").style.width = "0";
    P.setMsg($("uploadMsg"), `Subiendo ${file.name}… No cierres esta página.`);
    const where = section, who = profile;
    try {
      await uploadFile(file);
      if (section === where && profile === who) {
        await open(where, who); // vuelve a listar para que aparezca el archivo nuevo
        P.setMsg($("uploadMsg"), `Listo: se subió ${file.name}.`);
      }
    } catch (err) {
      P.setMsg($("uploadMsg"), err.message, true);
    } finally {
      uploading = false;
      $("uploadBtn").disabled = false;
      $("uploadProgress").hidden = true;
    }
  });

  // ---------- Escucha previa ----------
  // Un solo reproductor para toda la sección: al darle play a otro archivo
  // se corta el que estaba sonando.
  const audio = $("playerAudio");
  const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
  let seeking = false;

  function syncPlayer() {
    const playing = !audio.paused && !audio.ended;
    $("player").classList.toggle("is-playing", playing);
    $("playerToggle").setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
    document.querySelectorAll("#filesList .play-btn").forEach((btn) => {
      const current = btn.dataset.play === audio.dataset.url;
      btn.classList.toggle("is-current", current);
      btn.classList.toggle("is-playing", current && playing);
    });
  }

  function closePlayer() {
    audio.pause();
    audio.removeAttribute("src");
    delete audio.dataset.url;
    audio.load();
    $("player").hidden = true;
    syncPlayer();
  }

  $("filesList").addEventListener("click", (event) => {
    const btn = event.target.closest(".play-btn");
    if (!btn) return;
    if (audio.dataset.url === btn.dataset.play) {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      return;
    }
    audio.dataset.url = btn.dataset.play;
    audio.src = btn.dataset.play;
    $("playerName").textContent = btn.dataset.name;
    $("playerNow").textContent = "0:00";
    $("playerTotal").textContent = "0:00";
    $("playerSeek").value = 0;
    $("player").hidden = false;
    audio.play().catch(() => {});
    syncPlayer();
  });

  $("playerToggle").addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  $("playerClose").addEventListener("click", closePlayer);
  ["play", "pause", "ended"].forEach((type) => audio.addEventListener(type, syncPlayer));
  audio.addEventListener("loadedmetadata", () => { $("playerTotal").textContent = fmtTime(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    if (seeking) return;
    $("playerNow").textContent = fmtTime(audio.currentTime);
    if (audio.duration) $("playerSeek").value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  audio.addEventListener("error", () => {
    if (!audio.dataset.url) return;
    // Los links de OneDrive vencen al rato: hay que volver a abrir la sección.
    $("playerName").textContent = "No pudimos reproducir este audio. Volvé a abrir la sección y probá de nuevo.";
    syncPlayer();
  });
  $("playerSeek").addEventListener("input", () => { seeking = true; if (audio.duration) $("playerNow").textContent = fmtTime(($("playerSeek").value / 1000) * audio.duration); });
  $("playerSeek").addEventListener("change", () => { if (audio.duration) audio.currentTime = ($("playerSeek").value / 1000) * audio.duration; seeking = false; });

  // Si se sale de la sección (volver, cambiar de pestaña, cerrar sesión), el audio se corta.
  new MutationObserver(() => { if ($("panel-files").hidden && !$("player").hidden) closePlayer(); })
    .observe($("panel-files"), { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(() => { if ($("view-app").hidden && !$("player").hidden) closePlayer(); })
    .observe($("view-app"), { attributes: true, attributeFilter: ["hidden"] });

  // Un solo botón para desplegar todas las canciones o volver a ver solo los grupos.
  const groupsEls = () => [...document.querySelectorAll("#filesList .file-group")];
  function syncToggle() {
    const anyClosed = groupsEls().some((d) => !d.open);
    $("filesToggleAll").textContent = anyClosed ? "Desplegar todo" : "Ver solo los grupos";
  }
  $("filesToggleAll").addEventListener("click", () => {
    const openAll = groupsEls().some((d) => !d.open);
    groupsEls().forEach((d) => { d.open = openAll; });
    syncToggle();
  });
  $("filesList").addEventListener("toggle", syncToggle, true);

  $("filesBack").addEventListener("click", () => P.backToProfile(profile));

  window.ZGFiles = { open };
})();
