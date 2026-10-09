// ZECHE GRUV — Portal de artistas (etapa 1: login, perfil y panel de
// administrador). Cuentas y datos viven en Supabase; quién puede ver o
// editar qué lo decide la base (ver supabase/001_perfiles.sql), no este
// archivo: acá solo se muestra u oculta la interfaz.
(() => {
  // Clave pública (publishable): puede estar en el navegador.
  const SUPABASE_URL = "https://zdstltihskdcartkmgii.supabase.co";
  const SUPABASE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";

  // "Recordarme": con la casilla marcada la sesión queda guardada en el
  // dispositivo; sin marcar, dura solo hasta que se cierra el navegador.
  const REMEMBER_KEY = "zg-portal-recordar";
  const remembered = () => localStorage.getItem(REMEMBER_KEY) !== "0";
  const sessionStore = {
    getItem: (key) => sessionStorage.getItem(key) ?? localStorage.getItem(key),
    setItem: (key, value) => {
      const [keep, drop] = remembered() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
      keep.setItem(key, value);
      drop.removeItem(key);
    },
    removeItem: (key) => { localStorage.removeItem(key); sessionStorage.removeItem(key); },
  };

  // Si se llega desde el link de un mail (invitación o recuperación), la
  // dirección trae el tipo de link; hay que leerlo antes de crear el
  // cliente, que limpia la dirección al tomar la sesión.
  const linkParams = new URLSearchParams(location.hash.slice(1));
  const linkQuery = new URLSearchParams(location.search);
  // Los mails del portal traen un link a esta misma página con un código
  // de un solo uso (?token_hash=…&type=invite|recovery), que se canjea acá.
  const linkToken = linkQuery.get("token_hash");
  const linkType = linkQuery.get("type") || linkParams.get("type"); // "invite" | "recovery" | null
  let linkError = linkParams.get("error_description");              // p. ej. link vencido
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: sessionStore } });

  const $ = (id) => document.getElementById(id);
  const ROSTER = window.ZG_ARTISTS || [];
  const FORMAT_LABEL = { single: "Single", ep: "EP", album: "Álbum" };
  const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
  const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  let me = null;       // perfil de la cuenta que inició sesión
  let viewing = null;  // perfil que se está mostrando (el propio, o el de un artista si es admin)
  let recovering = linkType === "invite" || linkType === "recovery";

  // ---------- Utilidades ----------
  const PANELS = ["profile", "artists", "releases", "release", "files", "lyric", "pass"];
  function showPanel(name) {
    PANELS.forEach((p) => { $(`panel-${p}`).hidden = p !== name; });
    window.scrollTo(0, 0);
  }

  function showView(name) {
    ["loading", "login", "recovery", "app"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
    $("logoutBtn").hidden = name !== "app";
    // El menú del administrador vive en la franja de arriba: solo con la sesión abierta.
    $("tabs").hidden = !(name === "app" && me && me.role === "admin");
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

  // Ficha de Notion del artista: acepta el link (con o sin el nombre de la
  // página adelante) o el ID suelto, y guarda solo el ID.
  function parseNotionId(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    const m = v.replace(/-/g, "").match(/([0-9a-f]{32})(?![0-9a-f])/i);
    return m ? m[1].toLowerCase() : undefined; // undefined = no se pudo leer
  }
  const NOTION_BAD = "No reconocemos ese link de Notion. Abrí la ficha del artista en Clientes Zeche Gruv y copiá su link (Compartir → Copiar link).";

  // Foto: la que subió el artista o, si no hay, la de su perfil de Spotify
  // (sale del roster del sitio, que ya la tiene guardada).
  // Si no tiene Spotify vinculado, se busca en el roster por nombre (artistas
  // con foto propia, como Ailo).
  const sameName = (x, y) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    === String(y || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  function photoUrl(p) {
    if (p.avatar_url) return p.avatar_url;
    const inRoster = ROSTER.find((a) => a.id && a.id === p.spotify_artist_id)
      || ROSTER.find((a) => a.photo && sameName(a.name, p.display_name));
    if (!inRoster) return null;
    return inRoster.photo ? `/${inRoster.photo}` : `https://i.scdn.co/image/${inRoster.img}`;
  }

  const INACTIVE_MSG = "Tu acceso al portal está pausado. Si querés retomar, escribinos por WhatsApp.";

  const nameOf = (p) => p.display_name || p.full_name || p.email || "";

  // Artistas con Spotify vinculado que no están en el roster: la foto se
  // pide a Spotify (netlify/functions/spotify-artist-photo.js) una sola vez
  // por artista mientras la página siga abierta.
  const spotifyPhotos = new Map(); // id de Spotify -> Promise<url | null>
  function spotifyPhoto(id) {
    if (!spotifyPhotos.has(id)) {
      spotifyPhotos.set(id, fetch(`/.netlify/functions/spotify-artist-photo?id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => d.url || null)
        .catch(() => null));
    }
    return spotifyPhotos.get(id);
  }

  function paintAvatar(img, empty, p) {
    img.dataset.for = p.id;
    const url = photoUrl(p);
    img.hidden = !url;
    empty.hidden = !!url;
    if (url) { img.src = url; img.alt = nameOf(p); return; }
    empty.textContent = (nameOf(p).trim()[0] || "?").toUpperCase();
    if (!p.spotify_artist_id) return;
    // Mientras llega se ve la inicial; si en el medio se pintó otro perfil
    // en el mismo lugar, no se pisa.
    spotifyPhoto(p.spotify_artist_id).then((found) => {
      if (!found || img.dataset.for !== p.id) return;
      img.src = found; img.alt = nameOf(p);
      img.hidden = false; empty.hidden = true;
    });
  }

  // ---------- Sesión ----------
  // Primer ingreso (invitación) o cambio de contraseña (recuperación).
  function showSetPassword() {
    const first = linkType === "invite";
    $("recoveryTitle").innerHTML = first ? "Creá tu<br>contraseña." : "Elegí una<br>contraseña nueva.";
    $("recoveryLabel").textContent = first ? "Contraseña" : "Contraseña nueva";
    $("recoveryIntro").hidden = !first;
    showView("recovery");
  }

  db.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      showSetPassword();
    } else if (event === "SIGNED_OUT") {
      me = viewing = null;
      showView("login");
    }
  });

  async function start() {
    if (linkToken) {
      const { error } = await db.auth.verifyOtp({ token_hash: linkToken, type: linkType === "invite" ? "invite" : "recovery" });
      history.replaceState(null, "", location.pathname); // el código no queda en la dirección
      if (error) linkError = error.message;
    }
    const { data: { session } } = await db.auth.getSession();
    if (linkError) {
      showView("login");
      setMsg($("loginMsg"), "Ese link ya se usó o venció. Escribí tu mail y tocá “¿Olvidaste tu contraseña?” para recibir uno nuevo.", true);
      return;
    }
    if (recovering && session) { showSetPassword(); return; }
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
    // Artista inactivo: no entra (normalmente ni llega acá, porque su cuenta
    // está bloqueada; esto cubre una sesión que quedó abierta).
    if (data.role !== "admin" && data.active === false) {
      await db.auth.signOut();
      showView("login");
      setMsg($("loginMsg"), INACTIVE_MSG, true);
      return;
    }
    me = data;
    const admin = me.role === "admin";
    $("tabs").hidden = !admin;
    showView("app");
    if (admin) openTab("artists");
    // Equipo de distribución: entra directo a los lanzamientos de todos.
    else if (me.role === "distribution") window.ZGDistribution.openList(null);
    else showProfile(me);
    // La escena: el próximo evento del sello, como aviso y después franja (escena.js).
    if (me.role === "artist" && window.ZGEscena) window.ZGEscena.start(me);
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if (!email || !password) { setMsg($("loginMsg"), "Completá tu mail y tu contraseña.", true); return; }
    $("loginSubmit").disabled = true;
    setMsg($("loginMsg"), "");
    localStorage.setItem(REMEMBER_KEY, $("rememberMe").checked ? "1" : "0");
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    $("loginSubmit").disabled = false;
    if (error) {
      const banned = error.code === "user_banned" || /banned/i.test(error.message || "");
      setMsg($("loginMsg"), error.message === "Invalid login credentials"
        ? "El mail o la contraseña no coinciden."
        : banned ? INACTIVE_MSG
        : "No pudimos iniciar sesión. Probá de nuevo en un momento.", true);
      return;
    }
    $("loginPassword").value = "";
    await enter(data.user.id);
  });

  $("rememberMe").checked = remembered();
  $("showPasswordBtn").addEventListener("click", () => {
    const show = $("loginPassword").type === "password";
    $("loginPassword").type = show ? "text" : "password";
    $("showPasswordBtn").textContent = show ? "Ocultar" : "Ver";
    $("showPasswordBtn").setAttribute("aria-pressed", show);
  });

  // Recuperar contraseña. Supabase deja pedir un mail cada 60 segundos por
  // cuenta, así que después de cada pedido el link queda en espera con una
  // cuenta regresiva (también si se recarga la página).
  const FORGOT_WAIT_SECONDS = 60;
  const FORGOT_KEY = "zg-portal-recuperar-hasta";
  const FORGOT_LABEL = $("forgotBtn").textContent;
  let forgotTimer = null;

  function tickForgot() {
    const left = Math.ceil((Number(sessionStorage.getItem(FORGOT_KEY)) - Date.now()) / 1000);
    const waiting = left > 0;
    $("forgotBtn").disabled = waiting;
    $("forgotBtn").textContent = waiting ? `Podés pedir otro mail en ${left} s` : FORGOT_LABEL;
    if (!waiting) { clearInterval(forgotTimer); forgotTimer = null; sessionStorage.removeItem(FORGOT_KEY); }
  }
  function startForgotWait() {
    sessionStorage.setItem(FORGOT_KEY, Date.now() + FORGOT_WAIT_SECONDS * 1000);
    clearInterval(forgotTimer);
    forgotTimer = setInterval(tickForgot, 1000);
    tickForgot();
  }
  if (sessionStorage.getItem(FORGOT_KEY)) { forgotTimer = setInterval(tickForgot, 1000); tickForgot(); }

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) { $("loginEmail").focus(); setMsg($("loginMsg"), "Escribí tu mail arriba y volvé a tocar este link.", true); return; }
    $("forgotBtn").disabled = true;
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error && error.status !== 429) {
      $("forgotBtn").disabled = false;
      setMsg($("loginMsg"), "No pudimos enviar el mail. Probá de nuevo en un momento.", true);
      return;
    }
    startForgotWait();
    setMsg($("loginMsg"), error
      ? "Ya te mandamos un mail hace un momento. Revisá tu bandeja (y spam) y esperá un minuto para pedir otro."
      : "Si ese mail tiene cuenta, te llega un link para elegir una contraseña nueva. Revisá también la carpeta de spam.", !!error);
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

    $("profileRole").textContent = p.role === "admin" ? "Administrador" : p.role === "distribution" ? "Equipo de distribución" : "Artista ZECHE GRUV";
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

    // El administrador mirando a un artista: los títulos dicen de quién es.
    $("spaceTitle").textContent = own ? "Tu espacio" : `Espacio de ${nameOf(p)}`;
    $("profileFormTitle").textContent = own ? "Perfil" : "Datos del artista";
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
    }
    $("passwordForm").hidden = !own;
    // ⚙ Configuración (carpeta y Notion): solo el administrador, en un artista.
    $("cfgOpen").hidden = !(admin && !own && p.role === "artist");
    // Borrar: solo el administrador, y nunca su cuenta ni la de otro administrador.
    $("dangerZone").hidden = !(admin && !own && p.role !== "admin");
    // Activo / inactivo: también solo el administrador, sobre artistas.
    $("accessZone").hidden = !(admin && !own && p.role !== "admin");
    paintAccess(p);

    setMsg($("profileMsg"), "");
    setMsg($("passwordMsg"), "");

    // Tus canciones (canciones.js).
    if (window.ZGSongs) window.ZGSongs.load(p);
    // Tu show: subir pistas para los shows en los que toca (shows.js).
    if (window.ZGShows) window.ZGShows.load(p);
    // Las carpetas de OneDrive se empiezan a traer ya, en segundo plano, para
    // que Referencias, Exports, etc. abran al instante (archivos.js).
    if (window.ZGFiles && !(p.id === me.id && admin)) window.ZGFiles.prefetch(p);
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
    else if (tab === "pass") window.ZGPassAdmin.open();
    else showArtists();
  }

  // Distribución del perfil que se está viendo (el propio, o el de un
  // artista si lo abrió el administrador).
  $("openDistribution").addEventListener("click", () => window.ZGDistribution.openList(viewing));
  // Carpetas de OneDrive (archivos.js).
  $("sectionsList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-section]");
    if (btn) window.ZGFiles.open(btn.dataset.section, viewing);
  });

  $("tabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".tab");
    if (btn) openTab(btn.dataset.tab);
  });
  $("backToArtists").addEventListener("click", () => openTab("artists"));

  // ---------- Activo / inactivo ----------
  // Inactivo: la cuenta queda bloqueada y no entra al portal, pero no se
  // borra nada (netlify/functions/portal-artist-access.js).
  const isActive = (p) => p.active !== false;
  function paintAccess(p) {
    const on = isActive(p);
    $("accessState").textContent = on ? "Activo" : "Inactivo";
    $("accessState").className = `chip ${on ? "chip-on" : "chip-off"}`;
    $("accessHint").textContent = on
      ? "Puede entrar al portal. Si lo pasás a inactivo, no va a poder entrar, pero no se borra nada: cuando vuelva, lo reactivás y entra con su misma contraseña."
      : "No puede entrar al portal. Sus datos, letras, lanzamientos y carpetas siguen guardados. Reactivalo cuando vuelva a trabajar con ZECHE GRUV.";
    $("accessBtn").textContent = on ? "Pasar a inactivo" : "Reactivar";
    $("accessBtn").className = on ? "btn btn-danger" : "btn btn-primary";
    setMsg($("accessMsg"), "");
  }

  async function setAccess(target, active) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch("/.netlify/functions/portal-artist-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id: target.id, active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos cambiar el estado. Probá de nuevo.");
    return data.profile || { ...target, active };
  }

  $("accessBtn").addEventListener("click", async () => {
    const target = viewing;
    if (isActive(target)) {
      // Pasar a inactivo siempre pide confirmación.
      $("accessDialogTitle").textContent = `¿Pasar a ${nameOf(target)} a inactivo?`;
      setMsg($("accessDialogMsg"), "");
      $("accessDialog").showModal();
      $("accessCancelBtn").focus();
      return;
    }
    $("accessBtn").disabled = true;
    setMsg($("accessMsg"), "Reactivando…");
    try {
      const updated = await setAccess(target, true);
      if (viewing && viewing.id === target.id) { viewing = updated; paintAccess(updated); }
      setMsg($("accessMsg"), `${nameOf(target)} ya puede volver a entrar con su misma contraseña.`);
    } catch (err) {
      setMsg($("accessMsg"), err.message, true);
    } finally {
      $("accessBtn").disabled = false;
    }
  });
  $("accessCancelBtn").addEventListener("click", () => $("accessDialog").close());
  $("accessConfirmBtn").addEventListener("click", async () => {
    const target = viewing;
    $("accessConfirmBtn").disabled = true;
    $("accessCancelBtn").disabled = true;
    setMsg($("accessDialogMsg"), "Guardando…");
    try {
      const updated = await setAccess(target, false);
      $("accessDialog").close();
      if (viewing && viewing.id === target.id) { viewing = updated; paintAccess(updated); }
      setMsg($("accessMsg"), `${nameOf(target)} quedó inactivo. Ya no puede entrar al portal.`);
    } catch (err) {
      setMsg($("accessDialogMsg"), err.message, true);
    } finally {
      $("accessConfirmBtn").disabled = false;
      $("accessCancelBtn").disabled = false;
    }
  });

  // Borrar el perfil de un artista: siempre pide confirmación antes
  // (netlify/functions/portal-delete-artist.js).
  $("deleteArtistBtn").addEventListener("click", () => {
    $("deleteDialogTitle").textContent = `¿Seguro que querés borrar el perfil de ${nameOf(viewing)}?`;
    setMsg($("deleteDialogMsg"), "");
    $("deleteDialog").showModal();
    $("deleteCancelBtn").focus(); // lo que queda a mano es cancelar
  });
  $("deleteCancelBtn").addEventListener("click", () => $("deleteDialog").close());
  $("deleteConfirmBtn").addEventListener("click", async () => {
    const target = viewing;
    $("deleteConfirmBtn").disabled = true;
    $("deleteCancelBtn").disabled = true;
    setMsg($("deleteDialogMsg"), "Borrando…");
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-delete-artist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: target.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos borrar el perfil. Probá de nuevo.");
      $("deleteDialog").close();
      await showArtists();
      $("artistsStatus").textContent = `Se borró el perfil de ${nameOf(target)}. ${$("artistsStatus").textContent}`;
    } catch (err) {
      setMsg($("deleteDialogMsg"), err.message, true);
    } finally {
      $("deleteConfirmBtn").disabled = false;
      $("deleteCancelBtn").disabled = false;
    }
  });

  // Tipo de cuenta en la invitación: para el equipo de distribución no van
  // carpetas, Spotify, formato ni Notion.
  function syncInviteRole() {
    const team = $("inviteRole").value === "distribution";
    document.querySelectorAll("#inviteForm .artist-only").forEach((el) => { el.hidden = team; });
    $("inviteEmailLabel").textContent = team ? "Mail" : "Mail del artista";
    $("inviteNameLabel").textContent = team ? "Nombre" : "Nombre artístico";
  }
  $("inviteRole").addEventListener("change", syncInviteRole);

  // Alta de una cuenta del equipo de distribución: misma invitación que un
  // artista y, apenas existe la cuenta, se le pone el rol (014_distribucion_equipo.sql).
  async function inviteTeam(email, display_name) {
    const msg = $("inviteMsg");
    $("inviteSubmit").disabled = true;
    setMsg(msg, "Enviando invitación…");
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, display_name, role: "distribution" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviar la invitación. Probá de nuevo.");
      const saved = { error: data.roleError };
      ["inviteEmail", "inviteName"].forEach((id) => { $(id).value = ""; });
      $("inviteRole").value = "artist";
      syncInviteRole();
      await showArtists();
      setMsg(msg, saved.error
        ? `Invitación enviada a ${data.email}, pero no pudimos darle el acceso de distribución. ¿Ya corriste 014_distribucion_equipo.sql en Supabase?`
        : `Invitación enviada a ${data.email}. Cuando entre, va a ver solo los lanzamientos de los artistas.`, !!saved.error);
    } catch (err) {
      setMsg(msg, err.message, true);
    } finally {
      $("inviteSubmit").disabled = false;
    }
  }

  // Alta de artistas: crea la cuenta y manda el mail de invitación
  // (netlify/functions/portal-invite.js).
  $("inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("inviteMsg");
    const email = $("inviteEmail").value.trim();
    const display_name = $("inviteName").value.trim();
    const team = $("inviteRole").value === "distribution";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg(msg, team ? "Escribí su mail." : "Escribí el mail del artista.", true); return; }
    if (!display_name) { setMsg(msg, team ? "Escribí su nombre: es como la saludamos en el mail." : "Escribí el nombre artístico: es como lo saludamos en el mail.", true); return; }
    if (team) { await inviteTeam(email, display_name); return; }
    // Datos que quedan asociados al perfil apenas se crea la cuenta.
    // Un solo link de carpeta (de edición): sirve para ver, descargar y subir.
    const folderEdit = $("inviteFolderEdit").value.trim();
    const folder = folderEdit;
    if (folderEdit && !/^https:\/\/(1drv\.ms|onedrive\.live\.com)\//.test(folderEdit)) {
      setMsg(msg, "El link de la carpeta tiene que ser un link compartido de OneDrive (empieza con https://1drv.ms/).", true);
      return;
    }
    const spotifyId = parseSpotifyId($("inviteSpotify").value);
    if (spotifyId === undefined) { setMsg(msg, "No reconocemos ese perfil de Spotify. Pegá el link del artista.", true); return; }
    const format = $("inviteFormat").value || null;
    const notionId = parseNotionId($("inviteNotion").value);
    if (notionId === undefined) { setMsg(msg, NOTION_BAD, true); return; }
    $("inviteSubmit").disabled = true;
    setMsg(msg, "Enviando invitación…");
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, display_name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviar la invitación. Probá de nuevo.");
      // La cuenta ya existe: se le asocian la carpeta y los datos cargados.
      let linked = true;
      if (folder || folderEdit) {
        const saved = await db.from("artist_private").upsert({ profile_id: data.id, onedrive_link: folder || null, onedrive_edit_link: folderEdit || null, updated_at: new Date().toISOString() });
        if (saved.error) linked = false;
      }
      if (notionId) {
        const saved = await db.from("artist_private").upsert({ profile_id: data.id, notion_page_id: notionId, updated_at: new Date().toISOString() });
        if (saved.error) linked = false;
      }
      if (spotifyId || format) {
        const saved = await db.from("profiles").update({ spotify_artist_id: spotifyId, format }).eq("id", data.id);
        if (saved.error) linked = false;
      }
      ["inviteEmail", "inviteName", "inviteFolderEdit", "inviteSpotify", "inviteFormat", "inviteNotion"].forEach((id) => { $(id).value = ""; });
      await showArtists();
      setMsg(msg, linked
        ? `Invitación enviada a ${data.email}. Su perfil ya quedó con los datos que cargaste.`
        : `Invitación enviada a ${data.email}, pero no pudimos guardar todos sus datos. Abrí su fila y completalos.`, !linked);
    } catch (err) {
      setMsg(msg, err.message, true);
    } finally {
      $("inviteSubmit").disabled = false;
    }
  });

  async function showArtists() {
    showPanel("artists");
    const status = $("artistsStatus");
    const tbody = $("artistsTable").querySelector("tbody");
    status.textContent = "Cargando…";

    const { data, error } = await db.from("profiles").select("*").order("display_name", { nullsFirst: false });
    if (error) { status.textContent = "No pudimos cargar la lista. Recargá la página."; return; }

    const artists = data.filter((p) => p.role === "artist");
    const inactive = artists.filter((p) => !isActive(p)).length;
    status.textContent = (artists.length === 1 ? "1 artista con cuenta" : `${artists.length} artistas con cuenta`)
      + (inactive ? ` (${inactive} ${inactive === 1 ? "inactivo" : "inactivos"}).` : ".");

    tbody.replaceChildren(...data.map((p) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      if (p.role !== "admin" && !isActive(p)) tr.classList.add("row-inactive");

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
        p.role === "admin" ? cell("Administrador", "tag-admin")
          : p.role === "distribution" ? cell("Distribución", "tag-admin")
          : cell(FORMAT_LABEL[p.format]),
        cell(p.spotify_artist_id ? "Vinculado" : "Sin vincular"),
        p.role === "admin" ? cell("—") : cell(isActive(p) ? "Activo" : "Inactivo", isActive(p) ? "tag-on" : "tag-off"),
      );

      const open = () => { if (p.id === me.id) openTab("me"); else showProfile(p); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      return tr;
    }));
  }

  // En celular las tablas se ven como tarjetas (portal.css): cada celda
  // lleva el título de su columna para poder mostrarlo al lado del dato.
  document.querySelectorAll("table.table").forEach((table) => {
    const tbody = table.querySelector("tbody");
    const label = () => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      tbody.querySelectorAll("tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; }));
    };
    new MutationObserver(label).observe(tbody, { childList: true });
    label();
  });

  // ---------- ⚙ Configuración de un artista (solo administrador) ----------
  // Carpeta de OneDrive (un solo link, de edición) y ficha de Notion. Cada
  // una se guarda con su botón; ya cargadas, quedan en una línea.
  function cfgState(block, on, text) {
    block.querySelector(".cfg-state").textContent = on ? `✓ ${text}` : "Sin cargar";
    block.querySelector(".cfg-state").classList.toggle("is-on", on);
    block.querySelector(".zgp-root-edit").hidden = on;
    block.querySelector(".cfg-change").hidden = !on;
  }

  async function openCfg() {
    const p = viewing;
    $("artistCfgTitle").textContent = nameOf(p);
    ["cfgFolder", "cfgNotion"].forEach((id) => { setMsg($(id).querySelector(".msg"), ""); $(id).querySelector("input").value = ""; $(id).querySelector(".cfg-state").textContent = "Cargando…"; });
    $("artistCfg").showModal();
    const { data } = await db.from("artist_private").select("*").eq("profile_id", p.id).maybeSingle();
    if (!viewing || viewing.id !== p.id) return;
    const folder = data && (data.onedrive_edit_link || data.onedrive_link);
    $("cfgFolder").querySelector("input").value = folder || "";
    cfgState($("cfgFolder"), !!(data && data.onedrive_edit_link), "Conectada");
    if (data && !data.onedrive_edit_link && data.onedrive_link) setMsg($("cfgFolder").querySelector(".msg"), "Tiene solo el link de ver: pegá el de edición para que también pueda subir archivos.", true);
    const notion = data && data.notion_page_id;
    $("cfgNotion").querySelector("input").value = notion ? `https://www.notion.so/${notion}` : "";
    cfgState($("cfgNotion"), !!notion, "Vinculada");
  }

  function cfgBind(id, save) {
    const block = $(id);
    const btn = block.querySelector(".zgp-root-edit .btn");
    const input = block.querySelector("input");
    const msg = block.querySelector(".msg");
    const run = async () => {
      btn.disabled = true;
      setMsg(msg, "Guardando…");
      try {
        await save(input.value.trim(), block);
        setMsg(msg, "Guardado.");
      } catch (err) {
        setMsg(msg, err.message, true);
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener("click", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    block.querySelector(".cfg-change").addEventListener("click", () => {
      block.querySelector(".zgp-root-edit").hidden = false;
      block.querySelector(".cfg-change").hidden = true;
      input.focus();
      input.select();
    });
  }

  cfgBind("cfgFolder", async (link, block) => {
    if (link && !/^https:\/\/(1drv\.ms|onedrive\.live\.com)\//.test(link)) throw new Error("Tiene que ser un link compartido de OneDrive (empieza con https://1drv.ms/).");
    const saved = await db.from("artist_private").upsert({ profile_id: viewing.id, onedrive_link: link || null, onedrive_edit_link: link || null, updated_at: new Date().toISOString() });
    if (saved.error) throw new Error("No pudimos guardar la carpeta. Probá de nuevo.");
    cfgState(block, !!link, "Conectada");
    if (window.ZGFiles) window.ZGFiles.prefetch(viewing);
  });
  cfgBind("cfgNotion", async (link, block) => {
    const notionId = link ? parseNotionId(link) : null;
    if (notionId === undefined) throw new Error(NOTION_BAD);
    const saved = await db.from("artist_private").upsert({ profile_id: viewing.id, notion_page_id: notionId, updated_at: new Date().toISOString() });
    if (saved.error) throw new Error("No pudimos guardar la ficha de Notion. ¿Ya corriste supabase/009_notion.sql?");
    cfgState(block, !!notionId, "Vinculada");
    if (window.ZGSongs) window.ZGSongs.load(viewing);
  });
  $("cfgOpen").addEventListener("click", openCfg);
  $("artistCfgClose").addEventListener("click", () => $("artistCfg").close());
  $("artistCfg").addEventListener("click", (e) => { if (e.target === $("artistCfg")) $("artistCfg").close(); });

  // Alto real de la franja de arriba (cambia con el menú y en celular): los
  // menús fijos de cada sección se pegan justo debajo.
  const navEl = document.querySelector("nav");
  const syncNav = () => document.documentElement.style.setProperty("--nav-h", `${navEl.getBoundingClientRect().height}px`);
  new ResizeObserver(syncNav).observe(navEl);
  syncNav();

  // Lo que necesitan los módulos de distribución y de archivos.
  window.ZGPortal = {
    db, $, setMsg, showPanel, nameOf, FORMAT_LABEL,
    get me() { return me; },
    backToProfile(profile) { if (profile && profile.id !== me.id) showProfile(profile); else if (me.role === "admin") openTab("me"); else showProfile(me); },
  };

  // Arranca cuando ya cargaron todos los módulos (canciones, archivos, etc.):
  // si hay una sesión guardada, el perfil se abre enseguida y necesita que
  // estén listos para empezar a traer las canciones y las carpetas.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
