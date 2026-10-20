// ZECHE GRUV — Panel de administrador: Inicio (diseño del preview).
// Datos reales: ingresos del mes desde Notion (admin-ingresos), ZG PASS
// (entradas e inscriptos), artistas y lanzamientos de Supabase.
// Solo lee: los cambios se hacen en cada sección, como siempre.
(() => {
  const P = window.ZGPortal;
  const { db } = P;
  const { fmtDate, fmtTime, fmtMoney } = window.ZGPass;

  // Página de Gruvi. Mientras esté vacía, el botón flotante avisa que llega pronto.
  const GRUVI_URL = "";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const btn = (cls, text, fn) => { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", fn); return b; };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TZ = "America/Argentina/Buenos_Aires";
  // Una fecha sola ("2026-11-06") se lee como medianoche en Londres y en
  // Buenos Aires quedaba el día anterior. Se toma al mediodía de acá.
  const fmtDay = (d) => fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? `${d}T12:00:00-03:00` : d);

  function countUp(node, to, format) {
    const f = format || ((v) => String(v));
    if (reduced() || !to) { node.textContent = f(to || 0); return; }
    const start = performance.now(), dur = 1000;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      node.textContent = f(Math.round(to * e));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const bar = (pct) => { const b = el("div", "zh-bar"); const i = el("i"); i.style.setProperty("--w", `${Math.max(0, Math.min(100, pct))}%`); b.append(i); return b; };

  function openPass(view) {
    P.openTab("pass");
    if (!view) return;
    let tries = 0;
    const wait = setInterval(() => {
      const body = document.getElementById("zgpBody");
      const b = document.querySelector(`#zgpTabs [data-view="${view}"]`);
      if ((body && !body.hidden && b) || ++tries > 40) { clearInterval(wait); if (b) b.click(); }
    }, 150);
  }

  function nextEvent(events) {
    const now = Date.now();
    return (events || [])
      .filter((e) => e.status !== "cancelled" && Date.parse(e.starts_at) > now - 12 * 3600 * 1000)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
  }
  function daysTo(iso) {
    const f = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
    return Math.round((Date.parse(f(new Date(iso))) - Date.parse(f(new Date()))) / 86400000);
  }
  function weekLabel() {
    const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()) + "T12:00:00");
    const dow = today.getDay() || 7;
    const mon = new Date(today.getTime() - (dow - 1) * 86400000), fri = new Date(mon.getTime() + 4 * 86400000);
    const d = (x) => x.getDate();
    const m = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(fri);
    return `Semana del ${d(mon)} al ${d(fri)} de ${m}`;
  }

  async function ingresos() {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch("/.netlify/functions/admin-ingresos", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!res.ok) throw new Error("ingresos");
    return res.json();
  }

  function quick(label, hint, fn) {
    const b = btn("zh-q", "", fn);
    b.append(el("b", "", label), el("span", "", hint));
    return b;
  }

  async function render() {
    const root = document.getElementById("panel-home");
    const me = P.me;
    const first = ((me.display_name || me.full_name || "").trim().split(/\s+/)[0]) || "Yaco";

    const wrap = el("div", "zh");
    const head = el("header", "zh-head");
    const hl = el("div");
    const lead = el("p", "zh-lead", "Armando tu resumen…");
    // Estado del sistema (admin-estado.js): tarjeta chica abajo del saludo.
    const status = el("div");
    hl.append(el("div", "zh-eyebrow", weekLabel()), el("h1", "zh-title", `Buenas, ${first}.`), lead, status);
    head.append(hl, btn("zh-btn is-orange", "Abrir ZG PASS", () => openPass("summary")));

    const grid = el("div", "zh-grid");
    // 1) Ingresos del mes (Notion)
    const inc = el("section", "zh-card zh-wide");
    const incTop = el("div", "zh-top");
    const incLabel = el("span", "zh-label", "Ingresos del mes");
    const incGoal = el("span", "zh-mono", "");
    incTop.append(incLabel, incGoal);
    const incNum = el("span", "zh-num", "—");
    let incBarSlot = el("div");
    const incSub = el("span", "zh-sub", "Leyendo tu Notion…");
    const incRow = el("div", "zh-row"); // "Reintentar", si hace falta
    inc.append(incTop, incNum, incBarSlot, incSub);
    // Cambia la barra por otra (al reintentar, se reemplaza la anterior).
    const swap = (old, next) => { old.replaceWith(next); return next; };
    // 2) Artistas
    const art = el("section", "zh-card");
    const artNum = el("span", "zh-num", "—");
    const artSub = el("span", "zh-sub", "");
    art.append(el("span", "zh-label", "Artistas con acceso al portal"), artNum, artSub);
    // 3) Próximo evento (naranja)
    const evc = el("section", "zh-card zh-orange");
    const sun = el("img", "zh-sun"); sun.src = "../assets/zeche-gruv-sol.webp"; sun.alt = ""; sun.setAttribute("aria-hidden", "true");
    const evLabel = el("span", "zh-label", "ZG PASS");
    const evNum = el("span", "zh-num", "—");
    const evSub = el("span", "zh-sub", "");
    const evRow = el("div", "zh-row");
    evc.append(sun, evLabel, evNum, evSub, evRow);
    grid.append(inc, art, evc);

    // Accesos rápidos
    const qbox = el("section", "zh-box");
    const qgrid = el("div", "zh-quick");
    qgrid.append(
      quick("Escanear entradas", "La cámara en la puerta", () => openPass("door")),
      quick("Vender en puerta", "Emití entradas al toque", () => openPass("door")),
      quick("Entradas", "Quién compró y quién entró", () => openPass("tickets")),
      quick("Escenario", "Line up, pistas y open mic", () => openPass("stage")),
      quick("Artistas", "Perfiles, archivos y letras", () => P.openTab("artists")),
      quick("Lanzamientos", "Distribución y pitch", () => P.openTab("releases")),
    );
    qbox.append(el("h2", "zh-h2", "Accesos rápidos"), qgrid);

    // Lanzamientos + embudo del open mic
    const split = el("div", "zh-split");
    const rel = el("section", "zh-box");
    const relBody = el("div", "", "");
    rel.append(el("h2", "zh-h2", "Lo que viene"), relBody);
    const fun = el("section", "zh-box");
    const funBody = el("div", "zh-funnel");
    fun.append(el("h2", "zh-h2", "Del open mic al estudio"), funBody);
    split.append(rel, fun);

    // Hoy en el estudio: próximas tareas (Notion) y avisos de mezclas y
    // masters (admin-avisos.js), arriba de todo.
    const work = el("div");

    wrap.append(head, work, grid, qbox, split);
    root.replaceChildren(wrap);
    if (window.ZGAvisos) window.ZGAvisos.mount(work); else work.remove();
    if (window.ZGEstado) window.ZGEstado.mountCard(status); else status.remove();

    const [incRes, evRes, artRes, relRes] = await Promise.allSettled([
      ingresos(),
      window.ZGPassAdmin.call({ action: "events" }),
      db.from("profiles").select("id, role, active"),
      db.from("releases").select("id, title, status, release_date, profiles (display_name, full_name)")
        .gte("release_date", new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date())).order("release_date", { ascending: true }).limit(5),
    ]);

    // Ingresos
    // "Conectá Notion" solo si de verdad falta la conexión (admin-ingresos.js
    // → missing). Si Notion o la función fallaron un rato, se dice eso y se
    // puede reintentar sin recargar.
    const paintIngresos = (res) => {
      incRow.remove();
      incNum.style.fontSize = "";
      if (res.status === "fulfilled" && res.value.connected) {
        const v = res.value;
        incLabel.textContent = `Ingresos de ${v.month}`;
        incGoal.textContent = `meta ${fmtMoney(v.goal)}`;
        countUp(incNum, v.cobrado, fmtMoney);
        incBarSlot = swap(incBarSlot, bar(v.goal ? v.cobrado / v.goal * 100 : 0));
        incSub.textContent = `${v.pagos} ${v.pagos === 1 ? "pago" : "pagos"} · ${Math.round(v.goal ? v.cobrado / v.goal * 100 : 0)}% de la meta` + (v.pendiente ? ` · ${fmtMoney(v.pendiente)} por cobrar` : "") + (v.gastos ? ` · gastos ${fmtMoney(v.gastos)}` : "");
        return;
      }
      const v = res.status === "fulfilled" ? res.value : {};
      incGoal.textContent = v.goal ? `meta ${fmtMoney(v.goal)}` : "";
      incBarSlot = swap(incBarSlot, bar(0));
      incNum.style.fontSize = "30px";
      if (v.missing) {
        incNum.textContent = "Conectá Notion";
        incSub.textContent = v.problem === "not_shared"
          ? "Falta compartir la base “Gastos e ingresos” con la integración de Notion."
          : "Se llena solo con tu base “Gastos e ingresos” de Notion cuando la conectemos.";
        return;
      }
      incNum.textContent = "—";
      incSub.textContent = "No pudimos traer los ingresos, probá en un rato.";
      const again = btn("zh-btn is-ghost", "Reintentar", async () => {
        again.disabled = true;
        incSub.textContent = "Leyendo tu Notion…";
        paintIngresos(await ingresos().then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason })));
      });
      incRow.replaceChildren(again);
      inc.append(incRow);
    };
    paintIngresos(incRes);

    // Artistas
    const arts = artRes.status === "fulfilled" && !artRes.value.error ? artRes.value.data.filter((p) => p.role === "artist") : null;
    if (arts) {
      countUp(artNum, arts.filter((p) => p.active !== false).length);
      const paused = arts.filter((p) => p.active === false).length;
      artSub.textContent = paused ? `${paused} con el acceso pausado` : "Todos con acceso activo";
      art.append(el("div", "zh-row")); art.lastChild.append(btn("zh-btn is-ghost", "Ver artistas", () => P.openTab("artists")));
    } else artSub.textContent = "No pudimos cargarlos";

    // Próximo evento + embudo
    const ev = evRes.status === "fulfilled" ? nextEvent(evRes.value.events) : null;
    if (ev) {
      const s = ev.stats || {};
      const dd = daysTo(ev.starts_at);
      evLabel.textContent = `${ev.name} · ${fmtDate(ev.starts_at).replace(/,? \d{4}$/, "")}`;
      evNum.textContent = dd <= 0 ? "Hoy" : dd === 1 ? "Mañana" : `${dd} días`;
      // Se actualiza solo con cada venta: lo que entra por Mercado Pago (pass-mp-webhook) queda en ZG PASS.
      const mp = (s.methods && s.methods.mercadopago) || { tickets: 0, amount: 0 };
      evSub.textContent = `${s.issued || 0} de ${s.capacity || "—"} entradas · ${mp.tickets} por Mercado Pago (${fmtMoney(mp.amount)})${s.held ? ` · ${s.held} esperando pago` : ""}`;
      evRow.append(btn("zh-btn", dd <= 0 ? "Abrir la puerta" : "Ir a la puerta", () => openPass("door")));
      lead.textContent = dd <= 0 ? `Hoy es ${ev.name}. La puerta está a un toque.` : `${s.issued || 0} entradas emitidas y ${dd === 1 ? "mañana es" : `faltan ${dd} días para`} ${ev.name}.`;

      const row = (label, value, pct) => { const d = el("div"); const t = el("div", "zh-top"); t.append(el("span", "", label), el("span", "zh-mono", String(value))); d.append(t, bar(pct)); return d; };
      let signups = null;
      if (ev.openmic_enabled) {
        try { signups = ((await window.ZGPassAdmin.call({ action: "openmic", event_id: ev.id })).signups || []).length; } catch (e) { signups = null; }
      }
      const base = Math.max(s.issued || 0, signups || 0, 1);
      funBody.append(
        row("Entradas emitidas", s.issued || 0, (s.issued || 0) / base * 100),
        row("Se anotaron al open mic", signups === null ? "—" : signups, (signups || 0) / base * 100),
        row("Entraron al show", s.used || 0, (s.used || 0) / base * 100),
      );
      funBody.append(el("p", "zh-sub", "El seguimiento a las 48 h es lo que convierte a los que cantaron en artistas del estudio."));
    } else {
      evLabel.textContent = "ZG PASS";
      evNum.textContent = "Sin fecha";
      evSub.textContent = evRes.status === "fulfilled" ? "No hay eventos próximos." : "No pudimos cargar los eventos.";
      evRow.append(btn("zh-btn", "Crear evento", () => openPass("summary")));
      lead.textContent = "Todo tranquilo por ahora.";
      funBody.append(el("p", "zh-sub", "Aparece cuando haya un open mic a la venta."));
    }

    // Lo que viene: lanzamientos con fecha
    const rels = relRes.status === "fulfilled" && !relRes.value.error ? relRes.value.data : null;
    if (rels && rels.length) {
      const ul = el("ul", "zh-list");
      rels.forEach((r) => {
        const li = el("li");
        const who = r.profiles ? (r.profiles.display_name || r.profiles.full_name || "") : "";
        li.append(el("span", "zh-dot"), el("span", "zh-date", fmtDay(r.release_date).replace(/,? \d{4}$/, "")), el("span", "zh-what", `${r.title || "Sin título"}${who ? " · " + who : ""}`), el("span", "zh-tag", { draft: "Borrador", submitted: "Enviado", loaded: "Cargado", published: "Publicado" }[r.status] || "Lanzamiento"));
        ul.append(li);
      });
      relBody.replaceWith(ul);
    } else relBody.replaceWith(el("p", "zh-sub", rels ? "No hay lanzamientos con fecha por delante." : "No pudimos cargar los lanzamientos."));
  }

  // ---------- Gruvi flotante ----------
  function mountGruvi() {
    if (document.querySelector(".zg-fab")) return;
    const fab = el("div", "zg-fab");
    const bubble = el("div", "zg-fab-bubble", GRUVI_URL ? "Bora, Yaco. ¿Qué hacemos hoy?" : "Bora, Yaco. Muy pronto vas a poder hablarme acá.");
    bubble.setAttribute("role", "status");
    const b = el("button", "zg-fab-btn"); b.type = "button"; b.setAttribute("aria-label", "Hablar con Gruvi");
    const img = el("img"); img.src = "../assets/gruvi.svg"; img.alt = "";
    b.append(img);
    let shown = false;
    const hide = () => { bubble.remove(); shown = false; };
    b.addEventListener("click", () => {
      if (GRUVI_URL) { window.open(GRUVI_URL, "gruvi", "popup,width=440,height=720"); return; }
      if (shown) hide(); else { fab.prepend(bubble); shown = true; setTimeout(hide, 4000); }
    });
    fab.append(b);
    document.body.append(fab);
  }

  window.ZGHome = {
    open() {
      mountGruvi();
      P.showPanel("home");
      render().catch(() => {});
    },
    gruviUrl: GRUVI_URL,
  };
})();
