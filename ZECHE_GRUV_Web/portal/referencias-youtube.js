// ZECHE GRUV — Portal de artistas: links de YouTube en Referencias.
// Además de los archivos de OneDrive, el artista pega el link de un video que
// le sirve de referencia y el portal lo muestra con la portada del video, el
// título y el canal. Se guardan en la tabla "reference_links" de Supabase
// (supabase/015_referencias_youtube.sql); el título lo trae
// netlify/functions/youtube-info.js y la portada sale de i.ytimg.com.
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;

  const COLUMNS = "id, video_id, url, title, channel, song, created_at";
  const PLAY = '<svg viewBox="0 0 68 48" aria-hidden="true"><path d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3S12.8.3 7.5 1.7a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#F07800"/><path d="M27 34V14l18 10z" fill="#FFF4DC"/></svg>';

  let profile = null;
  let links = [];
  let folderSongs = [];  // canciones (subcarpetas) de Referencias en OneDrive
  let ticket = 0;
  let preview = null;    // { id, url, title, channel } del link pegado
  let previewTicket = 0;
  let saving = false;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  // Acepta youtube.com/watch?v=…, youtu.be/…, /shorts/, /live/, /embed/,
  // music.youtube.com y m.youtube.com. Devuelve el ID de 11 caracteres o null.
  function parseYouTube(value) {
    let raw = String(value || "").trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    let u;
    try { u = new URL(raw); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.split("/")[1];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/);
      if (!id && m) id = m[2];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  // Link limpio para guardar: conserva el minuto si venía (t=…).
  function cleanUrl(value, id) {
    let t = null;
    try { t = new URL(/^https?:\/\//i.test(value) ? value.trim() : `https://${value.trim()}`).searchParams.get("t"); } catch (e) {}
    return `https://www.youtube.com/watch?v=${id}${t && /^[0-9hms]+$/.test(t) ? `&t=${t}` : ""}`;
  }

  async function videoInfo(id) {
    const res = await fetch(`/.netlify/functions/youtube-info?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { title: "", channel: "" };
    return res.json();
  }

  // ---------- Lista ----------
  async function load(who) {
    profile = who;
    const mine = ++ticket;
    links = [];
    folderSongs = [];
    resetForm();
    $("refLinksStatus").textContent = "Cargando…";
    $("refLinksList").replaceChildren();
    P.setMsg($("refLinkMsg"), "");
    $("refLinksSub").textContent = who.id === P.me.id
      ? "Pegá el link de un video que te inspire para la canción: un sonido, una voz, un arreglo. Lo escuchamos juntos en la sesión."
      : `Los videos que ${P.nameOf(who)} guardó como referencia. También podés sumar los tuyos.`;
    syncSongs();

    const { data, error } = await db.from("reference_links").select(COLUMNS).eq("artist_id", who.id).order("created_at", { ascending: false });
    if (mine !== ticket) return;
    if (error) {
      $("refLinksStatus").textContent = P.me.role === "admin" && /reference_links/.test(error.message)
        ? "Falta crear la tabla de links: corré supabase/015_referencias_youtube.sql en Supabase."
        : "No pudimos cargar los links. Probá de nuevo en un momento.";
      return;
    }
    links = data || [];
    render();
    syncSongs();
  }

  function render() {
    $("refLinksStatus").textContent = links.length ? "" : "Todavía no hay links de YouTube.";
    $("refLinksList").innerHTML = links.map((l) => `
      <li class="ref-link">
        <a class="ref-thumb" href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Ver en YouTube: ${esc(l.title || "video")}">
          <img src="${thumb(l.video_id)}" alt="" loading="lazy" decoding="async">
          <span class="ref-play">${PLAY}</span>
        </a>
        <div class="ref-meta">
          <a class="ref-title" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || "Video de YouTube")}</a>
          ${l.channel ? `<div class="ref-channel">${esc(l.channel)}</div>` : ""}
          <div class="ref-foot">
            ${l.song ? `<span class="chip">${esc(l.song)}</span>` : ""}
            <button class="link-btn ref-remove" type="button" data-remove="${esc(l.id)}">Quitar</button>
          </div>
        </div>
      </li>`).join("");
  }

  // Canciones para elegir: las subcarpetas de Referencias más las que ya
  // tengan links guardados.
  function syncSongs() {
    const songs = [...new Set([...folderSongs, ...links.map((l) => l.song).filter(Boolean)])]
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
    const sel = $("refLinkSong");
    const keep = sel.value;
    sel.innerHTML = '<option value="">Sin canción</option>' + songs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    if (songs.includes(keep)) sel.value = keep;
    $("refLinkSongField").hidden = !songs.length;
  }

  function setSongs(who, names) {
    if (!profile || who.id !== profile.id) return;
    folderSongs = names || [];
    syncSongs();
  }

  // ---------- Pegar un link ----------
  function resetForm() {
    preview = null;
    ++previewTicket;
    $("refLinkUrl").value = "";
    $("refLinkPreview").hidden = true;
    $("refLinkPreview").innerHTML = "";
    $("refLinkAdd").disabled = true;
  }

  function showPreview() {
    const box = $("refLinkPreview");
    if (!preview) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <img src="${thumb(preview.id)}" alt="">
      <div class="ref-meta">
        <div class="ref-title">${preview.loading ? "Buscando el video…" : esc(preview.title || "Video de YouTube")}</div>
        ${preview.channel ? `<div class="ref-channel">${esc(preview.channel)}</div>` : ""}
      </div>`;
  }

  async function onInput() {
    const value = $("refLinkUrl").value;
    const id = parseYouTube(value);
    const mine = ++previewTicket;
    P.setMsg($("refLinkMsg"), "");
    if (!id) {
      preview = null;
      showPreview();
      $("refLinkAdd").disabled = true;
      if (value.trim().length > 8) P.setMsg($("refLinkMsg"), "Ese no parece un link de YouTube.", true);
      return;
    }
    if (preview && preview.id === id) { preview.url = cleanUrl(value, id); return; }
    preview = { id, url: cleanUrl(value, id), title: "", channel: "", loading: true };
    showPreview();
    $("refLinkAdd").disabled = false;
    const info = await videoInfo(id).catch(() => ({}));
    if (mine !== previewTicket) return;
    if (info.missing) {
      preview = null;
      showPreview();
      $("refLinkAdd").disabled = true;
      P.setMsg($("refLinkMsg"), "No encontramos ese video. Fijate que el link esté completo y que el video no sea privado.", true);
      return;
    }
    Object.assign(preview, { title: info.title || "", channel: info.channel || "", loading: false });
    showPreview();
  }

  async function add(event) {
    event.preventDefault();
    if (!preview || saving || !profile) return;
    const song = $("refLinkSong").value || null;
    if (links.some((l) => l.video_id === preview.id && (l.song || null) === song)) {
      P.setMsg($("refLinkMsg"), song ? `Ese video ya está en ${song}.` : "Ese video ya está en tus referencias.", true);
      return;
    }
    saving = true;
    $("refLinkAdd").disabled = true;
    const who = profile;
    const row = { artist_id: who.id, video_id: preview.id, url: preview.url, title: preview.title, channel: preview.channel, song };
    const { data, error } = await db.from("reference_links").insert(row).select(COLUMNS).single();
    saving = false;
    if (profile !== who) return;
    if (error) {
      $("refLinkAdd").disabled = false;
      P.setMsg($("refLinkMsg"), /duplicate|unique/i.test(error.message) ? "Ese video ya está guardado." : "No pudimos guardar el link. Probá de nuevo.", true);
      return;
    }
    links.unshift(data);
    render();
    resetForm();
    P.setMsg($("refLinkMsg"), "Listo: se agregó el video.");
  }

  // Quitar pide un segundo toque para confirmar (sin ventanas emergentes).
  $("refLinksList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    if (!btn.classList.contains("is-confirm")) {
      btn.classList.add("is-confirm");
      btn.textContent = "¿Quitar? Tocá de nuevo";
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove("is-confirm"); btn.textContent = "Quitar"; } }, 3500);
      return;
    }
    const id = btn.dataset.remove;
    btn.disabled = true;
    const { error } = await db.from("reference_links").delete().eq("id", id);
    if (error) { btn.disabled = false; P.setMsg($("refLinkMsg"), "No pudimos quitar el link. Probá de nuevo.", true); return; }
    links = links.filter((l) => l.id !== id);
    render();
    syncSongs();
  });

  $("refLinkUrl").addEventListener("input", onInput);
  $("refLinkForm").addEventListener("submit", add);

  window.ZGRefLinks = { load, setSongs, parseYouTube };
})();
