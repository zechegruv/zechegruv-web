// ZG PASS — listado de eventos y compra de entradas.
// /pass/            → eventos a la venta
// /pass/?e=<slug>   → un evento, con el formulario de compra
//
// Acá solo se muestra y se pide: si hay lugar, cuánto cuesta y si el pago
// entró lo decide siempre el servidor.
(() => {
  const { kindOf, fmtDate, fmtTime, fmtMoney, el, metaItem, api } = window.ZGPass;
  const $ = (id) => document.getElementById(id);
  const ORDER_KEY = "zg-pass-orden";  // compra en curso: { url, expires_at }

  let current = null;  // evento que se está mostrando
  let qty = 1;

  function showView(name) {
    ["loading", "state", "list", "event"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
  }

  function showState(title, text, withButton) {
    $("stateTitle").textContent = title;
    $("stateText").textContent = text;
    $("stateBtn").hidden = !withButton;
    showView("state");
  }

  function setMsg(text) { $("buyMsg").textContent = text || ""; $("buyMsg").classList.add("is-error"); }

  // ---------- Listado ----------
  function renderList(events) {
    if (!events.length) {
      showState("Pronto, nuevas fechas.", "Ahora no hay entradas a la venta. Seguinos en Instagram (@zechegruv) para enterarte de la próxima.", false);
      return;
    }
    const list = $("eventList");
    list.replaceChildren(...events.map((e) => {
      const row = el("a", "event-row");
      row.href = `/pass/?e=${encodeURIComponent(e.slug)}`;
      const img = el("img");
      img.src = e.image_url || kindOf(e.kind).logo;
      img.alt = "";
      const body = el("div");
      body.append(
        el("div", "eyebrow", kindOf(e.kind).kicker),
        el("h2", "", e.name),
        el("p", "", `${fmtDate(e.starts_at)} · ${fmtTime(e.starts_at)} · ${e.venue_name || ""}`),
      );
      row.append(img, body, el("span", "btn btn-primary", e.sold_out ? "Agotado" : "Ver entradas"));
      return row;
    }));
    showView("list");
  }

  // ---------- Evento ----------
  function selectedType() {
    const id = $("typeSelect").value;
    return current.ticket_types.find((t) => t.id === id) || current.ticket_types[0];
  }

  function refreshTotals() {
    const type = selectedType();
    const max = current.few_left ? Math.min(current.max_per_buyer, current.few_left) : current.max_per_buyer;
    qty = Math.max(1, Math.min(qty, max));
    $("typeName").textContent = type.name;
    $("typePrice").textContent = fmtMoney(type.price);
    $("qtyValue").textContent = qty;
    $("qtyLess").disabled = qty <= 1;
    $("qtyMore").disabled = qty >= max;
    $("total").textContent = fmtMoney(type.price * qty);
  }

  function renderEvent(e) {
    current = e;
    const kind = kindOf(e.kind);
    document.title = `${e.name} — ZG PASS`;
    $("eventArt").src = e.image_url || kind.logo;
    $("eventArt").alt = e.image_url ? e.name : kind.alt;
    $("eventKicker").textContent = `ZG PASS / ${kind.kicker}`;
    $("eventName").textContent = e.name;
    $("eventMeta").replaceChildren(
      metaItem("Fecha", fmtDate(e.starts_at)),
      metaItem("Hora", fmtTime(e.starts_at)),
      metaItem("Lugar", e.venue_name || "", e.venue_address, true),
    );
    $("eventDescription").textContent = e.description || "";
    $("eventDescription").hidden = !e.description;
    $("eventInfo").textContent = e.important_info || "";
    $("eventInfo").hidden = !e.important_info;

    const canBuy = e.on_sale && e.ticket_types.length > 0;
    $("buyForm").hidden = !canBuy;
    $("closedBox").hidden = canBuy;
    if (canBuy) {
      $("typeSelect").replaceChildren(...e.ticket_types.map((t) => {
        const option = el("option", "", `${t.name} — ${fmtMoney(t.price)}`);
        option.value = t.id;
        return option;
      }));
      $("typeField").hidden = e.ticket_types.length < 2;
      const max = e.max_per_buyer;
      $("qtyHint").textContent = e.few_left
        ? `¡Últimas ${e.few_left}! Máximo ${max} por persona.`
        : `Máximo ${max} por persona.`;
      refreshTotals();
    } else {
      $("closedPill").textContent = e.sold_out ? "Agotado" : "Venta cerrada";
      $("closedText").textContent = e.sold_out
        ? "No quedan entradas para esta fecha."
        : "La venta online de este evento no está abierta.";
    }
    $("micNotice").hidden = !e.openmic_open;
    $("micLink").href = `/pass/openmic/?e=${encodeURIComponent(e.slug)}`;
    showResume();
    showView("event");
  }

  // Si quedó una compra sin terminar en este dispositivo, se ofrece volver.
  function showResume() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null"); } catch (e) {}
    const alive = saved && saved.url && Date.parse(saved.expires_at) > Date.now();
    if (saved && !alive) localStorage.removeItem(ORDER_KEY);
    $("resumeBox").hidden = !alive;
    if (alive) $("resumeLink").href = saved.url;
  }

  async function submit(ev) {
    ev.preventDefault();
    const firstName = $("firstName").value.trim();
    const lastName = $("lastName").value.trim();
    const email = $("email").value.trim().toLowerCase();
    const email2 = $("email2").value.trim().toLowerCase();
    if (!firstName || !lastName) return setMsg("Completá tu nombre y apellido.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("Ese mail no parece válido.");
    if (email !== email2) return setMsg("Los dos mails no coinciden. Revisalos: ahí te mandamos la entrada.");

    setMsg("");
    const button = $("buySubmit");
    button.disabled = true;
    button.textContent = "Reservando tu lugar…";
    const res = await api("pass-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: current.slug, ticket_type_id: selectedType().id, quantity: qty, first_name: firstName, last_name: lastName, email }),
    }).catch(() => ({ ok: false, data: {} }));

    if (!res.ok || !res.data.pay_url) {
      button.disabled = false;
      button.textContent = "Ir a pagar";
      setMsg(res.data.error || "No pudimos iniciar la compra. Revisá tu conexión y probá de nuevo.");
      if (res.data.code === "sold_out" || res.data.code === "closed") load();
      return;
    }
    try { localStorage.setItem(ORDER_KEY, JSON.stringify({ url: res.data.order_url, expires_at: res.data.expires_at })); } catch (e) {}
    button.textContent = "Te llevamos a Mercado Pago…";
    location.href = res.data.pay_url;
  }

  // ---------- Arranque ----------
  async function load() {
    const slug = new URLSearchParams(location.search).get("e");
    const res = await api(slug ? `pass-events?slug=${encodeURIComponent(slug)}` : "pass-events").catch(() => ({ ok: false, status: 0, data: {} }));
    if (!res.ok) {
      if (res.status === 404) return showState("No encontramos ese evento.", "Puede que el link esté mal escrito o que el evento ya haya pasado.", true);
      return showState("No pudimos cargar los eventos.", "Revisá tu conexión y volvé a intentar en un momento.", false);
    }
    if (slug) renderEvent(res.data);
    else renderList(res.data.events || []);
  }

  $("qtyLess").addEventListener("click", () => { qty -= 1; refreshTotals(); });
  $("qtyMore").addEventListener("click", () => { qty += 1; refreshTotals(); });
  $("typeSelect").addEventListener("change", refreshTotals);
  $("buyForm").addEventListener("submit", submit);
  // Al volver con el botón "atrás" desde Mercado Pago, el formulario se rehabilita.
  window.addEventListener("pageshow", (e) => { if (e.persisted) { $("buySubmit").disabled = false; $("buySubmit").textContent = "Ir a pagar"; showResume(); } });

  load();
})();
