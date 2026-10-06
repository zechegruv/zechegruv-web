// ZG PASS — inscripción al open mic.
//   /pass/openmic/?e=<slug>              → pide el mail con el que se compró la entrada
//   /pass/openmic/?t=<clave de la orden> → entra directo (desde la entrada o el mail)
// Formulario y subida de la canción para quien ya compró su entrada. La
// canción va en partes, directo a la carpeta de ZECHE GRUV o, si el
// navegador no puede, a través del servidor.
(() => {
  const { fmtDate, fmtTime, el, api } = window.ZGPass;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const token = /^[0-9a-f]{64}$/.test(params.get("t") || "") ? params.get("t") : "";
  let slug = (params.get("e") || "").toLowerCase();
  // Con qué se identifica la persona en cada pedido al servidor.
  let ident = token ? { t: token } : null;
  const backUrl = () => (token ? `/pass/orden/?t=${token}` : slug ? `/pass/?e=${encodeURIComponent(slug)}` : "/pass/");
  const NOTES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
  const MAX_MB = 150;
  const CHUNK = 10 * 320 * 1024;  // 3,2 MB: múltiplo de 320 KB, como pide OneDrive
  let info = null;
  let busy = false;

  function showView(name) {
    ["loading", "state", "email", "form"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
  }

  function showState(title, text, toOrder) {
    $("stateTitle").textContent = title;
    $("stateText").textContent = text;
    $("stateBtn").href = toOrder ? backUrl() : "/pass/";
    $("stateBtn").textContent = toOrder && token ? "Ver mi entrada" : toOrder ? "Volver al evento" : "Ver eventos";
    showView("state");
  }

  function setMsg(text, isError) {
    $("micMsg").textContent = text || "";
    $("micMsg").classList.toggle("is-error", !!isError);
  }

  async function call(body) {
    const res = await api("pass-openmic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ident, ...body }) });
    if (!res.ok) throw new Error(res.data.error || "No pudimos completar la inscripción. Probá de nuevo.");
    return res.data;
  }

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
    reader.readAsDataURL(blob);
  });

  async function upload(file, started, code) {
    const progress = (done) => { $("uploadBar").style.width = `${Math.round((done / file.size) * 100)}%`; };
    if (started.mode === "simple") {
      await call({ action: "simple", code, data: await toBase64(file) });
      progress(file.size);
      return;
    }
    let direct = true;
    let offset = 0;
    let finalName = "";
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK, file.size) - 1;
      const part = file.slice(offset, end + 1);
      if (direct) {
        try {
          const res = await fetch(started.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${offset}-${end}/${file.size}` }, body: part });
          if (!res.ok) throw new Error(`OneDrive respondió ${res.status}`);
          const out = await res.json().catch(() => ({}));
          if (out.name) finalName = out.name;
          offset = end + 1;
          progress(offset);
          continue;
        } catch (err) {
          // Puede que la parte haya llegado igual: se pregunta desde dónde seguir.
          direct = false;
          const state = await call({ action: "status", uploadUrl: started.uploadUrl }).catch(() => null);
          const next = state && state.nextExpectedRanges && parseInt(state.nextExpectedRanges[0], 10);
          if (Number.isFinite(next)) { offset = next; progress(offset); }
          if (offset >= file.size) break;
          continue;
        }
      }
      const out = await call({ action: "chunk", uploadUrl: started.uploadUrl, start: offset, end, total: file.size, data: await toBase64(part) });
      if (out.name) finalName = out.name;
      offset = end + 1;
      progress(offset);
    }
    await call({ action: "done", code, name: finalName });
  }

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    const file = $("songFile").files[0];
    const note = $("tuneNote").value;
    const fields = {
      code: $("ticketSelect").value,
      full_name: $("fullName").value.trim(),
      aka: $("aka").value.trim(),
      instagram: $("instagram").value.trim(),
      email: $("email").value.trim().toLowerCase(),
      song_title: $("songTitle").value.trim(),
      tune_note: note === "Sin tune" ? note : `${note} ${$("tuneMode").value}`,
    };
    if (!fields.full_name || !fields.aka || !fields.instagram || !fields.song_title) return setMsg("Completá todos los datos.", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return setMsg("Ese mail no parece válido.", true);
    if (!note) return setMsg("Elegí la nota del tune.", true);
    if (!file) return setMsg("Elegí el archivo de tu canción.", true);
    if (!/\.(mp3|wav)$/i.test(file.name)) return setMsg("La canción tiene que ser un archivo MP3 o WAV.", true);
    if (file.size > MAX_MB * 1024 * 1024) return setMsg(`El archivo pesa más de ${MAX_MB} MB.`, true);

    busy = true;
    $("micSubmit").disabled = true;
    $("uploadProgress").hidden = false;
    $("uploadBar").style.width = "0";
    setMsg("Subiendo tu canción… No cierres esta página.");
    try {
      const started = await call({ action: "start", ...fields, file_name: file.name, file_size: file.size });
      await upload(file, started, fields.code);
      showState("¡Ya estás anotado!", `Recibimos “${fields.song_title}” de ${fields.aka}. Nos vemos en el open mic.`, true);
    } catch (err) {
      setMsg(err.message, true);
      $("uploadProgress").hidden = true;
      $("micSubmit").disabled = false;
    }
    busy = false;
  }

  function syncTune() { $("tuneMode").hidden = $("tuneNote").value === "Sin tune" || !$("tuneNote").value; }

  async function load() {
    const res = await api("pass-openmic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ident, action: "info" }) }).catch(() => ({ ok: false, status: 0, data: {} }));
    if (res.status === 404) {
      if (token) return showState("No encontramos tu compra.", "Para anotarte al open mic primero necesitás tu entrada.", false);
      $("emailMsg").textContent = "No encontramos una entrada comprada con ese mail para este evento. Revisá que sea el mismo mail que usaste al comprar.";
      $("emailMsg").classList.add("is-error");
      $("emailSubmit").disabled = false;
      return showView("email");
    }
    if (!res.ok) return showState("No pudimos cargar la inscripción.", "Revisá tu conexión y volvé a intentar en un momento.", true);
    info = res.data;
    if (!info.open) return showState("Inscripción cerrada.", info.closed_reason, true);
    const free = info.tickets.filter((t) => !(t.signup && t.signup.uploaded));
    if (!free.length) {
      const s = info.tickets[0].signup;
      return showState("¡Ya estás anotado!", `Recibimos “${s.song_title}” de ${s.aka}. Si necesitás cambiar algo, escribinos por Instagram (@zechegruv).`, true);
    }

    $("formIntro").textContent = `${info.event.name} · ${fmtDate(info.event.starts_at)}.`
      + (info.deadline ? ` Podés anotarte hasta el ${fmtDate(info.deadline).toLowerCase()} a las ${fmtTime(info.deadline)}.` : "");
    $("ticketSelect").replaceChildren(...free.map((t) => {
      const option = el("option", "", `${t.code} — ${t.holder_name}`);
      option.value = t.code;
      return option;
    }));
    $("ticketField").hidden = free.length < 2;
    $("tuneNote").replaceChildren(...["", ...NOTES, "Sin tune"].map((n) => {
      const option = el("option", "", n || "Elegí…");
      option.value = n;
      return option;
    }));
    $("fullName").value = info.buyer.name || "";
    $("email").value = info.buyer.email || "";
    syncTune();
    showView("form");
  }

  // Sin link de la orden: se elige el evento con open mic abierto y se
  // pide el mail de la compra.
  async function askEmail() {
    if (!slug) {
      const res = await api("pass-events").catch(() => ({ ok: false, data: {} }));
      const withMic = res.ok && (res.data.events || []).find((e) => e.openmic_open);
      if (!withMic) return showState("No hay open mic abierto.", "Cuando abramos la inscripción del próximo open mic la vas a encontrar acá.", false);
      slug = withMic.slug;
    }
    $("buyLink").href = `/pass/?e=${encodeURIComponent(slug)}`;
    showView("email");
  }

  $("emailForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const email = $("buyerEmail").value.trim().toLowerCase();
    $("emailMsg").classList.add("is-error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("emailMsg").textContent = "Ese mail no parece válido."; return; }
    $("emailMsg").textContent = "";
    $("emailSubmit").disabled = true;
    ident = { slug, email };
    load();
  });
  $("tuneNote").addEventListener("change", syncTune);
  $("micForm").addEventListener("submit", submit);
  if (ident) load();
  else askEmail();
})();
