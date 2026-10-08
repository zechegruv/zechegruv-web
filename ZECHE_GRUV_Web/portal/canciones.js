// ZECHE GRUV — Portal de artistas: "Tus canciones".
// Muestra cada canción del artista y en qué etapa está, tal como figura en
// la base Canciones del Notion del estudio (se lee desde
// netlify/functions/portal-songs.js). Las que siguen en proceso van a la
// vista, con su recorrido de etapas; las que ya tienen el master aprobado
// (en Notion: Distribución o Publicada) se guardan en "Terminadas", una
// lista plegada debajo. Solo lectura: el estado se cambia en Notion.
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;

  const STAGES = [
    ["estructura", "Estructura"],
    ["produccion", "Producción"],
    ["grabacion", "Grabación"],
    ["mezcla", "Mezcla"],
    ["master", "Master"],
  ];

  let current = 0; // para descartar respuestas viejas si se cambia de perfil rápido

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // Las fechas de Notion vienen como "2026-10-12": se leen como fecha local
  // para que no se corran un día por la zona horaria.
  function dayOf(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const fmtDay = (d) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");

  // Solo la fecha de lanzamiento de las terminadas. Las canciones en proceso
  // muestran la etapa y nada más: los plazos de mezcla y master los maneja
  // el estudio, no se le suman al artista.
  function dateLine(song) {
    const release = song.done ? dayOf(song.release) : null;
    if (!release) return "";
    return release >= today() ? `Sale el ${fmtDay(release)}` : `Salió el ${fmtDay(release)}`;
  }

  function titleHtml(song) {
    return `<b class="song-title">${esc(song.title)}</b>${song.feat ? `<span class="song-feat">feat. ${esc(song.feat)}</span>` : ""}`;
  }

  function activeSong(song) {
    const label = song.step >= 0
      ? `Etapa ${song.step + 1} de ${STAGES.length}: ${STAGES[song.step][1]}`
      : "Todavía sin etapa";
    const steps = STAGES.map(([key, name], i) => {
      const state = i < song.step ? "is-done" : i === song.step ? "is-current" : "";
      return `<li class="${state}"${i === song.step ? ' aria-current="step"' : ""}><span>${name}</span></li>`;
    }).join("");
    const when = dateLine(song);
    return `
      <li class="song">
        <div class="song-top">
          <div class="song-name">${titleHtml(song)}</div>
          <span class="song-stage">${song.step >= 0 ? esc(STAGES[song.step][1]) : "Por arrancar"}</span>
        </div>
        <ol class="stages" aria-label="${esc(label)}">${steps}</ol>
        ${when ? `<p class="song-when">${esc(when)}</p>` : ""}
      </li>`;
  }

  function doneSong(song) {
    const when = dateLine(song);
    const tag = song.stage === "publicada" ? "Publicada" : "Master aprobado";
    return `
      <li class="song song-finished">
        <div class="song-name">${titleHtml(song)}</div>
        <span class="song-meta">${when ? `${esc(when)} · ` : ""}<span class="song-ok">${tag}</span></span>
      </li>`;
  }

  // ---------- Bienvenida: la próxima sesión ----------
  // Lo primero que ve el artista al entrar. Si la próxima sesión está
  // agendada en Notion (una tarea con horario), le cuenta cuándo es y qué
  // vamos a hacer, en una o dos frases simples; si no, lo despide
  // hasta la próxima y le deja el WhatsApp a mano.
  const WHATSAPP = "https://wa.me/5491133287422?text=" + encodeURIComponent("Hola Zeche! Te escribo desde el portal: ");
  const TZ = "America/Argentina/Buenos_Aires";

  const PLAN = {
    estructura: (s) => `Arrancamos ${s}. Si tenés alguna idea grabada en el celu, traela.`,
    produccion: (s) => `Seguimos con la producción de ${s}.`,
    grabacion: (s) => `Grabamos voces de ${s}. Vení con la canción bien estudiada, así aprovechamos la sesión para la toma final.`,
    mezcla: (s) => `Escuchamos la mezcla de ${s} y vemos qué ajustar.`,
    master: (s) => `Cerramos el master de ${s}.`,
    distribucion: (s) => `Dejamos todo listo para lanzar ${s}.`,
    publicada: (s) => `Charlamos qué sigue después de ${s}.`,
  };

  const firstName = (p) => (P.nameOf(p).split(/\s+/)[0] || "").trim();

  function whenLabel(startIso, endIso) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const hour = (d) => {
      const [h, m] = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":");
      return m === "00" ? String(+h) : `${+h}:${m}`;
    };
    let day;
    if (dayKey(start) === dayKey(now)) day = "hoy";
    else if (dayKey(start) === dayKey(tomorrow)) day = "mañana";
    else day = "el " + new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric" }).format(start).replace(",", "");
    return `${day}, de ${hour(start)} a ${hour(end)} h`;
  }

  function renderWelcome(profile, next) {
    const own = profile.id === P.me.id;
    $("welcomeCard").hidden = false;
    $("welcomeEyebrow").textContent = own ? "Tu próxima sesión" : `Así lo ve ${P.nameOf(profile)} al entrar`;
    $("welcomeTitle").textContent = `Hola, ${firstName(profile)}.`;
    let html;
    if (next) {
      const lines = next.plan.map(({ stage, song }) => {
        const name = song ? `«${esc(song)}»` : "tu canción";
        if (stage && PLAN[stage]) return `<p>${PLAN[stage](name)}</p>`;
        return `<p>${song ? `Seguimos con ${name}.` : "Seguimos con tu proyecto."}</p>`;
      }).join("");
      html = `<p class="welcome-when">Nos vemos en el estudio ${esc(whenLabel(next.start, next.end))}.</p>${lines}`;
    } else {
      html = "<p>Nos vemos en la próxima sesión.</p>";
    }
    html += `<p class="welcome-help">¿Alguna duda antes? <a href="${WHATSAPP}" target="_blank" rel="noopener">Escribinos por WhatsApp ↗</a></p>`;
    $("welcomeBody").innerHTML = html;
  }

  // ---------- Caché ----------
  // Notion tarda, así que lo de cada perfil se guarda mientras dure la sesión
  // en esta pestaña: se pide al iniciar sesión y la próxima vez que se abre el
  // perfil se muestra al instante (y se actualiza por detrás si pasaron unos
  // minutos).
  const FRESH_FOR = 2 * 60 * 1000;
  const cache = new Map(); // id del perfil -> { data, at, promise }

  function fetchSongs(profile) {
    const hit = cache.get(profile.id);
    if (hit && hit.promise) return hit.promise;
    const own = profile.id === P.me.id;
    const promise = (async () => {
      const { data: { session } } = await db.auth.getSession();
      const query = own ? "" : `?artist=${encodeURIComponent(profile.id)}`;
      const res = await fetch(`/.netlify/functions/portal-songs${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
      cache.set(profile.id, { data, at: Date.now(), promise: null });
      return data;
    })();
    cache.set(profile.id, { ...(hit || {}), promise });
    promise.catch(() => { const h = cache.get(profile.id); if (h && h.promise === promise) cache.set(profile.id, { ...h, promise: null }); });
    return promise;
  }

  const countLabel = (n) => (n === 1 ? "1 canción" : `${n} canciones`);

  async function load(profile) {
    const ticket = ++current;
    const admin = P.me.role === "admin";
    const own = profile.id === P.me.id;
    const card = $("songsCard");
    const status = $("songsStatus");

    // El administrador no tiene canciones propias.
    $("welcomeCard").hidden = true;
    if (own && admin) { card.hidden = true; return; }
    card.hidden = false;
    $("songsTitle").textContent = own ? "Tus canciones" : `Canciones de ${P.nameOf(profile)}`;
    $("songsSub").textContent = own ? "Acá vas a ir viendo cómo avanzan tus canciones." : "Lo que ve el artista: la etapa de cada canción, sin fechas de entrega.";
    $("songsList").replaceChildren();
    $("songsDone").hidden = true;
    $("songsDone").open = false; // "Terminadas" arranca siempre plegada
    $("songsCount").textContent = "";
    status.textContent = "Cargando…";

    // Lo ya traído se muestra al instante y se actualiza por detrás.
    const hit = cache.get(profile.id);
    if (hit && hit.data) {
      paint(profile, hit.data);
      if (Date.now() - hit.at > FRESH_FOR) {
        const shown = JSON.stringify(hit.data);
        fetchSongs(profile).then((newer) => {
          if (ticket === current && JSON.stringify(newer) !== shown) paint(profile, newer);
        }).catch(() => {});
      }
      return;
    }

    let data;
    try {
      data = await fetchSongs(profile);
    } catch (err) {
      if (ticket !== current) return;
      renderWelcome(profile, null);
      // Al artista no se le muestra un error: la sección aparece cuando funciona.
      if (!admin) { card.hidden = true; return; }
      status.textContent = err.message !== "error" ? err.message : "No pudimos traer las canciones. Probá de nuevo en un momento.";
      return;
    }
    if (ticket !== current) return;
    paint(profile, data);
  }

  function paint(profile, data) {
    const admin = P.me.role === "admin";
    const own = profile.id === P.me.id;
    const card = $("songsCard");
    const status = $("songsStatus");
    card.hidden = false;
    renderWelcome(profile, data.next || null);

    if (!data.configured) {
      // Al artista no se le muestra una sección vacía: aparece cuando se conecta.
      if (!admin) { card.hidden = true; return; }
      status.textContent = "No encontramos su ficha en Clientes Zeche Gruv: el mail y el nombre artístico no coinciden con ninguna. Corregí uno de los dos en Notion o pegá el link de la ficha en su perfil.";
      return;
    }

    const { active, done } = data;
    if (!active.length && !done.length) {
      status.textContent = own ? "Todavía no hay canciones cargadas. Aparecen acá apenas arranquemos la primera." : "Todavía no tiene canciones en Notion.";
      return;
    }
    status.textContent = active.length ? "" : "No hay canciones en proceso ahora mismo.";
    $("songsCount").textContent = active.length ? `${countLabel(active.length)} en proceso` : "";
    $("songsList").innerHTML = active.map(activeSong).join("");

    $("songsDone").hidden = !done.length;
    $("songsDoneCount").textContent = countLabel(done.length);
    $("songsDoneList").innerHTML = done.map(doneSong).join("");
  }

  // Títulos de sus canciones (para sugerirlos al escribir una letra).
  function titles(profileId) {
    const hit = cache.get(profileId);
    const data = hit && hit.data;
    if (!data || !data.configured) return [];
    return [...(data.active || []), ...(data.done || [])].map((s) => s.title).filter(Boolean);
  }

  window.ZGSongs = { load, titles };
})();
