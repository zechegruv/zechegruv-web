// ZG PASS — piezas compartidas por las páginas de entradas: formato de
// fechas y precios, y el dibujo de la entrada digital con su QR.
window.ZGPass = (() => {
  const TZ = "America/Argentina/Buenos_Aires";
  const KINDS = {
    show: { cls: "pass-show", logo: "/assets/camps/zeche-gruv-shows-logo.webp", alt: "ZECHE GRUV Shows & Open Mic", kicker: "Show + Open mic", note: "Mostrá este QR en la puerta. Cada entrada sirve para un solo ingreso." },
    camp: { cls: "pass-camp", logo: "/assets/camps/zeche-gruv-camp-logo.webp", alt: "ZECHE GRUV Camp", kicker: "Campamento creativo", note: "Mostrá este QR al llegar. Cada entrada sirve para un solo ingreso." },
  };
  const kindOf = (kind) => KINDS[kind] || KINDS.show;

  const clean = (text) => text.replace(/\./g, "").replace(/,/g, "");
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  // "Sáb 24 oct 2026" · "20:00 h"
  const fmtDate = (iso) => capital(clean(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))));
  const fmtTime = (iso) => `${new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} h`;
  const fmtMoney = (value) => `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value)}`;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function metaItem(label, value, sub, wide) {
    const wrap = el("div", wide ? "wide" : "");
    wrap.append(el("dt", "", label));
    const dd = el("dd", "", value);
    if (sub) dd.append(el("span", "", sub));
    wrap.append(dd);
    return wrap;
  }

  // El QR lleva solo la clave secreta de la entrada, en mayúsculas (así
  // el código sale menos denso y se lee más fácil). Corrección de errores
  // alta para que el sol del centro no impida la lectura.
  function qrSvg(token, dark) {
    const qr = window.qrcode(0, "H");
    qr.addData(`ZGP1.${String(token).toUpperCase()}`, "Alphanumeric");
    qr.make();
    const n = qr.getModuleCount();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
    svg.setAttribute("fill", dark);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Código QR de la entrada");
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }

  // event: datos del evento · ticket: { code, token, status, holder_name, type }
  function renderTicket(event, ticket, index, total) {
    const kind = kindOf(event.kind);
    const card = el("article", `pass ${kind.cls}`);

    const top = el("div", "pass-top");
    const brand = el("div", "pass-brand", "ZG PASS");
    brand.append(el("small", "", "ZECHE GRUV · RECORD LABEL"));
    top.append(brand, el("div", "pass-type", ticket.type));

    const logo = el("img", "pass-logo");
    logo.src = kind.logo;
    logo.alt = kind.alt;

    const main = el("div", "pass-main");
    const meta = el("dl", "pass-meta");
    meta.append(
      metaItem("Fecha", fmtDate(event.starts_at)),
      metaItem("Hora", fmtTime(event.starts_at)),
      metaItem("Lugar", event.venue_name || "", event.venue_address, true),
    );
    main.append(el("div", "pass-kicker", kind.kicker), el("h2", "pass-title", event.name), meta);

    const cut = el("div", "pass-cut");
    cut.append(el("i"), el("i"));

    const stub = el("div", "pass-stub");
    const qrBox = el("div", "pass-qr");
    const dark = kind.cls === "pass-camp" ? "#1b2311" : "#241105";
    const sun = el("img");
    sun.src = "/assets/mail/sol.png";
    sun.alt = "";
    qrBox.append(qrSvg(ticket.token, dark), sun);
    stub.append(el("div", "pass-holder-label", "Titular"), el("div", "pass-holder", ticket.holder_name), qrBox, el("div", "pass-id", ticket.code));
    if (ticket.status === "used") stub.append(el("div", "pass-used", "Ya utilizada"));
    stub.append(el("p", "pass-note", event.important_info || kind.note));
    const foot = el("div", "pass-foot");
    foot.append(el("span", "", `Entrada ${index} de ${total}`), el("span", "", "zechegruv.com"));
    stub.append(foot);

    card.append(top, logo, main, cut, stub);
    return card;
  }

  async function api(path, options) {
    const res = await fetch(`/.netlify/functions/${path}`, options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  return { kindOf, fmtDate, fmtTime, fmtMoney, el, metaItem, renderTicket, api };
})();
