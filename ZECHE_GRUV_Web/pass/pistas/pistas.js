// ZG PASS — pistas de un artista invitado.
//   /pistas?k=<clave>  (redirige a /pass/pistas/?k=…)
// Para quien toca en un show y no tiene cuenta en el portal: con su link
// único sube las pistas a la carpeta Shows del evento, en una subcarpeta
// con su nombre (netlify/functions/portal-shows.js). Sin usuario ni contraseña.
(() => {
  const { api } = window.ZGPass;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const k = (params.get("k") || "").toLowerCase();
  const TZ = "America/Argentina/Buenos_Aires";
  const WHATSAPP = "https://wa.me/5491133287422";

  function showView(name) {
    ["loading", "state", "main"].forEach((v) => { $(`view-${v}`).hidden = v !== name; });
  }

  async function call(body) {
    const res = await api("portal-shows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, k }) });
    if (!res.ok) throw new Error(res.data.error || "No pudimos completar la subida. Probá de nuevo.");
    return res.data;
  }

  async function start() {
    if (!/^[0-9a-f]{64}$/.test(k)) {
      $("stateText").textContent = "Revisá que hayas copiado el link completo. Si el problema sigue, escribinos y te mandamos uno nuevo.";
      return showView("state");
    }
    let data;
    try {
      data = await call({ action: "mine" });
    } catch (err) {
      $("stateText").textContent = err.message;
      return showView("state");
    }
    const show = data.shows[0];
    const name = data.guest.name;
    const day = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(show.starts_at)).replace(",", "");
    const plural = data.guest.plural === true;
    const t = (one, many) => (plural ? many : one);
    document.title = `${name} · ${t("Tus", "Sus")} pistas — ZG PASS`;
    $("guestTitle").textContent = `${name}, el escenario es ${t("tuyo", "de ustedes")}.`;
    $("guestLead").textContent = `${t("Sos", "Son")} parte del line up de ${show.name}, el ${day}${show.venue_name ? ` en ${show.venue_name}` : ""}. ${t("Subí acá tus", "Suban acá sus")} pistas y del resto nos encargamos nosotros: que esa noche suene tal como la ${t("imaginaste", "imaginaron")}.`;
    $("guestCard").replaceChildren(window.ZGPistas.card(show, {
      call,
      plural,
      eyebrow: t("Tu show", "Su show"),
      title: t("Subí tus pistas", "Suban sus pistas"),
      intro: `Llegan directo a ${t("tu", "su")} carpeta del show. Lo que ${t("subís", "suben")} lo ve solo el equipo de ZECHE GRUV.`,
    }));

    // Sesión de 2 h de regalo (si el administrador la activó): se coordina por WhatsApp.
    const gift = data.guest.gift_session === true;
    $("giftBlock").hidden = !gift;
    $("studioBlock").hidden = gift;
    if (gift) {
      $("giftText").textContent = `Y como subirse a este escenario no es casualidad, ${t("te", "les")} regalamos una sesión de 2 horas en el estudio, sin cargo, para que ${t("sigas", "sigan")} trabajando ${t("tu", "su")} música con nosotros: una idea nueva, una canción a medio terminar o lo que ${t("tengas", "tengan")} ganas de grabar.`;
      $("giftBtn").textContent = t("Coordinar mi sesión", "Coordinar nuestra sesión");
      $("giftBtn").href = `${WHATSAPP}?text=${encodeURIComponent(`Hola ZECHE GRUV! ${t("Soy", "Somos")} ${name}, ${t("toco", "tocamos")} en ${show.name} y ${t("quiero", "queremos")} coordinar la sesión de 2 horas de regalo 🌞`)}`;
    } else {
      $("studioText").textContent = `Si después de esa noche ${t("querés", "quieren")} seguir llevando ${t("tu", "su")} música a otro nivel, el estudio está abierto: grabamos, producimos y lanzamos junto a artistas que sueñan en grande y quieren tomarse su música en serio.`;
      $("studioBtn").href = `${WHATSAPP}?text=${encodeURIComponent(`Hola ZECHE GRUV! ${t("Soy", "Somos")} ${name}, ${t("toco", "tocamos")} en ${show.name} y ${t("quiero", "queremos")} seguir trabajando ${t("mi", "nuestra")} música con ustedes 🌞`)}`;
    }
    showView("main");
  }

  start();
})();
