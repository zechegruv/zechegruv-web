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

  // ---------- Mezcla y master: escuchar y aprobar ----------
  // El audio se detecta solo en la carpeta del artista (portal-songs.js):
  // mientras Zeche mezcla, la canción figura "en proceso" y no hay nada que
  // aprobar; cuando sube el archivo, aparece para escuchar, dejar notas en
  // el segundo exacto y aprobar (revision.js).
  const WHAT = { mezcla: "la mezcla", master: "el master" };
  const NOUN = { mezcla: "Mezcla", master: "Master" };
  const approved = (song) => !!(song.delivery && song.delivery.state === "aprobada");
  const IC = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 001.5.86l10.6-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    notes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4z"/><path d="M9 9h6M9 12h4"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-5 15-3-6z"/></svg>',
  };
  const eq = '<span class="dv-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

  // El administrador: botones Entregado / Aprobado (portal-mark.js). Quedan
  // en Notion (Canciones → Entrega) y reemplazan el aviso anterior del Inicio.
  function reviewHtml(song) {
    const html = reviewCore(song);
    const d = song.delivery;
    if (!d || song.done || viewingOwn || P.me.role !== "admin") return html;
    const ao = d.kind === "mezcla" ? "a" : "o";
    const pressed = (on) => `aria-pressed="${on ? "true" : "false"}"`;
    return `${html}
      <div class="dv-admin" data-mark-song="${esc(song.id)}" data-kind="${d.kind}">
        <span class="dv-admin-label">${NOUN[d.kind]}:</span>
        <button class="dv-mark" type="button" data-mark="entregada" ${pressed(d.state === "aprobar")}>${IC.send}<span>Entregad${ao}</span></button>
        <button class="dv-mark is-ok" type="button" data-mark="aprobada" ${pressed(d.state === "aprobada")}>${IC.check}<span>Aprobad${ao}</span></button>
        <span class="dv-mark-msg" role="status"></span>
      </div>`;
  }

  // Nombre del artista que se está mirando (para "Esperando aprobación de …").
  const artistName = () => (shownProfile && P.nameOf ? P.nameOf(shownProfile) : "") || "el artista";

  function reviewCore(song) {
    const d = song.delivery;
    if (!d || song.done) return "";
    const own = viewingOwn;
    const r = d.review;
    const day = r ? fmtDay(new Date(r.at)) : "";
    const notes = r && r.marks ? r.marks.length : 0;
    const ao = d.kind === "mezcla" ? "a" : "o";
    const notesTxt = notes ? `${notes} ${notes === 1 ? "nota" : "notas"}` : "";
    const open = (label, cls = "btn") => `<button class="${cls} dv-play" type="button" data-listen="${esc(song.id)}">${IC.play}<span>${label}</span></button>`;
    if (d.state === "proceso") {
      return `<div class="dv is-proceso"><span class="dv-ico">${eq}</span><span class="dv-text"><b>${NOUN[d.kind]} en proceso</b><span>${own
        ? `Zeche está trabajando en ${WHAT[d.kind]}. Cuando esté, te aparece acá para escucharl${ao} y aprobarl${ao}.`
        : `Todavía no subiste ${WHAT[d.kind]}: el artista no ve nada para aprobar. Subí un audio con "${d.kind === "mezcla" ? "mix" : "master"}" en el nombre a su carpeta y aparece solo, o tocá «Entregad${ao}» si se l${ao} mandaste por otro lado.`}</span></span></div>`;
    }
    if (d.state === "aprobar" && !d.file) {
      // Entregado a mano (sin audio en la carpeta): se aprueba desde acá.
      if (!own) return `<div class="dv is-espera"><span class="dv-ico">${IC.send}</span><span class="dv-text"><b>${NOUN[d.kind]} entregad${ao}</b><span>Marcad${ao} a mano. Esperando aprobación de ${esc(artistName())}.</span></span></div>`;
      return `<div class="dv is-aprobar" data-quick-song="${esc(song.id)}" data-kind="${d.kind}"><span class="dv-ico">${IC.send}</span><span class="dv-text"><b>${NOUN[d.kind]} para aprobar</b><span>Zeche te pasó ${WHAT[d.kind]}. Escuchal${ao} y contanos: ¿la aprobás o querés cambios?</span></span>
        <div class="review-actions"><button class="btn review-btn" type="button" data-quick="aprobada">${IC.check}<span>Aprobar</span></button><button class="btn review-btn review-ghost" type="button" data-quick="cambios">Pedir cambios</button></div>
        <form class="review-form" hidden><textarea rows="3" maxlength="1000" placeholder="¿Qué te gustaría cambiar?"></textarea><div class="review-actions"><button class="btn review-btn" type="submit">Mandar</button><button class="btn review-btn review-ghost" type="button" data-quick="cancelar">Cancelar</button></div></form>
        <p class="review-msg" role="status"></p></div>`;
    }
    if (d.state === "aprobar") {
      const drafts = own && window.ZGReview ? window.ZGReview.drafts(song) : 0;
      const again = r && r.action === "cambios";
      if (!own) {
        return `<div class="dv is-espera"><span class="dv-ico">${IC.play}</span><span class="dv-text"><b>${NOUN[d.kind]} entregad${ao}${again ? " · versión nueva" : ""}</b><span>Esperando aprobación de ${esc(artistName())}.${again && notesTxt ? ` Antes había dejado ${notesTxt}.` : ""}</span></span>${open("Escuchar")}</div>`;
      }
      return `<div class="dv is-aprobar"><span class="dv-ico">${IC.play}</span><span class="dv-text"><b>${again ? "Versión nueva de " + WHAT[d.kind] : NOUN[d.kind] + " para aprobar"}</b><span>${drafts ? `Tenés ${drafts} ${drafts === 1 ? "nota guardada" : "notas guardadas"} sin mandar.` : `Escuchal${ao}, dejá notas en el momento exacto o aprobal${ao}.`}</span></span>${open(drafts ? "Seguir escuchando" : "Escuchar y aprobar", "btn")}</div>`;
    }
    if (d.state === "cambios") {
      return `<div class="dv is-cambios"><span class="dv-ico">${IC.notes}</span><span class="dv-text"><b>${own ? "Pediste cambios" : "Pidió cambios"} el ${esc(day)}${notesTxt ? ` · ${notesTxt}` : ""}</b><span>${own ? "Zeche los está trabajando. Cuando suba la versión nueva, te aparece acá." : "Tocá «Ver notas» y el audio salta a cada momento."}</span></span>${d.file ? open(own ? "Ver mis notas" : "Ver notas", "btn btn-ghost") : ""}</div>`;
    }
    // aprobada
    return `<div class="dv is-aprobada"><span class="dv-ico">${IC.check}</span><span class="dv-text"><b>${own ? "Aprobaste" : "Aprobó"} ${WHAT[d.kind]}${day ? ` el ${esc(day)}` : ""}</b><span>${d.kind === "mezcla" ? "Sigue el master." : "Lista para salir."}</span></span>${d.file ? open("Volver a escuchar", "btn btn-ghost") : ""}</div>`;
  }

  // Busca la canción en lo que ya está cargado (propio o del artista que se mira).
  function findSong(id) {
    for (const hit of cache.values()) {
      const all = hit && hit.data ? [...(hit.data.active || []), ...(hit.data.done || [])] : [];
      const s = all.find((x) => x.id === id);
      if (s) return { song: s, data: hit.data };
    }
    return null;
  }

  // Mezcla aprobada: el servidor ya la pasó a Master (cierre-etapa.js) y
  // devuelve cómo queda; se muestra al momento, sin recargar.
  function advance(song, out) {
    if (out && out.next) Object.assign(song, out.next);
  }

  function listen(id) {
    const found = findSong(id);
    if (!found || !window.ZGReview) return;
    const { song } = found;
    window.ZGReview.open(song, {
      own: viewingOwn,
      onSent(review, out) {
        // La canción pasa a aprobada o a "cambios" sin esperar a Notion.
        song.delivery = { ...song.delivery, state: review.action === "aprobada" ? "aprobada" : "cambios", review };
        song.review = { kind: song.delivery.kind, ...review };
        song.ready = false;
        advance(song, out);
        if (shownProfile) paint(shownProfile, found.data);
      },
    });
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-listen]");
    if (b) { e.preventDefault(); listen(b.dataset.listen); }
  });

  async function authed(url, body) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "No pudimos guardarlo. Probá de nuevo.");
    return out;
  }
  const repaint = (found) => { if (shownProfile) paint(shownProfile, found.data); };

  // Administrador: Entregado / Aprobado.
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mark]");
    if (!b) return;
    const box = b.closest("[data-mark-song]");
    const found = box && findSong(box.dataset.markSong);
    if (!found || !shownProfile) return;
    const action = b.dataset.mark;
    const { song } = found;
    const msg = box.querySelector(".dv-mark-msg");
    box.querySelectorAll("[data-mark]").forEach((x) => { x.disabled = true; });
    b.classList.add("is-busy");
    msg.textContent = "Guardando…";
    try {
      const out = await authed("/.netlify/functions/portal-mark", { song: song.id, kind: box.dataset.kind, action, artist: shownProfile.id });
      song.delivery = { ...song.delivery, state: action === "aprobada" ? "aprobada" : "aprobar", manual: action, by: "admin" };
      song.ready = action === "entregada";
      advance(song, out); // Mezcla aprobada: ya está en Master
      repaint(found);
      const again = document.querySelector(`[data-mark-song="${song.id}"] [data-mark="${action}"]`);
      if (again) again.classList.add("is-pop");
      const sentMsg = document.querySelector(`[data-mark-song="${song.id}"] .dv-mark-msg`);
      if (sentMsg && out.notified) sentMsg.textContent = `Le avisamos a ${artistName()} por mail.`;
    } catch (err) {
      msg.textContent = err.message;
      box.querySelectorAll("[data-mark]").forEach((x) => { x.disabled = false; });
      b.classList.remove("is-busy");
    }
  });

  // Artista: aprobar o pedir cambios de lo que Zeche marcó "Entregado" sin audio.
  async function quickSend(box, action, note) {
    const found = findSong(box.dataset.quickSong);
    if (!found) return;
    const msg = box.querySelector(".review-msg");
    box.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    P.setMsg(msg, "Enviando…");
    try {
      const out = await authed("/.netlify/functions/portal-review", { song: found.song.id, kind: box.dataset.kind, action, note: note || undefined });
      const review = out.review || { action, note, at: new Date().toISOString(), marks: [] };
      found.song.delivery = { ...found.song.delivery, state: action === "aprobada" ? "aprobada" : "cambios", review };
      found.song.review = { kind: found.song.delivery.kind, ...review };
      found.song.ready = false;
      advance(found.song, out);
      repaint(found);
    } catch (err) {
      P.setMsg(msg, err.message, true);
      box.querySelectorAll("button").forEach((x) => { x.disabled = false; });
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b) return;
    const box = b.closest("[data-quick-song]");
    if (!box) return;
    const form = box.querySelector(".review-form");
    const top = box.querySelector(":scope > .review-actions");
    if (b.dataset.quick === "aprobada") quickSend(box, "aprobada");
    else if (b.dataset.quick === "cambios") { form.hidden = false; top.hidden = true; form.querySelector("textarea").focus(); }
    else if (b.dataset.quick === "cancelar") { form.hidden = true; top.hidden = false; }
  });
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-quick-song] .review-form");
    if (!form) return;
    e.preventDefault();
    const note = form.querySelector("textarea").value.trim();
    const box = form.closest("[data-quick-song]");
    if (!note) { P.setMsg(box.querySelector(".review-msg"), "Contanos qué te gustaría cambiar.", true); return; }
    quickSend(box, "cambios", note);
  });

  // ---------- Mi proyecto (portal nuevo del artista) ----------
  // Como el preview "Rediseño web", armado con los datos de cada artista:
  // saludo con la fecha, avance del proyecto, el próximo evento del sello y
  // lo que tiene para escuchar y aprobar (o cómo va cada canción).
  // Sin fechas de entrega.
  const NOUN_OF = { album: ["Tu disco", "del disco"], ep: ["Tu EP", "del EP"], single: ["Tu single", "del single"] };
  const STAGE_LINE = ["arrancó", "está en producción", "está en grabación", "ya está en mezcla", "ya está en master"];
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const listJoin = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} y ${a[a.length - 1]}` : a[0] || "");

  // ---------- Avisos: mezclas y masters para aprobar ----------
  // Apenas entra, arriba de todo en Mi proyecto: una fila por cada mezcla o
  // master listo para escuchar (como los avisos del panel de Zeche). Tocando
  // la fila se abre el reproductor para aprobar o marcar cambios en el
  // segundo exacto. Con ✕ se oculta hasta la próxima vez que entra; si
  // llega una versión nueva, vuelve a aparecer.
  const HIDE_KEY = "zg-avisos-ocultos";
  const noticeKey = (s) => `${s.id}|${(s.delivery && s.delivery.file && s.delivery.file.modified) || s.updated || ""}`;
  const hiddenSet = () => { try { return new Set(JSON.parse(sessionStorage.getItem(HIDE_KEY) || "[]")); } catch (e) { return new Set(); } };
  const hiddenNotice = (s) => hiddenSet().has(noticeKey(s));
  function hideNotice(key) {
    const set = hiddenSet();
    set.add(key);
    try { sessionStorage.setItem(HIDE_KEY, JSON.stringify([...set].slice(-50))); } catch (e) { /* nada */ }
  }
  function agoText(iso) {
    const t = Date.parse(iso || "");
    if (!t) return "";
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 2) return "recién";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }
  // Pestaña del navegador: "(1) Portal de artistas — ZECHE GRUV".
  const BASE_TITLE = document.title.replace(/^\(\d+\)\s*/, "");
  function pendingTitle(n) { document.title = n ? `(${n}) ${BASE_TITLE}` : BASE_TITLE; }

  function noticeHtml(s, i) {
    const d = s.delivery || {};
    const master = d.kind === "master";
    const again = d.review && d.review.action === "cambios"; // ya había pedido cambios: es la versión nueva
    const head = master ? (again ? "Nueva versión del master" : "Master para aprobar") : (again ? "Nueva versión de la mezcla" : "Mezcla para aprobar");
    const text = master ? `El master de «${s.title}» está listo.` : `Tu mezcla de «${s.title}» está lista.`;
    const sub = master
      ? "Es la versión final, la que va a sonar en todas las plataformas. Escuchalo y aprobalo, o marcá el segundo exacto que querés ajustar."
      : again ? "Ya están tus cambios. Escuchala de nuevo y contanos si quedó como la imaginabas."
        : "Escuchala con auriculares y contanos qué sentís: aprobala o marcá el segundo exacto que querés cambiar.";
    const when = agoText(d.file && d.file.modified);
    return `<li class="apn-row${master ? " is-master" : ""}" data-notice="${esc(noticeKey(s))}" style="animation-delay:${180 + i * 90}ms">
        <button type="button" class="apn-main" data-listen="${esc(s.id)}">
          <span class="apn-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>
          <span class="apn-body">
            <span class="apn-top"><span class="apn-tag">${esc(head)}</span>${when ? `<span class="apn-ago">${esc(when)}</span>` : ""}</span>
            <span class="apn-text">${esc(text)}</span>
            <span class="apn-sub">${esc(sub)}</span>
          </span>
        </button>
        <button type="button" class="apn-x" data-hide-notice aria-label="Ocultar aviso" title="Ocultar hasta la próxima vez"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
      </li>`;
  }
  function noticesHtml(pending, own) {
    const list = own ? pending.filter((s) => !hiddenNotice(s)) : pending;
    if (!list.length) return "";
    const n = list.length;
    return `
      <section class="ap-card apn" aria-label="Avisos" role="status">
        <div class="apn-head">
          <h2 class="ap-h2">${n === 1 ? "Tenés algo para escuchar" : `Tenés ${n} cosas para escuchar`}</h2>
          <span class="apn-count">${n}</span>
        </div>
        <ul class="apn-list">${list.map(noticeHtml).join("")}</ul>
      </section>`;
  }
  document.addEventListener("click", (e) => {
    const x = e.target.closest("[data-hide-notice]");
    if (!x) return;
    const row = x.closest(".apn-row");
    const card = row && row.closest(".apn");
    if (!row) return;
    hideNotice(row.dataset.notice);
    const left = card.querySelectorAll(".apn-row:not(.is-out)").length - 1;
    pendingTitle(Math.max(0, left));
    row.classList.add("is-out");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => {
      if (left <= 0) card.remove();
      else {
        row.remove();
        card.querySelector(".apn-count").textContent = String(left);
        card.querySelector(".ap-h2").textContent = left === 1 ? "Tenés algo para escuchar" : `Tenés ${left} cosas para escuchar`;
      }
    }, reduce ? 0 : 380);
  });

  function renderProject(profile, data) {
    const box = $("projectCards");
    const own = profile.id === P.me.id;
    // El artista en su portal, o el administrador mirándolo (vista-artista.js).
    const asArtist = profile.role === "artist" && (own ? P.me.role === "artist" : P.me.role === "admin");
    if (!asArtist) { box.hidden = true; box.replaceChildren(); return; }
    const active = (data && data.configured && data.active) || [];
    const done = (data && data.configured && data.done) || [];
    const total = active.length + done.length;
    const [noun, ofNoun] = NOUN_OF[profile.format] || ["Tu proyecto", "del proyecto"];
    const pending = active.filter((s) => s.ready && !approved(s));
    if (own && window.ZGArtistNav) window.ZGArtistNav.setPending(pending.length);

    // Saludo: la etapa más avanzada y lo que tiene para aprobar.
    const top = active.reduce((m, s) => Math.max(m, s.step), -1);
    let lead;
    if (!total) lead = "Acá vas a ver cómo avanza tu música, etapa por etapa.";
    else if (!active.length) lead = `${noun} está terminado. ¡Gracias por confiar en el estudio!`;
    else lead = `${noun} ${top >= 0 ? STAGE_LINE[top] : "está por arrancar"}.`;
    if (pending.length) lead += ` Tenés ${pending.length === 1 ? "una canción" : `${pending.length} canciones`} para escuchar y aprobar.`;
    const today = capFirst(new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }).replace(",", ""));

    // Avance: cada canción suma una parte por etapa cumplida.
    let ring = "";
    if (total) {
      const steps = active.reduce((n, s) => n + Math.max(0, s.step), 0) + done.length * STAGES.length;
      const pct = Math.round((steps / (total * STAGES.length)) * 100);
      const counts = {};
      active.forEach((s) => { const k = s.step >= 0 ? STAGES[s.step][1] : "Por arrancar"; counts[k] = (counts[k] || 0) + 1; });
      const parts = Object.entries(counts).map(([k, n]) => `${n} en ${k.toLowerCase()}`);
      if (done.length) parts.push(`${done.length} ${done.length === 1 ? "terminada" : "terminadas"}`);
      const C = 2 * Math.PI * 72;
      ring = `
        <section class="ap-card ap-ring-card" aria-label="Avance">
          <div class="ap-ring">
            <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="72" class="ap-ring-bg"/><circle cx="80" cy="80" r="72" class="ap-ring-fg" style="stroke-dasharray:${C.toFixed(1)};--off:${(C * (1 - pct / 100)).toFixed(1)};--full:${C.toFixed(1)}"/></svg>
            <div class="ap-ring-num"><b>${pct}%</b><span>${ofNoun}</span></div>
          </div>
          <div class="ap-ring-text">
            <b>${countLabel(total)}</b>
            <span>${esc(listJoin(parts))}</span>
            <span>${pending.length ? `${pending.length} para escuchar y aprobar` : "Nada pendiente para aprobar"}</span>
          </div>
        </section>`;
    }

    // Lista: cómo va cada canción. Las que tienen algo para aprobar se abren
    // directo en el reproductor (el aviso de arriba ya las destaca).
    const TAG = { proceso: "en proceso", aprobar: "para aprobar", cambios: "cambios pedidos", aprobada: "aprobada" };
    const rows = active.map((s, i) => {
      const stage = s.step >= 0 ? STAGES[s.step][1] : "Por arrancar";
      const d = s.delivery;
      const go = pending.includes(s);
      const tag = go ? "Escuchar" : d ? `${d.kind === "mezcla" ? "Mezcla" : "Master"} ${TAG[d.state]}`.replace("Master aprobada", "Master aprobado") : "En proceso";
      const act = go ? `data-listen="${esc(s.id)}"` : 'data-go="canciones"';
      return `<li><button type="button" class="ap-row" ${act} style="animation-delay:${300 + i * 80}ms">
        <span class="ap-dot${go ? " is-now" : ""}" aria-hidden="true"></span>
        <span class="ap-stage">${esc(stage)}</span>
        <span class="ap-what">${esc(s.title)}${s.feat ? ` <small>feat. ${esc(s.feat)}</small>` : ""}</span>
        <span class="ap-tag${go ? " is-go" : ""}">${tag}</span>
      </button></li>`;
    }).join("");
    const list = rows ? `
      <section class="ap-card ap-list" aria-label="Tus canciones">
        <h2 class="ap-h2">Tus canciones</h2>
        <ol>${rows}</ol>
      </section>` : "";

    box.innerHTML = `
      <header class="ap-head">
        <div>
          <span class="ap-eyebrow ap-date">${esc(today)}</span>
          <h1 class="ap-hello">Hola, ${esc(firstName(profile))}.</h1>
          <p class="ap-lead">${esc(lead)}</p>
        </div>
        ${total ? '<button class="btn btn-primary ap-cta" type="button" data-go="canciones">Ver mis canciones</button>' : ""}
      </header>
      ${noticesHtml(pending, own)}
      <div class="ap-grid">${ring}<div id="apScene" class="ap-scene-slot"></div></div>
      ${list}`;
    box.hidden = false;
    if (own) pendingTitle(pending.filter((s) => !hiddenNotice(s)).length);
    if (window.ZGArtistNav) window.ZGArtistNav.fillScene($("apScene"), "small");
  }

  function doneSong(song) {
    const when = dateLine(song);
    const tag = song.stage === "publicada" ? "Publicada" : approved(song) && song.review ? `Master aprobado el ${fmtDay(new Date(song.review.at))}` : "Master aprobado";
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
      renderProject(profile, null);
      // Al artista no se le muestra un error: la sección aparece cuando funciona.
      if (!admin) { card.hidden = true; return; }
      status.textContent = err.message !== "error" ? err.message : "No pudimos traer las canciones. Probá de nuevo en un momento.";
      return;
    }
    if (ticket !== current) return;
    paint(profile, data);
  }

  let shownProfile = null; // perfil cuyas canciones están a la vista
  let wantOpen = null;     // { profileId, songId }: abrir esa canción apenas cargue
  function openWhenReady(profileId, songId) { wantOpen = { profileId, songId }; }
  function paint(profile, data) {
    shownProfile = profile;
    if (wantOpen && wantOpen.profileId === profile.id) {
      const id = String(wantOpen.songId).replace(/-/g, "");
      wantOpen = null;
      setTimeout(() => {
        const s = [...(data.active || []), ...(data.done || [])].find((x) => String(x.id).replace(/-/g, "") === id);
        if (!s) return;
        document.querySelector(`#songsList [data-song="${s.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        if (s.delivery && s.delivery.file) listen(s.id);
      }, 60);
    }
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
      status.textContent = "No encontramos su ficha en Clientes Zeche Gruv: ni el mail ni el nombre completo de su perfil coinciden con ninguna (el nombre que el artista edita no cuenta). Corregí uno de los dos o pegá el link de la ficha en su perfil.";
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

  // Etapa de la canción con ese título (el cuaderno de letras la muestra).
  function find(profileId, normTitle) {
    const hit = cache.get(profileId);
    const data = hit && hit.data;
    if (!data || !data.configured) return null;
    const clean = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const s = [...(data.active || []), ...(data.done || [])].find((x) => clean(x.title) === normTitle);
    if (!s) return null;
    if (s.done) return s.stage === "publicada" ? "Publicada" : "Terminada";
    return s.step >= 0 ? `En ${STAGES[s.step][1].toLowerCase()}` : "Por arrancar";
  }

  // Feat de la canción con ese título (el cuaderno de letras lo usa para «Quién canta»).
  function feat(profileId, normTitle) {
    const hit = cache.get(profileId);
    const data = hit && hit.data;
    if (!data || !data.configured || !normTitle) return null;
    const clean = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const s = [...(data.active || []), ...(data.done || [])].find((x) => clean(x.title) === normTitle);
    return (s && s.feat) || null;
  }

  window.ZGSongs = { load, titles, find, feat, openWhenReady };
})();
