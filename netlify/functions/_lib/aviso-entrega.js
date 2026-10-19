// Aviso al artista cuando Zeche le entrega una mezcla, un master o una
// corrección (versión nueva después de que pidió cambios).
//
// Se manda solo, en el momento:
//   · al subir el audio a su carpeta (auto-entregas.js), y
//   · al tocar "Entregado" en el panel (portal-mark.js).
// Una sola vez por versión (portal_reminders, clave "entrega-aviso|…"): si
// la misma entrega se procesa dos veces, no le llegan dos mails. Responde a
// Zeche (reply-to). Después, si no la escucha, siguen los recordatorios de
// los 3 y 7 días (auto-entregas.js → remindArtist).
const { db, sendMail, notifyEmail, esc } = require("./pass");

const PORTAL = "https://www.zechegruv.com/portal/";
const SUN = "https://www.zechegruv.com/assets/mail/sol.png";
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";

// Textos: formales pero cercanos, directos y en primera persona (Zeche),
// sin frases poéticas. Cuatro casos: mezcla, corrección de mezcla, master, corrección de master.
function deliveryMail({ name, song, kind, again, notes }) {
  const master = kind === "master";
  const hi = name ? `${esc(name)}, ` : "";
  const s = `«${esc(song)}»`;
  const c = master
    ? again
      ? { subject: `Ya están tus cambios en el master de «${song}»`, eyebrow: "Master · versión nueva",
          title: `${hi ? `${hi}ya` : "Ya"} están hechas las modificaciones que pediste en el master de ${s}`,
          body: "Escuchalo de nuevo en los lugares donde escuchás música todos los días: auriculares, el celu, el auto. Fijate si ahora suena como la tenías en la cabeza.",
          next: "Si está, aprobalo y tu canción queda terminada. Si todavía falta algo, dejá tu corrección en el segundo exacto (también podés grabarla en audio) y lo ajusto.",
          cta: "Escuchar el master" }
      : { subject: `El master de «${song}» está listo`, eyebrow: "Master listo",
          title: `${hi}esta es la versión de ${s} que va a escuchar todo el mundo`,
          body: "El master es el último paso: es como va a sonar tu canción en Spotify, en YouTube y en cada lugar donde alguien le dé play. Escuchalo en auriculares, en el celu y en el auto, de punta a punta.",
          next: "Si lo aprobás, la canción queda terminada y empezamos a prepararla para salir. Si algo no te cierra, dejá tu corrección en el segundo exacto (también podés grabarla en audio) y lo ajusto.",
          cta: "Escuchar el master" }
    : again
      ? { subject: `Ya están tus cambios en «${song}»`, eyebrow: "Mezcla · versión nueva",
          title: `${hi ? `${hi}ya` : "Ya"} están hechas las modificaciones que pediste en ${s}`,
          body: "Ya podés escuchar la versión nueva en el portal.",
          next: "Decime si querés cambiar algo más o si pasamos al master: si está bien, aprobala; si falta algo, dejá tu corrección en el segundo exacto (también podés grabarla en audio) y lo ajusto.",
          cta: "Escuchar la mezcla" }
      : { subject: `Tu mezcla de «${song}» está lista para escuchar`, eyebrow: "Mezcla lista",
          title: `${hi}ya podés escuchar la mezcla de ${s}`,
          body: `Terminé la mezcla de «${song}». Ya la podés escuchar en el portal.`,
          next: "Si te gusta cómo quedó, aprobala y pasamos al master. Si querés cambiar algo, dejá tu corrección en el segundo exacto (también podés grabarla en audio) y lo ajusto.",
          cta: "Escuchar la mezcla" };
  const html = `<div style="background:#241105;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#2E1607;border-radius:18px;padding:28px;color:#FFF4DC">
<img src="${SUN}" width="40" height="40" alt="ZECHE GRUV" style="display:block;border:0;margin:0 0 16px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">ZECHE GRUV · ${c.eyebrow}</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700;line-height:1.25">${c.title}</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#F0E0C0">${esc(c.body)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#F0E0C0">${esc(c.next)}</p>
<p style="margin:0 0 18px"><a href="${PORTAL}" style="display:inline-block;background:#F07800;color:#241105;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${c.cta}</a></p>
<p style="margin:0;font-size:13px;color:#C9A980">¿Alguna duda? Respondé este mail y lo hablamos. — Zeche</p>
</div></div>`;
  return { subject: c.subject, html };
}

// profileId: el artista (Supabase). song: { id, title }. kind: mezcla|master.
// version: algo que identifique esta entrega (archivo + fecha, o "manual|<hora>").
async function notifyArtistDelivered({ profileId, song, kind, version }) {
  if (!profileId || !song || !song.id) return { sent: false, why: "datos" };
  const prof = await db(`profiles?id=eq.${profileId}&select=email,display_name,full_name,active`);
  const p = prof.ok && prof.data && prof.data[0];
  if (!p || !p.email || p.active === false) return { sent: false, why: "sin-mail" };
  // ¿Es la versión nueva después de que pidió cambios? (lo último que dijo el artista)
  const last = await db(`song_approvals?song_id=eq.${encodeURIComponent(song.id)}&kind=eq.${kind}&select=action,source,marks&order=created_at.desc&limit=20`);
  const lastArtist = ((last.ok && last.data) || []).find((r) => (r.source || "artist") === "artist");
  const again = !!(lastArtist && lastArtist.action === "cambios");
  const notes = again && Array.isArray(lastArtist.marks) ? lastArtist.marks.length : 0;
  // Una sola vez por versión.
  const key = `entrega-aviso|${song.id}|${kind}|${String(version || "").slice(0, 200)}`;
  const claim = await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key, kind: "entrega-aviso", profile_id: profileId, song_id: song.id } });
  if (!claim.ok || !claim.data || !claim.data[0]) return { sent: false, why: "ya-avisado" };
  const mail = deliveryMail({ name: firstName(p.display_name || p.full_name), song: song.title, kind, again, notes });
  const ok = await sendMail({ to: p.email, from: "ZG Portal <portal@zechegruv.com>", replyTo: notifyEmail(), ...mail }).catch(() => false);
  return { sent: !!ok, again };
}

module.exports = { notifyArtistDelivered, deliveryMail };
