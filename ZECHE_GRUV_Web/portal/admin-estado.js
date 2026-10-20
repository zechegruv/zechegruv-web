// ZECHE GRUV — Panel de administrador: Estado del sistema.
// Dos partes:
//   - Tarjeta chica en el Inicio, abajo del saludo: un punto verde /
//     amarillo / rojo y "Todo funciona" o "1 servicio con problemas".
//     Revisa como mucho cada 10 minutos (aunque el Inicio se vuelva a
//     dibujar o se actualice solo): el resultado queda guardado en este
//     navegador y se reusa.
//   - Al tocarla se abre el detalle (#panel-estado): una fila por servicio
//     con su estado, la frase para vos y cuánto tardó; abajo las
//     automatizaciones programadas con "hace X min" y el último error
//     desplegable. Al abrirlo revisa de nuevo, y está "Volver a revisar".
// Todo sale de netlify/functions/admin-status.js, que nunca manda claves
// ni tokens: acá solo se muestran estados y frases.
(() => {
  const P = window.ZGPortal;
  const { db } = P;
  const URL_STATUS = "/.netlify/functions/admin-status";
  const CARD_EVERY_MS = 10 * 60 * 1000;
  const STORE_KEY = "zg-estado";
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const ICON = {
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    again: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"/></svg>',
  };

  // ---------- Hace cuánto ----------
  function ago(iso) {
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(m) || m < 1) return "recién";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }
  const agoMin = (m) => (m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`);

  // ---------- Revisión (una sola a la vez) ----------
  let cache = null;      // { at, data } de la última revisión que funcionó
  let inflight = null;
  try {
    const saved = JSON.parse((window.localStorage && window.localStorage.getItem(STORE_KEY)) || "null");
    if (saved && saved.at && saved.data) cache = saved;
  } catch (e) { /* navegador sin almacenamiento: se revisa al abrir */ }

  async function fetchStatus() {
    if (inflight) return inflight;
    inflight = (async () => {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(URL_STATUS, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.services) throw new Error(out.error || "estado");
      cache = { at: Date.now(), data: out };
      try { window.localStorage && window.localStorage.setItem(STORE_KEY, JSON.stringify(cache)); } catch (e) { /* sin almacenamiento */ }
      return out;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  // Qué decir en una línea: cuántos servicios con problemas, o la alerta.
  function headline(d) {
    const bad = (d.services || []).filter((s) => s.state === "atencion" || s.state === "caido").length;
    if (bad) return `${bad} ${bad === 1 ? "servicio" : "servicios"} con problemas`;
    if ((d.alerts || []).length) return "Las automatizaciones necesitan atención";
    return "Todo funciona";
  }

  // ---------- Tarjeta del Inicio ----------
  const cards = new Set();
  let lastError = false;
  function paintCard(c) {
    const d = cache && cache.data;
    c.dot.className = `zs-dot is-${lastError ? "unknown" : d ? d.overall : "loading"}`;
    if (lastError) { c.text.textContent = "No pudimos revisar el estado"; c.sub.textContent = "Tocá para probar de nuevo"; return; }
    if (!d) { c.text.textContent = "Revisando el sistema…"; c.sub.textContent = "Estado del sistema"; return; }
    c.text.textContent = headline(d);
    c.sub.textContent = `Estado del sistema · ${ago(d.checked_at || new Date(cache.at).toISOString())}`;
  }
  const paintCards = () => cards.forEach((c) => { if (c.node.isConnected) paintCard(c); else cards.delete(c); });

  function mountCard(slot) {
    const node = el("button", "zs-card");
    node.type = "button";
    const dot = el("span", "zs-dot is-loading");
    dot.setAttribute("aria-hidden", "true");
    const words = el("span", "zs-words");
    const text = el("span", "zs-text");
    const sub = el("span", "zs-sub");
    words.append(text, sub);
    const chev = el("span", "zs-chev");
    chev.innerHTML = ICON.chev;
    node.append(dot, words, chev);
    node.addEventListener("click", () => open());
    slot.replaceWith(node);
    const c = { node, dot, text, sub };
    cards.add(c);
    paintCard(c);
    // Como mucho cada 10 minutos: el Inicio se redibuja y se actualiza solo,
    // pero la revisión completa (8 servicios) no hace falta tan seguido.
    if (!cache || Date.now() - cache.at >= CARD_EVERY_MS || lastError) {
      fetchStatus().then(() => { lastError = false; }, () => { lastError = true; }).then(paintCards);
    }
  }

  // ---------- Detalle ----------
  const STATE = { ok: "Funciona", atencion: "Atención", caido: "Caído", sin_configurar: "Sin configurar" };
  const COUNT = {
    entregas: ["entrega marcada", "entregas marcadas"], avisos: ["aviso al artista", "avisos a artistas"],
    recordatorios: ["recordatorio", "recordatorios"], etapas: ["cambio de etapa", "cambios de etapa"],
    regla: ["mail de la regla de 15 días", "mails de la regla de 15 días"],
    lanzamientos: ["lanzamiento revisado", "lanzamientos revisados"], publicados: ["publicado", "publicados"], errores: ["con error", "con error"],
  };
  const summaryText = (s) => {
    const parts = Object.entries(s || {}).filter(([k, v]) => COUNT[k] && Number(v) > 0).map(([k, v]) => `${v} ${COUNT[k][v === 1 ? 0 : 1]}`);
    return parts.length ? parts.join(" · ") : "Sin novedades en la última corrida";
  };

  let view = null; // { root, again, lead, body }
  function shell(root) {
    const wrap = el("div", "zs");
    const back = el("button", "zs-back", "← Inicio");
    back.type = "button";
    back.addEventListener("click", () => P.openTab("home"));
    const head = el("header", "zs-head");
    const hl = el("div");
    const lead = el("p", "zh-lead zs-lead", "Revisando cada servicio…");
    hl.append(el("div", "zh-eyebrow", "Panel"), el("h1", "zh-title zs-title", "Estado del sistema"), lead);
    const again = el("button", "zh-btn is-orange zs-again");
    again.type = "button";
    again.innerHTML = ICON.again;
    again.append(el("span", "", "Volver a revisar"));
    again.addEventListener("click", () => recheck());
    head.append(hl, again);
    const body = el("div", "zs-body");
    wrap.append(back, head, body);
    root.replaceChildren(wrap);
    view = { root, again, lead, body, first: true };
  }

  function skeleton(n) {
    const box = el("div", "zh-skel");
    for (let i = 0; i < n; i++) box.append(el("i"));
    return box;
  }

  function serviceRow(s, i, animate) {
    const li = el("li", `zs-row is-${s.state}`);
    if (animate) li.style.animationDelay = `${60 + i * 40}ms`;
    const main = el("div", "zs-main");
    main.append(el("span", "zs-name", s.name), el("span", "zs-say", s.text));
    const side = el("div", "zs-side");
    side.append(el("span", `zs-pill is-${s.state}`, STATE[s.state] || s.state), el("span", "zs-ms", s.state === "sin_configurar" ? "—" : `${s.ms} ms`));
    li.append(main, side);
    return li;
  }

  function autoRow(a, i, animate) {
    const li = el("li", "zs-auto");
    if (animate) li.style.animationDelay = `${120 + i * 60}ms`;
    const top = el("div", "zs-auto-top");
    const name = el("div", "zs-main");
    name.append(el("span", "zs-name", a.name), el("span", "zs-say", `Corre sola ${a.every}`));
    const st = !a.last ? ["unknown", "Sin corridas"] : a.running ? ["running", "Corriendo"] : a.cut ? ["atencion", "Se cortó"] : a.last.ok ? ["ok", "Salió bien"] : ["caido", "Con error"];
    const side = el("div", "zs-side");
    side.append(el("span", `zs-pill is-${st[0]}`, st[1]), el("span", "zs-ms", a.last ? agoMin(a.minutes) : "—"));
    top.append(name, side);
    li.append(top);
    li.append(el("p", "zs-sum", a.last ? summaryText(a.last.summary) : "Todavía no hay corridas anotadas. La primera aparece cuando Netlify la corra."));
    if (a.lastError) {
      const btn = el("button", "zs-err-btn");
      btn.type = "button";
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = ICON.down;
      btn.append(el("span", "", `Último error · ${ago(a.lastError.at)}`));
      const box = el("div", "zs-err");
      box.hidden = true;
      box.append(el("span", "zs-err-when", new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(a.lastError.at))), el("p", "", a.lastError.error));
      btn.addEventListener("click", () => {
        const on = box.hidden;
        box.hidden = !on;
        btn.setAttribute("aria-expanded", on ? "true" : "false");
        btn.classList.toggle("is-open", on);
      });
      li.append(btn, box);
    }
    return li;
  }

  function paintDetail(d) {
    if (!view) return;
    const animate = view.first && !reduced();
    view.first = false;
    view.lead.textContent = `Revisado ${ago(d.checked_at)}. Cada servicio tiene 5 segundos para contestar.`;
    const parts = [];
    // Resumen grande arriba, con el mismo punto que la tarjeta.
    const hero = el("div", `zs-hero is-${d.overall}`);
    const dot = el("span", `zs-dot is-${d.overall}`);
    dot.setAttribute("aria-hidden", "true");
    hero.append(dot, el("span", "zs-hero-text", headline(d)));
    parts.push(hero);
    (d.alerts || []).forEach((a) => {
      const box = el("div", `zs-alert is-${a.level}`);
      box.setAttribute("role", "status");
      box.append(el("strong", "", a.level === "caido" ? "Atención" : "Para revisar"), el("span", "", a.text));
      parts.push(box);
    });
    const sBox = el("section", "zh-box zs-box");
    const sTop = el("div", "zh-top");
    sTop.append(el("h2", "zh-h2", "Servicios"), el("span", "zh-mono", `${(d.services || []).length} a la vez`));
    const ul = el("ul", "zs-list");
    (d.services || []).forEach((s, i) => ul.append(serviceRow(s, i, animate)));
    sBox.append(sTop, ul);
    parts.push(sBox);
    const aBox = el("section", "zh-box zs-box");
    const aTop = el("div", "zh-top");
    aTop.append(el("h2", "zh-h2", "Automatizaciones"));
    aBox.append(aTop);
    if (d.runsAvailable === false) aBox.append(el("p", "zh-sub", d.runsText || "No se pudieron leer las corridas."));
    else {
      const al = el("ul", "zs-list");
      (d.automations || []).forEach((a, i) => al.append(autoRow(a, i, animate)));
      aBox.append(al);
    }
    parts.push(aBox);
    view.body.replaceChildren(...parts);
    view.body.classList.remove("is-busy");
  }

  function paintFail() {
    if (!view) return;
    view.lead.textContent = "No pudimos revisar el estado.";
    const box = el("div", "zs-alert is-caido");
    box.append(el("strong", "", "No pudimos revisar"), el("span", "", "El panel no recibió respuesta. Puede ser la conexión: probá «Volver a revisar» en un momento."));
    view.body.replaceChildren(box);
    view.body.classList.remove("is-busy");
  }

  async function recheck() {
    if (!view) return;
    const btn = view.again;
    btn.disabled = true;
    btn.classList.add("is-busy");
    view.body.classList.add("is-busy");
    view.lead.textContent = "Revisando cada servicio…";
    try {
      const d = await fetchStatus();
      lastError = false;
      paintDetail(d);
    } catch (e) {
      lastError = true;
      paintFail();
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      paintCards();
    }
  }

  // Abre el detalle: muestra al toque lo último que se sabe y revisa de nuevo.
  function open() {
    const root = document.getElementById("panel-estado");
    if (!root) return Promise.resolve();
    P.showPanel("estado");
    shell(root);
    if (cache && cache.data && !lastError) paintDetail(cache.data);
    else view.body.replaceChildren(skeleton(4));
    return recheck();
  }

  window.ZGEstado = { mountCard, open };
})();
