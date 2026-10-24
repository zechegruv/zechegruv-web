// ZG PASS — tarjeta para subir las pistas de un show. La usan el portal
// (portal/shows.js, artistas del sello) y la página de invitados
// (pass/pistas/, link único). Cada una pasa su forma de hablar con
// netlify/functions/portal-shows.js en "call". Lo subido queda como
// borrador: se puede quitar y ordenar, guardar y, al final, enviar.
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

  const sentText = (iso) => {
    const t = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");
    return `${t} h`;
  };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // opts: { call, eyebrow, title, intro, plural }
  // Lo subido queda como borrador: se puede quitar y ordenar (el orden es el
  // del setlist), guardar, y al final "Enviar". Si cambia algo después de
  // enviar, vuelve a borrador hasta que lo envíe de nuevo.
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

    // Estado: archivos (en orden), cuándo se enviaron y si hay orden sin guardar.
    let files = show.files.slice();
    let saved = files.map((f) => f.id).join();
    let sentAt = show.sent_at || null;
    const canSend = show.can_send === true && show.open;
    let busy = false;
    let shown = new Set(files.map((f) => f.id || f.file_name)); // ya en pantalla (no se animan de nuevo)
    const dirty = () => files.map((f) => f.id).join() !== saved;

    const state = el("p", "show-state");
    state.setAttribute("aria-live", "polite");
    const list = el("ol", "show-files");
    const msg = el("p", "msg");
    msg.setAttribute("role", "status");
    const input = el("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ACCEPT;
    input.hidden = true;
    const upBtn = el("button", "btn", "");
    upBtn.type = "button";
    const saveBtn = el("button", "btn", "Guardar cambios");
    saveBtn.type = "button";
    const sendBtn = el("button", "btn btn-primary", "");
    sendBtn.type = "button";
    const bar = el("div", "upload-progress");
    const fill = el("i");
    bar.append(fill);
    bar.hidden = true;

    // Mueve un archivo en la lista con una transición suave (FLIP).
    function flip(mutate) {
      const before = new Map([...list.children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
      mutate();
      if (reduced()) return;
      [...list.children].forEach((li) => {
        const prev = before.get(li.dataset.id);
        if (prev === undefined) return;
        const dy = prev - li.getBoundingClientRect().top;
        if (!dy) return;
        li.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
      });
    }

    function paintState() {
      const editable = show.open && canSend;
      const isDirty = dirty();
      if (!files.length) state.textContent = "";
      else if (sentAt && !isDirty) state.textContent = `✓ ${t("Enviaste tus", "Enviaron sus")} pistas el ${sentText(sentAt)}.${editable ? ` Si ${t("cambiás", "cambian")} algo, ${t("volvé", "vuelvan")} a enviarlas.` : ""}`;
      else if (!show.open) state.textContent = sentAt ? "" : `${t("No llegaste", "No llegaron")} a enviarlas, pero lo que ${t("subiste", "subieron")} nos llegó igual.`;
      else if (editable) state.textContent = isDirty ? `Tenés cambios sin guardar.` : `Todavía no ${t("las enviaste", "las enviaron")}: ${t("ordenalas", "ordénenlas")} como van en el show y, cuando esté todo, ${t("tocá", "toquen")} “Enviar pistas”.`;
      else state.textContent = "";
      state.classList.toggle("is-sent", !!(sentAt && !isDirty));
      state.hidden = !state.textContent;
      saveBtn.hidden = !(editable && isDirty);
      sendBtn.hidden = !(editable && files.length);
      sendBtn.textContent = sentAt && !isDirty ? t("Enviadas ✓", "Enviadas ✓") : sentAt ? "Volver a enviar" : "Enviar pistas";
      sendBtn.disabled = busy || !!(sentAt && !isDirty);
      saveBtn.disabled = busy;
      upBtn.disabled = busy;
      upBtn.textContent = files.length ? "Subir más archivos" : t("Subir mis pistas", "Subir nuestras pistas");
      upBtn.classList.toggle("btn-primary", !files.length);
    }

    function paint() {
      const editable = show.open && canSend;
      list.replaceChildren(...files.map((f, i) => {
        const li = el("li");
        li.dataset.id = f.id || f.file_name;
        if (!shown.has(li.dataset.id)) li.classList.add("is-new"); // solo lo recién llegado entra animado
        li.append(el("span", "show-num", String(i + 1).padStart(2, "0")), el("span", "show-name", f.file_name), el("small", "", f.file_size ? size(f.file_size) : ""));
        if (editable && f.id) {
          const tools = el("span", "show-tools");
          const up = el("button", "show-tool", "↑");
          up.type = "button";
          up.title = "Subir en el orden";
          up.setAttribute("aria-label", `Subir ${f.file_name} en el orden`);
          up.disabled = busy || i === 0;
          const down = el("button", "show-tool", "↓");
          down.type = "button";
          down.title = "Bajar en el orden";
          down.setAttribute("aria-label", `Bajar ${f.file_name} en el orden`);
          down.disabled = busy || i === files.length - 1;
          const rm = el("button", "show-tool show-remove", "Quitar");
          rm.type = "button";
          rm.disabled = busy;
          const move = (to) => flip(() => { const [it] = files.splice(i, 1); files.splice(to, 0, it); paint(); });
          up.addEventListener("click", () => move(i - 1));
          down.addEventListener("click", () => move(i + 1));
          // Dos toques para quitar: el primero pide confirmar.
          let armed = null;
          rm.addEventListener("click", async () => {
            if (!armed) {
              rm.textContent = "¿Quitar?";
              rm.classList.add("is-armed");
              armed = setTimeout(() => { armed = null; rm.textContent = "Quitar"; rm.classList.remove("is-armed"); }, 3500);
              return;
            }
            clearTimeout(armed);
            await act(async () => {
              const out = await opts.call({ action: "remove", event_id: show.event_id, file_id: f.id });
              if (!reduced()) await li.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(12px)" }], { duration: 180, easing: "ease-in" }).finished.catch(() => {});
              // Se respeta el orden que estaba armando (aunque no lo haya guardado).
              const keep = files.map((x) => x.id).filter((id) => id !== f.id);
              files = sortLike(out.files, keep);
              saved = out.files.map((x) => x.id).join();
              sentAt = out.sent_at || null;
              flip(paint);
              setMsg(msg, `Quitamos “${f.file_name}”.`);
            });
          });
          tools.append(up, down, rm);
          li.append(tools);
        }
        return li;
      }));
      shown = new Set(files.map((f) => f.id || f.file_name));
      list.hidden = !files.length;
      paintState();
    }

    const sortLike = (fresh, ids) => {
      const at = new Map(ids.map((id, i) => [id, i]));
      return fresh.map((f, i) => ({ f, k: at.has(f.id) ? at.get(f.id) : 1e6 + i })).sort((a, b) => a.k - b.k).map((x) => x.f);
    };

    async function act(fn) {
      busy = true;
      paint();
      try { await fn(); }
      catch (err) { setMsg(msg, err.message, true); }
      busy = false;
      paint();
    }

    box.append(state, list);
    paint();

    if (!show.open) {
      box.append(el("p", "show-closed", show.closed_reason));
      return box;
    }

    box.append(howTo(!files.length, t));
    // Los formatos son los mismos que acepta ACCEPT (y el servidor).
    const hint = el("p", "hint", `WAV, MP3, AIFF, FLAC o M4A, o un ZIP o RAR con todo; también PDF o TXT (letras, setlist). Hasta 2 GB por archivo. ${t("Tenés", "Tienen")} tiempo hasta el ${until(show.deadline)} h para subir, ordenar y enviar.`);
    const buttons = el("div", "show-buttons");
    buttons.append(upBtn, saveBtn, sendBtn);
    const actions = el("div", "show-actions");
    actions.append(buttons, bar, msg, hint);
    box.append(input, actions);

    saveBtn.addEventListener("click", () => act(async () => {
      const out = await opts.call({ action: "save", event_id: show.event_id, order: files.map((f) => f.id) });
      files = out.files;
      saved = files.map((f) => f.id).join();
      sentAt = out.sent_at || null;
      setMsg(msg, "Cambios guardados.");
    }));

    sendBtn.addEventListener("click", () => act(async () => {
      const out = await opts.call({ action: "send", event_id: show.event_id, order: files.map((f) => f.id) });
      files = out.files;
      saved = files.map((f) => f.id).join();
      sentAt = out.sent_at || new Date().toISOString();
      setMsg(msg, `¡Listo! ${t("Tus", "Sus")} pistas nos llegaron en este orden. Nos vemos en el escenario.`);
      if (!reduced()) box.animate([{ boxShadow: "0 0 0 0 rgba(240,120,0,.55)" }, { boxShadow: "0 0 0 14px rgba(240,120,0,0)" }], { duration: 700, easing: "ease-out" });
    }));

    upBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const picked = [...input.files];
      input.value = "";
      if (!picked.length) return;
      const bad = picked.find((f) => !ACCEPT.split(",").includes((f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase()));
      if (bad) return setMsg(msg, `“${bad.name}” no se puede subir. ${t("Mandá", "Manden")} WAV, MP3, AIFF, FLAC, M4A, un ZIP o RAR, o PDF / TXT.`, true);
      const big = picked.find((f) => f.size > MAX || !f.size);
      if (big) return setMsg(msg, big.size ? `“${big.name}” pesa más de 2 GB. ${t("Partilo", "Pártanlo")} en varios.` : `“${big.name}” está vacío.`, true);

      const total = picked.reduce((n, f) => n + f.size, 0);
      let before = 0;
      const done = [];
      busy = true;
      paint();
      bar.hidden = false;
      fill.style.width = "0";
      try {
        for (const [i, file] of picked.entries()) {
          setMsg(msg, `Subiendo ${picked.length > 1 ? `${i + 1} de ${picked.length}: ` : ""}${file.name}… ${t("No cierres", "No cierren")} esta página.`);
          const name = await uploadOne(opts.call, show, file, (sent) => { fill.style.width = `${Math.round(((before + sent) / total) * 100)}%`; });
          done.push({ name, size: file.size });
          before += file.size;
        }
      } catch (err) {
        setMsg(msg, `${err.message}${done.length ? ` (${done.length === 1 ? "El anterior sí llegó." : `Los ${done.length} anteriores sí llegaron.`})` : ""}`, true);
      }
      if (done.length) {
        const out = await opts.call({ action: "done", event_id: show.event_id, files: done, draft: canSend }).catch(() => null);
        if (out && Array.isArray(out.files)) {
          // Lo nuevo va al final, respetando el orden que venía armando.
          const ids = files.map((f) => f.id);
          const wasDirty = dirty();
          files = sortLike(out.files, ids);
          saved = wasDirty ? saved : files.map((f) => f.id).join();
          if ("sent_at" in out) sentAt = out.sent_at;
        } else {
          files = files.concat(done.map((f) => ({ file_name: f.name, file_size: f.size })));
        }
        if (done.length === picked.length) {
          const got = done.length > 1 ? `Llegaron ${t("tus", "sus")} ${done.length} archivos.` : `Llegó ${t("tu", "su")} archivo.`;
          setMsg(msg, canSend ? `${got} Cuando esté todo en orden, ${t("tocá", "toquen")} “Enviar pistas”.` : `${got} Nos vemos en el escenario.`);
        }
      }
      busy = false;
      bar.hidden = true;
      paint();
    });
    return box;
  }

  return { card };
})();
