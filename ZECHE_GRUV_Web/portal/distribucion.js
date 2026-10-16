// ZECHE GRUV — Portal de artistas (etapa 2: distribución).
// El artista completa la ficha de su lanzamiento, la guarda como borrador
// y la envía; a partir de ahí queda bloqueada para él y la carga ZECHE GRUV.
// Los permisos reales están en supabase/003_distribucion.sql.
(() => {
  const P = window.ZGPortal;
  const { db, $, setMsg } = P;

  const STATUS_LABEL = { draft: "Borrador", submitted: "Enviado", loaded: "En camino a las tiendas", published: "Publicado" };
  // Roles y versiones tal cual figuran en la planilla de distribución.
  const ROLES = ["Main Artist", "Featuring", "Composer", "Lyricist", "Songwriter", "Producer", "Mixer", "Mastering Engineer", "Remixer"];
  const VERSIONS = ["Acoustic", "Clean", "Clean Edit", "Clean Version", "Cover", "Dub Edit", "Dub Mix", "Extended", "Extended Mix", "Instrumental", "Live", "Radio Edit", "Radio Mix", "Remastered", "Remix", "Stripped", "VIP Edit", "VIP Mix"];
  const MIN_DAYS = 21;       // anticipación recomendada
  const MIN_DAYS_PITCH = 30; // anticipación para pitch editorial
  const COVER_SIZE = 3000;                    // px por lado
  const COVER_MAX_BYTES = 20 * 1024 * 1024;
  const COVER_TYPES = { "image/jpeg": "jpg", "image/png": "png" };
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

  let listProfile = null; // perfil cuyos lanzamientos se listan; null = todos (administrador)
  let release = null;     // lanzamiento abierto en la ficha
  let owner = null;       // perfil del artista dueño de ese lanzamiento
  // Masters de la carpeta del artista (OneDrive), para elegir de una lista.
  // null = todavía no se pidió o no se pudo leer (queda el campo de texto).
  let masters = null;
  let mastersOwner = null;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const isAdmin = () => P.me.role === "admin";
  // Administrador o equipo de distribución: ven y editan todos los lanzamientos.
  const isStaff = () => isAdmin() || P.me.role === "distribution";
  const fmtDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
  const newCredit = () => ({ artist_name: "", full_name: "", email: "", roles: [], split: "" });
  const newTrack = () => ({ title: "", version: "", language: "", explicit: false, is_cover: false, isrc: "", master: "", spotify_link: "", credits: [newCredit()] });

  // ---------- Lista ----------
  async function openList(profile) {
    listProfile = profile;
    const all = !profile;
    const own = !!profile && profile.id === P.me.id;
    P.showPanel("releases");

    $("releasesBack").hidden = all;
    $("releasesEyebrow").textContent = all ? (isAdmin() ? "Administrador" : "Equipo de distribución") : `Distribución · ${P.nameOf(profile)}`;
    $("newReleaseBtn").hidden = !own;
    $("releasesTable").classList.toggle("show-artist", all);
    const status = $("releasesStatus");
    const tbody = $("releasesTable").querySelector("tbody");
    status.textContent = "Cargando…";
    tbody.replaceChildren();

    let query = db.from("releases")
      .select("id, title, status, release_type, release_date, tracks, artist_id, profiles (id, display_name, full_name, email)")
      .order("updated_at", { ascending: false });
    if (profile) query = query.eq("artist_id", profile.id);
    const { data, error } = await query;
    if (error) { status.textContent = "No pudimos cargar los lanzamientos. Recargá la página."; return; }

    $("releasesTableWrap").hidden = !data.length;
    status.textContent = data.length ? "" : (own
      ? "Todavía no cargaste ningún lanzamiento. Leé la guía de abajo y empezá cuando tengas todo listo."
      : "Todavía no hay lanzamientos cargados.");

    tbody.replaceChildren(...data.map((r) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      // Canciones del lanzamiento, en orden (las que todavía no tienen título no se listan).
      const songs = (r.tracks || []).map((t) => t.title).filter(Boolean);
      const total = (r.tracks || []).length;
      tr.innerHTML = `
        <td>${esc(r.title || "Sin título")}</td>
        <td class="col-songs">${songs.length
          ? `<ol>${songs.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
          : `<span class="muted">${total === 1 ? "1 canción sin título" : `${total} canciones sin título`}</span>`}</td>
        <td class="col-artist">${esc(r.profiles ? P.nameOf(r.profiles) : "—")}</td>
        <td>${esc(P.FORMAT_LABEL[r.release_type] || "—")}</td>
        <td>${fmtDate(r.release_date)}</td>
        <td><span class="status status-${esc(r.status)}">${esc(STATUS_LABEL[r.status])}</span></td>`;
      const open = () => openRelease(r.id);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
  }

  $("releasesBack").addEventListener("click", () => P.backToProfile(listProfile));
  $("releaseBack").addEventListener("click", () => openList(listProfile));

  $("newReleaseBtn").addEventListener("click", () => {
    owner = P.me;
    release = {
      id: null, status: "draft", artist_id: P.me.id, title: "", release_type: P.me.format || "single", release_date: null,
      genre: "", subgenre: "", language: "", territory: "Todo el mundo", upc: "", cover_link: "", pitch: false, notes: "",
      tracks: [newTrack()],
    };
    renderRelease();
  });

  async function openRelease(id) {
    const { data, error } = await db.from("releases").select("*, profiles (*)").eq("id", id).single();
    if (error || !data) { $("releasesStatus").textContent = "No pudimos abrir ese lanzamiento."; return; }
    owner = data.profiles;
    delete data.profiles;
    release = data;
    if (!Array.isArray(release.tracks) || !release.tracks.length) release.tracks = [newTrack()];
    renderRelease();
  }

  // ---------- Ficha ----------
  function renderRelease() {
    const admin = isStaff();
    const editable = admin || release.status === "draft";
    P.showPanel("release");

    $("releaseEyebrow").textContent = `Distribución · ${P.nameOf(owner)}`;
    $("releaseHeading").textContent = release.title || (release.id ? "Sin título" : "Nuevo lanzamiento");
    $("releaseChips").innerHTML = `<span class="chip status-${esc(release.status)}">${esc(STATUS_LABEL[release.status])}</span>`
      + (release.submitted_at ? `<span class="chip">Enviado el ${fmtDate(release.submitted_at)}</span>` : "");

    const notice = $("releaseNotice");
    const changes = release.status === "draft" && release.review_note;
    notice.hidden = editable && !changes;
    notice.classList.toggle("notice-changes", !!changes);
    notice.textContent = changes
      ? `ZECHE GRUV te pidió ajustar esto antes de mandarlo a las tiendas: ${release.review_note}`
      : "Este lanzamiento ya fue enviado a ZECHE GRUV y no se puede editar. Si hay que corregir algo, escribinos.";
    $("rReviewNote").value = "";
    renderStores();

    $("rTitle").value = release.title || "";
    $("rType").value = release.release_type || "single";
    $("rDate").value = release.release_date || "";
    $("rGenre").value = release.genre || "";
    $("rSubgenre").value = release.subgenre || "";
    $("rLanguage").value = release.language || "";
    $("rTerritory").value = release.territory || "";
    $("rUpc").value = release.upc || "";
    renderCover();
    $("rPitch").checked = !!release.pitch;
    $("rNotes").value = release.notes || "";
    $("rStatus").value = release.status;

    $("releaseFields").disabled = !editable;
    $("releaseAdmin").hidden = !admin;
    document.querySelector("#releaseAdmin .zil-admin").hidden = !isAdmin() || owner.distributes === false;
    $("releaseActions").hidden = !editable;
    $("saveDraftBtn").hidden = admin;
    $("submitReleaseBtn").hidden = admin;
    $("adminSaveBtn").hidden = !admin;

    renderTracks();
    loadMasters();
    syncPitch();
    $("releaseErrors").replaceChildren();
    setMsg($("releaseMsg"), "");
  }

  // ---------- Portada ----------
  // El archivo queda en un espacio privado; "cover_link" guarda su ruta y
  // para mostrarla o descargarla se pide un link temporal.
  async function coverUrl(seconds) {
    if (!release.cover_link) return null;
    if (/^https?:/.test(release.cover_link)) return release.cover_link;
    const { data } = await db.storage.from("covers").createSignedUrl(release.cover_link, seconds);
    return data ? data.signedUrl : null;
  }

  async function renderCover() {
    const path = release.cover_link;
    $("coverBtn").textContent = path ? "Cambiar portada" : "Subir portada";
    $("coverPreview").hidden = true;
    $("coverEmpty").hidden = false;
    $("coverDownload").hidden = true;
    setMsg($("coverMsg"), "");
    const url = await coverUrl(3600);
    if (!url || release.cover_link !== path) return;
    $("coverPreview").src = url;
    $("coverPreview").hidden = false;
    $("coverEmpty").hidden = true;
    $("coverDownload").href = url;
    $("coverDownload").hidden = false;
  }

  function imageSize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve([img.naturalWidth, img.naturalHeight]); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No pudimos leer esa imagen. Probá exportarla de nuevo.")); };
      img.src = url;
    });
  }

  $("coverBtn").addEventListener("click", () => $("coverFile").click());
  $("coverFile").addEventListener("change", async () => {
    const file = $("coverFile").files[0];
    $("coverFile").value = "";
    if (!file) return;
    const msg = $("coverMsg");
    $("coverBtn").disabled = true;
    setMsg(msg, "Revisando la portada…");
    try {
      const ext = COVER_TYPES[file.type];
      if (!ext) throw new Error("La portada tiene que ser JPG o PNG.");
      if (file.size > COVER_MAX_BYTES) throw new Error("La portada pesa más de 20 MB. Exportala más liviana.");
      const [w, h] = await imageSize(file);
      if (w !== COVER_SIZE || h !== COVER_SIZE) throw new Error(`La portada mide ${w} x ${h} px y tiene que medir ${COVER_SIZE} x ${COVER_SIZE} px.`);
      setMsg(msg, "Subiendo portada…");
      // Nombre único por subida: las anteriores no se pisan ni se borran.
      const path = `${owner.id}/portada-${Date.now()}.${ext}`;
      const { error } = await db.storage.from("covers").upload(path, file, { contentType: file.type });
      if (error) throw new Error("No pudimos subir la portada. Probá de nuevo.");
      release.cover_link = path;
      await renderCover();
      setMsg(msg, release.id ? "Portada subida. Guardá para que quede en el lanzamiento." : "Portada subida.");
    } catch (err) {
      setMsg(msg, err.message, true);
    } finally {
      $("coverBtn").disabled = false;
    }
  });

  // El pitch editorial es solo para EP y Álbum.
  function syncPitch() {
    const allowed = $("rType").value !== "single";
    $("rPitch").disabled = !allowed;
    if (!allowed) $("rPitch").checked = false;
    $("rPitchRow").style.opacity = allowed ? "" : ".45";
  }
  $("rType").addEventListener("change", syncPitch);

  function creditHtml(c, ti, ci) {
    return `
      <div class="credit" data-credit="${ci}">
        <div class="credit-grid">
          <div class="field"><label>Nombre artístico</label><input type="text" data-c="artist_name" maxlength="80" value="${esc(c.artist_name)}"></div>
          <div class="field"><label>Nombre completo</label><input type="text" data-c="full_name" maxlength="120" value="${esc(c.full_name)}"></div>
          <div class="field"><label>Mail</label><input type="email" data-c="email" maxlength="160" value="${esc(c.email)}"></div>
          <div class="field"><label>Split %</label><input type="number" data-c="split" min="0" max="100" step="0.01" value="${esc(c.split)}"></div>
        </div>
        <div class="roles" role="group" aria-label="Roles">
          ${ROLES.map((role) => `<label class="role"><input type="checkbox" data-role="${esc(role)}"${(c.roles || []).includes(role) ? " checked" : ""}><span>${esc(role)}</span></label>`).join("")}
        </div>
        <button class="link-btn" type="button" data-action="remove-credit">Quitar participante</button>
      </div>`;
  }

  function trackHtml(t, ti) {
    return `
      <div class="card form track" data-track="${ti}">
        <div class="track-head">
          <span class="track-num">Canción ${ti + 1}</span>
          <button class="link-btn" type="button" data-action="remove-track">Quitar canción</button>
        </div>
        <div class="field"><label>Título de la canción</label><input type="text" data-t="title" maxlength="160" value="${esc(t.title)}"></div>
        <div class="row">
          <div class="field"><label>Versión</label>
            <select data-t="version">
              <option value="">Original</option>
              ${VERSIONS.map((v) => `<option${t.version === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Idioma</label><input type="text" data-t="language" maxlength="40" list="languageList" value="${esc(t.language)}"></div>
        </div>
        <div class="row">
          <div class="field"><label>¿Contenido explícito?</label>
            <select data-t="explicit"><option value="no">No</option><option value="yes"${t.explicit ? " selected" : ""}>Sí</option></select>
          </div>
          <div class="field"><label>¿Es un cover?</label>
            <select data-t="is_cover"><option value="no">No</option><option value="yes"${t.is_cover ? " selected" : ""}>Sí</option></select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>Máster a usar</label>${masterField(t.master)}</div>
          <div class="field"><label>ISRC</label><input type="text" data-t="isrc" maxlength="20" value="${esc(t.isrc)}">
            <p class="hint">Solo si la canción ya estaba publicada.</p></div>
        </div>
        <div class="field"><label>Link actual en Spotify</label><input type="url" data-t="spotify_link" maxlength="300" placeholder="https://" value="${esc(t.spotify_link)}">
          <p class="hint">Solo si la canción ya estaba publicada.</p></div>

        <div class="subhead">Créditos y splits</div>
        <p class="hint">Sumá a todas las personas que participaron. Mínimo un Main Artist y un Composer. Los porcentajes tienen que sumar 100.</p>
        <div class="credits">${(t.credits || []).map((c, ci) => creditHtml(c, ti, ci)).join("")}</div>
        <div class="actions">
          <button class="btn add-credit" type="button" data-action="add-credit">+ Agregar participante</button>
          <span class="split-total" data-total></span>
        </div>
      </div>`;
  }

  // Lista de masters de la carpeta del artista; si no se pudo leer, el
  // campo de texto de siempre.
  function masterField(value) {
    if (!masters || !masters.length) {
      return `<input type="text" data-t="master" maxlength="200" placeholder="Ej: Sol v3" value="${esc(value)}">
            <p class="hint">El nombre de la versión final aprobada, tal como figura en Masters.</p>`;
    }
    const known = masters.includes(value);
    return `<select data-t="master">
              <option value="">Elegí el máster…</option>
              ${!known && value ? `<option selected>${esc(value)}</option>` : ""}
              ${masters.map((m) => `<option${m === value ? " selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
            <p class="hint">Los audios de tu carpeta Masters (sin las versiones para vivo).</p>`;
  }

  async function loadMasters() {
    if (!owner || !owner.id || !release) return;
    if (mastersOwner === owner.id) return;
    mastersOwner = owner.id;
    masters = null;
    const forId = owner.id;
    try {
      const { data: { session } } = await db.auth.getSession();
      const params = new URLSearchParams({ section: "masters" });
      if (forId !== P.me.id) params.set("artist", forId);
      const res = await fetch(`/.netlify/functions/portal-files?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      if (!res.ok || !data.exists) return;
      const files = [...(data.files || []), ...(data.groups || []).flatMap((g) => g.files || [])];
      const list = [...new Set(files
        .filter((f) => /\.(wav|aiff?|flac|mp3)$/i.test(f.name) && f.tag !== "vivo")
        .map((f) => f.name))];
      if (!list.length || !owner || owner.id !== forId) return;
      masters = list;
      if (!$("releaseFields").disabled) { collect(); renderTracks(); }
    } catch (err) {
      // Sin lista: queda el campo de texto.
    }
  }

  function renderTracks() {
    $("tracksList").innerHTML = release.tracks.map(trackHtml).join("");
    updateSplitTotals();
  }

  function updateSplitTotals() {
    document.querySelectorAll("#tracksList .track").forEach((card) => {
      const values = [...card.querySelectorAll('[data-c="split"]')].map((i) => parseFloat(i.value)).filter((n) => !Number.isNaN(n));
      const total = values.reduce((a, b) => a + b, 0);
      const el = card.querySelector("[data-total]");
      el.textContent = values.length ? `Total splits: ${+total.toFixed(2)}%` : "";
      el.classList.toggle("is-ok", Math.abs(total - 100) < 0.01);
      el.classList.toggle("is-off", values.length > 0 && Math.abs(total - 100) >= 0.01);
    });
  }

  // Pasa lo que hay en pantalla al objeto "release".
  function collect() {
    const text = (id) => $(id).value.trim();
    Object.assign(release, {
      title: text("rTitle"), release_type: $("rType").value, release_date: $("rDate").value || null,
      genre: text("rGenre"), subgenre: text("rSubgenre"), language: text("rLanguage"), territory: text("rTerritory"),
      upc: text("rUpc"), pitch: $("rPitch").checked, notes: text("rNotes"),
    });
    release.tracks = [...document.querySelectorAll("#tracksList .track")].map((card) => {
      const t = (key) => card.querySelector(`[data-t="${key}"]`).value.trim();
      return {
        title: t("title"), version: t("version"), language: t("language"),
        explicit: t("explicit") === "yes", is_cover: t("is_cover") === "yes",
        isrc: t("isrc"), master: t("master"), spotify_link: t("spotify_link"),
        credits: [...card.querySelectorAll(".credit")].map((row) => {
          const c = (key) => row.querySelector(`[data-c="${key}"]`).value.trim();
          return {
            artist_name: c("artist_name"), full_name: c("full_name"), email: c("email"), split: c("split"),
            roles: [...row.querySelectorAll("[data-role]:checked")].map((i) => i.dataset.role),
          };
        }),
      };
    });
  }

  $("tracksList").addEventListener("input", (event) => {
    if (event.target.matches('[data-c="split"]')) updateSplitTotals();
  });

  $("tracksList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    collect();
    const ti = +btn.closest(".track").dataset.track;
    const track = release.tracks[ti];
    if (btn.dataset.action === "add-credit") track.credits.push(newCredit());
    else if (btn.dataset.action === "remove-credit") {
      track.credits.splice(+btn.closest(".credit").dataset.credit, 1);
      if (!track.credits.length) track.credits.push(newCredit());
    } else if (btn.dataset.action === "remove-track") {
      if (release.tracks.length === 1) return;
      if (track.title && !confirm(`¿Quitar "${track.title}" de este lanzamiento?`)) return;
      release.tracks.splice(ti, 1);
    }
    renderTracks();
  });

  $("addTrackBtn").addEventListener("click", () => {
    collect();
    release.tracks.push(newTrack());
    renderTracks();
  });

  // ---------- Validación (solo al enviar; el borrador se guarda como esté) ----------
  function validate() {
    const errors = [];
    const warnings = [];
    const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!release.title) errors.push("Falta el título del lanzamiento.");
    if (!release.release_date) errors.push("Falta la fecha de salida.");
    if (!release.genre) errors.push("Falta el género.");
    if (!release.language) errors.push("Falta el idioma del lanzamiento.");
    if (!release.cover_link) errors.push("Falta subir la portada.");
    if (release.release_type === "ep" && release.tracks.length < 3) errors.push("Un EP lleva al menos 3 canciones.");
    if (release.release_type === "album" && release.tracks.length < 8) errors.push("Un álbum lleva al menos 8 canciones.");

    release.tracks.forEach((t, i) => {
      const n = `Canción ${i + 1}`;
      if (!t.title) errors.push(`${n}: falta el título.`);
      if (!t.language) errors.push(`${n}: falta el idioma.`);
      if (!t.master) errors.push(`${n}: falta indicar qué máster usar.`);
      const credits = t.credits.filter((c) => c.full_name || c.email || c.artist_name || c.roles.length || c.split);
      if (!credits.some((c) => c.roles.includes("Main Artist"))) errors.push(`${n}: falta al menos un Main Artist.`);
      if (!credits.some((c) => c.roles.includes("Composer"))) errors.push(`${n}: falta al menos un Composer.`);
      credits.forEach((c, k) => {
        const who = c.full_name || c.artist_name || `participante ${k + 1}`;
        if (!c.full_name) errors.push(`${n}: falta el nombre completo de ${who}.`);
        if (!mail.test(c.email)) errors.push(`${n}: falta un mail válido para ${who}.`);
        if (!c.roles.length) errors.push(`${n}: falta el rol de ${who}.`);
      });
      const total = credits.reduce((sum, c) => sum + (parseFloat(c.split) || 0), 0);
      if (Math.abs(total - 100) >= 0.01) errors.push(`${n}: los splits suman ${+total.toFixed(2)}% y tienen que sumar 100%.`);
      if (t.is_cover) warnings.push(`${n}: los covers pueden requerir licencias. Avisanos antes de la fecha de salida.`);
    });

    if (release.release_date) {
      const days = Math.ceil((new Date(release.release_date + "T00:00:00") - new Date()) / 86400000);
      if (release.pitch && days < MIN_DAYS_PITCH) warnings.push(`Faltan ${Math.max(days, 0)} días para la salida: para el pitch editorial se necesitan ${MIN_DAYS_PITCH}.`);
      else if (days < MIN_DAYS) warnings.push(`Faltan ${Math.max(days, 0)} días para la salida: recomendamos enviar con al menos 3 o 4 semanas de anticipación.`);
    }
    return { errors, warnings };
  }

  function showIssues(errors, warnings) {
    $("releaseErrors").replaceChildren(...[...errors.map((t) => [t, ""]), ...warnings.map((t) => [t, "is-warning"])].map(([text, cls]) => {
      const li = document.createElement("li");
      li.textContent = text;
      li.className = cls;
      return li;
    }));
  }

  // ---------- Guardar / enviar ----------
  async function save(status) {
    const row = {
      title: release.title || null, release_type: release.release_type, release_date: release.release_date,
      genre: release.genre || null, subgenre: release.subgenre || null, language: release.language || null,
      territory: release.territory || null, upc: release.upc || null, cover_link: release.cover_link || null,
      pitch: release.pitch, notes: release.notes || null, tracks: release.tracks, status,
    };
    if (status === "submitted") row.review_note = null;
    const query = release.id
      ? db.from("releases").update(row).eq("id", release.id)
      : db.from("releases").insert(row);
    const { data, error } = await query.select().single();
    if (error) throw new Error("No pudimos guardar. Revisá tu conexión y probá de nuevo.");
    release = data;
  }

  async function run(btn, task, okText) {
    btn.disabled = true;
    setMsg($("releaseMsg"), "Guardando…");
    try {
      await task();
      renderRelease();
      setMsg($("releaseMsg"), okText);
    } catch (err) {
      setMsg($("releaseMsg"), err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  // Aviso por mail (release-notify.js). Si falla, lo guardado queda igual.
  async function notify(kind) {
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/release-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: release.id, event: kind }),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  $("saveDraftBtn").addEventListener("click", (event) => {
    collect();
    showIssues([], []);
    run(event.currentTarget, () => save("draft"), "Borrador guardado. Podés seguir cuando quieras.");
  });

  $("submitReleaseBtn").addEventListener("click", (event) => {
    collect();
    const { errors, warnings } = validate();
    showIssues(errors, warnings);
    if (errors.length) { setMsg($("releaseMsg"), "Completá lo que falta para poder enviarlo.", true); return; }
    const extra = warnings.length ? `\n\nAvisos:\n- ${warnings.join("\n- ")}` : "";
    if (!confirm(`¿Enviar "${release.title}" a ZECHE GRUV? Después de enviarlo no vas a poder editarlo.${extra}`)) return;
    run(event.currentTarget, async () => { await save("submitted"); await notify("submitted"); },
      "¡Listo! Lo recibimos y lo vamos a revisar. Te avisamos cuando salga a las tiendas.");
  });

  $("adminSaveBtn").addEventListener("click", (event) => {
    collect();
    const { errors, warnings } = validate();
    showIssues(errors, warnings);
    run(event.currentTarget, () => save($("rStatus").value), "Cambios guardados.");
  });

  // Devolverle el lanzamiento al artista con una nota: vuelve a borrador,
  // él lo puede editar y le llega un mail con lo que hay que corregir.
  $("requestChangesBtn").addEventListener("click", async (event) => {
    const note = $("rReviewNote").value.trim();
    if (!note) { setMsg($("releaseMsg"), "Escribí qué tiene que corregir el artista.", true); $("rReviewNote").focus(); return; }
    if (!confirm(`¿Devolverle "${release.title || "el lanzamiento"}" al artista con esta nota?\n\n${note}`)) return;
    collect();
    const btn = event.currentTarget;
    btn.disabled = true;
    setMsg($("releaseMsg"), "Guardando…");
    try {
      const { data, error } = await db.from("releases").update({ status: "draft", review_note: note }).eq("id", release.id).select().single();
      if (error) throw new Error("No pudimos guardar. ¿Corriste supabase/027_lanzamientos_revision.sql?");
      release = data;
      const sent = await notify("changes");
      renderRelease();
      setMsg($("releaseMsg"), sent ? "Devuelto al artista. Le llegó un mail con tu nota." : "Devuelto al artista, pero el mail no salió. Avisale por WhatsApp.", !sent);
    } catch (err) {
      setMsg($("releaseMsg"), err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Tiendas (ZIL) ----------
  // Lo que ve el artista (y vos): en qué está su lanzamiento y, cuando ya
  // salió, el link con todas las plataformas. Lo actualiza zil-sync.js cada hora.
  function renderStores() {
    const box = $("storeStatus");
    const z = release.zil_status || {};
    const show = release.status === "loaded" || release.status === "published";
    box.hidden = !show;
    if (!show) return;
    const live = z.live || 0, total = z.total || 0;
    const line = release.status === "published"
      ? "¡Ya está en las plataformas!"
      : total ? `En revisión en las tiendas · ${live} de ${total} ya lo publicaron` : "Enviado a las tiendas. Cada tienda lo revisa antes de publicarlo; suele tardar unos días.";
    box.innerHTML = `<p class="store-line"><b>${esc(line)}</b></p>`
      + (release.smart_link ? `<p><a class="btn btn-primary" href="${esc(release.smart_link)}" target="_blank" rel="noopener">Escuchar y compartir</a></p>` : "")
      + (z.checked_at ? `<p class="hint">Actualizado ${fmtDate(z.checked_at)}</p>` : "");
  }

  async function zil(action) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch("/.netlify/functions/zil-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, id: release && release.id }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  function zilShow(text) { const out = $("zilOut"); out.hidden = !text; out.textContent = text || ""; }

  async function zilRun(btn, action, label) {
    btn.disabled = true;
    zilShow(`${label}…`);
    try {
      const { ok, data } = await zil(action);
      const lines = [];
      if (data.error) lines.push(`✕ ${data.error}`);
      if (data.problems && data.problems.length) lines.push("Falta resolver:", ...data.problems.map((x) => `• ${x}`));
      if (ok && action === "preview" && data.ok) lines.push(`✓ Está todo para mandar (entorno: ${data.entorno}).`, "", ...(data.resumen.canciones || []).map((c) => `• ${c}`));
      if (ok && action === "publish") lines.push(`✓ Enviado a revisión de las tiendas${data.dev ? " (entorno de PRUEBAS: no llega a ninguna tienda real)" : ""}.`);
      if (ok && action === "sync") lines.push(data.ok ? `✓ ${data.live || 0} de ${(data.stores || []).length} tiendas lo publicaron.` : `✕ ${data.error}`);
      if (ok && action === "diagnose") lines.push(JSON.stringify(data, null, 2));
      zilShow(lines.join("\n"));
      if (ok && (action === "publish" || action === "sync")) await openRelease(release.id);
    } catch (err) {
      zilShow("✕ No pudimos hablar con el servidor. Probá de nuevo.");
    } finally {
      btn.disabled = false;
    }
  }

  $("zilDiagBtn").addEventListener("click", (e) => zilRun(e.currentTarget, "diagnose", "Probando la conexión con ZIL"));
  $("zilPreviewBtn").addEventListener("click", (e) => zilRun(e.currentTarget, "preview", "Revisando el lanzamiento"));
  $("zilSyncBtn").addEventListener("click", (e) => zilRun(e.currentTarget, "sync", "Consultando las tiendas"));
  $("zilPublishBtn").addEventListener("click", (e) => {
    if (release.status !== "submitted") { zilShow("Solo se publica un lanzamiento que el artista envió (estado Recibido). Guardá los cambios primero."); return; }
    if (!confirm(`¿Mandar "${release.title}" a las tiendas?\n\nSe carga en ZIL y pasa a revisión de las tiendas. Revisá antes que la fecha, la portada y los masters estén bien.`)) return;
    zilRun(e.currentTarget, "publish", "Cargando en ZIL y enviando a las tiendas");
  });

  // ---------- Exportar a Excel (administrador) ----------
  // Mismas 22 columnas y hojas que la planilla de distribución; los datos
  // extra del portal van en columnas adicionales al final.
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = XLSX_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No pudimos preparar el Excel. Revisá tu conexión."));
      document.head.append(s);
    });
  }

  $("exportBtn").addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    collect();
    btn.disabled = true;
    try {
      await loadXlsx();
      // Link de la portada válido por 30 días, para poder bajarla desde el Excel.
      const cover = (await coverUrl(60 * 60 * 24 * 30)) || "";
      const yn = (b) => (b ? "Yes" : "No");
      const head = ["UPC", "Release Date", "Release Title", "Song Title", "ISRC", "Main Artist", "Composer", "Featuring", "Remixer", "Lyricist", "Songwriter", "Producer", "Mastering Engineer", "Explicit?", "Cover?", "Version", "Genre", "Territory", "Audio Link", "Cover Art Link", "Spotify Link", "Notes",
        "Language", "Subgenre", "Format", "Editorial Pitch", "Mixer", "Splits"];
      const rows = release.tracks.map((t) => {
        // Artistas por nombre artístico; autores y técnicos por nombre real.
        const by = (role, stage) => t.credits.filter((c) => c.roles.includes(role)).map((c) => (stage && c.artist_name) || c.full_name).join(", ");
        const splits = t.credits.filter((c) => c.split !== "").map((c) => `${c.full_name || c.artist_name} ${c.split}%`).join(" / ");
        return [release.upc, release.release_date, release.title, t.title, t.isrc, by("Main Artist", true), by("Composer"), by("Featuring", true), by("Remixer", true), by("Lyricist"), by("Songwriter"), by("Producer", true), by("Mastering Engineer"), yn(t.explicit), yn(t.is_cover), t.version, release.genre, release.territory, t.master, cover, t.spotify_link, release.notes,
          t.language || release.language, release.subgenre, P.FORMAT_LABEL[release.release_type], yn(release.pitch), by("Mixer"), splits];
      });

      const people = new Map();
      people.set((owner.email || "").toLowerCase(), [owner.display_name, owner.full_name, owner.email, owner.spotify_artist_id ? `spotify:artist:${owner.spotify_artist_id}` : "", owner.apple_id]);
      release.tracks.forEach((t) => t.credits.forEach((c) => {
        const key = c.email.toLowerCase();
        if (key && !people.has(key)) people.set(key, [c.artist_name, c.full_name, c.email, "", ""]);
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), "Releases Metadata");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Artistic Name", "Full Name", "Email", "Spotify URI", "Apple ID"], ...people.values()]), "Artists Information");
      const safe = (release.title || "lanzamiento").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "lanzamiento";
      XLSX.writeFile(wb, `ZG Distribucion - ${safe}.xlsx`);
    } catch (err) {
      setMsg($("releaseMsg"), err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  window.ZGDistribution = { openList, openRelease };
})();
