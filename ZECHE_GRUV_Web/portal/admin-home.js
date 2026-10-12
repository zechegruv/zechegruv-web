// ZECHE GRUV — Panel de administrador: Inicio.
// Resumen del día con datos reales de Supabase (ZG PASS, artistas y
// lanzamientos) y accesos directos a la puerta, la venta en puerta y Gruvi.
// No cambia nada por sí solo: solo lee y abre las secciones de siempre.
(() => {
  const P = window.ZGPortal;
  const { db } = P;
  const { fmtDate, fmtTime, fmtMoney } = window.ZGPass;

  // Página de Gruvi en Claude (opción B). Mientras esté vacía, el botón dice "muy pronto".
  const GRUVI_URL = "";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const panel = () => document.getElementById("panel-home");
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function countUp(node, to, format) {
    const f = format || ((v) => String(v));
    if (reduced() || !to) { node.textContent = f(to || 0); return; }
    const start = performance.now(), dur = 900;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      node.textContent = f(Math.round(to * e));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Abre ZG PASS directo en una pestaña (Puerta, Entradas…).
  function openPass(view) {
    P.openTab("pass");
    if (!view) return;
    let tries = 0;
    const wait = setInterval(() => {
      const body = document.getElementById("zgpBody");
      const btn = document.querySelector(`#zgpTabs [data-view="${view}"]`);
      if ((body && !body.hidden && btn) || ++tries > 40) {
        clearInterval(wait);
        if (btn) btn.click();
      }
    }, 150);
  }

  function nextEvent(events) {
    const now = Date.now();
    return (events || [])
      .filter((e) => e.status !== "cancelled" && Date.parse(e.starts_at) > now - 12 * 3600 * 1000)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
  }

  function daysTo(iso) {
    const d = new Date(iso), t = new Date();
    d.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }

  function quick(label, hint, fn) {
    const b = el("button", "zh-q");
    b.type = "button";
    b.append(el("b", "", label), el("span", "", hint));
    b.addEventListener("click", fn);
    return b;
  }

  async function render() {
    const root = panel();
    const me = P.me;
    const first = ((me.display_name || me.full_name || "").trim().split(/\s+/)[0]) || "Yaco";
    const today = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" }).format(new Date());

    const wrap = el("div", "zh");
    const head = el("header", "zh-head");
    const hl = el("div");
    const lead = el("p", "zh-lead", "Cargando tu resumen…");
    hl.append(el("div", "zh-eyebrow", today), el("h1", "zh-title", `Buenas, ${first}.`), lead);
    head.append(hl);

    const grid = el("div", "zh-grid");
    const quickGrid = el("div", "zh-quick");
    quickGrid.append(
      quick("Escanear entradas", "Abrí la cámara en la puerta", () => openPass("door")),
      quick("Vender en puerta", "Emití entradas en el momento", () => openPass("door")),
      quick("Entradas", "Quién compró y quién entró", () => openPass("tickets")),
      quick("Eventos", "Crear, editar y publicar", () => openPass("summary")),
      quick("Artistas", "Perfiles, archivos y letras", () => P.openTab("artists")),
      quick("Lanzamientos", "Distribución y pitch", () => P.openTab("releases")),
    );

    const lower = el("div", "zh-grid");
    wrap.append(head, grid, el("h2", "zh-h2", "Accesos rápidos"), quickGrid, lower);
    root.replaceChildren(wrap);

    // Datos (en paralelo; si uno falla, el resto se muestra igual).
    const [evRes, artRes, relRes] = await Promise.allSettled([
      window.ZGPassAdmin.call({ action: "events" }),
      db.from("profiles").select("id, role, active"),
      db.from("releases").select("id, title, status, release_date, profiles (display_name, full_name)")
        .gte("release_date", new Date().toISOString().slice(0, 10)).order("release_date", { ascending: true }).limit(4),
    ]);

    // Próximo evento
    const ev = evRes.status === "fulfilled" ? nextEvent(evRes.value.events) : null;
    const evCard = el("section", "zh-card zh-event zh-wide");
    const sun = el("img", "zh-sun");
    sun.src = "../assets/zeche-gruv-sol.webp"; sun.alt = ""; sun.setAttribute("aria-hidden", "true");
    evCard.append(sun);
    if (ev) {
      const s = ev.stats || {};
      const dd = daysTo(ev.starts_at);
      const when = dd === 0 ? "Hoy" : dd === 1 ? "Mañana" : `En ${dd} días`;
      evCard.append(
        el("span", "zh-label", `${when} · ${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`),
        el("span", "zh-event-name", ev.name),
      );
      const num = el("span", "zh-num", "0");
      evCard.append(num, el("span", "zh-sub", `entradas emitidas de ${s.capacity || "—"}${s.held ? ` · ${s.held} reservadas esperando pago` : ""}${s.revenue ? ` · ${fmtMoney(s.revenue)} cobrados` : ""}`));
      const bar = el("div", "zh-bar"); const fill = el("i");
      fill.style.setProperty("--w", `${s.capacity ? Math.min(100, Math.round((s.issued || 0) / s.capacity * 100)) : 0}%`);
      bar.append(fill); evCard.append(bar);
      const row = el("div", "zh-row");
      const door = el("button", "zh-btn", dd <= 0 ? "Abrir la puerta" : "Ir a la puerta"); door.type = "button";
      door.addEventListener("click", () => openPass("door"));
      const tix = el("button", "zh-btn is-ghost", "Ver entradas"); tix.type = "button";
      tix.addEventListener("click", () => openPass("tickets"));
      row.append(door, tix); evCard.append(row);
      countUp(num, s.issued || 0);
      lead.textContent = dd === 0 ? `Hoy es ${ev.name}. La puerta está a un toque.` : `${when} es ${ev.name}.`;
    } else {
      evCard.append(el("span", "zh-label", "ZG PASS"), el("span", "zh-event-name", evRes.status === "fulfilled" ? "No hay eventos próximos" : "No pudimos cargar los eventos"));
      const row = el("div", "zh-row");
      const b = el("button", "zh-btn", "Crear evento"); b.type = "button";
      b.addEventListener("click", () => openPass("summary"));
      row.append(b); evCard.append(row);
      lead.textContent = "Todo tranquilo por ahora.";
    }

    // Artistas activos
    const arts = artRes.status === "fulfilled" && !artRes.value.error ? artRes.value.data.filter((p) => p.role === "artist") : null;
    const aCard = el("section", "zh-card");
    const aNum = el("span", "zh-num", arts ? "0" : "—");
    aCard.append(el("span", "zh-label", "Artistas con acceso al portal"), aNum, el("span", "zh-sub", arts ? `${arts.filter((p) => p.active === false).length} con el acceso pausado` : "No pudimos cargarlos"));
    const aRow = el("div", "zh-row");
    const aBtn = el("button", "zh-btn is-ghost", "Ver artistas"); aBtn.type = "button";
    aBtn.addEventListener("click", () => P.openTab("artists"));
    aRow.append(aBtn); aCard.append(aRow);
    if (arts) countUp(aNum, arts.filter((p) => p.active !== false).length);

    grid.append(evCard, aCard);

    // Próximos lanzamientos
    const rels = relRes.status === "fulfilled" && !relRes.value.error ? relRes.value.data : null;
    const rCard = el("section", "zh-card zh-wide");
    rCard.append(el("h2", "zh-h2", "Próximos lanzamientos"));
    if (rels && rels.length) {
      const ul = el("ul", "zh-list");
      rels.forEach((r) => {
        const li = el("li");
        const who = r.profiles ? (r.profiles.display_name || r.profiles.full_name || "") : "";
        li.append(el("span", "zh-date", fmtDate(r.release_date).replace(/ de \d{4}$|,? \d{4}$/, "")), el("span", "zh-what", `${r.title || "Sin título"}${who ? " · " + who : ""}`), el("span", "zh-tag", { draft: "Borrador", submitted: "Enviado", loaded: "Cargado", published: "Publicado" }[r.status] || ""));
        ul.append(li);
      });
      rCard.append(ul);
    } else {
      rCard.append(el("span", "zh-sub", rels ? "No hay lanzamientos con fecha por delante." : "No pudimos cargar los lanzamientos."));
    }

    // Gruvi
    const gCard = el("section", "zh-card zh-gruvi");
    const face = el("img", "zh-gruvi-face"); face.src = "../assets/gruvi.svg"; face.alt = "";
    const gText = el("div");
    gText.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0";
    gText.append(el("b", "", "Gruvi"), el("span", "zh-sub", "Hablale para agendar mezclas, mover entregas o registrar pagos en tu Notion y tu calendario."));
    const gBtn = el("button", "zh-btn is-orange", GRUVI_URL ? "Hablar con Gruvi" : "Muy pronto"); gBtn.type = "button";
    if (GRUVI_URL) gBtn.addEventListener("click", () => window.open(GRUVI_URL, "_blank", "noopener"));
    else gBtn.disabled = true;
    gText.append(gBtn);
    gCard.append(face, gText);

    lower.append(rCard, gCard);
  }

  window.ZGHome = {
    open() {
      P.showPanel("home");
      render().catch(() => {});
    },
    gruviUrl: GRUVI_URL,
  };
})();
