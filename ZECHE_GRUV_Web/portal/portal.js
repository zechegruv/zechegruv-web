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

  // Sin conexión: en lugar de "Cargando…" para siempre, un aviso claro con
  // "Reintentar" (en la misma pantalla de carga). onRetry: qué hacer al
  // tocarlo (por defecto, volver a cargar la página).
  function showRetry(text, onRetry) {
    ["loading", "login", "recovery", "app"].forEach((v) => { const el = document.getElementById(`view-${v}`); if (el) el.hidden = v !== "loading"; });
    const box = document.getElementById("view-loading");
    box.innerHTML = '<div class="load-retry" role="alert"><p class="muted"></p><button class="btn btn-primary" type="button">Reintentar</button></div>';
    box.querySelector("p").textContent = text;
    box.querySelector("button").addEventListener("click", () => {
      if (!onRetry) { location.reload(); return; }
      box.innerHTML = '<p class="muted">Cargando…</p>';
      onRetry();
    });
  }

  // La librería de Supabase viene de un CDN: si no cargó (sin conexión o el
  // CDN caído), no hay forma de entrar.
  if (!window.supabase || !window.supabase.createClient) {
    const go = () => showRetry("No pudimos conectarnos con el portal. Revisá tu conexión a internet y probá de nuevo.");
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
    return;
  }
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
  const PANELS = ["home", "profile", "artists", "releases", "release", "files", "lyric", "pass", "estado", "producer"];
  function showPanel(name) {
    PANELS.forEach((p) => { $(`panel-${p}`).hidden = p !== name; });
    window.scrollTo(0, 0);
    // Menú del artista (artista.js): marca la pestaña de lo que se abrió.
    if (window.ZGArtistNav) window.ZGArtistNav.sync(name);
    // Admin mirando a un artista (vista-artista.js): sigue o se cierra.
    if (window.ZGArtistView) window.ZGArtistView.sync(name);
    // Medición: qué secciones usan los artistas (tu uso como admin no cuenta).
    if (me && me.role !== "admin" && window.zgTrack) window.zgTrack("portal_seccion", { seccion: name, tipo_cuenta: me.role });
  }

  function showView(name) {
    ["loading", "login", "recovery", "app"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
    $("logoutBtn").hidden = name !== "app";
    // El menú del administrador vive en la franja de arriba: solo con la sesión abierta.
    $("tabs").hidden = !(name === "app" && me && me.role === "admin");
    // Panel nuevo del administrador (admin.css): barra lateral e Inicio.
    document.body.classList.toggle("is-admin", name === "app" && !!me && me.role === "admin");
    // Portal nuevo del artista (artista.css / artista.js): barra lateral y menú propio.
    const artist = name === "app" && !!me && me.role === "artist";
    document.body.classList.toggle("is-artist", artist);
    $("artistTabs").hidden = !artist;
    // Productor (productor.js): una sola columna, misma piel que el artista.
    document.body.classList.toggle("is-producer", name === "app" && !!me && me.role === "producer");
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

  // ---------- Sesión vencida ----------
  // Las funciones del servidor (canciones, archivos, revisión, shows) se
  // llaman con el token de la sesión. Si la sesión venció y no se pudo
  // renovar (o el servidor responde 401), en vez de quedar la sección vacía
  // o con un error raro, se vuelve a la pantalla de ingreso con el aviso.
  const EXPIRED_MSG = "Tu sesión venció, entrá de nuevo.";
  let expiring = false;
  async function expired() {
    if (expiring) return;
    expiring = true;
    me = viewing = null;
    try { await db.auth.signOut({ scope: "local" }); } catch (e) { /* ya no había sesión */ }
    showView("login");
    setMsg($("loginMsg"), EXPIRED_MSG, true);
    expiring = false;
  }
  // El token para mandar en Authorization. Sin sesión: aviso y error.
  async function token() {
    let session = null;
    try { ({ data: { session } } = await db.auth.getSession()); } catch (e) { session = null; }
    if (!session || !session.access_token) {
      expired();
      throw new Error(EXPIRED_MSG);
    }
    return session.access_token;
  }
  // fetch con la sesión puesta; si el servidor dice 401, se pide entrar de nuevo.
  async function authFetch(url, init = {}) {
    const t = await token();
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
    if (res.status === 401) expired();
    return res;
  }

  // Si ya eligió su contraseña: queda anotado en la cuenta al crearla o al
  // entrar con mail y contraseña (user_metadata.password_set).
  const hasPassword = (user) => !!(user && user.user_metadata && user.user_metadata.password_set);

  async function start() {
    if (linkToken) {
      const { error } = await db.auth.verifyOtp({ token_hash: linkToken, type: linkType === "invite" ? "invite" : "recovery" });
      history.replaceState(null, "", location.pathname); // el código no queda en la dirección
      if (error) linkError = error.message;
    }
    const { data: { session } } = await db.auth.getSession();
    // Volvió a tocar el link del mail (que ya se usó) con la sesión abierta:
    // no es un error, sigue adentro. Si es la invitación y todavía no creó
    // su contraseña (se marca al crearla, ver recoveryForm), se la pide.
    if (linkError && session) {
      linkError = null;
      recovering = linkType === "invite" && !hasPassword(session.user);
    }
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
    let data = null, error = null;
    try { ({ data, error } = await db.from("profiles").select("*").eq("id", userId).single()); }
    catch (e) { error = { message: String(e && e.message) }; }
    // Un corte de red no es motivo para cerrar la sesión: se avisa y se
    // reintenta. Solo si el perfil de verdad no existe (la base responde
    // "sin filas", PGRST116) se cierra la sesión.
    const missing = !error ? !data : error.code === "PGRST116";
    if (error && !missing) {
      showRetry("No pudimos conectarnos. Revisá tu conexión a internet y probá de nuevo.", () => enter(userId));
      return;
    }
    if (missing) {
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
    // Medición: tu dispositivo queda excluido; para los artistas se cuenta
    // el ingreso con su id interno (un código, nunca nombre ni mail).
    if (admin) { if (window.zgNoMedir) window.zgNoMedir(true); }
    else if (window.gtag) {
      window.gtag("set", { user_id: me.id, user_properties: { tipo_cuenta: me.role } });
      window.zgTrack("portal_ingreso", { tipo_cuenta: me.role });
    }
    $("tabs").hidden = !admin;
    showView("app");
    // Link del mail de "nuevo lanzamiento para revisar": abre esa ficha.
    const deep = /^#lanzamiento-([0-9a-f-]{36})$/i.exec(location.hash);
    if (deep && (admin || me.role === "distribution")) {
      history.replaceState(null, "", location.pathname);
      window.ZGDistribution.openRelease(deep[1]);
    }
    else if (admin) { openTab("home"); }
    // Equipo de distribución: entra directo a los lanzamientos de todos.
    else if (me.role === "distribution") window.ZGDistribution.openList(null);
    // Productor: sus artistas, solo seguimiento (productor.js).
    else if (me.role === "producer") window.ZGProducer.open(me);
    else showProfile(me);
    // Productor/Artista (037): el interruptor Artista · Productor (productor.js).
    if (window.ZGProducer) window.ZGProducer.ready(me);
    // La escena: el próximo evento del sello, como aviso y después franja (escena.js).
    if (me.role === "artist" && window.ZGEscena) window.ZGEscena.start(me);
    // Instalable y sin conexión (sin-conexion.js): aviso para instalar y lo pendiente.
    if (window.ZGOffline) window.ZGOffline.ready(me);
    // Notificaciones en el celu y la compu (notificaciones.js).
    if (window.ZGPush) window.ZGPush.ready(me);
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
    // Entró con contraseña: queda anotado que ya la tiene (cuentas de antes).
    if (!hasPassword(data.user)) db.auth.updateUser({ data: { password_set: true } }).catch(() => {});
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
    const { data, error } = await db.auth.updateUser({ password, data: { password_set: true } });
    if (error) { setMsg($("recoveryMsg"), "No pudimos guardar la contraseña. Pedí un link nuevo.", true); return; }
    recovering = false;
    await enter(data.user.id);
  });

  $("logoutBtn").addEventListener("click", async () => {
    // Lo guardado para escuchar sin señal es de esta cuenta: al salir se borra del celu.
    if (window.ZGOffline) window.ZGOffline.clear();
    // Y este dispositivo deja de recibir sus notificaciones.
    if (window.ZGPush) await window.ZGPush.logout();
    db.auth.signOut();
  });

  // ---------- Perfil ----------
  function showProfile(p) {
    viewing = p;
    const admin = me.role === "admin";
    const own = p.id === me.id;

    showPanel("profile");
    $("backToArtists").hidden = !(admin && !own);
    // El administrador ve al artista como lo ve él, con una pestaña Admin.
    if (window.ZGArtistView) {
      if (admin && !own && p.role === "artist") window.ZGArtistView.enter(p);
      else window.ZGArtistView.leave();
    }

    $("profileRole").textContent = p.role === "admin" ? "Administrador" : p.role === "distribution" ? "Equipo de distribución" : p.role === "producer" ? "Productor" : "Artista ZECHE GRUV";
    // Perfil de un productor (lo abre el administrador): sin carpetas ni
    // canciones propias; en su lugar, qué artistas sigue (productor.js).
    const producerProfile = p.role === "producer";
    $("spaceCard").hidden = producerProfile;
    // Y en un artista (pestaña Admin): si también es productor (037).
    if (window.ZGProducer) window.ZGProducer.adminZone(p, admin && !own);
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
    $("profileFormTitle").textContent = own ? "Perfil" : p.role === "producer" ? "Datos del productor" : "Datos del artista";
    $("fDisplayName").previousElementSibling.textContent = p.role === "producer" ? "Nombre" : "Nombre artístico";
    // Spotify, Apple ID y formato son de artista: en un productor no van.
    ["fSpotify", "fApple", "fFormat"].forEach((id) => { $(id).closest(".field").hidden = p.role === "producer"; });
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
    // Distribuye con ZECHE GRUV: el administrador lo cambia en cada artista;
    // si no distribuye, el artista no ve la sección Distribución.
    $("distZone").hidden = !(admin && !own && p.role === "artist");
    paintDist(p);
    // Avisos por WhatsApp: el artista los prende o apaga; el admin ve una línea.
    paintWhatsApp(p, own, admin);
    $("openDistribution").closest("li").hidden = p.role === "artist" && p.distributes === false && !admin;

    setMsg($("profileMsg"), "");
    setMsg($("passwordMsg"), "");

    if (producerProfile) {
      $("songsCard").hidden = true;
      $("welcomeCard").hidden = true;
      $("projectCards").hidden = true;
      $("showCards").replaceChildren();
      return;
    }
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
    if (window.ZGArtistView && tab !== "gruvi") window.ZGArtistView.leave();
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    if (tab === "gruvi") { if (window.ZGHome && window.ZGHome.gruviUrl) window.open(window.ZGHome.gruviUrl, "_blank", "noopener"); else openTab("home"); return; }
    if (tab === "home") { if (window.ZGHome) window.ZGHome.open(); else showArtists(); return; }
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
    if (btn) {
      if (me && me.role !== "admin" && window.zgTrack) window.zgTrack("portal_carpeta", { carpeta: btn.dataset.section });
      window.ZGFiles.open(btn.dataset.section, viewing);
    }
  });

  $("tabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".tab");
    if (btn) openTab(btn.dataset.tab);
  });
  $("backToArtists").addEventListener("click", () => openTab("artists"));

  // ---------- Distribuye con ZECHE GRUV ----------
  function paintDist(p) {
    const on = p.distributes !== false;
    $("distState").textContent = on ? "Sí" : "No";
    $("distState").className = `chip ${on ? "chip-on" : "chip-off"}`;
    $("distHint").textContent = on
      ? "Ve la sección Distribución, puede cargar sus lanzamientos y, al aprobar un master, se arma solo el paso a Distribución."
      : "No ve la sección Distribución y sus masters aprobados no generan tarea de Distribución ni se pueden mandar a ZIL.";
    $("distBtn").textContent = on ? "No distribuye con ZECHE GRUV" : "Distribuye con ZECHE GRUV";
    $("distBtn").className = on ? "btn" : "btn btn-primary";
    setMsg($("distMsg"), "");
  }

  $("distBtn").addEventListener("click", async () => {
    const target = viewing;
    const next = target.distributes === false;
    $("distBtn").disabled = true;
    setMsg($("distMsg"), "Guardando…");
    const { data, error } = await db.from("profiles").update({ distributes: next }).eq("id", target.id).select().single();
    $("distBtn").disabled = false;
    if (error || !data) { setMsg($("distMsg"), "No pudimos guardarlo. ¿Corriste supabase/028_distribuye.sql?", true); return; }
    if (viewing && viewing.id === target.id) { viewing = data; paintDist(data); }
    setMsg($("distMsg"), next ? `${nameOf(target)} distribuye con ZECHE GRUV.` : `Listo: ${nameOf(target)} no distribuye con ZECHE GRUV.`);
  });

  // ---------- Avisos por WhatsApp ----------
  // Además del mail, al artista le llega un WhatsApp cuando su mezcla o su
  // master está listo (netlify/functions/_lib/whatsapp.js). El número sale de
  // su ficha de Notion, que el artista no puede leer: portal-whatsapp.js dice
  // si hay uno (solo las últimas 4 cifras). El interruptor guarda
  // profiles.whatsapp_avisos al instante (supabase/033_whatsapp.sql).
  const WA_TEXT = "Te aviso por WhatsApp cuando tu mezcla o tu master esté listo para escuchar (al número que tengo en tu ficha).";
  const WA_NO_PHONE = "Te aviso por WhatsApp cuando tu mezcla o tu master esté listo para escuchar, pero todavía no tengo tu número en tu ficha. Pasámelo por WhatsApp y lo cargo.";
  function paintWaSwitch(on) {
    $("waSwitch").setAttribute("aria-checked", on ? "true" : "false");
  }
  async function paintWhatsApp(p, own, admin) {
    const row = $("waRow");
    // Solo en artistas: su propio perfil, o el administrador mirando uno.
    const show = p.role === "artist" && (own || admin);
    row.hidden = !show;
    if (!show) return;
    setMsg($("waMsg"), "");
    $("waSwitch").hidden = !own;
    // Al artista solo se le muestra si WhatsApp ya está conectado en Netlify:
    // si no, sería un interruptor que no hace nada.
    if (own) row.hidden = true;
    row.classList.toggle("is-readonly", !own);
    paintWaSwitch(p.whatsapp_avisos !== false);
    $("waHint").textContent = own ? WA_TEXT : "Revisando su ficha…";
    let st = null;
    try {
      const res = await authFetch(`/.netlify/functions/portal-whatsapp${own ? "" : `?artist=${encodeURIComponent(p.id)}`}`);
      st = res.ok ? await res.json() : null;
    } catch (e) { st = null; }
    if (!viewing || viewing.id !== p.id) return; // ya abrió otro perfil
    if (own) {
      row.hidden = !(st && st.configured);
      if (st && !st.phone) $("waHint").textContent = WA_NO_PHONE;
      return;
    }
    // Administrador: una línea, solo lectura (y otra de notificaciones, notificaciones.js).
    if (window.ZGPush) window.ZGPush.paintAdminLine(p);
    if (!st) { $("waHint").textContent = "No pudimos revisar su ficha ahora."; return; }
    const phone = st.phone ? `Teléfono …${st.last4}` : st.written ? "El teléfono de su ficha no se entiende (revisalo en Notion)" : "Sin teléfono en su ficha de Notion";
    const on = st.on ? "avisos activos" : "avisos apagados por el artista";
    $("waHint").textContent = `${phone} · ${on}${st.configured ? "" : " · todavía sin conectar (docs/WHATSAPP.md)"}`;
  }

  $("waSwitch").addEventListener("click", async () => {
    const sw = $("waSwitch");
    if (sw.getAttribute("aria-busy") === "true" || !viewing || viewing.id !== me.id) return;
    const target = viewing;
    const next = sw.getAttribute("aria-checked") !== "true";
    // Se mueve en el momento; si no se pudo guardar, vuelve.
    paintWaSwitch(next);
    sw.setAttribute("aria-busy", "true");
    setMsg($("waMsg"), "");
    const { data, error } = await db.from("profiles").update({ whatsapp_avisos: next }).eq("id", target.id).select().single();
    sw.removeAttribute("aria-busy");
    if (error || !data) {
      paintWaSwitch(!next);
      setMsg($("waMsg"), "No pudimos guardarlo. Probá de nuevo.", true);
      return;
    }
    if (data.id === me.id) me = data;
    if (viewing && viewing.id === data.id) viewing = data;
    setMsg($("waMsg"), next ? "Listo: te aviso por WhatsApp." : "Listo: apagaste los avisos por WhatsApp. Te sigo avisando por mail.");
  });

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
    const team = ["distribution", "producer"].includes($("inviteRole").value); // cuentas sin carpeta propia
    document.querySelectorAll("#inviteForm .artist-only").forEach((el) => { el.hidden = team; });
    $("inviteEmailLabel").textContent = team ? "Mail" : "Mail del artista";
    $("inviteNameLabel").textContent = team ? "Nombre" : "Nombre artístico";
  }
  $("inviteRole").addEventListener("change", syncInviteRole);

  // Alta de una cuenta del equipo de distribución: misma invitación que un
  // artista y, apenas existe la cuenta, se le pone el rol (014_distribucion_equipo.sql).
  async function inviteTeam(email, display_name, role) {
    const producer = role === "producer";
    const msg = $("inviteMsg");
    $("inviteSubmit").disabled = true;
    setMsg(msg, "Enviando invitación…");
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, display_name, role: producer ? "producer" : "distribution" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviar la invitación. Probá de nuevo.");
      const saved = { error: data.roleError };
      ["inviteEmail", "inviteName"].forEach((id) => { $(id).value = ""; });
      $("inviteRole").value = "artist";
      syncInviteRole();
      await showArtists();
      if (producer) {
        setMsg(msg, saved.error
          ? `Invitación enviada a ${data.email}, pero no pudimos darle el acceso de productor. ¿Ya corriste 036_productor.sql en Supabase?`
          : `Invitación enviada a ${data.email}. Abrí su fila en la lista y elegí qué artistas sigue: hasta entonces no ve ninguno.`, !!saved.error);
        return;
      }
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
    const team = ["distribution", "producer"].includes($("inviteRole").value);
    // Productor/Artista (037): se invita como artista y se le prende la vista de productor.
    const dual = $("inviteRole").value === "artist_producer";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg(msg, team ? "Escribí su mail." : "Escribí el mail del artista.", true); return; }
    if (!display_name) { setMsg(msg, team ? "Escribí su nombre: es como la saludamos en el mail." : "Escribí el nombre artístico: es como lo saludamos en el mail.", true); return; }
    if (team) { await inviteTeam(email, display_name, $("inviteRole").value); return; }
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
      let dualOk = true;
      if (dual) {
        const saved = await db.from("profiles").update({ also_producer: true }).eq("id", data.id);
        if (saved.error) dualOk = false;
      }
      ["inviteEmail", "inviteName", "inviteFolderEdit", "inviteSpotify", "inviteFormat", "inviteNotion"].forEach((id) => { $(id).value = ""; });
      $("inviteRole").value = "artist";
      syncInviteRole();
      await showArtists();
      if (dual) {
        setMsg(msg, !dualOk
          ? `Invitación enviada a ${data.email}, pero no pudimos prenderle la vista de productor. ¿Ya corriste 037_productor_artista.sql? Lo podés prender desde su perfil (pestaña Admin).`
          : `Invitación enviada a ${data.email}. Entra a su portal de artista y arriba tiene el interruptor para la vista de productor. Elegí en su perfil (pestaña Admin) qué artistas sigue.`, !dualOk || !linked);
        return;
      }
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

    // Acceso rápido: un rollo con foto y AKA. Primero los activos, después
    // los inactivos y al final el equipo (admin, distribución, productores).
    const order = (p) => (p.role === "artist" ? (isActive(p) ? 0 : 1) : 2);
    const list = data.slice().sort((a, b) => order(a) - order(b) || nameOf(a).localeCompare(nameOf(b), "es", { sensitivity: "base" }));
    const ROLE = { admin: "Administrador", distribution: "Distribución", producer: "Productor" };
    $("artistQ").value = "";
    AG.items = list.map((p, i) => {
      const li = document.createElement("li");
      li.className = "ag-item" + (p.role !== "artist" ? " is-team" : "") + (p.role !== "admin" && !isActive(p) ? " is-off" : "");
      li.id = `ag-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-label", nameOf(p) + (ROLE[p.role] ? `, ${ROLE[p.role]}` : "") + (p.role !== "admin" && !isActive(p) ? ", inactivo" : ""));
      li.dataset.q = agNorm([p.display_name, p.full_name, p.email].filter(Boolean).join(" "));
      li._open = () => { if (p.id === me.id) openTab("me"); else showProfile(p); };
      const ring = document.createElement("span");
      ring.className = "ag-ring";
      const img = document.createElement("img");
      const empty = document.createElement("div");
      img.className = "avatar";
      img.draggable = false;
      empty.className = "avatar avatar-empty";
      paintAvatar(img, empty, p);
      ring.append(img, empty);
      const name = document.createElement("span");
      name.className = "ag-name";
      name.dataset.name = p.display_name || nameOf(p);
      name.textContent = name.dataset.name;
      const go = document.createElement("span");
      go.className = "ag-go";
      go.setAttribute("aria-hidden", "true");
      go.textContent = "Abrir →";
      li.append(ring, name, go);
      return li;
    });
    $("artistGrid").replaceChildren(...AG.items);
    $("artistNone").hidden = true;
    AG.pos = 0; AG.vel = 0; AG.target = null; AG.last = -1; AG.ready = false;
    agPaint();
    $("artistWheel").classList.remove("is-in"); void $("artistWheel").offsetWidth; $("artistWheel").classList.add("is-in");
    AG.ready = true;
    // Una sola vez: el rollo amaga girar para mostrar que se mueve.
    if (!AG.peeked && list.length > 1 && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      AG.peeked = true;
      setTimeout(() => { if (AG.drag || AG.target != null || AG.pos !== 0) return; AG.target = 0.42; agKick(); setTimeout(() => { if (!AG.drag && Math.abs(AG.pos - 0.42) < 0.08) { AG.target = 0; agKick(); } }, 420); }, 950);
    }
  }

  // ---------- Rollo de artistas (acceso rápido del panel) ----------
  // Como el selector de fecha del iPhone: se ven tres nombres, el del medio
  // queda marcado. Se gira con el dedo (con inercia), la ruedita del mouse
  // (un nombre por clic), el trackpad o las flechas, sin mover la página.
  // Tocar el del medio abre su perfil; tocar otro lo trae al medio. Con 6 o
  // más, el rollo da la vuelta. El movimiento es un resorte que se calcula
  // por tiempo (igual de suave en pantallas de 60 o 120 Hz).
  const agNorm = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const AG = { items: [], pos: 0, vel: 0, target: null, raf: 0, paintRaf: 0, drag: null, last: -1, ready: false, peeked: false, t: 0 };
  const AG_STEP = 24;   // grados entre un nombre y el siguiente
  const AG_PX = 64;     // píxeles de arrastre por nombre
  const AG_K = 170, AG_C = 24; // resorte: rigidez y freno (casi sin rebote)
  const agVis = () => AG.items.filter((li) => !li.hidden);
  const agLoop = (n) => n >= 6;
  function agWrap(d, n) {
    if (!agLoop(n)) return d;
    d = ((d % n) + n) % n;
    return d > n / 2 ? d - n : d;
  }
  const agClamp = (x, n) => (agLoop(n) ? x : Math.max(0, Math.min(n - 1, x)));
  const agCenter = () => { const v = agVis(), n = v.length; return n ? v[((Math.round(AG.pos) % n) + n) % n] : null; };
  function agPaint() {
    const vis = agVis(), n = vis.length;
    AG.items.forEach((li) => { if (li.hidden && li.classList.contains("is-center")) { li.classList.remove("is-center"); li.setAttribute("aria-selected", "false"); } });
    vis.forEach((li, i) => {
      const d = agWrap(i - AG.pos, n), far = Math.abs(d);
      li.style.transform = `rotateX(${(-d * AG_STEP).toFixed(2)}deg) translateZ(var(--ag-r))`;
      li.style.opacity = far > 2.7 ? "0" : Math.max(0, 1 - far * 0.3).toFixed(3);
      li.style.visibility = far > 2.9 ? "hidden" : "";
      li.style.setProperty("--ag-near", Math.max(0, 1 - far).toFixed(3));
      const on = far < 0.5;
      if (li.classList.contains("is-center") !== on) { li.classList.toggle("is-center", on); li.setAttribute("aria-selected", on ? "true" : "false"); }
    });
    const c = agCenter();
    const wheel = $("artistWheel");
    if (c) wheel.setAttribute("aria-activedescendant", c.id); else wheel.removeAttribute("aria-activedescendant");
    const idx = c ? vis.indexOf(c) : -1;
    if (idx !== AG.last) {
      if (AG.ready && AG.last !== -1 && navigator.vibrate) { try { navigator.vibrate(3); } catch (e) { /* nada */ } }
      AG.last = idx;
    }
  }
  // Pinta en el próximo cuadro (el dedo puede mandar más eventos que cuadros).
  const agPaintSoon = () => { if (!AG.paintRaf) AG.paintRaf = requestAnimationFrame(() => { AG.paintRaf = 0; agPaint(); }); };
  function agTick(now) {
    AG.raf = 0;
    const n = agVis().length;
    if (!n || AG.drag) { AG.t = 0; return; }
    const dt = AG.t ? Math.min(0.034, (now - AG.t) / 1000) : 1 / 60;
    AG.t = now;
    const goal = agClamp(AG.target != null ? AG.target : Math.round(AG.pos), n);
    const x = AG.pos - goal;
    AG.vel += (-AG_K * x - AG_C * AG.vel) * dt;
    AG.pos += AG.vel * dt;
    if (Math.abs(x) < 0.0015 && Math.abs(AG.vel) < 0.01) {
      AG.pos = agLoop(n) ? ((goal % n) + n) % n : goal;
      AG.vel = 0; AG.t = 0;
      AG.target = null;
      agPaint();
      return;
    }
    agPaint();
    AG.raf = requestAnimationFrame(agTick);
  }
  const agKick = () => { if (!AG.raf) AG.raf = requestAnimationFrame(agTick); };
  const agStop = () => { cancelAnimationFrame(AG.raf); AG.raf = 0; AG.t = 0; };
  // Ir a un nombre por el camino más corto (sin cortar el movimiento que ya hay).
  function agGo(i) {
    const n = agVis().length;
    if (!n) return;
    AG.target = agLoop(n) ? AG.pos + agWrap(i - AG.pos, n) : agClamp(i, n);
    agKick();
  }
  const agStep = (k) => {
    const n = agVis().length;
    if (!n) return;
    const base = AG.target != null ? Math.round(AG.target) : Math.round(AG.pos);
    AG.target = agClamp(base + k, n);
    agKick();
  };
  const agOpen = () => { const c = agCenter(); if (c && c._open) c._open(); };

  function agFilter() {
    const q = agNorm($("artistQ").value.trim());
    let shown = 0;
    AG.items.forEach((li) => {
      const on = !q || li.dataset.q.includes(q);
      li.hidden = !on;
      const name = li.querySelector(".ag-name");
      const raw = name.dataset.name;
      // Resalta lo que coincide en el AKA (sin importar tildes ni mayúsculas).
      const chars = Array.from(raw);
      const at = q ? chars.map((c) => agNorm(c)).join("").indexOf(q) : -1;
      if (at >= 0 && chars.every((c) => agNorm(c).length === 1)) {
        name.replaceChildren(chars.slice(0, at).join(""), Object.assign(document.createElement("mark"), { textContent: chars.slice(at, at + q.length).join("") }), chars.slice(at + q.length).join(""));
      } else name.textContent = raw;
      if (on) shown++;
    });
    $("artistNone").hidden = shown > 0;
    agStop();
    AG.pos = 0; AG.vel = 0; AG.target = null;
    agPaint();
    const w = $("artistWheel");
    w.classList.remove("is-swap"); void w.offsetWidth; w.classList.add("is-swap");
  }

  (() => {
    const wheel = $("artistWheel");
    if (!wheel) return;
    // Ruedita: un nombre por clic. Trackpad: gira continuo y encaja al soltar.
    let wheelT = 0, wheelAcc = 0, wheelLock = 0;
    wheel.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // Rueda con clics: saltos grandes y enteros (o en líneas). Trackpad: pasos chicos.
      const notched = e.deltaMode !== 0 || (Math.abs(dy) >= 50 && Number.isInteger(dy) && e.deltaX === 0 && (!e.wheelDeltaY || Math.abs(e.wheelDeltaY) % 120 === 0));
      if (notched) {
        const now = performance.now();
        if (now - wheelLock < 70) return; // un clic de rueda = un nombre
        wheelLock = now;
        agStep(Math.sign(dy));
        return;
      }
      agStop();
      AG.target = null; AG.vel = 0;
      wheelAcc = dy / (AG_PX * 1.6);
      const n = agVis().length;
      AG.pos += wheelAcc;
      if (!agLoop(n)) AG.pos = Math.max(-0.35, Math.min(n - 0.65, AG.pos));
      agPaintSoon();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => { AG.target = agClamp(Math.round(AG.pos + wheelAcc * 2), n); agKick(); }, 70);
    }, { passive: false });
    // Dedo o mouse: arrastre 1 a 1; al soltar, calcula dónde frena y llega
    // con el resorte. Un toque sin arrastre abre el del medio o trae otro.
    wheel.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      agStop();
      AG.target = null;
      AG.drag = { y: e.clientY, pos: AG.pos, samples: [{ y: e.clientY, t: performance.now() }], moved: false, id: e.pointerId };
      AG.vel = 0;
    });
    wheel.addEventListener("pointermove", (e) => {
      const d = AG.drag;
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dy) > 5) { d.moved = true; try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* nada */ } wheel.classList.add("is-drag"); }
      if (!d.moved) return;
      const now = performance.now();
      d.samples.push({ y: e.clientY, t: now });
      while (d.samples.length > 2 && now - d.samples[0].t > 90) d.samples.shift();
      const n = agVis().length;
      let p = d.pos - dy / AG_PX;
      if (!agLoop(n)) { if (p < 0) p *= 0.35; if (p > n - 1) p = n - 1 + (p - (n - 1)) * 0.35; }
      AG.pos = p;
      agPaintSoon();
    });
    const end = (e) => {
      const d = AG.drag;
      if (!d || e.pointerId !== d.id) return;
      AG.drag = null;
      wheel.classList.remove("is-drag");
      const n = agVis().length;
      if (!d.moved) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const li = el && el.closest && el.closest(".ag-item");
        if (li && !li.hidden) {
          if (li.classList.contains("is-center")) { li._open(); return; }
          agGo(agVis().indexOf(li));
          return;
        }
        AG.target = agClamp(Math.round(AG.pos), n);
        agKick();
        return;
      }
      // Velocidad del dedo (nombres por segundo) y adónde llegaría frenando.
      const a = d.samples[0], b = d.samples[d.samples.length - 1];
      const v = b.t > a.t ? -((b.y - a.y) / AG_PX) / ((b.t - a.t) / 1000) : 0;
      const reach = Math.max(-n / 2, Math.min(n / 2, v * 0.22));
      AG.vel = Math.max(-40, Math.min(40, v));
      AG.target = agClamp(Math.round(AG.pos + reach), n);
      agKick();
    };
    wheel.addEventListener("pointerup", end);
    wheel.addEventListener("pointercancel", end);
    wheel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); agStep(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); agStep(-1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); agOpen(); }
    });
    $("artistQ").addEventListener("input", agFilter);
    $("artistQ").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agOpen(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); agStep(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); agStep(-1); }
      else if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; agFilter(); }
    });
    // Con la lista abierta, tipear en cualquier lado escribe en el buscador.
    document.addEventListener("keydown", (e) => {
      const panel = $("panel-artists");
      if (!panel || panel.hidden || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      const t = document.activeElement;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      $("artistQ").focus();
    });
  })();

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
    db, $, setMsg, showPanel, nameOf, FORMAT_LABEL, openTab, showProfile, paintAvatar, token, authFetch, expired,
    get me() { return me; },
    backToProfile(profile) { if (profile && profile.id !== me.id) showProfile(profile); else if (me.role === "admin") openTab("me"); else showProfile(me); },
  };

  // Arranca cuando ya cargaron todos los módulos (canciones, archivos, etc.):
  // si hay una sesión guardada, el perfil se abre enseguida y necesita que
  // estén listos para empezar a traer las canciones y las carpetas.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
