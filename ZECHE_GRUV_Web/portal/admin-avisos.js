// ZECHE GRUV — Panel de administrador: "Hoy en el estudio" en el Inicio.
// Dos columnas:
//   - Mezclas y masters (admin-tasks.js): solo las sesiones de mezcla y master
//     y las fechas límite de entrega, por fecha y con cartel de urgencia
//     (vencida · hoy · mañana · en 2-3 días). ✓ marca la sesión COMPLETADO en
//     Notion; la entrega se va sola al marcarla entregada o aprobada.
//     Tocando una fila se abre el artista.
//   - Avisos: lo que los artistas aprobaron o pidieron cambiar de sus
//     mezclas y masters (portal-reviews.js). Uno por canción, se reemplaza
//     solo cuando la canción avanza o cuando tocás Entregado / Aprobado, y el
//     master aprobado se borra con ✕ (o solo, a los 7 días).
// Se actualiza solo: al volver a la pestaña y cada 2 minutos con el Inicio
// abierto. La cantidad de avisos queda en la pastilla de "Inicio".
(() => {
  const P = window.ZGPortal;
  const { db } = P;
  const TZ = "America/Argentina/Buenos_Aires";
  const SHOW_TASKS = 7;
  const REFRESH_MS = 2 * 60 * 1000;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16M12 13v3.5l2 1.2"/></svg>',
  };
  const iconBtn = (cls, label, svg) => { const b = el("button", cls); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.innerHTML = svg; return b; };

  async function call(url, body) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(url, body
      ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) }
      : { headers: { Authorization: `Bearer ${session.access_token}` } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "error");
    return out;
  }

  // ---------- Fechas ----------
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function whenTask(t) {
    const hour = t.timed ? new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t.start)) + " h" : "";
    let day;
    if (t.days === 0) day = "Hoy";
    else if (t.days === 1) day = "Mañana";
    else if (t.days === -1) day = "Ayer";
    else if (t.days < 0) day = `Hace ${-t.days} días`;
    else {
      const d = t.timed ? new Date(t.start) : new Date(`${t.start.slice(0, 10)}T12:00:00-03:00`);
      day = cap(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric" }).format(d).replace(",", "").replace(".", ""));
    }
    return hour ? `${day} · ${hour}` : day;
  }
  const URG = { vencida: "Vencida", hoy: "Hoy", manana: "Mañana", pronto: "Pronto", normal: "" };
  function ago(iso) {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return "recién";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }

  // ---------- Salida animada ----------
  // La fila se desliza y se cierra el hueco (sin saltos en la lista).
  function removeRow(li, dir = 1) {
    if (reduced()) { li.remove(); return Promise.resolve(); }
    const h = li.offsetHeight;
    li.style.height = `${h}px`;
    li.style.overflow = "hidden";
    return li.animate([
      { opacity: 1, transform: "translateX(0)", height: `${h}px` },
      { opacity: 0, transform: `translateX(${dir * 28}px)`, height: `${h}px`, offset: 0.55 },
      { opacity: 0, transform: `translateX(${dir * 28}px)`, height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px" },
    ], { duration: 460, easing: "cubic-bezier(.23, 1, .32, 1)" }).finished.then(() => li.remove()).catch(() => li.remove());
  }

  // ---------- Artistas (para abrir el perfil desde una tarea) ----------
  let artists = null;
  async function artistByName(name) {
    if (!name) return null;
    if (!artists) {
      const { data } = await db.from("profiles").select("*").eq("role", "artist");
      artists = data || [];
    }
    const n = norm(name);
    return artists.find((a) => norm(a.display_name) === n) || artists.find((a) => norm(a.full_name) === n) || null;
  }
  async function openProfileId(id, songId) {
    const { data } = await db.from("profiles").select("*").eq("id", id).single();
    if (!data) return;
    if (songId && window.ZGSongs && window.ZGSongs.openWhenReady) window.ZGSongs.openWhenReady(data.id, songId);
    P.showProfile(data);
    if (songId && window.ZGArtistView) window.ZGArtistView.go("canciones");
  }

  // ---------- Pastilla en "Inicio" ----------
  function badge(n) {
    const tab = document.querySelector('#tabs [data-tab="home"]');
    if (!tab) return;
    let b = tab.querySelector(".tab-badge");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = el("span", "tab-badge"); tab.append(b); }
    if (b.textContent !== String(n)) { b.textContent = String(n); b.classList.remove("is-pop"); void b.offsetWidth; b.classList.add("is-pop"); }
  }

  // ---------- Próximas tareas ----------
  function taskRow(t, i) {
    const li = el("li", `zt-row is-${t.urgency}`);
    li.style.animationDelay = `${120 + i * 60}ms`;
    const main = el("button", "zt-main");
    main.type = "button";
    const top = el("span", "zt-top");
    if (URG[t.urgency]) top.append(el("span", `zt-urg is-${t.urgency}`, t.urgency === "pronto" ? `En ${t.days} días` : URG[t.urgency]));
    top.append(el("span", "zt-when", whenTask(t)));
    // Sesión de mezcla/master o fecha límite de entrega.
    const what = t.kind === "entrega" ? (t.stage === "Mezcla" ? "Entrega de la mezcla" : "Entrega del master") : (t.stage === "Mezcla" ? "Sesión de mezcla" : "Sesión de master");
    top.append(el("span", `zt-kind is-${t.kind === "entrega" ? "entrega" : "sesion"}`, what));
    const title = t.kind === "entrega" ? `«${t.name}»` : t.name;
    const sub = [t.artist, t.kind === "sesion" && t.song && !norm(t.name).includes(norm(t.song)) ? `«${t.song}»` : null].filter(Boolean).join(" · ");
    main.append(top, el("span", "zt-name", title), sub ? el("span", "zt-sub", sub) : "");
    main.addEventListener("click", async () => {
      const a = await artistByName(t.artist);
      if (a) openProfileId(a.id);
      else if (t.url) window.open(t.url, "_blank", "noopener");
    });
    // Las fechas de entrega se van solas cuando la mezcla o el master se
    // marca entregado o aprobado; las sesiones se tildan acá.
    // Vencida: botón para reprogramarla (Notion + Google Calendar).
    const move = t.urgency === "vencida" && window.ZGReprogramar ? iconBtn("zt-move", "Reprogramar", ICON.cal) : null;
    if (move) move.addEventListener("click", () => window.ZGReprogramar.open({ ...t, whenText: whenTask(t).toLowerCase() }, reloadTasks));
    if (t.kind === "entrega") { li.append(main); if (move) li.append(move); return li; }
    const done = iconBtn("zt-done", "Marcar como hecha", ICON.check);
    done.addEventListener("click", async () => {
      done.disabled = true;
      li.classList.add("is-checking");
      try {
        await call("/.netlify/functions/admin-tasks", { task: t.id });
        li.classList.add("is-done");
        setTimeout(() => removeRow(li, 1).then(() => { tasksCache = (tasksCache || []).filter((x) => x.id !== t.id); paintTasksHead(); }), reduced() ? 0 : 380);
      } catch (e) {
        li.classList.remove("is-checking");
        done.disabled = false;
        li.classList.add("is-shake");
        setTimeout(() => li.classList.remove("is-shake"), 500);
      }
    });
    li.append(main, ...(move ? [move] : []), done);
    return li;
  }

  let tasksCache = null, tasksBox = null, tasksHead = null, expanded = false;
  // Después de reprogramar: se vuelve a leer la lista (la fila deja de estar vencida).
  function reloadTasks() {
    if (!tasksBox) return;
    call("/.netlify/functions/admin-tasks").then((d) => { if (d.connected) paintTasks(d.tasks || [], tasksBox); }).catch(() => {});
  }
  function paintTasksHead() {
    if (!tasksHead) return;
    const urgent = (tasksCache || []).filter((t) => t.urgency === "vencida" || t.urgency === "hoy").length;
    tasksHead.textContent = urgent ? `${urgent} ${urgent === 1 ? "urgente" : "urgentes"}` : (tasksCache && tasksCache.length ? "Al día" : "");
    tasksHead.className = `zh-pill${urgent ? " is-hot" : " is-calm"}`;
    if (tasksCache && !tasksCache.length && tasksBox) tasksBox.replaceChildren(el("p", "zh-sub zt-empty", "Sin mezclas ni masters por delante en las próximas 3 semanas."));
  }
  function paintTasks(list, body) {
    tasksCache = list;
    if (!list.length) { paintTasksHead(); return; }
    const ul = el("ul", "zt-list");
    const shown = expanded ? list : list.slice(0, SHOW_TASKS);
    shown.forEach((t, i) => ul.append(taskRow(t, i)));
    body.replaceChildren(ul);
    if (list.length > SHOW_TASKS) {
      const more = el("button", "zh-more", expanded ? "Ver menos" : `Ver todas (${list.length})`);
      more.type = "button";
      more.addEventListener("click", () => { expanded = !expanded; paintTasks(tasksCache, body); });
      body.append(more);
    }
    paintTasksHead();
  }

  // ---------- Avisos ----------
  function noticeRow(r, i, onGone) {
    const what = r.kind === "mezcla" ? "la mezcla" : "el master";
    const kind = r.action === "cambios" ? "is-cambios" : r.final ? "is-final" : "is-ok";
    const li = el("li", `zn-row ${kind}`);
    li.style.animationDelay = `${120 + i * 60}ms`;
    const main = el("button", "zn-main");
    main.type = "button";
    const verb = r.action === "aprobada" ? `aprobó ${what}` : `pidió cambios en ${what}`;
    const top = el("span", "zn-top");
    top.append(el("span", "zn-tag", r.action === "cambios" ? "Cambios" : r.final ? "Master aprobado" : "Mezcla aprobada"), el("span", "zn-ago", ago(r.at)));
    const text = el("span", "zn-text");
    text.append(el("b", "", r.artist || "Un artista"), document.createTextNode(` ${verb} de «${r.song}»`));
    main.append(top, text);
    const hint = r.action === "cambios"
      ? (r.notes ? `${r.notes} ${r.notes === 1 ? "nota marcada" : "notas marcadas"} en el audio` : r.note ? `«${r.note.length > 90 ? r.note.slice(0, 90) + "…" : r.note}»` : "")
      : r.final ? "Listo para Distribución." : "Ya podés arrancar con el master.";
    if (hint) main.append(el("span", "zn-sub", hint));
    main.addEventListener("click", () => openProfileId(r.profile_id, r.song_id));
    const x = iconBtn(`zn-x${r.final ? " is-strong" : ""}`, "Borrar aviso", ICON.x);
    x.addEventListener("click", async () => {
      x.disabled = true;
      const gone = removeRow(li, 1);
      try { await call("/.netlify/functions/portal-reviews", { song: r.song_id }); onGone(r); }
      catch (e) { await gone; onGone(null); } // si falló, vuelve a aparecer en la próxima actualización
    });
    li.append(main, x);
    return li;
  }

  let noticesCache = [];
  function paintNotices(list, body, head) {
    noticesCache = list;
    badge(list.length);
    head.textContent = list.length ? String(list.length) : "";
    head.className = `zh-pill${list.some((r) => r.action === "cambios") ? " is-hot" : " is-calm"}`;
    head.hidden = !list.length;
    if (!list.length) { body.replaceChildren(el("p", "zh-sub zt-empty", "Sin avisos. Cuando un artista apruebe o te deje notas en una mezcla o un master, aparece acá.")); return; }
    // Primero lo que pide acción (cambios), después lo aprobado; lo más nuevo arriba.
    const order = (r) => (r.action === "cambios" ? 0 : r.final ? 2 : 1);
    const sorted = [...list].sort((a, b) => order(a) - order(b) || Date.parse(b.at) - Date.parse(a.at));
    const ul = el("ul", "zn-list");
    sorted.forEach((r, i) => ul.append(noticeRow(r, i, (gone) => {
      if (!gone) return;
      noticesCache = noticesCache.filter((x) => x.song_id !== gone.song_id);
      badge(noticesCache.length);
      head.textContent = noticesCache.length ? String(noticesCache.length) : "";
      head.hidden = !noticesCache.length;
      if (!noticesCache.length) paintNotices([], body, head);
    })));
    body.replaceChildren(ul);
  }

  // Cartel que se va solo: "✓ Mix Seu amor · Pazz — entregado solo".
  function autoNote(list, box) {
    const note = el("div", "zt-auto");
    note.setAttribute("role", "status");
    const names = list.slice(0, 3).map((d) => `${d.kind === "master" ? "Master" : "Mix"} ${d.song}${d.artist ? ` · ${d.artist}` : ""}`);
    const more = list.length > 3 ? ` y ${list.length - 3} más` : "";
    note.append(el("strong", null, list.length === 1 ? "Entregado solo" : `${list.length} entregas marcadas solas`), el("span", null, `${names.join(", ")}${more}. Ya está en Notion y el artista lo puede aprobar.`));
    box.querySelector(".zt-auto")?.remove();
    box.querySelector(".zh-top").after(note);
    setTimeout(() => { note.classList.add("is-out"); setTimeout(() => note.remove(), reduced() ? 0 : 420); }, 9000);
  }

  // ---------- Armado ----------
  let timer = null;
  function mount(slot) {
    const wrap = el("section", "zh-work");
    const tBox = el("div", "zh-box zt-box");
    const tTop = el("div", "zh-top");
    tasksHead = el("span", "zh-pill");
    tTop.append(el("h2", "zh-h2", "Mezclas y masters"), tasksHead);
    tasksBox = el("div", "zt-body");
    tasksBox.append(skeleton(3));
    tBox.append(tTop, tasksBox);

    const nBox = el("div", "zh-box zn-box");
    const nTop = el("div", "zh-top");
    const nHead = el("span", "zh-pill");
    nHead.hidden = true;
    nTop.append(el("h2", "zh-h2", "Avisos"), nHead);
    const nBody = el("div", "zn-body");
    nBody.append(skeleton(2));
    nBox.append(nTop, nBody);
    wrap.append(tBox, nBox);
    slot.replaceWith(wrap);

    const load = (first) => {
      call("/.netlify/functions/admin-tasks").then((d) => {
        if (!d.connected) { tasksBox.replaceChildren(el("p", "zh-sub", "Conectá Notion para ver tus tareas.")); return; }
        if (first || JSON.stringify(d.tasks) !== JSON.stringify(tasksCache)) paintTasks(d.tasks || [], tasksBox);
      }).catch(() => { if (first) tasksBox.replaceChildren(el("p", "zh-sub", "No pudimos leer tus tareas de Notion.")); });
      call("/.netlify/functions/portal-reviews").then((d) => {
        const list = d.reviews || [];
        if (first || JSON.stringify(list) !== JSON.stringify(noticesCache)) paintNotices(list, nBody, nHead);
      }).catch(() => { if (first) nBody.replaceChildren(el("p", "zh-sub", "No pudimos cargar los avisos.")); });
    };
    load(true);
    // Entregas automáticas: al abrir el Inicio se revisan ya las carpetas
    // (además de cada 15 minutos). Si subiste una mezcla o un master, se
    // marca entregado solo, su sesión se cierra y la lista se vuelve a leer.
    call("/.netlify/functions/admin-tasks", { sync: true }).then((d) => {
      const list = (d && d.delivered) || [];
      if (!list.length || !wrap.isConnected) return;
      load(false);
      autoNote(list, tBox);
    }).catch(() => {});
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && wrap.isConnected && !document.getElementById("panel-home").hidden) load(false); }, REFRESH_MS);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !tasksBox || !tasksBox.isConnected || document.getElementById("panel-home").hidden) return;
    // Volviste a la pestaña: se refresca en silencio.
    Promise.allSettled([call("/.netlify/functions/portal-reviews"), call("/.netlify/functions/admin-tasks")]).then(([n, t]) => {
      if (n.status === "fulfilled") { const box = document.querySelector(".zn-body"), head = document.querySelector(".zn-box .zh-pill"); if (box && JSON.stringify(n.value.reviews) !== JSON.stringify(noticesCache)) paintNotices(n.value.reviews || [], box, head); }
      if (t.status === "fulfilled" && t.value.connected && JSON.stringify(t.value.tasks) !== JSON.stringify(tasksCache)) paintTasks(t.value.tasks || [], tasksBox);
    });
  });

  function skeleton(n) {
    const box = el("div", "zh-skel");
    for (let i = 0; i < n; i++) box.append(el("i"));
    return box;
  }

  // Solo la pastilla de avisos, sin abrir el Inicio (al entrar al panel).
  async function refreshBadge() {
    try { const d = await call("/.netlify/functions/portal-reviews"); noticesCache = d.reviews || []; badge(noticesCache.length); } catch (e) { /* nada */ }
  }

  window.ZGAvisos = { mount, refreshBadge };
})();
