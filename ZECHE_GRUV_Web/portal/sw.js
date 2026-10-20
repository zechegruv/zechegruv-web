// ZECHE GRUV — Service worker del portal de artistas (alcance /portal/).
//
// Guarda la "cáscara" del portal (la página, los estilos y el código) para
// que abra aunque no haya conexión. Nada más:
//  - La página (/portal/): red primero. Con conexión siempre llega la
//    versión publicada; sin conexión, la última que se guardó.
//  - Lo que lleva versión en el nombre (?v=…, supabase-js@2.45.4 del CDN,
//    tipografías e imágenes): primero lo guardado, porque no cambia.
//  - El resto del código del portal (portal.js, portal.css…, que no llevan
//    ?v=): red primero y, sin conexión, lo guardado. Así nunca se mezcla
//    código viejo con la página nueva.
//  - NUNCA se guardan las Netlify Functions (/.netlify/functions/…), nada
//    de Supabase (sesión, perfiles, notas de voz), ningún POST ni los audios
//    de OneDrive. Los audios que el artista elige guardar para escuchar sin
//    conexión los guarda la página (sin-conexion.js, en "zg-audios").
//
// El build de Netlify reemplaza __BUILD__ por la versión (netlify.toml): con
// cada publicación este archivo cambia, el navegador instala el nuevo y el
// nuevo borra lo guardado de la versión anterior.
const VERSION = "__BUILD__";
const SHELL = `zg-portal-${VERSION}`;
const PAGE = "/portal/";
// Archivos versionados de otros sitios que el portal necesita para abrir.
const SHELL_KINDS = new Set(["script", "style", "image", "font", "manifest"]);
const CDN = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/|cdnjs\.cloudflare\.com\/ajax\/libs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

// Lo que pide la página (estilos, código, íconos y el manifest), sacado del
// mismo HTML publicado: si mañana se suma un archivo, se guarda solo.
function shellUrls(html) {
  const out = new Set();
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/g)) {
    const tag = m[0];
    const at = (name) => { const r = new RegExp(`\\b${name}="([^"]+)"`).exec(tag); return r ? r[1] : ""; };
    const url = m[1] === "script" ? at("src") : /\brel="(stylesheet|icon|apple-touch-icon|manifest)"/.test(tag) ? at("href") : "";
    if (!url) continue;
    const abs = new URL(url, self.location.origin + PAGE);
    if (abs.origin === self.location.origin || CDN.test(abs.href)) out.add(abs.href);
  }
  return [...out];
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const res = await fetch(PAGE, { cache: "reload" });
    if (!res.ok) throw new Error("no se pudo bajar el portal");
    const html = await res.clone().text();
    await cache.put(PAGE, res);
    // Si algún archivo no baja (p. ej. el CDN de Google), se instala igual.
    await Promise.all(shellUrls(html).map(async (url) => {
      try {
        const own = new URL(url).origin === self.location.origin;
        const r = await fetch(url, own ? { cache: "reload" } : { mode: "no-cors" });
        if (r.ok || r.type === "opaque") await cache.put(url, r);
      } catch (e) { /* sigue con el resto */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Solo se borran las cáscaras de otras versiones: los audios guardados
    // por el artista ("zg-audios") quedan.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("zg-portal-") && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Guarda una copia solo de respuestas buenas y que se pueden repetir.
async function keep(req, res) {
  if (!res || !(res.ok || res.type === "opaque")) return;
  try { await (await caches.open(SHELL)).put(req, res); } catch (e) { /* sin espacio: sigue sin guardar */ }
}

async function networkFirst(req, key) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== "opaque" && !res.redirected) keep(key || req, res.clone());
    return res;
  } catch (e) {
    const cache = await caches.open(SHELL);
    const hit = (await cache.match(key || req)) || (key ? null : await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const hit = await (await caches.open(SHELL)).match(req);
  if (hit) return hit;
  const res = await fetch(req);
  keep(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return; // POST y partes de un audio: siempre a la red
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (own && url.pathname.startsWith("/.netlify/")) return;        // funciones: datos del artista, nunca guardados
  if (/(^|\.)supabase\.(co|in)$/.test(url.hostname)) return;        // sesión y base: nunca guardados
  if (req.destination === "audio" || req.destination === "video") return;
  if (req.mode === "navigate") {
    // La página del portal (con o sin ?token_hash=… de los mails): una sola copia.
    if (own && (url.pathname === PAGE || url.pathname === `${PAGE}index.html`)) event.respondWith(networkFirst(req, PAGE));
    return;
  }
  if (!own && !CDN.test(req.url)) return;
  // Del propio sitio, solo la cáscara (código, estilos, íconos, tipografías y
  // el manifest). Cualquier otro pedido (un audio bajado con fetch para la
  // onda, un JSON, un archivo) va directo a la red y no ocupa lugar en el celu.
  if (own && !SHELL_KINDS.has(req.destination)) return;
  const fixed = !own || url.searchParams.has("v") || req.destination === "image" || req.destination === "font";
  event.respondWith(fixed ? cacheFirst(req) : networkFirst(req));
});

// ---------- Notificaciones (push.js en el servidor) ----------
// Llega el aviso cifrado; se muestra con el logo del sello. Al tocarlo, se
// abre el portal en la sección del aviso (o la página del evento). Si el
// portal ya está abierto, se usa esa ventana.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "ZECHE GRUV", body: event.data ? event.data.text() : "" }; }
  const title = d.title || "ZECHE GRUV";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: d.icon || "/assets/favicon/android-chrome-192x192.png?v=3",
    badge: d.badge || "/assets/favicon/zg-badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: "es-AR",
    data: { url: d.url || "/portal/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/portal/", self.location.origin);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = target.pathname.startsWith(PAGE) && wins.find((w) => new URL(w.url).pathname.startsWith(PAGE));
    if (same) {
      await same.focus();
      // El portal abre la sección del aviso (notificaciones.js escucha esto).
      same.postMessage({ type: "zg-open", hash: target.hash });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
