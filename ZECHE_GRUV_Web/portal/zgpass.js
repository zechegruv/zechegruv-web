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

  function paintGuests() {
    const data = showsData;
    $("zgpGuestList").replaceChildren(...data.guests.map((g) => {
      const li = el("li", "zgp-guest");
      const files = data.files.filter((f) => f.guest_id === g.id).length;
      const who = el("div", "zgp-guest-who");
      who.append(el("strong", "", g.name), el("small", files ? "" : "zgp-missing", `${files ? `${files} ${files > 1 ? "archivos subidos" : "archivo subido"}` : "Todavía no subió nada"}${g.plural ? " · dúo o banda" : ""}${g.gift_session ? " · con sesión de regalo" : ""}`));
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
    $("zgpMicFolder").value = data.openmic_folder_link || "";
    $("zgpShowsFolder").value = data.shows_folder_link || "";
    $("zgpShowsDeadline").value = toLocalInput(data.shows_deadline);

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
      label.append(input, el("span", "", a.active ? a.name : `${a.name} (inactivo)`));
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
      openmic_folder_link: $("zgpMicFolder").value.trim(),
      shows_folder_link: $("zgpShowsFolder").value.trim(),
      shows_deadline: deadline ? new Date(deadline).toISOString() : null,
      artist_ids: [...$("zgpShowArtists").querySelectorAll("input:checked")].map((i) => i.value),
    };
    $("zgpShowsSave").disabled = true;
    setMsg($("zgpShowsMsg"), "Guardando y comprobando las carpetas…");
    try {
      await call(body);
      await loadShows();
      setMsg($("zgpShowsMsg"), "Listo: guardado.");
    } catch (err) {
      setMsg($("zgpShowsMsg"), err.message, true);
    } finally {
      $("zgpShowsSave").disabled = false;
    }
  });

  $("zgpGuestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!showsFor || showsFor !== current.id) return;
    const folder = $("zgpGuestFolder").value.trim();
    if (!folder) return setMsg($("zgpGuestMsg"), "Pegá el link de edición de la carpeta del invitado.", true);
    $("zgpGuestAdd").disabled = true;
    setMsg($("zgpGuestMsg"), "Abriendo la carpeta…");
    try {
      const out = await call({ action: "guest_add", event_id: current.id, folder_link: folder, email: $("zgpGuestEmail").value.trim(), gift_session: $("zgpGuestGift").checked, plural: $("zgpGuestPlural").checked });
      $("zgpGuestFolder").value = "";
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
