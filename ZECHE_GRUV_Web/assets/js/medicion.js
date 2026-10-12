// Medición de visitas con Google Analytics 4 (web, portal y ZG PASS).
// Cuenta: visitas, clics a WhatsApp, entradas, Spotify e Instagram,
// reservas de visita, uso del portal de artistas y el embudo de entradas.
// No manda nombres, mails ni datos de pago: solo qué se usa y cuánto.
(function () {
  var GA_ID = window.ZG_GA_ID || "G-8HB1KK6Y4S";
  var OFF_KEY = "zg-no-medir";
  window.zgTrack = function () {};

  // Excluir este dispositivo (el tuyo): se activa solo al entrar al portal
  // como administrador, o abriendo cualquier página con ?no-medir=1
  // (?no-medir=0 lo vuelve a activar).
  window.zgNoMedir = function (on) {
    try { on === false ? localStorage.removeItem(OFF_KEY) : localStorage.setItem(OFF_KEY, "1"); } catch (e) {}
    window["ga-disable-" + GA_ID] = on !== false;
  };
  var q = new URLSearchParams(location.search);
  if (q.get("no-medir") === "1") window.zgNoMedir(true);
  if (q.get("no-medir") === "0") window.zgNoMedir(false);
  var off = false;
  try { off = localStorage.getItem(OFF_KEY) === "1"; } catch (e) {}
  if (!GA_ID || GA_ID.indexOf("XXXX") !== -1 || off) return;

  // La dirección que se manda a Google, sin códigos privados (links de
  // acceso al portal, números de orden, pagos): solo campañas (utm_) y evento.
  var keep = new URLSearchParams();
  q.forEach(function (v, k) { if (k.indexOf("utm_") === 0 || k === "e") keep.set(k, v); });
  var clean = location.origin + location.pathname + (keep.toString() ? "?" + keep : "");

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { anonymize_ip: true, page_location: clean });

  window.zgTrack = function (name, params) {
    var p = params || {};
    p.transport_type = "beacon";
    window.gtag("event", name, p);
  };

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var where = (a.closest("section") && a.closest("section").id) || (a.closest("header") ? "menu" : (a.closest("footer") ? "pie" : "web"));
    if (href.indexOf("wa.me") !== -1) window.zgTrack("click_whatsapp", { seccion: where });
    else if (href.indexOf("/entradas") !== -1 || href.indexOf("/pass") === 0) window.zgTrack("click_entradas", { seccion: where });
    else if (href.indexOf("spotify.com") !== -1) window.zgTrack("click_spotify", { seccion: where });
    else if (href.indexOf("instagram.com") !== -1) window.zgTrack("click_instagram", { seccion: where });
  }, true);
})();
