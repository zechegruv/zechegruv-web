// ZECHE GRUV — Portal: crear y editar eventos de ZG PASS (solo administrador).
// Formulario con los datos del evento, las entradas, el line up, el open
// mic y la carpeta de la edición. Un show nuevo arranca con los datos del
// último (lugar, entradas, capacidad, horarios…), así cada edición se arma
// cambiando solo lo que cambia. Antes de publicar, un cartel muestra todo
// para revisarlo. Todo pasa por netlify/functions/pass-admin.js.
(() => {
  const P = window.ZGPortal;
  const { db, $, setMsg } = P;
  const A = window.ZGPassAdmin;
  const { fmtDate, fmtTime, fmtMoney, el } = window.ZGPass;

  let editing = null;   // evento que se edita (null: uno nuevo)
  let flyerUrl = "";
  let touched = {};     // plazos que se cambiaron a mano (no se recalculan)

  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const localTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toLocalInput = (iso) => (iso ? `${localDate(iso)}T${localTime(iso)}` : "");
  const iso = (local) => (local ? new Date(local).toISOString() : null);

  // ---------- Tipos de entrada ----------
  function typeRow(t = {}) {
    const row = el("div", "ze-type");
    row.dataset.id = t.id || "";
    row.innerHTML = `
      <div class="field"><label>Tipo de entrada</label><input type="text" class="ze-type-name" maxlength="60" placeholder="General"></div>
      <div class="field"><label>Precio ($)</label><input type="number" class="ze-type-price" min="0" step="1" inputmode="numeric"></div>
      <div class="field ze-type-desc"><label>Aclaración (opcional)</label><input type="text" class="ze-type-description" maxlength="200" placeholder="Ej.: hasta el 15/10"></div>
      <label class="check ze-type-active"><input type="checkbox" class="ze-type-on"><span>A la venta</span></label>
      <button class="link-btn ze-type-remove" type="button">Quitar</button>`;
    row.querySelector(".ze-type-name").value = t.name || "";
    row.querySelector(".ze-type-price").value = t.price ?? "";
    row.querySelector(".ze-type-description").value = t.description || "";
    row.querySelector(".ze-type-on").checked = t.active !== false;
    row.querySelector(".ze-type-remove").addEventListener("click", () => {
      if ($("zeTypes").children.length > 1) row.remove();
    });
    return row;
  }

  // ---------- Abrir el formulario ----------
  // "#3" → "#4": el nombre del show nuevo sigue la numeración del anterior.
  const nextName = (name) => String(name || "").replace(/#\s*(\d+)\s*$/, (_, n) => `#${Number(n) + 1}`);
  const edition = (name) => { const m = String(name || "").match(/#\s*(\d+)\s*$/); return m ? `Edición ${m[1]}` : ""; };

  function fill(e, isNew) {
    $("zeName").value = e.name || "";
    $("zeKind").value = e.kind || "show";
    $("zeDate").value = !isNew && e.starts_at ? localDate(e.starts_at) : "";
    $("zeTime").value = e.starts_at ? localTime(e.starts_at) : "20:00";
    $("zeEnd").value = e.ends_at ? localTime(e.ends_at) : "";
    $("zeVenue").value = e.venue_name || "";
    $("zeAddress").value = e.venue_address || "";
    $("zeDescription").value = e.description || "";
    $("zeInfo").value = e.important_info || "";
    $("zeCapacity").value = e.capacity || 70;
    $("zeMax").value = e.max_per_buyer || 2;
    $("zeLineup").value = isNew ? "" : (e.lineup || []).join("\n");
    $("zeOpenmic").checked = !!e.openmic_enabled;
    $("zeOpenmicDeadline").value = isNew ? "" : toLocalInput(e.openmic_deadline);
    $("zeShowsDeadline").value = isNew ? "" : toLocalInput(e.shows_deadline);
    $("zeFolder").value = isNew ? edition(e.name) : e.folder_name || "";
    flyerUrl = isNew ? "" : e.image_url || "";
    paintFlyer();
    const types = (e.ticket_types && e.ticket_types.length ? e.ticket_types : [{ name: "General", price: "" }])
      .filter((t) => isNew ? t.active !== false : true)
      .map((t) => (isNew ? { ...t, id: null } : t));
    $("zeTypes").replaceChildren(...(types.length ? types : [{ name: "General" }]).map(typeRow));
    touched = { openmic: !isNew && !!e.openmic_deadline, shows: !isNew && !!e.shows_deadline };
  }

  const KIND_LABEL = { show: "Shows & Open Mic", camp: "Campamento Creativo" };
  const DEFAULT_NAME = { show: "ZECHE GRUV Shows & Open Mic #1", camp: "ZECHE GRUV Camp #1" };

  // Campamento: sin line up, open mic ni pistas.
  const syncKind = () => { $("zeShowBlock").hidden = $("zeKind").value !== "show"; };

  function openEditor(ev, kind) {
    editing = ev || null;
    const isNew = !ev;
    kind = ev ? ev.kind : kind || "show";
    // Un evento nuevo arranca con los datos del último de su mismo tipo.
    const last = [...(A.events || [])].filter((e) => e.kind === kind).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0];
    const base = ev || (last ? { ...last, name: nextName(last.name) } : { kind, name: DEFAULT_NAME[kind], openmic_enabled: kind === "show" });
    fill(base, isNew);
    $("zeKind").value = kind;
    syncKind();
    $("zeEyebrow").textContent = isNew ? `Nuevo · ${KIND_LABEL[kind] || "evento"}` : "Editar evento";
    $("zeTitle").textContent = isNew ? "Crear evento" : ev.name;
    $("zeLead").textContent = isNew
      ? (last ? `Arranca con los datos de “${last.name}”: cambiá lo que haga falta. Se guarda en borrador; nadie lo ve hasta que lo publiques.` : "Se guarda en borrador; nadie lo ve hasta que lo publiques.")
      : (ev.status === "published" ? "Está a la venta: los cambios se ven al instante en la página de entradas." : "Está en borrador: nadie lo ve hasta que lo publiques.");
    $("zeSave").textContent = isNew || ev.status !== "published" ? "Guardar borrador" : "Guardar cambios";
    $("zeReview").hidden = !!ev && ev.status === "published";
    setMsg($("zeMsg"), "");
    $("zgpBody").hidden = true;
    $("zgpStatus").hidden = true;
    document.querySelector(".zgp-head").hidden = true;
    $("zgpEditor").hidden = false;
    window.scrollTo(0, 0);
  }

  function closeEditor() {
    $("zgpEditor").hidden = true;
    $("zgpStatus").hidden = false;
    document.querySelector(".zgp-head").hidden = false;
    if (A.current) $("zgpBody").hidden = false;
  }

  // Al elegir la fecha, los plazos se proponen solos: ese día a las 13:00.
  function syncDeadlines() {
    const date = $("zeDate").value;
    if (!date) return;
    if (!touched.openmic) $("zeOpenmicDeadline").value = `${date}T13:00`;
    if (!touched.shows) $("zeShowsDeadline").value = `${date}T13:00`;
  }

  // ---------- Flyer ----------
  function paintFlyer() {
    $("zeFlyerImg").hidden = !flyerUrl;
    if (flyerUrl) $("zeFlyerImg").src = flyerUrl;
    $("zeFlyerRemove").hidden = !flyerUrl;
    $("zeFlyerBtn").textContent = flyerUrl ? "Cambiar flyer" : "Subir flyer";
  }

  async function uploadFlyer(file) {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    if (!ext) throw new Error("El flyer tiene que ser JPG, PNG o WebP.");
    if (file.size > 5 * 1024 * 1024) throw new Error("El flyer pesa más de 5 MB.");
    const path = `flyers/${Date.now()}.${ext}`;
    const { error } = await db.storage.from("events").upload(path, file, { contentType: file.type });
    if (error) throw new Error("No pudimos subir el flyer. ¿Ya corriste supabase/017_shows_carpetas.sql?");
    return db.storage.from("events").getPublicUrl(path).data.publicUrl;
  }

  // ---------- Guardar ----------
  function collect() {
    const date = $("zeDate").value;
    const time = $("zeTime").value;
    if (!$("zeName").value.trim()) throw new Error("Poné el nombre del evento.");
    if (!date || !time) throw new Error("Poné la fecha y la hora del evento.");
    const start = `${date}T${time}`;
    let end = null;
    if ($("zeEnd").value) {
      end = new Date(`${date}T${$("zeEnd").value}`);
      if (end <= new Date(start)) end.setDate(end.getDate() + 1); // termina después de medianoche
      end = end.toISOString();
    }
    const ticket_types = [...$("zeTypes").children].map((row) => ({
      id: row.dataset.id || null,
      name: row.querySelector(".ze-type-name").value.trim(),
      price: row.querySelector(".ze-type-price").value === "" ? NaN : Number(row.querySelector(".ze-type-price").value),
      description: row.querySelector(".ze-type-description").value.trim(),
      active: row.querySelector(".ze-type-on").checked,
    }));
    if (ticket_types.some((t) => !t.name || !(t.price >= 0))) throw new Error("Cada tipo de entrada necesita nombre y precio.");
    return {
      event: {
        kind: $("zeKind").value,
        name: $("zeName").value.trim(),
        starts_at: iso(start),
        ends_at: end,
        venue_name: $("zeVenue").value.trim(),
        venue_address: $("zeAddress").value.trim(),
        description: $("zeDescription").value.trim(),
        important_info: $("zeInfo").value.trim(),
        image_url: flyerUrl,
        capacity: Number($("zeCapacity").value),
        max_per_buyer: Number($("zeMax").value),
        lineup: $("zeKind").value === "show" ? $("zeLineup").value.split("\n").map((n) => n.trim()).filter(Boolean) : [],
        openmic_enabled: $("zeKind").value === "show" && $("zeOpenmic").checked,
        openmic_deadline: iso($("zeOpenmicDeadline").value),
        shows_deadline: iso($("zeShowsDeadline").value),
        folder_name: $("zeFolder").value.trim(),
      },
      ticket_types,
    };
  }

  async function save(thenReview) {
    let data;
    try { data = collect(); } catch (err) { return setMsg($("zeMsg"), err.message, true); }
    $("zeSave").disabled = $("zeReview").disabled = true;
    setMsg($("zeMsg"), "Guardando…");
    try {
      const out = await A.call({ action: "event_save", event_id: editing ? editing.id : undefined, ...data });
      await A.reload(out.id);
      closeEditor();
      setMsg($("zgpBarMsg"), editing ? "Cambios guardados." : data.event.kind === "show" ? "Evento creado en borrador. Completá las carpetas y quién sube pistas en la pestaña Carpetas." : "Evento creado en borrador.");
      if (thenReview) review(A.current);
    } catch (err) {
      setMsg($("zeMsg"), err.message, true);
    } finally {
      $("zeSave").disabled = $("zeReview").disabled = false;
    }
  }

  // ---------- Cartel para revisar antes de publicar ----------
  function review(ev) {
    if (!ev) return;
    const list = $("zgpReviewList");
    const row = (label, value) => { list.append(el("dt", "", label), el("dd", "", value || "—")); };
    list.replaceChildren();
    if (ev.image_url) {
      const img = el("img", "review-flyer");
      img.src = ev.image_url;
      img.alt = "";
      list.append(img);
    }
    row("Evento", ev.name);
    row("Fecha y hora", `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}${ev.ends_at ? ` a ${fmtTime(ev.ends_at)}` : ""}`);
    row("Lugar", [ev.venue_name, ev.venue_address].filter(Boolean).join(" · "));
    const types = ev.ticket_types.filter((t) => t.active !== false);
    row("Entradas", types.map((t) => `${t.name}: ${fmtMoney(t.price)}${t.description ? ` (${t.description})` : ""}`).join(" · "));
    row("Capacidad", `${ev.capacity} lugares · hasta ${ev.max_per_buyer} por persona`);
    row("Tipo", KIND_LABEL[ev.kind] || "Evento");
    if (ev.kind === "show") {
      row("Line up", (ev.lineup || []).join(" · "));
      row("Open mic", ev.openmic_enabled ? `Sí · inscripción hasta ${ev.openmic_deadline ? `${fmtDate(ev.openmic_deadline)} ${fmtTime(ev.openmic_deadline)}` : "la hora del evento"}` : "No");
      row("Pistas del line up hasta", ev.shows_deadline ? `${fmtDate(ev.shows_deadline)} ${fmtTime(ev.shows_deadline)}` : "la hora del evento");
    }
    row("Nota extra", ev.important_info);

    // Lo que falta: en rojo frena la publicación; en amarillo, solo avisa.
    const checks = [];
    if (Date.parse(ev.starts_at) < Date.now()) checks.push(["La fecha ya pasó.", true]);
    if (!ev.venue_name) checks.push(["Falta el lugar.", true]);
    if (!types.length) checks.push(["No hay ningún tipo de entrada a la venta.", true]);
    if (!ev.venue_address) checks.push(["Falta la dirección.", false]);
    if (!ev.description) checks.push(["No tiene descripción.", false]);
    if (!ev.image_url) checks.push(["No tiene flyer: se va a ver el logo de ZECHE GRUV Shows.", false]);
    if (ev.kind === "show" && !(ev.lineup || []).length) checks.push(["Todavía no tiene line up.", false]);
    $("zgpReviewChecks").replaceChildren(...checks.map(([text, blocking]) => el("li", blocking ? "is-blocking" : "", text)));
    $("zgpReviewChecks").hidden = !checks.length;
    $("zgpReviewPublish").disabled = checks.some(([, blocking]) => blocking);
    setMsg($("zgpReviewMsg"), "");
    $("zgpReview").dataset.id = ev.id;
    $("zgpReview").showModal();
  }

  $("zgpReviewEdit").addEventListener("click", () => {
    $("zgpReview").close();
    const ev = (A.events || []).find((e) => e.id === $("zgpReview").dataset.id);
    if (ev) openEditor(ev);
  });
  $("zgpReviewPublish").addEventListener("click", async () => {
    $("zgpReviewPublish").disabled = true;
    try {
      const id = $("zgpReview").dataset.id;
      await A.call({ action: "status", event_id: id, status: "published" });
      $("zgpReview").close();
      await A.reload(id);
      setMsg($("zgpBarMsg"), "Publicado: las entradas ya están a la venta en zechegruv.com/entradas.");
    } catch (err) {
      setMsg($("zgpReviewMsg"), err.message, true);
    } finally {
      $("zgpReviewPublish").disabled = false;
    }
  });

  // ---------- Eventos de la interfaz ----------
  $("zgpNew").addEventListener("click", () => $("zgpKind").showModal());
  $("zgpKindCancel").addEventListener("click", () => $("zgpKind").close());
  document.querySelectorAll("#zgpKind .kind-option").forEach((b) => b.addEventListener("click", () => {
    $("zgpKind").close();
    openEditor(null, b.dataset.kind);
  }));
  $("zeKind").addEventListener("change", syncKind);
  $("zgpEdit").addEventListener("click", () => { if (A.current) openEditor(A.current); });
  $("zeBack").addEventListener("click", closeEditor);
  $("zeAddType").addEventListener("click", () => $("zeTypes").append(typeRow({ name: "", active: true })));
  $("zeDate").addEventListener("change", syncDeadlines);
  $("zeOpenmicDeadline").addEventListener("input", () => { touched.openmic = true; });
  $("zeShowsDeadline").addEventListener("input", () => { touched.shows = true; });
  $("zgpEditor").addEventListener("submit", (event) => { event.preventDefault(); save(false); });
  $("zeReview").addEventListener("click", () => save(true));
  $("zeFlyerBtn").addEventListener("click", () => $("zeFlyerFile").click());
  $("zeFlyerRemove").addEventListener("click", () => { flyerUrl = ""; paintFlyer(); });
  $("zeFlyerFile").addEventListener("change", async () => {
    const file = $("zeFlyerFile").files[0];
    $("zeFlyerFile").value = "";
    if (!file) return;
    $("zeFlyerBtn").disabled = true;
    setMsg($("zeMsg"), "Subiendo flyer…");
    try {
      flyerUrl = await uploadFlyer(file);
      paintFlyer();
      setMsg($("zeMsg"), "");
    } catch (err) {
      setMsg($("zeMsg"), err.message, true);
    } finally {
      $("zeFlyerBtn").disabled = false;
    }
  });

  // ---------- Acceso de puerta ----------
  const doorText = (a, ev) => `Hola ${a.label}! Este es tu acceso a la puerta de ${ev.name} (${fmtDate(ev.starts_at)}): ${a.link}\nDesde ahí escaneás las entradas, vendés en puerta y ves el contador. Es solo para vos, no lo compartas.`;

  async function loadDoor() {
    const ev = A.current;
    setMsg($("zgpDoorMsg"), "Cargando…");
    try {
      const { access } = await A.call({ action: "door_list", event_id: ev.id });
      setMsg($("zgpDoorMsg"), access.length ? "" : "Todavía no hay links de puerta para este evento.");
      $("zgpDoorList").replaceChildren(...access.map((a) => {
        const li = el("li", "zgp-guest");
        const who = el("div", "zgp-guest-who");
        who.append(el("strong", "", a.label), el("small", "", "Scanner, venta en puerta y contador"));
        const actions = el("div", "zgp-guest-actions");
        const copy = el("button", "btn btn-sm", "Copiar link");
        copy.type = "button";
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(a.link); copy.textContent = "¡Copiado!"; } catch (e) { window.prompt("Copiá el link:", a.link); }
          setTimeout(() => { copy.textContent = "Copiar link"; }, 1800);
        });
        const wa = el("a", "btn btn-sm", "WhatsApp");
        wa.href = `https://wa.me/?text=${encodeURIComponent(doorText(a, ev))}`;
        wa.target = "_blank";
        wa.rel = "noopener";
        const off = el("button", "link-btn", "Dar de baja");
        off.type = "button";
        off.addEventListener("click", async () => {
          if (!window.confirm(`¿Dar de baja el acceso de ${a.label}? Su link deja de andar en el momento.`)) return;
          try { await A.call({ action: "door_remove", event_id: ev.id, access_id: a.id }); loadDoor(); } catch (err) { setMsg($("zgpDoorMsg"), err.message, true); }
        });
        actions.append(copy, wa, off);
        li.append(who, actions);
        return li;
      }));
    } catch (err) {
      setMsg($("zgpDoorMsg"), err.message, true);
    }
  }

  $("zgpDoorBtn").addEventListener("click", () => {
    if (!A.current) return;
    $("zgpDoorTitle").textContent = A.current.name;
    $("zgpDoorList").replaceChildren();
    $("zgpDoor").showModal();
    loadDoor();
  });
  $("zgpDoorClose").addEventListener("click", () => $("zgpDoor").close());
  $("zgpDoorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const label = $("zgpDoorLabel").value.trim();
    if (!label) return setMsg($("zgpDoorMsg"), "Poné el nombre de quien va a estar en la puerta.", true);
    $("zgpDoorAdd").disabled = true;
    try {
      await A.call({ action: "door_add", event_id: A.current.id, label });
      $("zgpDoorLabel").value = "";
      await loadDoor();
      setMsg($("zgpDoorMsg"), `Listo: copiá el link de ${label} o mandáselo por WhatsApp.`);
    } catch (err) {
      setMsg($("zgpDoorMsg"), err.message, true);
    } finally {
      $("zgpDoorAdd").disabled = false;
    }
  });

  window.ZGEventos = { review, openEditor };
})();
