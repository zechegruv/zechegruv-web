// Notificaciones de eventos (tipo "novedades", que cada artista puede apagar).
// Lo corre la función programada (auto-entregas, cada 15 minutos):
//   · Invitación al open mic: cuando hay un Shows & Open Mic publicado en los
//     próximos 14 días con el open mic abierto, a los artistas del sello que
//     NO están en el line up. Una vez por evento, entre las 12 y las 21 h.
//   · El día del show: a los artistas del sello que tocan, desde las 10 h.
// Quién toca sale de pass_show_artists, que se actualiza solo con el line
// up del evento (_lib/lineup.js); por las dudas también se mira el line up.
const push = require("./push");
const { matchLineup } = require("./lineup");

const TZ = "America/Argentina/Buenos_Aires";
const DAYS_AHEAD = 14;
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const hourAR = (d) => +new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d) % 24;
const fmtDay = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric" }).format(new Date(iso)).replace(",", "");
const fmtTime = (iso) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).split(":");
  return m === "00" ? `${+h} h` : `${+h}:${m} h`;
};
// "en el Teatro Sergio Souza", "en La Tangente": con artículo cuando el nombre es un lugar genérico.
const atVenue = (v) => (!v ? "" : /^(teatro|centro|club|bar|espacio|estudio|sal[oó]n|auditorio|anfiteatro|museo|galp[oó]n|patio)\b/i.test(v) ? ` en el ${v}` : ` en ${v}`);
const firstName = (p) => String(p.display_name || p.full_name || "").trim().split(/\s+/)[0] || "";

// Textos (en primera persona, directos; ver docs/NOTIFICACIONES.md).
function inviteText(ev, p) {
  const day = fmtDay(ev.starts_at);
  const where = atVenue(ev.venue_name);
  return {
    title: `Open mic del ${day}`,
    body: `Hola ${firstName(p)}, el ${day} a las ${fmtTime(ev.starts_at)} es ${ev.name}${where}. Si querés cantar una canción tuya en el open mic, sacá tu entrada y anotate desde la página del evento.`,
    url: `/pass/?e=${encodeURIComponent(ev.slug)}`,
  };
}
function dayText(ev, p) {
  const where = atVenue(ev.venue_name);
  return {
    title: `Hoy tocás en ${ev.name}`,
    body: `Hola ${firstName(p)}, hoy es el show. Te espero a las ${fmtTime(ev.starts_at)}${where}. Disfrutalo: es tu noche.`,
    url: `/pass/?e=${encodeURIComponent(ev.slug)}`,
  };
}

async function runEvents(now = push._clock.now()) {
  if (!push.configured()) return { invites: 0, day: 0 };
  const { db } = require("./pass");
  const from = new Date(now.getTime() - 12 * 3600 * 1000).toISOString();
  const to = new Date(now.getTime() + DAYS_AHEAD * 86400000).toISOString();
  const evs = await db(`pass_events?status=eq.published&is_test=eq.false&kind=eq.show&starts_at=gte.${encodeURIComponent(from)}&starts_at=lte.${encodeURIComponent(to)}&select=*&order=starts_at.asc`);
  if (!evs.ok || !(evs.data || []).length) return { invites: 0, day: 0 };
  const prof = await db("profiles?role=eq.artist&select=*");
  const artists = ((prof.ok && prof.data) || []).filter((a) => a.active !== false);
  let invites = 0, day = 0;
  for (const ev of evs.data) {
    const rows = await db(`pass_show_artists?event_id=eq.${ev.id}&select=profile_id`);
    const playing = new Set([...((rows.ok && rows.data) || []).map((r) => r.profile_id), ...matchLineup(ev.lineup || [], artists).ids]);
    const start = Date.parse(ev.starts_at);

    // Invitación al open mic: a quien no toca, mientras se pueda anotar.
    const micOpen = ev.openmic_enabled && start > now.getTime() && (!ev.openmic_deadline || Date.parse(ev.openmic_deadline) > now.getTime());
    const h = hourAR(now);
    if (micOpen && h >= 12 && h < 21) {
      for (const p of artists.filter((a) => !playing.has(a.id))) {
        const r = await push.notify({ profileId: p.id, profile: p, category: "novedades", key: `evento-invita|${ev.id}|${p.id}`, tag: `evento-${ev.id}`, now, ...inviteText(ev, p) });
        if (r.sent) invites++;
      }
    }

    // El día del show: a quien toca, desde las 10 h y antes de que empiece.
    if (dayAR(now) === dayAR(new Date(start)) && h >= 10 && now.getTime() < start) {
      for (const p of artists.filter((a) => playing.has(a.id))) {
        const r = await push.notify({ profileId: p.id, profile: p, category: "novedades", key: `evento-dia|${ev.id}|${p.id}`, tag: `evento-${ev.id}`, cap: 0, now, ...dayText(ev, p) });
        if (r.sent) day++;
      }
    }
  }
  return { invites, day };
}

module.exports = { runEvents, _inviteText: inviteText, _dayText: dayText };
