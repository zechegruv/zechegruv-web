// ZECHE GRUV — Portal: "La escena". Al artista le aparece arriba el próximo
// evento del sello (show o campamento): primero como aviso, con el flyer,
// la fecha y el line up; a los segundos se achica solo a una franja fina,
// como la de entradas del sitio. Tocando la franja se vuelve a abrir. Si ya
// lo vio, la próxima vez entra directo como franja. Si el artista toca en
// esa fecha, el aviso se lo dice.
(() => {
  const TZ = "America/Argentina/Buenos_Aires";
  const SEEN_KEY = "zg-escena-vista";
  const SHOW_MS = 7000;
  const LOGOS = { show: "/assets/camps/zeche-gruv-shows-logo.webp", camp: "/assets/camps/zeche-gruv-camp-logo.webp" };
  const clean = (t) => t.replace(/[.,]/g, "");
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const fmtDate = (iso) => cap(clean(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))));
  const fmtTime = (iso) => `${new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} h`;
  const norm = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const seen = () => { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } };
  const markSeen = (slug) => { try { localStorage.setItem(SEEN_KEY, slug); } catch (e) { /* nada */ } };

  let started = false;
  async function start(profile) {
    if (started || !profile || profile.role !== "artist") return;
    started = true;
    let ev;
    try {
      const res = await fetch("/.netlify/functions/pass-events");
      const data = res.ok ? await res.json() : null;
      ev = data && (data.events || []).filter((e) => e.on_sale || e.sold_out).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
    } catch (e) { return; }
    if (!ev) return;

    const me = norm(profile.display_name);
    const plays = !!me && (ev.lineup || []).some((n) => norm(n) === me);
    const url = `/pass/?e=${encodeURIComponent(ev.slug)}`;
    const when = `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`;
    const kindLabel = ev.kind === "camp" ? "Campamento Creativo" : "Shows & Open Mic";

    // ---- Franja fina (como la del sitio) ----
    const bar = el("button", "escena-bar");
    bar.type = "button";
    bar.setAttribute("aria-label", `Ver ${ev.name}`);
    bar.append(
      el("span", "escena-bar-when", when),
      el("span", "escena-bar-name", plays ? `Tocás en ${ev.name}` : ev.name),
      el("span", "escena-bar-lineup", (ev.lineup || []).join(" · ")),
      el("span", "escena-bar-cta", "Ver evento"),
    );

    // ---- Aviso con flyer, fecha y line up ----
    const card = el("div", `escena-card${plays ? " is-mine" : ""}`);
    card.setAttribute("role", "status");
    const img = el("img", "escena-flyer");
    img.src = ev.image_url || LOGOS[ev.kind] || LOGOS.show;
    img.alt = "";
    if (!ev.image_url) img.classList.add("is-logo");
    const body = el("div", "escena-body");
    body.append(
      el("div", "escena-eyebrow", plays ? "¡Tocás en esta fecha!" : `Próximo evento del sello · ${kindLabel}`),
      el("div", "escena-name", ev.name),
      el("div", "escena-meta", [when, ev.venue_name].filter(Boolean).join(" · ")),
    );
    if ((ev.lineup || []).length) {
      const lineup = el("div", "escena-lineup");
      ev.lineup.forEach((n) => lineup.append(el("span", norm(n) === me ? "is-me" : "", n)));
      body.append(lineup);
    }
    const actions = el("div", "escena-actions");
    const go = el("a", "btn btn-primary", ev.sold_out ? "Ver evento" : plays ? "Compartí tu fecha" : "Conseguí tu entrada");
    go.href = url;
    go.target = "_blank";
    go.rel = "noopener";
    const later = el("button", "link-btn", "Ok");
    later.type = "button";
    actions.append(go, later);
    body.append(actions);
    const progress = el("i", "escena-progress");
    card.append(img, body, progress);

    document.body.append(card, bar);
    document.body.classList.add("has-escena");

    let timer = null;
    const collapse = () => {
      clearTimeout(timer);
      card.classList.remove("is-open");
      bar.classList.add("is-on");
      markSeen(ev.slug);
    };
    const expand = (auto) => {
      bar.classList.remove("is-on");
      card.classList.remove("is-open");
      void card.offsetWidth;
      card.classList.add("is-open");
      clearTimeout(timer);
      if (auto) timer = setTimeout(collapse, SHOW_MS);
    };
    // Mientras se lo mira (mouse encima), no se cierra.
    card.addEventListener("mouseenter", () => { clearTimeout(timer); card.classList.add("is-held"); });
    card.addEventListener("mouseleave", () => { card.classList.remove("is-held"); timer = setTimeout(collapse, 2500); });
    later.addEventListener("click", collapse);
    bar.addEventListener("click", () => expand(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && card.classList.contains("is-open")) collapse(); });

    // Ya lo vio: entra directo como franja.
    if (seen() === ev.slug) bar.classList.add("is-on");
    else setTimeout(() => expand(true), 600);
  }

  window.ZGEscena = { start };
})();
