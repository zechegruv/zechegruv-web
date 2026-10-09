// ZG PASS — acceso de puerta de un evento.
//   /puerta?k=<clave>  (redirige a /pass/puerta/?k=…)
// Para quien controla la entrada: escanear QR, vender en puerta y ver el
// contador (totales, anticipadas, en puerta). Sin cuenta y sin acceso al
// resto del portal (netlify/functions/pass-door.js).
(() => {
  const { fmtDate, fmtTime, fmtMoney, el, renderTicket, api } = window.ZGPass;
  const $ = (id) => document.getElementById(id);
  const k = (new URLSearchParams(location.search).get("k") || "").toLowerCase();
  const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
  let info = null;
  let view = "scan";
  let stream = null;
  let scanning = false;
  let pending = null;

  const setMsg = (node, text, isError) => { node.textContent = text || ""; node.classList.toggle("is-error", !!isError); };
  const show = (name) => ["loading", "state", "pin", "main"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });

  // El código se guarda en este celular (si el navegador lo permite) para
  // no pedirlo de nuevo.
  const PIN_KEY = `zg-puerta-${k.slice(0, 16)}`;
  let pin = "";
  try { pin = localStorage.getItem(PIN_KEY) || ""; } catch (e) { /* sin almacenamiento: se pide cada vez */ }
  const savePin = (value) => { pin = value; try { if (value) localStorage.setItem(PIN_KEY, value); else localStorage.removeItem(PIN_KEY); } catch (e) { /* nada */ } };

  async function call(body) {
    const res = await api("pass-door", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, k, pin }) });
    if (!res.ok) {
      const err = new Error(res.data.error || "No pudimos completar la operación.");
      err.status = res.status;
      err.needPin = !!res.data.need_pin;
      throw err;
    }
    return res.data;
  }

  function askPin(message) {
    stopCamera();
    savePin("");
    $("pinInput").value = "";
    setMsg($("pinMsg"), message || "", !!message);
    show("pin");
    setTimeout(() => $("pinInput").focus(), 50);
  }

  // ---------- Evento y contador ----------
  function stat(label, value, strong) {
    const box = el("div", strong ? "zgp-stat is-strong" : "zgp-stat");
    box.append(el("strong", "", value), el("span", "", label));
    return box;
  }

  function paint() {
    const c = info.counts;
    $("doorStats").replaceChildren(
      stat("Entradas totales", c.issued, true),
      stat("Anticipadas", c.advance),
      stat("En puerta", c.door),
      stat("Ingresaron", c.used, true),
      stat("Quedan lugares", c.available),
    );
  }

  async function refresh() {
    try {
      info = await call({ action: "info" });
      paint();
    } catch (err) {
      if (err.needPin) askPin();
      else if ([404, 410, 423].includes(err.status)) { $("stateText").textContent = err.message; show("state"); }
    }
  }

  // ---------- Escanear ----------
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
    if (kind === "already_used" && data.used_at) meta.push(`Ingresó el ${fmtDate(data.used_at).toLowerCase()} a las ${fmtTime(data.used_at)}`);
    $("zgpResultMeta").textContent = meta.join("\n");
    $("zgpMark").hidden = kind !== "ok";
    $("zgpMark").disabled = false;
    $("zgpScanBtn").textContent = "Escanear otra";
    box.hidden = false;
    if (navigator.vibrate) navigator.vibrate(cls === "is-ok" ? 80 : [120, 80, 120]);
  }

  async function check(what) {
    pending = what;
    setMsg($("zgpScanMsg"), "");
    if (!what.token && !what.code) return showResult("unknown", {});
    try {
      const out = await call({ action: "peek", ...what });
      showResult(out.result, out);
    } catch (err) {
      if (err.needPin) return askPin();
      $("zgpResult").hidden = true;
      $("zgpScanBtn").textContent = "Escanear otra";
      setMsg($("zgpScanMsg"), err.message, true);
    }
  }

  async function mark() {
    if (!pending) return;
    $("zgpMark").disabled = true;
    try {
      const out = await call({ action: "checkin", ...pending });
      showResult(out.result === "ok" ? "done" : out.result, out);
      refresh();
    } catch (err) {
      $("zgpMark").disabled = false;
      setMsg($("zgpScanMsg"), err.message, true);
    }
  }

  // ---------- Venta en puerta ----------
  function syncTotal() {
    const type = info && info.ticket_types.find((t) => t.id === $("zgpType").value);
    const qty = Math.max(1, Number($("zgpQty").value) || 1);
    $("doorTotal").textContent = type ? `Total a cobrar: ${fmtMoney(type.price * qty)}` : "";
  }

  async function issue(event) {
    event.preventDefault();
    const body = {
      action: "issue",
      ticket_type_id: $("zgpType").value,
      quantity: Number($("zgpQty").value),
      first_name: $("zgpFirst").value.trim(),
      last_name: $("zgpLast").value.trim(),
      email: $("zgpEmail").value.trim(),
      method: $("zgpMethod").value,
      checkin: $("zgpEnter").checked,
    };
    if (!body.first_name || !body.last_name) return setMsg($("zgpIssueMsg"), "Completá nombre y apellido.", true);
    if (!(body.quantity >= 1)) return setMsg($("zgpIssueMsg"), "Revisá la cantidad.", true);
    $("zgpIssueSubmit").disabled = true;
    setMsg($("zgpIssueMsg"), "Emitiendo…");
    try {
      const out = await call(body);
      const mail = body.email ? (out.emailed ? ` Se la mandamos a ${body.email}.` : " No pudimos mandar el mail: mostrale el QR de la pantalla.") : "";
      setMsg($("zgpIssueMsg"), `Listo: ${out.tickets.length} ${out.tickets.length > 1 ? "entradas" : "entrada"}, total ${fmtMoney(out.total)}.${body.checkin ? " Ingreso registrado." : ""}${mail}`);
      const ev = info.event;
      $("zgpIssued").replaceChildren(...out.tickets.map((t, i) => renderTicket({ kind: ev.kind, name: ev.name, starts_at: ev.starts_at, venue_name: ev.venue_name }, t, i + 1, out.tickets.length)));
      ["zgpFirst", "zgpLast", "zgpEmail"].forEach((id) => { $(id).value = ""; });
      $("zgpQty").value = 1;
      syncTotal();
      refresh();
    } catch (err) {
      setMsg($("zgpIssueMsg"), err.message, true);
    }
    $("zgpIssueSubmit").disabled = false;
  }

  function showView(name) {
    view = name;
    $("door-scan").hidden = name !== "scan";
    $("door-issue").hidden = name !== "issue";
    document.querySelectorAll("#doorTabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    if (name !== "scan") stopCamera();
  }

  // ---------- Arranque ----------
  let started = false;
  async function start() {
    if (!/^[0-9a-f]{64}$/.test(k)) { $("stateText").textContent = "Revisá que hayas copiado el link completo."; return show("state"); }
    try {
      info = await call({ action: "info" });
    } catch (err) {
      if (err.needPin) return askPin(pin ? err.message : "");
      $("stateText").textContent = err.message;
      return show("state");
    }
    const ev = info.event;
    document.title = `Puerta · ${ev.name} — ZG PASS`;
    $("doorEyebrow").textContent = `ZG PASS / Puerta · ${info.door.label}`;
    $("doorTitle").textContent = ev.name;
    $("doorWhen").textContent = `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}${ev.venue_name ? ` · ${ev.venue_name}` : ""}`;
    $("zgpType").replaceChildren(...info.ticket_types.map((t) => {
      const option = el("option", "", `${t.name} — ${fmtMoney(t.price)}`);
      option.value = t.id;
      return option;
    }));
    syncTotal();
    paint();
    show("main");
    if (!started) setInterval(() => { if (!document.hidden && !$("view-main").hidden) refresh(); }, 20000); // el contador se actualiza solo
    started = true;
  }

  $("pinForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = $("pinInput").value.replace(/\D/g, "");
    if (value.length !== 4) return setMsg($("pinMsg"), "Son 4 números.", true);
    $("pinSubmit").disabled = true;
    pin = value;
    try {
      await call({ action: "info" });
      savePin(value);
      await start();
    } catch (err) {
      pin = "";
      if (err.needPin) setMsg($("pinMsg"), err.message || "Código incorrecto.", true);
      else { $("stateText").textContent = err.message; show("state"); }
    } finally {
      $("pinSubmit").disabled = false;
    }
  });

  $("doorTabs").addEventListener("click", (event) => { const b = event.target.closest(".tab"); if (b) showView(b.dataset.view); });
  $("zgpScanBtn").addEventListener("click", () => { if (scanning) stopCamera(); else startCamera(); });
  $("zgpMark").addEventListener("click", mark);
  $("zgpManual").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = $("zgpCode").value.trim().toUpperCase();
    if (!code) return;
    stopCamera();
    check({ code });
  });
  $("zgpType").addEventListener("change", syncTotal);
  $("zgpQty").addEventListener("input", syncTotal);
  $("zgpIssueForm").addEventListener("submit", issue);

  start();
})();
