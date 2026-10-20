// ZECHE GRUV — Portal: notificaciones en el celu y en la compu (Web Push).
//
// - En Mi proyecto aparece una tarjeta que explica qué le va a llegar al
//   artista, con dos interruptores (Tu proyecto / Eventos). Recién al tocar
//   «Activar avisos» el navegador pide el permiso: así no sale el cartel del
//   navegador apenas entra, que es cuando casi todos dicen que no.
// - En Mi perfil, «Notificaciones»: los dos tipos (valen para todos sus
//   dispositivos), si están activas en este dispositivo, «Probar» y
//   «Desactivar en este celu».
// - Al tocar una notificación se abre el portal en esa sección (#canciones,
//   #escena…); si el portal ya estaba abierto, se usa esa ventana (sw.js).
// - Al cerrar sesión, este dispositivo deja de recibir.
// En el servidor: netlify/functions/portal-push.js y _lib/push.js. Sin las
// claves cargadas en Netlify (VAPID), nada de esto se muestra.
(() => {
  const P = () => window.ZGPortal || null;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } },
  };
  const DISMISS_KEY = "zg-avisos-ahora-no";
  const DISMISS_DAYS = 30;
  const touch = (() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return true; } })();
  const ESTE = touch ? "este celu" : "esta compu";
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const deviceName = () => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows";
    return "Otro";
  };
  const isArtist = () => { const p = P(); return !!(p && p.me && p.me.role === "artist"); };

  let server = null;   // { configured, publicKey, devices, proyecto, novedades }
  let busy = false;

  const b64ToBytes = (b64) => {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  async function registration() {
    // El service worker lo registra sin-conexion.js; acá se espera a que esté.
    const reg = await navigator.serviceWorker.getRegistration("/portal/");
    if (reg) return reg;
    return navigator.serviceWorker.register("/portal/sw.js", { scope: "/portal/" });
  }
  async function currentSub() {
    if (!supported()) return null;
    try { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; }
  }
  // "on": llegan acá · "off": se pueden activar · "denied": bloqueadas · "unsupported"
  async function deviceState() {
    if (!supported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    const sub = await currentSub();
    return sub && Notification.permission === "granted" ? "on" : "off";
  }

  async function api(method, body) {
    const p = P();
    const res = await p.authFetch("/.netlify/functions/portal-push", body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos conectarnos.");
    return data;
  }

  // Guarda qué tipos quiere (en su perfil: valen para todos sus dispositivos).
  async function savePrefs(prefs) {
    const p = P();
    const { data, error } = await p.db.from("profiles").update(prefs).eq("id", p.me.id).select().single();
    if (error || !data) throw new Error("No pudimos guardarlo. Probá de nuevo.");
    if (server) Object.assign(server, { proyecto: data.notif_proyecto !== false, novedades: data.notif_novedades !== false });
    return data;
  }

  // Pide el permiso, suscribe este dispositivo y lo guarda en el servidor.
  async function enable() {
    if (!server || !server.publicKey) throw new Error("Las notificaciones todavía no están listas. Probá más tarde.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { const e = new Error(perm === "denied" ? "denied" : "dismissed"); e.code = perm; throw e; }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(server.publicKey) });
    await api("POST", { action: "subscribe", subscription: sub.toJSON(), device: deviceName() });
    server.devices = (server.devices || 0) + 1;
  }
  async function disable() {
    const sub = await currentSub();
    if (!sub) return;
    await api("POST", { action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }

  const DENIED = `Las notificaciones están bloqueadas para el portal en ${ESTE}. Para activarlas, abrí la configuración del sitio (el candado de la barra de direcciones o los ajustes de la app) → Notificaciones → Permitir, y volvé a tocar «Activar».`;
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5a6 6 0 0112 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5"/><path d="M10 19.5a2.2 2.2 0 004 0"/></svg>';
  const X_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  const sw = (id, on, label, hint) => `
    <div class="zgn-opt">
      <div class="zgn-opt-text"><span id="${id}L">${label}</span><small>${hint}</small></div>
      <button class="wa-switch" type="button" role="switch" id="${id}" aria-checked="${on ? "true" : "false"}" aria-labelledby="${id}L"><span class="wa-knob" aria-hidden="true"></span></button>
    </div>`;

  // ---------- Tarjeta en Mi proyecto ----------
  async function paintCard() {
    const old = $("zgPush");
    const dismissed = store.get(DISMISS_KEY);
    const recent = dismissed && Date.now() - dismissed < DISMISS_DAYS * 86400000;
    const st = server && server.configured && isArtist() && !recent ? await deviceState() : "unsupported";
    if (st !== "off" && st !== "denied") { if (old && !old.classList.contains("is-done")) old.remove(); return; }
    const anchor = $("zgInstall") && !$("zgInstall").hidden ? $("zgInstall") : $("projectCards");
    if (!anchor) return;
    const card = old || document.createElement("section");
    card.id = "zgPush";
    card.className = "zgi zgn";
    card.setAttribute("aria-label", "Avisos en tu dispositivo");
    card.innerHTML = `
      <span class="zgi-ico">${BELL}</span>
      <div class="zgi-text zgn-main">
        <b>Enterate apenas esté tu mezcla</b>
        <span>Te aviso en ${ESTE} cuando tu mezcla o tu master esté listo para escuchar, y cuando haya un evento. Elegí qué querés recibir:</span>
        <div class="zgn-opts">
          ${sw("zgnProyecto", !server || server.proyecto !== false, "Tu proyecto", "Mezclas, masters, modificaciones y fechas de entrega")}
          ${sw("zgnNovedades", !server || server.novedades !== false, "Eventos", "Invitación al open mic y el día del show")}
        </div>
        <p class="msg zgn-msg" id="zgnMsg" role="status">${st === "denied" ? DENIED : ""}</p>
        <div class="zgn-actions">
          <button class="btn btn-primary zgi-btn" type="button" data-push-on>Activar avisos</button>
          <button class="btn zgn-later" type="button" data-push-later>Ahora no</button>
        </div>
      </div>
      <button class="zgi-x" type="button" data-push-later aria-label="Cerrar aviso de notificaciones">${X_IC}</button>`;
    if (!old) anchor.after(card);
    if (window.ZGOffline && window.ZGOffline.paintSaved) window.ZGOffline.paintSaved();
  }

  function hideCard(animate) {
    const card = $("zgPush");
    if (!card) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { card.remove(); return; }
    card.classList.add("is-out");
    setTimeout(() => card.remove(), 240);
  }

  function setMsg(el, text, err) { if (!el) return; el.textContent = text || ""; el.classList.toggle("is-error", !!err); }

  async function onEnable(btn, msgEl, prefs) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    setMsg(msgEl, "Activando…");
    try {
      if (prefs) await savePrefs(prefs);
      await enable();
      return true;
    } catch (e) {
      const code = e && (e.code || e.message);
      setMsg(msgEl, code === "denied" ? DENIED : code === "dismissed" ? "No se activaron: cuando quieras, tocá «Activar» de nuevo y elegí «Permitir»." : (e && e.message) || "No pudimos activarlas. Probá de nuevo.", true);
      return false;
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  // ---------- Mi perfil ----------
  async function paintProfile() {
    const row = $("waRow");
    const form = row && row.parentElement;
    let box = $("zgnProfile");
    const p = P();
    const own = !!(p && p.me && isArtist());
    if (!form || !own || !server || !server.configured) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement("div");
      box.id = "zgnProfile";
      box.className = "wa-row zgn-profile";
      row.after(box);
    }
    box.hidden = false;
    const st = await deviceState();
    const where = st === "on" ? `Activas en ${ESTE}.`
      : st === "denied" ? `Bloqueadas en ${ESTE}.`
      : st === "unsupported" ? (isIOS() ? "En iPhone llegan con el portal instalado: tocá Compartir → Agregar a inicio y abrilo desde ahí." : `Este navegador no recibe notificaciones.`)
      : `No están activas en ${ESTE}.`;
    // Solo se vuelve a dibujar si algo cambió (si no, se borraría el mensaje de «Listo»).
    const sig = JSON.stringify([st, server.devices]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = `
      <div class="wa-text zgn-ptext">
        <span class="wa-label">Notificaciones</span>
        <p class="hint">${where}${server.devices > (st === "on" ? 1 : 0) ? ` También ${st === "on" ? "en otros" : "en"} ${server.devices - (st === "on" ? 1 : 0) === 1 ? "1 dispositivo más" : `${server.devices - (st === "on" ? 1 : 0)} dispositivos`}.` : ""}</p>
        <div class="zgn-opts">
          ${sw("zgnpProyecto", server.proyecto !== false, "Tu proyecto", "Mezclas, masters, modificaciones y fechas de entrega")}
          ${sw("zgnpNovedades", server.novedades !== false, "Eventos", "Invitación al open mic y el día del show")}
        </div>
        <p class="msg" id="zgnpMsg" role="status">${st === "denied" ? DENIED : ""}</p>
        <div class="zgn-actions">
          ${st === "on" ? `<button class="btn" type="button" data-push-test>Probar</button><button class="btn zgn-later" type="button" data-push-off>Desactivar en ${ESTE}</button>`
            : st === "off" || st === "denied" ? `<button class="btn btn-primary" type="button" data-push-pon>Activar en ${ESTE}</button>` : ""}
        </div>
      </div>`;
  }

  // ---------- Clics ----------
  document.addEventListener("click", async (e) => {
    const t = e.target;
    // Interruptores de tipo: en la tarjeta solo se marcan (se guardan al
    // activar); en Mi perfil se guardan al toque.
    const swb = t.closest("#zgnProyecto, #zgnNovedades, #zgnpProyecto, #zgnpNovedades");
    if (swb) {
      e.preventDefault();
      const next = swb.getAttribute("aria-checked") !== "true";
      swb.setAttribute("aria-checked", String(next));
      if (swb.id.startsWith("zgnp")) {
        const field = swb.id === "zgnpProyecto" ? "notif_proyecto" : "notif_novedades";
        swb.setAttribute("aria-busy", "true");
        try {
          await savePrefs({ [field]: next });
          setMsg($("zgnpMsg"), next ? `Listo: te aviso de ${field === "notif_proyecto" ? "tu proyecto" : "los eventos"}.` : `Listo: no te aviso más de ${field === "notif_proyecto" ? "tu proyecto (el mail te sigue llegando)" : "los eventos"}.`);
        } catch (err) {
          swb.setAttribute("aria-checked", String(!next));
          setMsg($("zgnpMsg"), err.message, true);
        } finally { swb.removeAttribute("aria-busy"); }
      }
      return;
    }
    const on = t.closest("[data-push-on]");
    if (on) {
      const prefs = { notif_proyecto: $("zgnProyecto").getAttribute("aria-checked") === "true", notif_novedades: $("zgnNovedades").getAttribute("aria-checked") === "true" };
      const ok = await onEnable(on, $("zgnMsg"), prefs);
      if (ok) {
        const card = $("zgPush");
        card.classList.add("is-done");
        card.querySelector(".zgn-main").innerHTML = `<b>Listo: te van a llegar acá</b><span>Cuando tu mezcla o tu master esté listo, te aviso en ${ESTE}. Lo cambiás cuando quieras en Mi perfil.</span>`;
        setTimeout(() => hideCard(true), 4200);
        paintProfile();
      }
      return;
    }
    if (t.closest("[data-push-later]")) { store.set(DISMISS_KEY, Date.now()); hideCard(true); return; }
    const pon = t.closest("[data-push-pon]");
    if (pon) { if (await onEnable(pon, $("zgnpMsg"))) { await paintProfile(); setMsg($("zgnpMsg"), `Listo: te van a llegar en ${ESTE}.`); hideCard(false); } return; }
    const off = t.closest("[data-push-off]");
    if (off) {
      off.disabled = true;
      await disable();
      server.devices = Math.max(0, (server.devices || 1) - 1);
      await paintProfile();
      setMsg($("zgnpMsg"), `Listo: ${ESTE} ya no recibe notificaciones. El mail te sigue llegando.`);
      return;
    }
    const test = t.closest("[data-push-test]");
    if (test) {
      test.disabled = true;
      try {
        const r = await api("POST", { action: "test" });
        setMsg($("zgnpMsg"), r.ok ? "Te mandé una de prueba: tiene que aparecer en unos segundos." : "No pudimos mandarla. Desactivalas y volvé a activarlas.", !r.ok);
      } catch (err) { setMsg($("zgnpMsg"), err.message, true); } finally { test.disabled = false; }
    }
  });

  // ---------- Abrir la sección del aviso ----------
  const TABS = { canciones: "canciones", escena: "escena", proyecto: "proyecto", archivos: "archivos" };
  function openHash(hash) {
    const tab = TABS[String(hash || "").replace(/^#/, "")];
    if (!tab || !window.ZGArtistNav || !isArtist()) return false;
    window.ZGArtistNav.go(tab);
    return true;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "zg-open") openHash(e.data.hash); });
  }

  // Lo llama portal.js cada vez que entra alguien (enter).
  async function ready() {
    if (openHash(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    if (!isArtist()) return;
    try { server = await api("GET"); } catch (e) { server = null; }
    await paintCard();
    await paintProfile();
  }

  // Al cerrar sesión: este dispositivo deja de recibir (como mucho 2 s de espera).
  function logout() {
    if (!supported()) return Promise.resolve();
    return Promise.race([disable().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  }

  // Mi perfil se arma de nuevo cada vez que se abre: se vuelve a sumar la fila.
  document.addEventListener("click", (e) => { if (e.target.closest('#artistTabs [data-atab="perfil"]')) setTimeout(paintProfile, 0); });

  window.ZGPush = { ready, logout, paintProfile, _state: deviceState };
})();
