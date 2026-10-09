// ZG PASS — tarjeta para subir las pistas de un show. La usan el portal
// (portal/shows.js, artistas del sello) y la página de invitados
// (pass/pistas/, link único). Cada una pasa su forma de hablar con
// netlify/functions/portal-shows.js en "call". Solo se agrega: desde acá
// no se puede borrar ni reemplazar nada.
window.ZGPistas = (() => {
  const { fmtTime, el } = window.ZGPass;
  const TZ = "America/Argentina/Buenos_Aires";
  const CHUNK = 10 * 320 * 1024; // 3,2 MB: múltiplo de 320 KB, como pide OneDrive
  const MAX = 2048 * 1024 * 1024;
  const ACCEPT = ".wav,.mp3,.aif,.aiff,.flac,.m4a,.zip,.rar,.pdf,.txt";

  const day = (iso) => {
    const t = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" }).format(new Date(iso)).replace(",", "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const until = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");
  const size = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(0.1, b / 1024 / 1024).toFixed(1)} MB`);
  const setMsg = (node, text, isError) => { node.textContent = text || ""; node.classList.toggle("is-error", !!isError); };

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
    reader.readAsDataURL(blob);
  });

  // Sube un archivo en partes (directo a OneDrive o, si el navegador no
  // puede, a través del servidor). Devuelve el nombre con el que quedó.
  async function uploadOne(call, show, file, progress) {
    const base = { event_id: show.event_id, name: file.name };
    const started = await call({ action: "start", size: file.size, ...base });
    if (started.mode === "simple") {
      const out = await call({ action: "simple", data: await toBase64(file), ...base });
      progress(file.size);
      return out.name || file.name;
    }
    let direct = true;
    let offset = 0;
    let finalName = started.name || file.name;
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
    return finalName;
  }

  // Paso a paso de cómo mandar las pistas.
  function howTo(open, t) {
    const box = el("details", "pistas-how");
    box.open = open;
    box.append(el("summary", "", t("Cómo preparar y subir tus pistas", "Cómo preparar y subir sus pistas")));
    const steps = el("ol");
    [
      ["Una pista por tema.", t("Exportá cada canción por separado, en WAV si podés (24 bits, 48 kHz), tal como querés que suene esa noche.", "Exporten cada canción por separado, en WAV si pueden (24 bits, 48 kHz), tal como quieren que suene esa noche.")],
      [t("Nombralas en el orden del show.", "Nómbrenlas en el orden del show."), t("Así armamos tu setlist tal cual: “01 - Nombre del tema.wav”, “02 - …”. Si usás tune, sumá la nota: “01 - Nombre del tema - Do# menor.wav”.", "Así armamos su setlist tal cual: “01 - Nombre del tema.wav”, “02 - …”. Si usan tune, sumen la nota: “01 - Nombre del tema - Do# menor.wav”.")],
      [t("Subilas todas juntas.", "Súbanlas todas juntas."), t("Tocá el botón, elegí todos los archivos a la vez (o un ZIP con todo) y esperá a que cada uno aparezca con su ✓. No cierres la página mientras sube.", "Toquen el botón, elijan todos los archivos a la vez (o un ZIP con todo) y esperen a que cada uno aparezca con su ✓. No cierren la página mientras sube.")],
    ].forEach(([title, text]) => {
      const li = el("li");
      li.append(el("strong", "", title), document.createTextNode(` ${text}`));
      steps.append(li);
    });
    box.append(steps);
    return box;
  }

  // opts: { call, eyebrow, title, intro, plural }
  function card(show, opts) {
    const t = (one, many) => (opts.plural ? many : one);
    const box = el("div", "card welcome-card show-card");
    const sun = el("img", "welcome-sun");
    sun.src = "/assets/zeche-gruv-sol.webp";
    sun.alt = "";
    sun.setAttribute("aria-hidden", "true");
    const where = show.venue_name ? ` · ${show.venue_name}` : "";
    box.append(
      sun,
      el("div", "eyebrow", `${opts.eyebrow} · ${day(show.starts_at)} · ${fmtTime(show.starts_at)}${where}`),
      el("h2", "welcome-title", opts.title),
    );
    const body = el("div", "welcome-body");
    body.append(el("p", "", opts.intro));
    box.append(body);

    // Lo que ya subió.
    const list = el("ul", "show-files");
    const paint = (files) => {
      list.replaceChildren(...files.map((f) => {
        const li = el("li");
        li.append(el("span", "show-check", "✓"), el("span", "show-name", f.file_name), el("small", "", f.file_size ? size(f.file_size) : ""));
        return li;
      }));
      list.hidden = !files.length;
    };
    paint(show.files);
    box.append(list);

    if (!show.open) {
      box.append(el("p", "show-closed", show.closed_reason));
      return box;
    }

    box.append(howTo(!show.files.length, t));
    const msg = el("p", "msg");
    msg.setAttribute("role", "status");
    const input = el("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ACCEPT;
    input.hidden = true;
    const btn = el("button", "btn btn-primary", show.files.length ? "Subir más archivos" : t("Subir mis pistas", "Subir nuestras pistas"));
    btn.type = "button";
    const bar = el("div", "upload-progress");
    const fill = el("i");
    bar.append(fill);
    bar.hidden = true;
    const hint = el("p", "hint", `WAV, MP3, AIFF o FLAC, o un ZIP con todo (hasta 2 GB por archivo). ${t("Tenés", "Tienen")} tiempo hasta el ${until(show.deadline)} h. Desde acá no se puede borrar: si ${t("subiste algo por error, avisanos", "subieron algo por error, avísennos")}.`);
    const actions = el("div", "show-actions");
    actions.append(btn, bar, msg, hint);
    box.append(input, actions);

    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = [...input.files];
      input.value = "";
      if (!files.length) return;
      const bad = files.find((f) => !ACCEPT.split(",").includes((f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase()));
      if (bad) return setMsg(msg, `“${bad.name}” no se puede subir. ${t("Mandá", "Manden")} WAV, MP3, AIFF, FLAC o un ZIP.`, true);
      const big = files.find((f) => f.size > MAX || !f.size);
      if (big) return setMsg(msg, big.size ? `“${big.name}” pesa más de 2 GB. ${t("Partilo", "Pártanlo")} en varios.` : `“${big.name}” está vacío.`, true);

      const total = files.reduce((t, f) => t + f.size, 0);
      let before = 0;
      const done = [];
      btn.disabled = true;
      bar.hidden = false;
      fill.style.width = "0";
      try {
        for (const [i, file] of files.entries()) {
          setMsg(msg, `Subiendo ${files.length > 1 ? `${i + 1} de ${files.length}: ` : ""}${file.name}… ${t("No cierres", "No cierren")} esta página.`);
          const name = await uploadOne(opts.call, show, file, (sent) => { fill.style.width = `${Math.round(((before + sent) / total) * 100)}%`; });
          done.push({ name, size: file.size });
          before += file.size;
        }
      } catch (err) {
        setMsg(msg, `${err.message}${done.length ? ` (${done.length === 1 ? "El anterior sí llegó." : `Los ${done.length} anteriores sí llegaron.`})` : ""}`, true);
      }
      if (done.length) {
        await opts.call({ action: "done", event_id: show.event_id, files: done }).catch(() => null);
        show.files = show.files.concat(done.map((f) => ({ file_name: f.name, file_size: f.size })));
        paint(show.files);
        btn.textContent = "Subir más archivos";
        if (done.length === files.length) setMsg(msg, done.length > 1 ? `Listo: llegaron ${t("tus", "sus")} ${done.length} archivos. Nos vemos en el escenario.` : `Listo: llegó ${t("tu", "su")} archivo. Nos vemos en el escenario.`);
      }
      btn.disabled = false;
      bar.hidden = true;
    });
    return box;
  }

  return { card };
})();
