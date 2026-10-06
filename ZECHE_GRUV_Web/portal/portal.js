// ZECHE GRUV — Portal de artistas (etapa 1: login, perfil y panel de
// administrador). Cuentas y datos viven en Supabase; quién puede ver o
// editar qué lo decide la base (ver supabase/001_perfiles.sql), no este
// archivo: acá solo se muestra u oculta la interfaz.
(() => {
  // Clave pública (publishable): puede estar en el navegador.
  const SUPABASE_URL = "https://zdstltihskdcartkmgii.supabase.co";
  const SUPABASE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = (id) => document.getElementById(id);
  const ROSTER = window.ZG_ARTISTS || [];
  const FORMAT_LABEL = { single: "Single", ep: "EP", album: "Álbum" };
  const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
  const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  let me = null;       // perfil de la cuenta que inició sesión
  let viewing = null;  // perfil que se está mostrando (el propio, o el de un artista si es admin)
  let recovering = false;

  // ---------- Utilidades ----------
  const PANELS = ["profile", "artists", "releases", "release"];
  function showPanel(name) {
    PANELS.forEach((p) => { $(`panel-${p}`).hidden = p !== name; });
    window.scrollTo(0, 0);
  }

  function showView(name) {
    ["loading", "login", "recovery", "app"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
    $("logoutBtn").hidden = name !== "app";
  }

  function setMsg(el, text, isError) {
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  // Acepta el link del artista, el URI (spotify:artist:…) o el ID suelto.
  function parseSpotifyId(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    const m = v.match(/artist[/:]([A-Za-z0-9]{22})/) || v.match(/^([A-Za-z0-9]{22})$/);
    return m ? m[1] : undefined; // undefined = no se pudo leer
  }

  // Foto: la que subió el artista o, si no hay, la de su perfil de Spotify
  // (sale del roster del sitio, que ya la tiene guardada).
  function photoUrl(p) {
    if (p.avatar_url) return p.avatar_url;
    const inRoster = ROSTER.find((a) => a.id === p.spotify_artist_id);
    return inRoster ? `https://i.scdn.co/image/${inRoster.img}` : null;
  }

  const nameOf = (p) => p.display_name || p.full_name || p.email || "";

  function paintAvatar(img, empty, p) {
    const url = photoUrl(p);
    img.hidden = !url;
    empty.hidden = !!url;
    if (url) { img.src = url; img.alt = nameOf(p); }
    else empty.textContent = (nameOf(p).trim()[0] || "?").toUpperCase();
  }

  // ---------- Sesión ----------
  db.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      showView("recovery");
    } else if (event === "SIGNED_OUT") {
      me = viewing = null;
      showView("login");
    }
  });

  async function start() {
    const { data: { session } } = await db.auth.getSession();
    if (recovering) return;
    if (!session) { showView("login"); return; }
    await enter(session.user.id);
  }

  async function enter(userId) {
    const { data, error } = await db.from("profiles").select("*").eq("id", userId).single();
    if (error || !data) {
      await db.auth.signOut();
      showView("login");
      setMsg($("loginMsg"), "No pudimos cargar tu perfil. Escribinos para revisarlo.", true);
      return;
    }
    me = data;
    const admin = me.role === "admin";
    $("tabs").hidden = !admin;
    showView("app");
    if (admin) openTab("artists");
    else showProfile(me);
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if (!email || !password) { setMsg($("loginMsg"), "Completá tu mail y tu contraseña.", true); return; }
    $("loginSubmit").disabled = true;
    setMsg($("loginMsg"), "");
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    $("loginSubmit").disabled = false;
    if (error) {
      setMsg($("loginMsg"), error.message === "Invalid login credentials"
        ? "El mail o la contraseña no coinciden."
        : "No pudimos iniciar sesión. Probá de nuevo en un momento.", true);
      return;
    }
    $("loginPassword").value = "";
    await enter(data.user.id);
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) { setMsg($("loginMsg"), "Escribí tu mail arriba y volvé a tocar este link.", true); return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setMsg($("loginMsg"), error
      ? "No pudimos enviar el mail. Probá de nuevo en un momento."
      : "Si ese mail tiene cuenta, te llega un link para elegir una contraseña nueva.", !!error);
  });

  $("recoveryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("recoveryPassword").value;
    if (password.length < 8) { setMsg($("recoveryMsg"), "La contraseña tiene que tener al menos 8 caracteres.", true); return; }
    const { data, error } = await db.auth.updateUser({ password });
    if (error) { setMsg($("recoveryMsg"), "No pudimos guardar la contraseña. Pedí un link nuevo.", true); return; }
    recovering = false;
    await enter(data.user.id);
  });

  $("logoutBtn").addEventListener("click", () => db.auth.signOut());

  // ---------- Perfil ----------
  function showProfile(p) {
    viewing = p;
    const admin = me.role === "admin";
    const own = p.id === me.id;

    showPanel("profile");
    $("backToArtists").hidden = !(admin && !own);

    $("profileRole").textContent = p.role === "admin" ? "Administrador" : "Artista ZECHE GRUV";
    $("profileName").textContent = nameOf(p);
    paintAvatar($("profileAvatar"), $("profileAvatarEmpty"), p);

    const chips = $("profileChips");
    chips.replaceChildren();
    if (p.format) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = FORMAT_LABEL[p.format];
      chips.append(chip);
    }
    if (p.spotify_artist_id) {
      const link = document.createElement("a");
      link.className = "chip";
      link.href = `https://open.spotify.com/artist/${p.spotify_artist_id}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Spotify ↗";
      chips.append(link);
    }

    $("fDisplayName").value = p.display_name || "";
    // La foto la cambia cada artista desde su propia cuenta.
    $("photoBtn").hidden = !own;
    setMsg($("photoMsg"), "");
    $("adminFields").hidden = !admin;
    if (admin) {
      $("fFullName").value = p.full_name || "";
      $("fEmail").value = p.email || "";
      $("fSpotify").value = p.spotify_artist_id || "";
      $("fApple").value = p.apple_id || "";
      $("fFormat").value = p.format || "";
      $("fFolder").value = p.onedrive_folder || "";
    }
    $("passwordForm").hidden = !own;

    const membership = $("sectionsList").children[4].querySelector("em");
    membership.textContent = p.format ? FORMAT_LABEL[p.format] : "Próximamente";
    membership.classList.toggle("is-set", !!p.format);

    setMsg($("profileMsg"), "");
    setMsg($("passwordMsg"), "");
  }

  async function uploadPhoto(file) {
    const ext = PHOTO_TYPES[file.type];
    if (!ext) throw new Error("La foto tiene que ser JPG, PNG o WebP.");
    if (file.size > PHOTO_MAX_BYTES) throw new Error("La foto pesa más de 2 MB. Probá con una más liviana.");
    // Nombre único por subida: así no hace falta reemplazar ni borrar la anterior.
    const path = `${me.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await db.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (error) throw new Error("No pudimos subir la foto. Probá de nuevo.");
    return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  }

  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("profileMsg");
    const admin = me.role === "admin";
    const changes = { display_name: $("fDisplayName").value.trim() || null };

    if (admin) {
      const spotifyId = parseSpotifyId($("fSpotify").value);
      if (spotifyId === undefined) { setMsg(msg, "No reconocemos ese perfil de Spotify. Pegá el link del artista.", true); return; }
      Object.assign(changes, {
        full_name: $("fFullName").value.trim() || null,
        spotify_artist_id: spotifyId,
        apple_id: $("fApple").value.trim() || null,
        format: $("fFormat").value || null,
        onedrive_folder: $("fFolder").value.trim() || null,
      });
    }

    const submit = event.submitter || $("profileForm").querySelector('[type="submit"]');
    submit.disabled = true;
    setMsg(msg, "Guardando…");
    try {
      const { data, error } = await db.from("profiles").update(changes).eq("id", viewing.id).select().single();
      if (error) throw new Error("No pudimos guardar los cambios. Probá de nuevo.");
      if (data.id === me.id) me = data;
      showProfile(data);
      setMsg(msg, "Cambios guardados.");
    } catch (err) {
      setMsg(msg, err.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  // Foto de perfil: se elige desde la propia foto y se guarda al instante.
  $("photoBtn").addEventListener("click", () => $("fPhoto").click());
  $("fPhoto").addEventListener("change", async () => {
    const file = $("fPhoto").files[0];
    $("fPhoto").value = "";
    if (!file || !viewing || viewing.id !== me.id) return;
    const msg = $("photoMsg");
    $("photoBtn").classList.add("is-busy");
    $("photoBtn").disabled = true;
    setMsg(msg, "Subiendo foto…");
    try {
      const avatar_url = await uploadPhoto(file);
      const { data, error } = await db.from("profiles").update({ avatar_url }).eq("id", me.id).select().single();
      if (error) throw new Error("No pudimos guardar la foto. Probá de nuevo.");
      me = viewing = data;
      paintAvatar($("profileAvatar"), $("profileAvatarEmpty"), data);
      setMsg(msg, "Foto actualizada.");
    } catch (err) {
      setMsg(msg, err.message, true);
    } finally {
      $("photoBtn").classList.remove("is-busy");
      $("photoBtn").disabled = false;
    }
  });

  $("passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("fNewPassword").value;
    if (password.length < 8) { setMsg($("passwordMsg"), "La contraseña tiene que tener al menos 8 caracteres.", true); return; }
    const { error } = await db.auth.updateUser({ password });
    if (error) { setMsg($("passwordMsg"), "No pudimos cambiar la contraseña. Probá de nuevo.", true); return; }
    $("fNewPassword").value = "";
    setMsg($("passwordMsg"), "Contraseña cambiada.");
  });

  // ---------- Administrador ----------
  function openTab(tab) {
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    if (tab === "me") showProfile(me);
    else if (tab === "releases") window.ZGDistribution.openList(null);
    else showArtists();
  }

  // Distribución del perfil que se está viendo (el propio, o el de un
  // artista si lo abrió el administrador).
  $("openDistribution").addEventListener("click", () => window.ZGDistribution.openList(viewing));

  $("tabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".tab");
    if (btn) openTab(btn.dataset.tab);
  });
  $("backToArtists").addEventListener("click", () => openTab("artists"));

  async function showArtists() {
    showPanel("artists");
    const status = $("artistsStatus");
    const tbody = $("artistsTable").querySelector("tbody");
    status.textContent = "Cargando…";

    const { data, error } = await db.from("profiles").select("*").order("display_name", { nullsFirst: false });
    if (error) { status.textContent = "No pudimos cargar la lista. Recargá la página."; return; }

    const artists = data.filter((p) => p.role !== "admin").length;
    status.textContent = artists === 1 ? "1 artista con cuenta." : `${artists} artistas con cuenta.`;

    tbody.replaceChildren(...data.map((p) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;

      const photoCell = document.createElement("td");
      const img = document.createElement("img");
      const empty = document.createElement("div");
      img.className = "avatar";
      empty.className = "avatar avatar-empty";
      paintAvatar(img, empty, p);
      photoCell.append(img, empty);

      const cell = (text, className) => {
        const td = document.createElement("td");
        td.textContent = text || "—";
        if (className) td.className = className;
        return td;
      };
      tr.append(
        photoCell,
        cell(p.display_name),
        cell(p.full_name),
        cell(p.email),
        p.role === "admin" ? cell("Administrador", "tag-admin") : cell(FORMAT_LABEL[p.format]),
        cell(p.spotify_artist_id ? "Vinculado" : "Sin vincular"),
      );

      const open = () => { if (p.id === me.id) openTab("me"); else showProfile(p); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
  }

  // Lo que necesita el módulo de distribución (distribucion.js).
  window.ZGPortal = {
    db, $, setMsg, showPanel, nameOf, FORMAT_LABEL,
    get me() { return me; },
    backToProfile(profile) { if (profile && profile.id !== me.id) showProfile(profile); else if (me.role === "admin") openTab("me"); else showProfile(me); },
  };

  start();
})();
