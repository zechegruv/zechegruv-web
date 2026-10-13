// ZECHE GRUV — Portal de artistas: "Tus canciones".
// Muestra cada canción del artista y en qué etapa está, tal como figura en
// la base Canciones del Notion del estudio (se lee desde
// netlify/functions/portal-songs.js). Las que siguen en proceso van a la
// vista, con su recorrido de etapas; las que ya tienen el master aprobado
// (en Notion: Distribución o Publicada) se guardan en "Terminadas", una
// lista plegada debajo. El estado se cambia en Notion; lo único que el
// artista hace desde acá es aprobar la mezcla y el master (o pedir cambios
// con una nota), que se guarda con netlify/functions/portal-review.js.
// En "Mi proyecto" (portal nuevo del artista) se muestra el avance del
// proyecto y lo que tiene para aprobar. Sin fechas de entrega.
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

  let current = 0;
  let viewingOwn = false; // los botones de aprobar son solo para el artista // para descartar respuestas viejas si se cambia de perfil rápido

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
      <li class="song${song.ready && !approved(song) ? " is-awaiting" : ""}" data-song="${esc(song.id)}">
        <div class="song-top">
          <div class="song-name">${titleHtml(song)}</div>
          <span class="song-stage">${song.step >= 0 ? esc(STAGES[song.step][1]) : "Por arrancar"}</span>
        </div>
        <ol class="stages" aria-label="${esc(label)}">${steps}</ol>
        ${when ? `<p class="song-when">${esc(when)}</p>` : ""}
        ${reviewHtml(song)}
      </li>`;
  }

  // ---------- Aprobar mezcla y master ----------
  // Mezcla: mientras la canción está en Mezcla. Master: cuando ya se lo
  // mandamos (en Notion ya no tiene fecha de entrega). El artista aprueba o
  // pide cambios con una nota; a Zeche le llega el aviso.
  const KIND = { 3: "mezcla", 4: "master" };
  const WHAT = { mezcla: "la mezcla", master: "el master" };
  const NOUN = { mezcla: "mezcla", master: "master" };
  const WHERE = { mezcla: "Escuchala en Archivos → Exports.", master: "Escuchalo en Archivos → Masters." };
  const approved = (song) => !!(song.review && song.review.action === "aprobada");
  const kindOf = (song) => KIND[song.step] || null;

  function reviewHtml(song) {
    const kind = kindOf(song);
    if (!kind) return "";
    const own = viewingOwn;
    const r = song.review;
    const day = r ? fmtDay(new Date(r.at)) : "";
    if (approved(song)) {
      return `<div class="song-review is-ok"><span class="review-state">✓ ${own ? "Aprobaste" : "Aprobó"} ${WHAT[kind]} el ${esc(day)}</span></div>`;
    }
    const asked = r && r.action === "cambios"
      ? `<p class="review-asked">${own ? "Pediste cambios" : "Pidió cambios"} el ${esc(day)}: «${esc(r.note || "")}»</p>`
      : "";
    if (!own) {
      const state = song.ready ? `Falta que apruebe ${WHAT[kind]}` : "Master en proceso";
      return `<div class="song-review">${asked}<span class="review-state is-wait">${state}</span></div>`;
    }
    if (!song.ready) {
      return `<div class="song-review">${asked}<button class="btn review-btn" type="button" disabled>Aprobar master · cuando te lo mandemos</button></div>`;
    }
    const again = r ? "¿Ya escuchaste la nueva versión? " : "";
    return `
      <div class="song-review" data-kind="${kind}">
        ${asked}
        <p class="review-hint">${again}${WHERE[kind]}</p>
        <div class="review-actions">
          <button class="btn btn-primary review-btn" type="button" data-review="aprobada">Aprobar ${NOUN[kind]}</button>
          <button class="btn review-btn review-ghost" type="button" data-review="open">Pedir cambios</button>
        </div>
        <form class="review-form" hidden>
          <label class="sr-only" for="rv-${esc(song.id)}">Qué te gustaría cambiar</label>
          <textarea id="rv-${esc(song.id)}" rows="3" maxlength="1000" placeholder="Ej.: en el estribillo subiría un poco la voz"></textarea>
          <div class="review-actions">
            <button class="btn btn-primary review-btn" type="submit">Enviar a Zeche</button>
            <button class="btn review-btn review-ghost" type="button" data-review="close">Cancelar</button>
          </div>
        </form>
        <p class="msg review-msg" role="status"></p>
      </div>`;
  }

  async function sendReview(li, kind, action, note) {
    const msg = li.querySelector(".review-msg");
    const buttons = li.querySelectorAll(".review-btn");
    buttons.forEach((b) => { b.disabled = true; });
    P.setMsg(msg, "Enviando…");
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch("/.netlify/functions/portal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ song: li.dataset.song, kind, action, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviarlo. Probá de nuevo.");
      // Se actualiza lo guardado y se vuelve a pintar.
      const hit = cache.get(P.me.id);
      if (hit && hit.data) {
        (hit.data.active || []).forEach((s) => { if (s.id === li.dataset.song) s.review = data.review; });
        paint(P.me, hit.data);
      }
      if (window.zgTrack) window.zgTrack("portal_aprobacion", { etapa: kind, accion: action });
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      P.setMsg(msg, err.message, true);
    }
  }

  $("songsList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-review]");
    if (!b) return;
    const li = b.closest("li.song");
    const box = li.querySelector(".song-review");
    const form = box.querySelector(".review-form");
    const actions = box.querySelector(".review-actions");
    if (b.dataset.review === "open") { form.hidden = false; actions.hidden = true; form.querySelector("textarea").focus(); return; }
    if (b.dataset.review === "close") { form.hidden = true; actions.hidden = false; return; }
    if (b.dataset.review === "aprobada") sendReview(li, box.dataset.kind, "aprobada", null);
  });
  $("songsList").addEventListener("submit", (e) => {
    e.preventDefault();
    const li = e.target.closest("li.song");
    const box = li.querySelector(".song-review");
    const note = e.target.querySelector("textarea").value.trim();
    if (!note) { P.setMsg(box.querySelector(".review-msg"), "Contanos qué te gustaría cambiar.", true); return; }
    sendReview(li, box.dataset.kind, "cambios", note);
  });

  // ---------- Mi proyecto: avance y pendientes ----------
  // Avance: cada canción suma una parte por etapa cumplida (las terminadas,
  // todas). Sin fechas: solo cuánto falta y qué hay para escuchar.
  function renderProject(profile, data) {
    const box = $("projectCards");
    const own = profile.id === P.me.id;
    const active = (data && data.active) || [];
    const done = (data && data.done) || [];
    const total = active.length + done.length;
    if (!own || !data || !data.configured || !total) {
      box.hidden = true;
      box.replaceChildren();
      if (own && window.ZGArtistNav) window.ZGArtistNav.setPending(0);
      return;
    }
    const steps = active.reduce((n, s) => n + Math.max(0, s.step), 0) + done.length * STAGES.length;
    const pct = Math.round((steps / (total * STAGES.length)) * 100);
    const counts = {};
    active.forEach((s) => { const k = s.step >= 0 ? STAGES[s.step][1] : "Por arrancar"; counts[k] = (counts[k] || 0) + 1; });
    const parts = Object.entries(counts).map(([k, n]) => `${n} en ${k.toLowerCase()}`);
    if (done.length) parts.push(`${done.length} ${done.length === 1 ? "terminada" : "terminadas"}`);
    const pending = active.filter((s) => s.ready && !approved(s));
    if (window.ZGArtistNav) window.ZGArtistNav.setPending(pending.length);
    const C = 2 * Math.PI * 72;
    const ring = `
      <section class="ap-card ap-ring-card" aria-label="Avance del proyecto">
        <div class="ap-ring">
          <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="72" class="ap-ring-bg"/><circle cx="80" cy="80" r="72" class="ap-ring-fg" style="stroke-dasharray:${C.toFixed(1)};--off:${(C * (1 - pct / 100)).toFixed(1)};--full:${C.toFixed(1)}"/></svg>
          <div class="ap-ring-num"><b>${pct}%</b><span>del proyecto</span></div>
        </div>
        <div class="ap-ring-text">
          <b>${countLabel(total)}</b>
          <span>${esc(parts.join(" · "))}</span>
          <button class="btn ap-link" type="button" data-go="canciones">Ver mis canciones →</button>
        </div>
      </section>`;
    const items = pending.map((s) => `<li><b>${esc(s.title)}</b><span>${s.step === 4 ? "Master" : "Mezcla"} lista</span></li>`).join("");
    const todo = pending.length
      ? `<section class="ap-card ap-todo" aria-label="Para escuchar y aprobar">
          <img class="ap-todo-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true">
          <span class="ap-eyebrow">Para escuchar y aprobar</span>
          <ul>${items}</ul>
          <button class="btn ap-dark" type="button" data-go="canciones">Escuchar y aprobar</button>
        </section>`
      : `<section class="ap-card ap-todo is-calm" aria-label="Para aprobar">
          <img class="ap-todo-sun" src="../assets/zeche-gruv-sol.webp" alt="" aria-hidden="true">
          <span class="ap-eyebrow">Para aprobar</span>
          <p>Nada pendiente por ahora. Cuando una mezcla o un master esté listo, te aparece acá para que lo escuches y lo apruebes.</p>
        </section>`;
    box.innerHTML = `<div class="ap-grid">${ring}${todo}</div>`;
    box.hidden = false;
  }

  function doneSong(song) {
    const when = dateLine(song);
    const tag = song.stage === "publicada" ? "Publicada" : approved(song) ? `Master aprobado el ${fmtDay(new Date(song.review.at))}` : "Master aprobado";
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
    $("projectCards").hidden = true;
    if (own && admin) { card.hidden = true; return; }
    card.hidden = false;
    $("songsTitle").textContent = own ? "Tus canciones" : `Canciones de ${P.nameOf(profile)}`;
    $("songsSub").textContent = own ? "Cómo avanza cada canción. Cuando una mezcla o un master esté listo, lo escuchás y lo aprobás desde acá." : "Lo que ve el artista: la etapa de cada canción (sin fechas de entrega) y si aprobó la mezcla y el master.";
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
    viewingOwn = own && !admin;
    renderWelcome(profile, data.next || null);
    renderProject(profile, data);

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
