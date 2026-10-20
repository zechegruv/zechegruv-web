// ZG PASS — página de la orden: /pass/orden/?t=<clave de la orden>
// Acá vuelve la persona después de pagar en Mercado Pago, y acá apunta el
// link del mail. Muestra las entradas cuando el servidor confirma el pago;
// mientras tanto vuelve a consultar cada pocos segundos.
(() => {
  const { renderTicket, api } = window.ZGPass;
  const $ = (id) => document.getElementById(id);
  const ORDER_KEY = "zg-pass-orden";
  const POLL_MS = 3000;
  const POLL_MAX = 40;  // unos dos minutos

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || "";
  // Mercado Pago agrega estos datos al volver. Sirven para apurar la
  // confirmación; el servidor igual los comprueba con Mercado Pago.
  let paymentId = params.get("payment_id") || params.get("collection_id") || "";
  let mpStatus = params.get("status") || params.get("collection_status") || "";
  // La dirección se limpia (abajo), así que el número de pago se guarda en
  // esta pestaña: si la persona recarga, se sigue usando para confirmar.
  const PAY_KEY = `zg-pass-pago-${token.slice(0, 16)}`;
  try {
    if (/^\d+$/.test(paymentId)) sessionStorage.setItem(PAY_KEY, JSON.stringify({ paymentId, mpStatus }));
    else {
      const saved = JSON.parse(sessionStorage.getItem(PAY_KEY) || "null");
      if (saved && /^\d+$/.test(saved.paymentId)) { paymentId = saved.paymentId; mpStatus = saved.mpStatus || ""; }
    }
  } catch (e) { /* sin almacenamiento: se sigue solo con lo que traiga la dirección */ }
  let wantsPdf = params.get("pdf") === "1";  // se llega desde el botón "Descargar PDF" del mail
  let pdfName = "ZG-PASS.pdf";
  let tries = 0;

  function showView(name) {
    ["waiting", "state", "paid"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
  }

  // payUrl: link de pago de la orden mientras la reserva sigue viva. Con
  // él, "Volver a intentar" lleva al mismo pago de Mercado Pago (no a una
  // compra nueva, que reservaría otros lugares).
  function showState(number, title, text, eventSlug, payUrl) {
    $("stateNumber").textContent = number ? `Orden ${number}` : "ZG PASS";
    $("stateTitle").textContent = title;
    $("stateText").textContent = text;
    $("stateBtn").href = payUrl || (eventSlug ? `/pass/?e=${encodeURIComponent(eventSlug)}` : "/pass/");
    showView("state");
  }

  function showPaid(order) {
    try { localStorage.removeItem(ORDER_KEY); } catch (e) {}
    // Medición: la compra se cuenta una sola vez aunque recarguen la página.
    try {
      const key = `zg-medido-${order.number}`;
      if (window.zgTrack && !localStorage.getItem(key)) {
        window.zgTrack("purchase", { transaction_id: String(order.number), currency: "ARS", cantidad: order.tickets.length });
        localStorage.setItem(key, "1");
      }
    } catch (e) {}
    const many = order.tickets.length > 1;
    $("paidNumber").textContent = `Orden ${order.number}`;
    $("paidTitle").textContent = many ? "¡Tus entradas están confirmadas!" : "¡Tu entrada está confirmada!";
    $("paidText").textContent = `${many ? "Te las mandamos" : "Te la mandamos"} también a ${order.buyer_email}. Podés sacarle una captura de pantalla: el QR es lo que se muestra en la puerta.`;
    $("micBtn").hidden = !order.openmic_open;
    $("micBtn").href = `/pass/openmic/?t=${token}`;
    pdfName = `ZG-PASS-${order.tickets.length > 1 ? order.number : order.tickets[0].code}.pdf`;
    $("tickets").replaceChildren(...order.tickets.map((t, i) => renderTicket(order.event, t, i + 1, order.tickets.length)));
    showView("paid");
    if (wantsPdf) { wantsPdf = false; downloadPdf(); }
  }

  // ---------- Descarga en PDF ----------
  // Cada entrada se "fotografía" tal como se ve y va a una página del PDF.
  // Las dos herramientas que lo hacen se cargan recién cuando se piden.
  const PDF_LIBS = [
    ["html2canvas", "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"],
    ["jspdf", "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"],
  ];
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("sin conexión"));
    document.head.append(s);
  });

  async function downloadPdf() {
    const button = $("pdfBtn");
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Preparando PDF…";
    $("pdfMsg").textContent = "";
    try {
      await Promise.all(PDF_LIBS.filter(([name]) => !window[name]).map(([, src]) => loadScript(src)));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const MARGIN = 24;
      let pdf = null;
      for (const card of document.querySelectorAll("#tickets .pass")) {
        const canvas = await window.html2canvas(card, { scale: 3, backgroundColor: "#4B2509", logging: false });
        const w = card.offsetWidth, h = card.offsetHeight;
        const page = [w + MARGIN * 2, h + MARGIN * 2];
        if (!pdf) pdf = new window.jspdf.jsPDF({ unit: "pt", format: page, orientation: "portrait" });
        else pdf.addPage(page, "portrait");
        pdf.setFillColor(75, 37, 9);
        pdf.rect(0, 0, page[0], page[1], "F");
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, MARGIN, w, h);
      }
      pdf.save(pdfName);
    } catch (e) {
      $("pdfMsg").textContent = "No pudimos armar el PDF. Probá de nuevo o sacale una captura de pantalla a la entrada: sirve igual.";
      $("pdfMsg").classList.add("is-error");
    }
    button.disabled = false;
    button.textContent = "Descargar PDF";
  }

  async function check() {
    tries += 1;
    const query = `pass-order?t=${encodeURIComponent(token)}${paymentId && /^\d+$/.test(paymentId) ? `&payment_id=${paymentId}` : ""}`;
    const res = await api(query).catch(() => ({ ok: false, status: 0, data: {} }));
    if (res.status === 404) return showState("", "No encontramos esa orden.", "Revisá que el link esté completo. Si pagaste y no ves tu entrada, escribinos a zechegruv@gmail.com.", "");
    if (!res.ok) return retry(null);

    const order = res.data;
    $("waitNumber").textContent = `Orden ${order.number}`;
    const slug = order.event && order.event.slug;
    if (order.status === "paid") {
      // Si algo falla al dibujar la entrada, se sigue consultando en vez de
      // quedar trabado en "Estamos confirmando…".
      try { return showPaid(order); } catch (e) { console.error("ZG PASS: no se pudo mostrar la entrada", e); return retry(order); }
    }
    if (order.status === "refunded") return showState(order.number, "Esta orden fue reembolsada.", "Las entradas de esta compra ya no son válidas.", slug);
    if (order.status === "cancelled") return showState(order.number, "Esta orden fue cancelada.", "No se emitieron entradas para esta compra.", slug);
    if (order.status === "expired") return showState(order.number, "Se venció el tiempo para pagar.", "Los lugares se liberaron y no se te cobró nada. Si llegaste a pagar, el dinero se devuelve solo. Podés volver a intentarlo.", slug);
    // Mercado Pago avisó que no hubo pago (rechazo o "volver al sitio").
    if (mpStatus === "rejected" || mpStatus === "null") {
      if (tries >= 2) return showState(order.number, "El pago no se completó.", "No se te cobró nada. Tus lugares siguen reservados unos minutos: podés volver a intentarlo.", slug, safePayUrl(order.pay_url));
    } else if (!/^\d+$/.test(paymentId) && tries >= 2) {
      // Sin datos del pago no se sabe si pagó: no se afirma nada y se sigue
      // consultando, por si la confirmación llega en un rato.
      showState(order.number, "Todavía no vemos tu pago.", "Si ya pagaste, puede tardar unos minutos en confirmarse: no hace falta pagar de nuevo, la entrada te llega por mail. Si no llegaste a pagar, tus lugares siguen reservados unos minutos y podés volver a intentarlo.", slug, safePayUrl(order.pay_url));
    }
    retry(order);
  }

  // Solo se usa un link de pago de Mercado Pago (https).
  const safePayUrl = (url) => (/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(String(url || "")) ? url : "");

  function retry(order) {
    if (tries >= POLL_MAX) {
      return showState(order && order.number, "Todavía no pudimos confirmar tu pago.", "Si pagaste, tu entrada te va a llegar por mail en unos minutos. Si no llega, escribinos a zechegruv@gmail.com con el número de orden.", "");
    }
    setTimeout(check, POLL_MS);
  }

  $("pdfBtn").addEventListener("click", downloadPdf);
  if (!/^[0-9a-f]{64}$/.test(token)) {
    showState("", "No encontramos esa orden.", "Revisá que el link esté completo.", "");
  } else {
    // La dirección queda solo con la clave de la orden.
    history.replaceState(null, "", `${location.pathname}?t=${token}`);
    check();
  }
})();
