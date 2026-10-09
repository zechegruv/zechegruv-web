// ZECHE GRUV — Portal: administración de ZG PASS (solo administrador).
// Recuento de entradas por evento, control de acceso con la cámara del
// celular, venta en puerta y bonificadas, listado de entradas e inscriptos
// al open mic. Todo pasa por netlify/functions/pass-admin.js, que es quien
// comprueba que la sesión sea de un administrador.
(() => {
  const P = window.ZGPortal;
  const { db, $, setMsg } = P;
  const { fmtDate, fmtTime, fmtMoney, el, renderTicket } = window.ZGPass;
  const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
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
    // Open mic y Carpetas son solo de los shows.
    const isShow = current.kind === "show";
    document.querySelectorAll('#zgpTabs [data-view="mic"], #zgpTabs [data-view="shows"]').forEach((b) => { b.hidden = !isShow; });
    if (!isShow && (view === "mic" || view === "shows")) view = "scan";
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
    $("zgpType").replaceChildren(...current.ticket_types.filter((t) => t.active !== false).map((t) => {
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
    paintPicker();
    $("zgpBody").hidden = false;
    renderEvent();
    showView(view);
  }

  // Tarjetas para elegir el evento (próximos primero; los pasados, más tenues).
  const STATE_SHORT = { draft: "Borrador", published: "A la venta", closed: "Venta cerrada", cancelled: "Cancelado" };
  function paintPicker() {
    const now = Date.now() - 12 * 3600 * 1000;
    const list = [...events].sort((a, b) => {
      const pa = Date.parse(a.starts_at) < now, pb = Date.parse(b.starts_at) < now;
      return pa - pb || (pa ? Date.parse(b.starts_at) - Date.parse(a.starts_at) : Date.parse(a.starts_at) - Date.parse(b.starts_at));
    });
    $("zgpEventPicker").replaceChildren(...list.map((e) => {
      const past = Date.parse(e.starts_at) < now;
      const b = el("button", `zgp-event${e.id === current.id ? " is-active" : ""}${past ? " is-past" : ""}`);
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", e.id === current.id ? "true" : "false");
      const top = el("span", "zgp-event-top");
      top.append(el("span", "zgp-event-kind", e.kind === "camp" ? "Campamento" : "Show"), el("span", `zgp-event-state is-${e.status}`, past ? "Pasado" : STATE_SHORT[e.status] || e.status));
      b.append(top, el("b", "", e.name), el("small", "", `${fmtDate(e.starts_at)} · ${fmtTime(e.starts_at)}`));
      b.addEventListener("click", () => {
        if (e.id === current.id) return;
        $("zgpEvent").value = e.id;
        $("zgpEvent").dispatchEvent(new Event("change"));
        paintPicker();
      });
      return b;
    }));
  }

  function showView(name) {
    view = name;
    ["scan", "issue", "list", "mic", "shows"].forEach((v) => { $(`zgp-${v}`).hidden = v !== name; });
    document.querySelectorAll("#zgpTabs .tab").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    if (name !== "scan") stopCamera();
    if (name === "list") loadTickets();
    if (name === "mic") loadMic();
    if (name === "shows") loadShows();
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
      checkin: $("zgpEnter").checked,
    };
    if (!body.first_name || !body.last_name) return setMsg($("zgpIssueMsg"), "Completá nombre y apellido.", true);
    if (!(body.quantity >= 1)) return setMsg($("zgpIssueMsg"), "Revisá la cantidad.", true);
    $("zgpIssueSubmit").disabled = true;
    setMsg($("zgpIssueMsg"), "Emitiendo…");
    try {
      const out = await call(body);
      const mail = body.email ? (out.emailed ? ` Se la mandamos a ${body.email}.` : " No pudimos mandar el mail: mostrale el QR de la pantalla.") : "";
      const entered = body.checkin ? " Ingreso registrado." : "";
      setMsg($("zgpIssueMsg"), `Listo: orden ${out.number}, ${out.tickets.length} ${out.tickets.length > 1 ? "entradas" : "entrada"}, total ${fmtMoney(out.total)}.${entered}${mail}`);
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
        // Borrar: saca la canción de la carpeta Open Mic y la inscripción del portal.
        const del = el("button", "link-btn zgp-del", "Borrar");
        del.type = "button";
        del.addEventListener("click", async () => {
          if (!window.confirm(`¿Borrar la inscripción de ${s.aka} (“${s.song_title}”)?\n\nSe borra la canción de la carpeta Open Mic y desaparece del portal. No se puede deshacer. Su entrada sigue valiendo y puede volver a anotarse.`)) return;
          del.disabled = true;
          try {
            const out = await call({ action: "openmic_delete", event_id: current.id, signup_id: s.id });
            await loadMic();
            setMsg($("zgpMicStatus"), out.file === "error" ? `Borramos la inscripción de ${s.aka}, pero no pudimos borrar el archivo de OneDrive: borralo a mano de la carpeta Open Mic.` : `Listo: borramos la inscripción y la canción de ${s.aka}.`, out.file === "error");
          } catch (err) {
            del.disabled = false;
            setMsg($("zgpMicStatus"), err.message, true);
          }
        });
        const td = el("td");
        td.append(del);
        tr.append(td);
        return tr;
      }));
    } catch (err) {
      setMsg($("zgpMicStatus"), err.message, true);
    }
  }

  // ---------- Carpetas y line up ----------
  // datetime-local trabaja en la hora de la compu: se pasa a ISO con su zona.
  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtSize = (b) => (b ? (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} GB` : `${(b / 1024 / 1024).toFixed(1)} MB`) : "—");
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let showsFor = null;
  let showsData = null;

  // Mensaje listo para mandarle al invitado por WhatsApp.
  const guestText = (g) => g.plural
    ? `Hola ${g.name}! Ya son parte del line up de ${current.name} (${fmtDate(current.starts_at)}). Suban sus pistas acá, sin usuario ni contraseña: ${g.link}\nEl link es solo de ustedes. Nos vemos en el escenario 🌞`
    : `Hola ${g.name}! Ya sos parte del line up de ${current.name} (${fmtDate(current.starts_at)}). Subí tus pistas acá, sin usuario ni contraseña: ${g.link}\nEl link es solo tuyo. Nos vemos en el escenario 🌞`;

  // Dónde va a quedar cada cosa en OneDrive.
  function paintPath() {
    const folder = $("zgpFolderName").value.trim() || "(carpeta de la edición)";
    $("zgpFolderPath").textContent = $("zgpRootFolder").value.trim()
      ? `📁 Carpeta madre / ${folder} / Open Mic · Shows / una carpeta por artista`
      : "Pegá la carpeta madre una sola vez: después cada edición arma sus carpetas sola.";
  }
  ["zgpRootFolder", "zgpFolderName"].forEach((id) => $(id).addEventListener("input", paintPath));
  // La carpeta madre se guarda sola, con su botón: se comprueba el link y se
  // arman en el momento las carpetas del evento elegido.
  $("zgpRootSave").addEventListener("click", async () => {
    const link = $("zgpRootFolder").value.trim();
    if (!link) return setMsg($("zgpRootMsg"), "Pegá el link de la carpeta madre.", true);
    $("zgpRootSave").disabled = true;
    setMsg($("zgpRootMsg"), "Comprobando el link y armando las carpetas…");
    try {
      const out = await call({ action: "root_save", event_id: current.id, root_folder_link: link });
      $("zgpRootSet").hidden = false;
      $("zgpRootEdit").hidden = true;
      $("zgpRootSet").querySelector("span").textContent = `✓ Conectada${out.name ? ` · ${out.name}` : ""}`;
      paintPath();
      setMsg($("zgpRootMsg"), out.folders_ok === false
        ? "La carpeta madre quedó guardada, pero no pudimos crear alguna carpeta adentro. Revisá que el link sea de “Puede editar”."
        : out.folders_ok ? `Listo: carpeta madre conectada y “${out.folder_name}” creada con Open Mic y Shows.` : "Listo: carpeta madre conectada.", out.folders_ok === false);
    } catch (err) {
      setMsg($("zgpRootMsg"), err.message, true);
    } finally {
      $("zgpRootSave").disabled = false;
    }
  });
  $("zgpRootFolder").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("zgpRootSave").click(); } });

  $("zgpRootChange").addEventListener("click", () => {
    $("zgpRootSet").hidden = true;
    $("zgpRootEdit").hidden = false;
    $("zgpRootFolder").focus();
    $("zgpRootFolder").select();
  });

  function paintGuests() {
    const data = showsData;
    $("zgpGuestList").replaceChildren(...data.guests.map((g) => {
      const li = el("li", "zgp-guest");
      const files = data.files.filter((f) => f.guest_id === g.id).length;
      const who = el("div", "zgp-guest-who");
      const nameRow = el("div", "zgp-guest-name");
      nameRow.append(el("strong", "", g.name), el("span", "zgp-tag", "Invitado"));
      who.append(nameRow, el("small", files ? "" : "zgp-missing", `${files ? `${files} ${files > 1 ? "archivos subidos" : "archivo subido"}` : "Todavía no subió nada"}${g.plural ? " · dúo o banda" : ""}${g.gift_session ? " · con sesión de regalo" : ""}`));
      const actions = el("div", "zgp-guest-actions");
      const copy = el("button", "btn btn-sm", "Copiar link");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(g.link); copy.textContent = "¡Copiado!"; } catch (e) { window.prompt("Copiá el link:", g.link); }
        setTimeout(() => { copy.textContent = "Copiar link"; }, 1800);
      });
      const wa = el("a", "btn btn-sm", "WhatsApp");
      wa.href = `https://wa.me/?text=${encodeURIComponent(guestText(g))}`;
      wa.target = "_blank";
      wa.rel = "noopener";
      const off = el("button", "link-btn", "Quitar");
      off.type = "button";
      off.addEventListener("click", async () => {
        if (!window.confirm(`¿Quitar a ${g.name} del line up? Su link deja de andar (lo que ya subió queda en la carpeta).`)) return;
        try {
          await call({ action: "guest_remove", event_id: current.id, guest_id: g.id });
          loadShows();
        } catch (err) { setMsg($("zgpGuestMsg"), err.message, true); }
      });
      actions.append(copy, wa, off);
      li.append(who, actions);
      return li;
    }));
    $("zgpGuestList").hidden = !data.guests.length;
    $("zgpGuestsSub").hidden = !data.guests.length;
  }

  async function loadShows() {
    const ev = current;
    showsFor = null;
    setMsg($("zgpShowsMsg"), "");
    setMsg($("zgpGuestMsg"), "");
    setMsg($("zgpShowsStatus"), "Cargando…");
    $("zgpShowsForm").hidden = true;
    document.querySelector(".zgp-guests").hidden = true;
    let data;
    try {
      data = await call({ action: "shows", event_id: ev.id });
    } catch (err) {
      return setMsg($("zgpShowsStatus"), err.message, true);
    }
    if (current !== ev) return;
    showsFor = ev.id;
    showsData = data;
    $("zgpShowsForm").hidden = false;
    document.querySelector(".zgp-guests").hidden = false;
    $("zgpRootFolder").value = data.root_folder_link || "";
    // Con la carpeta madre ya cargada, se muestra en una línea (y "Cambiar").
    $("zgpRootSet").hidden = !data.root_folder_link;
    $("zgpRootEdit").hidden = !!data.root_folder_link;
    setMsg($("zgpRootMsg"), "");
    $("zgpFolderName").value = data.folder_name_custom || data.folder_name;
    $("zgpShowsDeadline").value = toLocalInput(data.shows_deadline);
    paintPath();

    // Si todavía no se eligió a nadie, se proponen los del line up que tienen cuenta.
    const lineup = (data.lineup || []).map(norm);
    const chosen = new Set(data.chosen.length ? data.chosen : data.artists.filter((a) => lineup.includes(norm(a.name))).map((a) => a.id));
    const sorted = [...data.artists].sort((a, b) => (chosen.has(b.id) - chosen.has(a.id)) || (b.active - a.active) || a.name.localeCompare(b.name, "es"));
    $("zgpShowArtists").replaceChildren(...sorted.map((a) => {
      const label = el("label", a.active ? "check" : "check is-inactive");
      const input = el("input");
      input.type = "checkbox";
      input.value = a.id;
      input.checked = chosen.has(a.id);
      const sun = el("img", "zgp-sun");
      sun.src = "../assets/zeche-gruv-sol.webp";
      sun.alt = "";
      sun.title = "Artista del sello";
      label.append(input, sun, el("span", "", a.active ? a.name : `${a.name} (inactivo)`));
      if (data.notified.includes(a.id)) label.append(el("small", "zgp-notified", "· avisado"));
      return label;
    }));
    if (!data.chosen.length && chosen.size) setMsg($("zgpShowsMsg"), "Marcamos a los del line up que tienen cuenta. Revisá y guardá para habilitarles la subida.");
    paintGuests();

    // Pistas recibidas, y quién todavía no subió nada.
    const nameOf = Object.fromEntries([...data.artists.map((a) => [a.id, a.name]), ...data.guests.map((g) => [g.id, `${g.name} (invitado)`])]);
    const rows = data.files.map((f) => {
      const tr = el("tr");
      tr.append(el("td", "", nameOf[f.profile_id || f.guest_id] || "—"), el("td", "", f.file_name), el("td", "", fmtSize(f.file_size)), el("td", "", `${fmtDate(f.uploaded_at)} ${fmtTime(f.uploaded_at)}`));
      return tr;
    });
    const withFiles = new Set(data.files.map((f) => f.profile_id || f.guest_id));
    [...data.chosen, ...data.guests.map((g) => g.id)].filter((id) => !withFiles.has(id)).forEach((id) => {
      const tr = el("tr");
      tr.append(el("td", "", nameOf[id] || "—"), el("td", "zgp-missing", "Todavía no subió nada"), el("td", "", "—"), el("td", "", "—"));
      rows.push(tr);
    });
    $("zgpShowsTable").querySelector("tbody").replaceChildren(...rows);
    const n = data.files.length;
    setMsg($("zgpShowsStatus"), n ? `${n} ${n > 1 ? "archivos recibidos" : "archivo recibido"}.` : rows.length ? "Todavía no llegó ninguna pista." : "");
  }

  $("zgpShowsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!showsFor || showsFor !== current.id) return;
    const deadline = $("zgpShowsDeadline").value;
    const body = {
      action: "shows_save",
      event_id: current.id,
      root_folder_link: $("zgpRootFolder").value.trim(),
      folder_name: $("zgpFolderName").value.trim(),
      // Sin links propios: todo va a la carpeta de la edición, dentro de la madre.
      openmic_folder_link: "",
      shows_folder_link: "",
      shows_deadline: deadline ? new Date(deadline).toISOString() : null,
      artist_ids: [...$("zgpShowArtists").querySelectorAll("input:checked")].map((i) => i.value),
    };
    $("zgpShowsSave").disabled = true;
    setMsg($("zgpShowsMsg"), "Guardando y armando las carpetas en OneDrive…");
    try {
      const out = await call(body);
      await loadShows();
      const parts = ["Listo: guardado."];
      if (out.folders_ok === true) parts.push("Las carpetas ya están en OneDrive.");
      if (out.folders_ok === false) parts.push("Ojo: no pudimos armar alguna carpeta en OneDrive; revisá los links.");
      if (out.notified && out.notified.length) parts.push(`Les mandamos el mail para subir pistas a: ${out.notified.join(", ")}.`);
      setMsg($("zgpShowsMsg"), parts.join(" "), out.folders_ok === false);
    } catch (err) {
      setMsg($("zgpShowsMsg"), err.message, true);
    } finally {
      $("zgpShowsSave").disabled = false;
    }
  });

  $("zgpGuestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!showsFor || showsFor !== current.id) return;
    const folder = ""; // sube a su carpeta dentro de Shows (se crea sola)
    const name = $("zgpGuestName").value.trim();
    if (!name && !folder) return setMsg($("zgpGuestMsg"), "Poné el nombre artístico del invitado.", true);
    $("zgpGuestAdd").disabled = true;
    setMsg($("zgpGuestMsg"), "Creando el link…");
    try {
      const out = await call({ action: "guest_add", event_id: current.id, name, folder_link: folder, email: $("zgpGuestEmail").value.trim(), gift_session: $("zgpGuestGift").checked, plural: $("zgpGuestPlural").checked });
      $("zgpGuestName").value = "";
      $("zgpGuestEmail").value = "";
      $("zgpGuestGift").checked = false;
      $("zgpGuestPlural").checked = false;
      await loadShows();
      setMsg($("zgpGuestMsg"), out.emailed ? `Listo: le mandamos el link a ${out.guest.email}.` : `Listo: copiá el link de ${out.guest.name} o mandáselo por WhatsApp.`);
    } catch (err) {
      setMsg($("zgpGuestMsg"), err.message, true);
    } finally {
      $("zgpGuestAdd").disabled = false;
    }
  });

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
    // Publicar: primero el cartel para revisar todo (zgpass-eventos.js).
    if (next === "published" && window.ZGEventos) return window.ZGEventos.review(current);
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
    call,
    reload: (id) => load(id),
    get current() { return current; },
    get events() { return events; },
  };
})();
