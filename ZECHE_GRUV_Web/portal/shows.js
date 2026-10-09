// ZECHE GRUV — Portal: "Tu show". Al artista del sello que toca en un
// evento de ZG PASS le aparece, arriba de sus canciones, la tarjeta para
// subir las pistas (pass/pistas-card.js). Llegan a la carpeta Shows del
// evento, en una subcarpeta con su nombre (netlify/functions/portal-shows.js).
(() => {
  const P = window.ZGPortal;
  const { db, $ } = P;
  let profile = null;
  let current = 0;

  async function call(body) {
    const { data: { session } } = await db.auth.getSession();
    if (profile && profile.id !== P.me.id) body.artist = profile.id;
    const res = await fetch("/.netlify/functions/portal-shows", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "No pudimos completar la subida.");
    return out;
  }

  async function load(p) {
    profile = p;
    const ticket = ++current;
    const holder = $("showCards");
    holder.replaceChildren();
    // El administrador en su propio perfil no toca en ningún show.
    if (P.me.role === "admin" && p.id === P.me.id) return;
    let shows;
    try {
      shows = (await call({ action: "mine" })).shows;
    } catch (err) {
      return; // si falla, el resto del perfil sigue igual
    }
    if (ticket !== current) return;
    const own = p.id === P.me.id;
    holder.replaceChildren(...shows.map((show) => window.ZGPistas.card(show, {
      call,
      eyebrow: own ? "Tu show" : "Show",
      title: own ? "Subí tus pistas para el show" : `Pistas de ${P.nameOf(p)}`,
      intro: own
        ? `Mandanos acá las pistas que van a sonar en vivo en ${show.name}. Llegan directo a la carpeta del show, así esa noche solo tenés que subirte al escenario y cantar.`
        : `Lo que suba para ${show.name} llega a su carpeta, adentro de Shows.`,
    })));
  }

  window.ZGShows = { load };
})();
