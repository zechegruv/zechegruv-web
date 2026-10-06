// ZECHE GRUV — Portal: administración de ZG PASS (solo administrador).
// Recuento de entradas por evento, control de acceso con la cámara del
// celular, venta en puerta y bonificadas, listado de entradas e inscriptos
// al open mic. Todo pasa por netlify/functions/pass-admin.js, que es quien
// comprueba que la sesión sea de un administrador.
(() => {
  const P = window.ZGPortal;
  const { db, $, setMsg } = P;
  const { fmtDate, fmtTime, fmtMoney, el, renderTicket } = window.ZGPass;
  const JSQR_URL = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
  const STATE = { draft: "Borrador (no se ve)", published: "A la venta", closed: "Venta cerrada", cancelled: "Cancelado" };
  const ORIGIN = { mercadopago: "Mercado Pago", cash: "Efectivo", transfer: "Transferencia", none: "—" };

  let events = [];
  let current = null;   // evento elegido
  let tickets = [];     // entradas del evento (pestaña "Entradas")
  let view = "scan";
  let stream = null;    // cámara abierta
  let scanning = false;
  let pending = null;   // lo último que se leyó: { token } o { code }

  async function call(body) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch("/.netlify/functions/pass-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "No pudimos completar la operación.");
    return out;
  }

  // ---------- Evento y recuento ----------
  function stat(label, value, strong) {
    const box = el("div", strong ? "zgp-stat is-strong" : "zgp-stat");
    box.append(el("strong", "", value), el("span", "", label));
    return box;
  }

  function renderEvent() {
    const s = current.stats;
    $("zgpState").textContent = STATE[current.status] || current.status;
    $("zgpPublish").hidden = current.status === "cancelled";
    $("zgpPublish").textContent = current.status === "published" ? "Cerrar la venta" : "Publicar y abrir la venta";
    $("zgpStats").replaceChildren(
      stat("Capacidad", s.capacity),
      stat("Emitidas", s.issued, true),
      stat("Disponibles", s.available),
      stat("Ingresaron", s.used, true),
      stat("No ingresaron", s.issued - s.used),
      stat("Bonificadas", s.comp),
      stat("En puerta", s.door),
      stat("Reservadas sin pagar", s.held),
    );
    $("zgpMoney").replaceChildren(
      stat("Ingreso real", fmtMoney(s.revenue), true),
      stat(`Mercado Pago (${s.methods.mercadopago.tickets})`, fmtMoney(s.methods.mercadopago.amount)),
      stat(`Efectivo (${s.methods.cash.tickets})`, fmtMoney(s.methods.cash.amount)),
      stat(`Transferencia (${s.methods.transfer.tickets})`, fmtMoney(s.methods.transfer.amount)),
      stat("Valor nominal", fmtMoney(s.face_value)),
      stat("Descuentos y bonificaciones", fmtMoney(s.face_value - s.revenue)),
    );
    $("zgpType").replaceChildren(...current.ticket_types.map((t) => {
      const option = el("option", "", `${t.name} — ${fmtMoney(t.price)}`);
      option.value = t.id;
      return option;
    }));
    syncPrice();
  }

  async function load(keepId) {
    setMsg($("zgpStatus"), "Cargando…");
    try {
      events = (await call({ action: "events" })).events;
    } catch (err) {
      $("zgpBody").hidden = true;
      return setMsg($("zgpStatus"), err.message, true);
    }
    if (!events.length) { $("zgpBody").hidden = true; return setMsg($("zgpStatus"), "Todavía no hay eventos cargados."); }
    setMsg($("zgpStatus"), "");
    $("zgpEvent").replaceChildren(...events.map((e) => {
      const option = el("option", "", `${e.name} — ${fmtDate(e.starts_at)} ${fmtTime(e.starts_at)}`);
      option.value = e.id;
      return option;
    }));
    // Por defecto, el próximo evento.
    current = events.find((e) => e.id === keepId) || events.find((e) => Date.parse(e.starts_at) > Date.now() - 12 * 3600 * 1000) || events[events.length - 1];
    $("zgpEvent").value = current.id;
    $("zgpBody").hidden = false;
    renderEvent();
    showView(view);
  }

  function showView(name) {
    view = name;
    ["scan", "issue", "list", "mic"].forEach((v) => { $(`zgp-${v}`).hidden = v !== name; });
    document.querySelectorAll("#zgpTabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    if (name !== "scan") stopCamera();
    if (name === "list") loadTickets();
    if (name === "mic") loadMic();
  }

  // ---------- Control de acceso ----------
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No pudimos cargar el lector de QR. Revisá la conexión."));
    document.head.append(s);
  });

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $("zgpCamera").hidden = true;
    $("zgpScanBtn").textContent = "Abrir cámara";
  }

  async function startCamera() {
    setMsg($("zgpScanMsg"), "");
    $("zgpResult").hidden = true;
    try {
      if (!window.jsQR) await loadScript(JSQR_URL);
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (err) {
      stopCamera();
      return setMsg($("zgpScanMsg"), err.name === "NotAllowedError" ? "Tenés que permitir el uso de la cámara para escanear." : (err.message || "No pudimos abrir la cámara."), true);
    }
    const video = $("zgpVideo");
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("zgpCamera").hidden = false;
    $("zgpScanBtn").textContent = "Cerrar cámara";
    scanning = true;
    requestAnimationFrame(tick);
  }

  const canvas = document.createElement("canvas");
  function tick() {
    if (!scanning) return;
    // Si se cambió de pestaña del portal, la cámara se apaga.
    if ($("panel-pass").hidden) return stopCamera();
    const video = $("zgpVideo");
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 720 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const found = window.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
      if (found && found.data) {
        scanning = false;
        $("zgpCamera").hidden = true;
        const match = /^ZGP1\.([0-9A-F]{64})$/i.exec(found.data.trim());
        return check(match ? { token: match[1].toLowerCase() } : { token: "" });
      }
    }
    requestAnimationFrame(tick);
  }

  const RESULT = {
    ok: ["is-ok", "Entrada válida"],
    done: ["is-ok", "Ingreso registrado"],
    already_used: ["is-bad", "Entrada ya utilizada"],
    not_valid: ["is-bad", "Entrada anulada"],
    wrong_event: ["is-bad", "Es de otro evento"],
    unknown: ["is-bad", "QR no válido"],
  };

  function showResult(kind, data) {
    const [cls, title] = RESULT[kind] || RESULT.unknown;
    const box = $("zgpResult");
    box.className = `zgp-result ${cls}`;
    $("zgpResultTitle").textContent = title;
    $("zgpResultName").textContent = data.holder_name || "";
    const meta = [];
    if (data.code) meta.push(data.code);
    if (data.type) meta.push(data.comp ? `${data.type} · Bonificada` : data.type);
    if (kind === "ok" || kind === "done") meta.push(current.name);
    if (kind === "already_used" && data.used_at) meta.push(`Ingresó el ${fmtDate(data.used_at).toLowerCase()} a las ${fmtTime(data.used_at)}`);
    $("zgpResultMeta").textContent = meta.join("\n");
    $("zgpMark").hidden = kind !== "ok";
    $("zgpMark").disabled = false;
    $("zgpScanBtn").textContent = "Escanear otra";
    box.hidden = false;
    if (navigator.vibrate) navigator.vibrate(cls === "is-ok" ? 80 : [120, 80, 120]);
  }

  // Primer paso: ¿es válida? (no la marca todavía).
  async function check(what) {
    pending = what;
    setMsg($("zgpScanMsg"), "");
    if (!what.token && !what.code) return showResult("unknown", {});
    try {
      const out = await call({ action: "peek", event_id: current.id, ...what });
      showResult(out.result, out);
    } catch (err) {
      $("zgpResult").hidden = true;
      $("zgpScanBtn").textContent = "Escanear otra";
      setMsg($("zgpScanMsg"), err.message, true);
    }
  }

  // Segundo paso: marcar el ingreso. El servidor lo hace una sola vez
  // aunque dos celulares lo intenten a la vez.
  async function mark() {
    if (!pending) return;
    $("zgpMark").disabled = true;
    try {
      const out = await call({ action: "checkin", event_id: current.id, ...pending });
      showResult(out.result === "ok" ? "done" : out.result, out);
      if (out.result === "ok") { current.stats.used += 1; renderEvent(); }
    } catch (err) {
      $("zgpMark").disabled = false;
      setMsg($("zgpScanMsg"), err.message, true);
    }
  }

  // ---------- Venta en puerta / bonificadas ----------
  function syncPrice() {
    const type = current && current.ticket_types.find((t) => t.id === $("zgpType").value);
    const comp = $("zgpMethod").value === "comp";
    $("zgpPrice").value = comp ? 0 : type ? type.price : "";
    $("zgpPrice").disabled = comp;
    $("zgpIssueSubmit").textContent = comp ? "Emitir bonificada" : "Emitir entrada";
  }

  async function issue(ev) {
    ev.preventDefault();
    const body = {
      action: "issue",
      event_id: current.id,
      ticket_type_id: $("zgpType").value,
      quantity: Number($("zgpQty").value),
      first_name: $("zgpFirst").value.trim(),
      last_name: $("zgpLast").value.trim(),
      email: $("zgpEmail").value.trim(),
      method: $("zgpMethod").value,
      unit_price: $("zgpPrice").value,
    };
    if (!body.first_name || !body.last_name) return setMsg($("zgpIssueMsg"), "Completá nombre y apellido.", true);
    if (!(body.quantity >= 1)) return setMsg($("zgpIssueMsg"), "Revisá la cantidad.", true);
    $("zgpIssueSubmit").disabled = true;
    setMsg($("zgpIssueMsg"), "Emitiendo…");
    try {
      const out = await call(body);
      const mail = body.email ? (out.emailed ? ` Se la mandamos a ${body.email}.` : " No pudimos mandar el mail: mostrale el QR de la pantalla.") : "";
      setMsg($("zgpIssueMsg"), `Listo: orden ${out.number}, ${out.tickets.length} ${out.tickets.length > 1 ? "entradas" : "entrada"}, total ${fmtMoney(out.total)}.${mail}`);
      const eventView = { kind: current.kind, name: current.name, starts_at: current.starts_at, venue_name: current.venue_name };
      $("zgpIssued").replaceChildren(...out.tickets.map((t, i) => renderTicket(eventView, t, i + 1, out.tickets.length)));
      ["zgpFirst", "zgpLast", "zgpEmail"].forEach((id) => { $(id).value = ""; });
      $("zgpQty").value = 1;
      load(current.id);
    } catch (err) {
      setMsg($("zgpIssueMsg"), err.message, true);
    }
    $("zgpIssueSubmit").disabled = false;
  }

  // ---------- Entradas emitidas ----------
  function origin(t) {
    if (t.comp) return "Bonificada";
    return `${ORIGIN[t.method] || "—"}${t.channel === "door" ? " · puerta" : ""}`;
  }

  function renderTickets() {
    const q = $("zgpSearch").value.trim().toLowerCase();
    const rows = tickets.filter((t) => !q || `${t.code} ${t.holder_name} ${t.holder_email || ""}`.toLowerCase().includes(q));
    setMsg($("zgpListStatus"), tickets.length ? `${rows.length} de ${tickets.length} entradas.` : "Todavía no hay entradas emitidas para este evento.");
    $("zgpTable").querySelector("tbody").replaceChildren(...rows.map((t) => {
      const tr = el("tr");
      const holder = el("td", "", t.holder_name);
      if (t.holder_email) holder.append(el("small", "", t.holder_email));
      const action = el("td");
      if (t.status === "valid") {
        const button = el("button", "btn", "Marcar ingreso");
        button.type = "button";
        button.dataset.code = t.code;
        action.append(button);
      }
      tr.append(
        el("td", "zgp-code", t.code), holder, el("td", "", t.type), el("td", "", origin(t)), el("td", "", fmtMoney(t.price_paid)),
        el("td", t.status === "used" ? "zgp-in" : "", t.status === "used" ? `${fmtTime(t.used_at)}` : "—"), action,
      );
      return tr;
    }));
  }

  async function loadTickets() {
    setMsg($("zgpListStatus"), "Cargando…");
    try {
      tickets = (await call({ action: "tickets", event_id: current.id })).tickets;
      renderTickets();
    } catch (err) {
      setMsg($("zgpListStatus"), err.message, true);
    }
  }

  // ---------- Open mic ----------
  async function loadMic() {
    setMsg($("zgpMicStatus"), "Cargando…");
    try {
      const { signups } = await call({ action: "openmic", event_id: current.id });
      setMsg($("zgpMicStatus"), signups.length ? `${signups.length} ${signups.length > 1 ? "inscriptos" : "inscripto"}.` : "Todavía no se anotó nadie al open mic.");
      $("zgpMicTable").querySelector("tbody").replaceChildren(...signups.map((s) => {
        const tr = el("tr");
        tr.append(
          el("td", "", s.aka), el("td", "", s.song_title), el("td", "", s.tune_note), el("td", "", s.full_name),
          el("td", "", s.instagram ? `@${s.instagram}` : "—"), el("td", "", s.email),
          el("td", s.uploaded ? "" : "zgp-missing", s.uploaded ? s.file_name : "No terminó de subir"),
        );
        return tr;
      }));
    } catch (err) {
      setMsg($("zgpMicStatus"), err.message, true);
    }
  }

  // ---------- Eventos de la interfaz ----------
  $("zgpEvent").addEventListener("change", () => {
    current = events.find((e) => e.id === $("zgpEvent").value);
    stopCamera();
    $("zgpResult").hidden = true;
    $("zgpIssued").replaceChildren();
    renderEvent();
    showView(view);
  });
  $("zgpRefresh").addEventListener("click", () => load(current && current.id));
  $("zgpPublish").addEventListener("click", async () => {
    const next = current.status === "published" ? "closed" : "published";
    const question = next === "published"
      ? `¿Publicar “${current.name}” y abrir la venta en el sitio?`
      : `¿Cerrar la venta online de “${current.name}”? Las entradas ya emitidas siguen valiendo.`;
    if (!window.confirm(question)) return;
    try {
      await call({ action: "status", event_id: current.id, status: next });
      setMsg($("zgpBarMsg"), next === "published" ? "Evento publicado: ya se puede comprar." : "Venta cerrada.");
      load(current.id);
    } catch (err) {
      setMsg($("zgpBarMsg"), err.message, true);
    }
  });
  $("zgpTabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".tab");
    if (btn) showView(btn.dataset.view);
  });
  $("zgpScanBtn").addEventListener("click", () => { if (scanning) stopCamera(); else startCamera(); });
  $("zgpMark").addEventListener("click", mark);
  $("zgpManual").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = $("zgpCode").value.trim().toUpperCase();
    if (!code) return;
    stopCamera();
    check({ code });
  });
  $("zgpType").addEventListener("change", syncPrice);
  $("zgpMethod").addEventListener("change", syncPrice);
  $("zgpIssueForm").addEventListener("submit", issue);
  $("zgpSearch").addEventListener("input", renderTickets);
  $("zgpTable").addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-code]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await call({ action: "checkin", event_id: current.id, code: btn.dataset.code });
      await loadTickets();
      load(current.id);
    } catch (err) {
      btn.disabled = false;
      setMsg($("zgpListStatus"), err.message, true);
    }
  });

  window.ZGPassAdmin = {
    open() {
      P.showPanel("pass");
      load(current && current.id);
    },
  };
})();
