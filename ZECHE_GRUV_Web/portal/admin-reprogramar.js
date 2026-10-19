// ZECHE GRUV — Panel de administrador: reprogramar una mezcla o un master
// vencido. Se abre desde "Mezclas y masters" (botón del calendario en las
// filas vencidas). Muestra los huecos libres de los próximos 14 días según
// Google Calendar y la rutina fija (almuerzo, gimnasio, sesión con Layla),
// sugiere el primero y, al confirmar, mueve todo junto (admin-reschedule.js):
// la sesión en Notion, la fecha de entrega de la canción (ese mismo día) y
// los dos eventos de Google Calendar. Desde una fila de sesión o de entrega
// se elige igual: día y horario de la sesión. Sin Google conectado no se
// mueve nada y ofrece conectarlo.
(() => {
  const P = window.ZGPortal;
  const { db } = P;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const DURS = [60, 90, 120, 180];
  const durLabel = (m) => (m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);

  async function call(url, body) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(url, body
      ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) }
      : { headers: { Authorization: `Bearer ${session.access_token}` } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "No se pudo. Probá de nuevo.");
    return out;
  }

  // Aviso corto abajo de la pantalla.
  function toast(text, ok = true) {
    const t = el("div", `zr-toast${ok ? "" : " is-error"}`, text);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add("is-in"));
    setTimeout(() => { t.classList.remove("is-in"); setTimeout(() => t.remove(), 400); }, 3800);
  }

  // Vuelta desde Google después de conectar.
  const g = new URLSearchParams(location.search).get("google");
  if (g) {
    history.replaceState(null, "", location.pathname + location.hash);
    setTimeout(() => toast(g === "ok" ? "Google Calendar conectado. Ya ves tus huecos libres al reprogramar." : "No se pudo conectar Google Calendar. Probá de nuevo.", g === "ok"), 900);
  }

  async function connectGoogle(btn) {
    btn.disabled = true;
    try { const { url } = await call("/.netlify/functions/admin-google", { action: "start" }); location.href = url; }
    catch (e) { btn.disabled = false; toast(e.message, false); }
  }

  function open(t, onDone) {
    // Siempre se elige día y horario: la entrega va el día de la sesión.
    const isSession = true;
    const fromDelivery = t.kind === "entrega";
    const origDur = t.timed && t.end ? Math.round((Date.parse(t.end) - Date.parse(t.start)) / 60000) : 120;
    let dur = DURS.includes(origDur) ? origDur : 120;
    let days = [], dayIdx = 0, pick = null, google = null, busy = false;

    const back = el("div", "zr-back");
    const sheet = el("div", "zr-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Reprogramar");
    const head = el("div", "zr-head");
    const titles = el("div", "zr-titles");
    titles.append(
      el("span", "zr-eyebrow", fromDelivery ? (t.stage === "Mezcla" ? "Nueva fecha de entrega de la mezcla" : "Nueva fecha de entrega del master") : (t.stage === "Mezcla" ? "Reprogramar sesión de mezcla" : "Reprogramar sesión de master")),
      el("h3", "zr-title", t.song ? `«${t.song}»` : t.name),
      el("span", "zr-who", [t.artist, "estaba para " + (t.whenText || "antes")].filter(Boolean).join(" · ")),
    );
    const x = el("button", "zr-x");
    x.type = "button"; x.setAttribute("aria-label", "Cerrar");
    x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    head.append(titles, x);

    const gBar = el("div", "zr-google");
    const durRow = el("div", "zr-durs");
    const dayRow = el("div", "zr-days");
    const slotBox = el("div", "zr-slots");
    const foot = el("div", "zr-foot");
    const hint = el("span", "zr-hint");
    const go = el("button", "zr-go", "Elegí un día");
    go.type = "button"; go.disabled = true;
    foot.append(hint, go);

    if (isSession) {
      durRow.append(el("span", "zr-label", "Duración"));
      DURS.forEach((m) => {
        const b = el("button", `zr-chip${m === dur ? " is-on" : ""}`, durLabel(m));
        b.type = "button";
        b.addEventListener("click", () => { if (m === dur) return; dur = m; durRow.querySelectorAll(".zr-chip").forEach((c) => c.classList.toggle("is-on", c === b)); load(); });
        durRow.append(b);
      });
    }
    sheet.append(head, gBar, durRow, el("span", "zr-label zr-label-days", "Día"), dayRow, slotBox, foot);
    if (!isSession) durRow.remove();
    slotBox.append(skel());
    document.body.append(back, sheet);
    document.documentElement.classList.add("zr-lock");
    requestAnimationFrame(() => { back.classList.add("is-in"); sheet.classList.add("is-in"); });

    const close = () => {
      document.removeEventListener("keydown", onKey);
      back.classList.remove("is-in"); sheet.classList.remove("is-in"); sheet.classList.add("is-out");
      document.documentElement.classList.remove("zr-lock");
      setTimeout(() => { back.remove(); sheet.remove(); }, reduced() ? 0 : 320);
    };
    const onKey = (e) => { if (e.key === "Escape" && !busy) close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("click", () => { if (!busy) close(); });
    x.addEventListener("click", () => { if (!busy) close(); });

    function skel() { const s = el("div", "zr-skel"); for (let i = 0; i < 6; i++) s.append(el("i")); return s; }

    function paintGoogle() {
      gBar.replaceChildren();
      if (google && google.connected) {
        gBar.className = "zr-google is-on";
        gBar.append(el("span", "zr-dot"), el("span", "", "Huecos según tu Google Calendar y tu rutina"));
        return;
      }
      gBar.className = "zr-google";
      gBar.append(el("span", "", google && !google.configured ? "Falta configurar Google en Netlify: sin el calendario no se reprograma (se mueve todo junto o nada)." : "Conectá Google Calendar para reprogramar: se mueven juntos el evento, la tarea y la entrega."));
      if (google && google.configured) {
        const b = el("button", "zr-link", "Conectar");
        b.type = "button";
        b.addEventListener("click", () => connectGoogle(b));
        gBar.append(b);
      }
    }

    function paintDays() {
      dayRow.replaceChildren();
      const maxFree = Math.max(60, ...days.map((d) => d.freeMin));
      days.forEach((d, i) => {
        const has = isSession ? d.slots.length > 0 : true;
        const b = el("button", `zr-day${i === dayIdx ? " is-on" : ""}${has ? "" : " is-full"}`);
        b.type = "button";
        b.style.animationDelay = `${i * 28}ms`;
        const parts = d.label.replace(",", "").split(" ");
        const [wd, num] = [d.today ? "Hoy" : cap(parts[0].replace(".", "")), parts[1]];
        const meter = el("i", "zr-meter");
        meter.style.setProperty("--f", (d.freeMin / maxFree).toFixed(2));
        b.append(el("span", "zr-wd", wd), el("b", "", num), meter);
        b.title = `${Math.round(d.freeMin / 6) / 10} h libres`;
        b.addEventListener("click", () => { if (i === dayIdx) return; dayIdx = i; pick = null; dayRow.querySelectorAll(".zr-day").forEach((c, k) => c.classList.toggle("is-on", k === i)); paintSlots(); });
        dayRow.append(b);
      });
      const on = dayRow.children[dayIdx];
      if (on) on.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
    }

    function paintSlots() {
      const d = days[dayIdx];
      const box = el("div", "zr-grid");
      if (!isSession) {
        pick = { date: d.date };
        const freeH = Math.round(d.freeMin / 6) / 10;
        box.append(el("p", "zr-note", d.freeMin ? `Ese día tenés ${String(freeH).replace(".", ",")} h libres para terminarlo.` : "Ese día está lleno: vas a tener que entregarlo a la noche."));
      } else if (!d.slots.length) {
        box.append(el("p", "zr-note", `No entra una sesión de ${durLabel(dur)} ese día. Probá otro o achicá la duración.`));
      } else {
        d.slots.forEach((s, i) => {
          const b = el("button", `zr-slot${pick && pick.time === s ? " is-on" : ""}`, s);
          b.type = "button";
          b.style.animationDelay = `${Math.min(i, 14) * 22}ms`;
          if (i === 0) b.append(el("em", "", "primero"));
          b.addEventListener("click", () => { pick = { date: d.date, time: s }; box.querySelectorAll(".zr-slot").forEach((c) => c.classList.toggle("is-on", c === b)); paintFoot(); });
          box.append(b);
        });
      }
      slotBox.replaceChildren(box);
      paintFoot();
    }

    function paintFoot() {
      const d = days[dayIdx];
      if (google && !google.connected) { go.disabled = true; go.textContent = "Conectá Google Calendar"; hint.textContent = ""; return; }
      if (!pick) { go.disabled = true; go.textContent = isSession ? "Elegí un horario" : "Elegí un día"; hint.textContent = ""; return; }
      go.disabled = false;
      const dayTxt = d.today ? "hoy" : d.label.replace(",", "").replace(/\./g, "");
      if (isSession) {
        const [h, m] = pick.time.split(":").map(Number);
        const endMin = h * 60 + m + dur;
        go.textContent = `Mover a ${dayTxt} · ${pick.time}`;
        hint.textContent = `Hasta las ${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      } else {
        go.textContent = `Entregar ${dayTxt}`;
        hint.textContent = "";
      }
    }

    // Arranca en el primer día con lugar y marca el primer hueco (sugerido).
    async function load() {
      slotBox.replaceChildren(skel());
      go.disabled = true;
      try {
        const out = await call(`/.netlify/functions/admin-reschedule?task=${encodeURIComponent(t.id)}&kind=${t.kind}&dur=${dur}`);
        google = out.google; days = out.days || [];
        const keep = days.findIndex((d) => pick && d.date === pick.date);
        dayIdx = keep >= 0 && (!isSession || days[keep].slots.length) ? keep : Math.max(0, days.findIndex((d) => (isSession ? d.slots.length : d.freeMin > 0)));
        pick = isSession && days[dayIdx] && days[dayIdx].slots[0] ? { date: days[dayIdx].date, time: days[dayIdx].slots[0] } : null;
        paintGoogle(); paintDays(); paintSlots();
      } catch (e) {
        slotBox.replaceChildren(el("p", "zr-note", e.message));
      }
    }

    go.addEventListener("click", async () => {
      if (!pick || busy) return;
      busy = true; go.disabled = true; go.classList.add("is-busy");
      try {
        const out = await call("/.netlify/functions/admin-reschedule", { task: t.id, kind: t.kind, date: pick.date, time: pick.time, dur });
        go.classList.remove("is-busy"); go.classList.add("is-done");
        go.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Listo';
        const cal = { movido: " y en Google Calendar", creado: " y agendada en Google Calendar" }[out.calendar] || "";
        const extra = out.delivery ? ` La entrega quedó para el ${out.delivery.replace(".", "")}.` : "";
        setTimeout(() => { busy = false; close(); toast(`Movida a ${out.label.replace(".", "")} en Notion${cal}.${extra}`); if (onDone) onDone(); }, reduced() ? 0 : 520);
      } catch (e) {
        busy = false; go.classList.remove("is-busy"); go.disabled = false;
        go.classList.remove("is-shake"); void go.offsetWidth; go.classList.add("is-shake");
        toast(e.message, false);
      }
    });

    load();
    setTimeout(() => x.focus({ preventScroll: true }), 60);
  }

  window.ZGReprogramar = { open };
})();
