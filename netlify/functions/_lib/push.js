// Notificaciones del portal en el celu y en la compu (Web Push), además del
// mail (nunca en lugar del mail). Gratis: no pasa por ningún proveedor pago,
// el aviso lo entrega el servicio de notificaciones de cada navegador.
//
// Dos tipos, que cada artista prende o apaga en su portal
// (supabase/035_notificaciones.sql):
//   proyecto   mezcla lista, master listo, modificaciones listas,
//              recordatorio, nueva fecha de entrega (aviso-entrega.js,
//              auto-entregas.js, admin-reschedule.js)
//   novedades  invitación al open mic y aviso el día del show
//              (push-eventos.js). Como mucho 2 por semana a cada artista.
//
// Horario de silencio: de 00 a 9 h (Argentina) no sale nada; lo que se
// genera en ese horario queda en la cola (push_queue) y sale a las 9, cuando
// corre la función programada (auto-entregas, cada 15 minutos).
// Una sola vez por aviso: cada uno tiene su clave (la del mail, con "push|").
//
// Variables de entorno en Netlify:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (secreta): el par de claves con el
//     que los navegadores reconocen que el aviso viene de zechegruv.com.
//   VAPID_SUBJECT (opcional): contacto para los servicios de notificaciones.
// Sin las claves no se manda nada y todo sigue igual. Nada de acá tira error.
const webpush = require("web-push");

const TZ = "America/Argentina/Buenos_Aires";
const OFF = "-03:00"; // Argentina no tiene horario de verano
const QUIET_END = 9;  // de 00 a 9 h no sale nada
const NEWS_PER_WEEK = 2;
const EXPIRE_MS = 36 * 3600 * 1000; // un aviso que no pudo salir en 36 h ya no sirve
const ICON = "/assets/favicon/android-chrome-192x192.png?v=3";
const BADGE = "/assets/favicon/zg-badge-96.png";
const clean = (v) => String(v || "").replace(/[\s"'“”‘’]/g, "");
const db = (...a) => require("./pass").db(...a);
// La hora de "ahora" (las pruebas la cambian para simular la madrugada).
const clock = { now: () => new Date() };

const keys = () => ({ publicKey: clean(process.env.VAPID_PUBLIC_KEY), privateKey: clean(process.env.VAPID_PRIVATE_KEY) });
const configured = () => { const k = keys(); return !!(k.publicKey && k.privateKey); };
const publicKey = () => keys().publicKey || null;

// ---------- Horario de silencio ----------
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const hourAR = (d) => +new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d) % 24;
// Desde cuándo puede salir un aviso generado ahora: ya mismo, o a las 9 si es de madrugada.
function notBefore(now = clock.now()) {
  if (hourAR(now) >= QUIET_END) return now;
  return new Date(`${dayAR(now)}T${String(QUIET_END).padStart(2, "0")}:00:00${OFF}`);
}

// ---------- Envío a un dispositivo ----------
// Se arma con web-push (cifrado y firma) y se manda con fetch.
async function sendOne(sub, payload) {
  const k = keys();
  const req = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    { vapidDetails: { subject: clean(process.env.VAPID_SUBJECT) || "https://www.zechegruv.com", publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 24 * 3600, urgency: "normal" },
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal });
    return res.status;
  } catch (e) {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// Manda un aviso a todos los dispositivos del artista. Los que el navegador
// da por dados de baja (404/410) se borran.
async function deliverTo(profileId, payload) {
  const subs = await db(`push_subscriptions?profile_id=eq.${profileId}&select=endpoint,p256dh,auth`);
  const list = (subs.ok && subs.data) || [];
  if (!list.length) return { sent: 0, total: 0 };
  let sent = 0;
  for (const s of list) {
    const status = await sendOne(s, payload);
    const enc = encodeURIComponent(s.endpoint);
    if (status >= 200 && status < 300) {
      sent++;
      await db(`push_subscriptions?endpoint=eq.${enc}`, { method: "PATCH", body: { last_ok_at: new Date().toISOString() } });
    } else if (status === 404 || status === 410) {
      await db(`push_subscriptions?endpoint=eq.${enc}`, { method: "DELETE" });
    } else {
      console.error("Notificación rechazada", status, new URL(s.endpoint).host);
    }
  }
  return { sent, total: list.length };
}

const payloadOf = (row) => ({ title: row.title, body: row.body, url: row.url || "/portal/", tag: row.tag || row.key, icon: ICON, badge: BADGE });

// Toma una fila de la cola (solo si nadie la tomó antes) y la manda.
async function deliverRow(row) {
  const claim = await db(`push_queue?id=eq.${row.id}&sent_at=is.null`, { method: "PATCH", prefer: "return=representation", body: { sent_at: new Date().toISOString(), result: "enviando" } });
  if (!claim.ok || !claim.data || !claim.data[0]) return { sent: false, why: "ya-salio" };
  const r = await deliverTo(row.profile_id, payloadOf(row));
  await db(`push_queue?id=eq.${row.id}`, { method: "PATCH", body: { result: r.total ? `ok ${r.sent}/${r.total}` : "sin dispositivos" } });
  return { sent: r.sent > 0, devices: r.total };
}

// ---------- Avisar a un artista ----------
// category: proyecto | novedades. key: clave única del aviso. title/body/url.
// at: desde cuándo puede salir (por defecto ya, o a las 9 si es de madrugada).
// cap: para novedades, el tope semanal (por defecto 2; 0 = sin tope).
// profile (opcional): la fila de profiles si ya se leyó.
async function notify({ profileId, profile, category, key, title, body, url, tag, at, cap, now = clock.now() }) {
  try {
    if (!configured()) return { sent: false, why: "sin-configurar" };
    if (!profileId || !key || !title) return { sent: false, why: "datos" };
    let p = profile;
    if (!p) { const r = await db(`profiles?id=eq.${profileId}&select=*`); p = r.ok && r.data && r.data[0]; }
    if (!p || p.active === false) return { sent: false, why: "sin-perfil" };
    // Antes de correr 035 las columnas no existen: cuentan como prendidas.
    if (category === "novedades" ? p.notif_novedades === false : p.notif_proyecto === false) return { sent: false, why: "desactivado" };
    const subs = await db(`push_subscriptions?profile_id=eq.${profileId}&select=endpoint&limit=1`);
    if (!subs.ok || !subs.data || !subs.data.length) return { sent: false, why: "sin-dispositivo" };
    if (category === "novedades") {
      const max = cap == null ? NEWS_PER_WEEK : cap;
      if (max > 0) {
        const since = new Date(now.getTime() - 7 * 86400000).toISOString();
        const recent = await db(`push_queue?profile_id=eq.${profileId}&category=eq.novedades&created_at=gte.${encodeURIComponent(since)}&select=id`);
        if (recent.ok && (recent.data || []).length >= max) return { sent: false, why: "tope-semanal" };
      }
    }
    const when = notBefore(at && at > now ? at : now);
    const ins = await db("push_queue?on_conflict=key", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: { key: `push|${key}`.slice(0, 500), profile_id: profileId, category, title: String(title).slice(0, 120), body: String(body || "").slice(0, 300), url: url || "/portal/", tag: tag || null, not_before: when.toISOString(), created_at: now.toISOString() },
    });
    if (!ins.ok || !ins.data || !ins.data[0]) return { sent: false, why: "ya-avisado" };
    if (when > now) return { sent: false, queued: true, at: when.toISOString() };
    return await deliverRow(ins.data[0]);
  } catch (e) {
    console.error("Notificación: no se pudo avisar", e && e.message);
    return { sent: false, why: "error" };
  }
}

// ---------- La cola ----------
// Lo corre la función programada: manda lo que quedó esperando (horario de
// silencio) y descarta lo que ya venció.
async function flush(now = clock.now()) {
  if (!configured()) return { sent: 0 };
  const due = await db(`push_queue?sent_at=is.null&not_before=lte.${encodeURIComponent(now.toISOString())}&select=*&order=not_before.asc&limit=100`);
  let sent = 0, expired = 0;
  for (const row of (due.ok && due.data) || []) {
    if (now - Date.parse(row.not_before) > EXPIRE_MS) {
      await db(`push_queue?id=eq.${row.id}&sent_at=is.null`, { method: "PATCH", body: { sent_at: now.toISOString(), result: "vencido" } });
      expired++;
      continue;
    }
    const r = await deliverRow(row);
    if (r.sent) sent++;
  }
  return { sent, expired };
}

// Aviso de prueba ("Probar" en Mi perfil): sale ya, sin cola ni horario.
async function sendTest(profileId) {
  if (!configured()) return { sent: 0, total: 0 };
  return deliverTo(profileId, { title: "Así te llegan los avisos", body: "Cuando tu mezcla o tu master esté listo, te aviso por acá.", url: "/portal/", tag: "prueba", icon: ICON, badge: BADGE });
}

// ---------- Textos del proyecto ----------
// En primera persona, directos, y a lo que pide cambiar el artista se le
// dice "modificaciones".
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
function projectText(which, { name, song, kind, day }) {
  const hi = name ? `Hola ${first(name)}, ` : "";
  const master = kind === "master";
  if (which === "mezcla") return { title: `Tu mezcla de «${song}» está lista`, body: `${hi}ya la podés escuchar en el portal. Si te gusta, aprobala y pasamos al master; si querés cambiar algo, dejame tus modificaciones.` };
  if (which === "master") return { title: `El master de «${song}» está listo`, body: `${hi}escuchalo de punta a punta en el portal y decime si lo aprobás o si querés hacerle modificaciones.` };
  if (which === "cambios") return { title: `Ya están las modificaciones de «${song}»`, body: `${hi}escuchá la versión nueva en el portal y decime si querés cambiar algo más o si ${master ? "lo" : "la"} aprobás.` };
  if (which === "recordatorio") return { title: `«${song}» te está esperando`, body: `${hi}${master ? "el master" : "tu mezcla"} sigue en el portal esperando que ${master ? "lo" : "la"} escuches. Cuando puedas, decime si ${master ? "lo" : "la"} aprobás o si querés hacerle modificaciones.` };
  if (which === "fecha") return { title: `Nueva fecha para «${song}»`, body: `${hi}${master ? "el master" : "la mezcla"} de «${song}» queda para el ${day}. Te aviso apenas ${master ? "esté listo" : "esté lista"} para escuchar.` };
  return { title: song, body: "" };
}

// El perfil del artista a partir de su ficha en Notion (Clientes Zeche
// Gruv), vinculada en artist_private.notion_page_id.
async function profileByClient(clientPageId) {
  const want = String(clientPageId || "").replace(/-/g, "").toLowerCase();
  if (!want) return null;
  const r = await db("artist_private?select=profile_id,notion_page_id");
  const hit = ((r.ok && r.data) || []).find((x) => String(x.notion_page_id || "").replace(/-/g, "").toLowerCase().includes(want));
  return hit ? hit.profile_id : null;
}

module.exports = { configured, publicKey, notify, flush, sendTest, notBefore, projectText, profileByClient, NEWS_PER_WEEK, _sendOne: sendOne, _clock: clock };
