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

  function tableHtml(files) {
    return `
      <div class="table-wrap">
        <table class="table files-table">
          <thead><tr><th>Archivo</th><th>Creado</th><th>Modificado</th><th>Tamaño</th><th></th></tr></thead>
          <tbody>
            ${files.map((f) => `
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

  async function open(section, who) {
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
    closePlayer();
    status.textContent = "Cargando…";
    list.replaceChildren();
    $("filesTools").hidden = true;

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
    const total = data.files.length + data.groups.reduce((n, g) => n + g.files.length, 0);
    if (!total) { status.textContent = EMPTY[section]; return; }
    status.textContent = "";

    const loose = data.files.length ? tableHtml(data.files) : "";
    const groups = data.groups.map((g) => `
      <details class="file-group">
        <summary><span class="group-name">${esc(g.name)}</span><span class="group-count">${countLabel(g.files.length)}</span></summary>
        ${g.files.length ? tableHtml(g.files) : ""}
      </details>`).join("");
    list.innerHTML = loose + groups;
    $("filesTools").hidden = data.groups.length < 2;
    syncToggle();
  }

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
