// Función programada (netlify.toml → cada hora). Mantiene al artista al
// tanto de su lanzamiento: consulta en ZIL el estado de cada lanzamiento
// enviado a las tiendas y lo guarda en el portal. Cuando ya está en las
// tiendas: pide el link único con todas las plataformas, pasa a
// "Publicado" y le llega al artista un mail para compartirlo. Si alguna
// tienda lo rechaza, te llega un mail a vos.
const { db, esc, sendMail, notifyEmail } = require("./_lib/pass");
const { listOf, token, isDev } = require("./_lib/zil");

const PORTAL_URL = process.env.PORTAL_URL || "https://zechegruv.com/portal/";
const FROM = "ZECHE GRUV <portal@zechegruv.com>";
const LIVE = /deliver|live|publish|online|distributed|available|released|entregad|publicad/i;
const BAD = /reject|error|fail|takendown|taken_down|rechaz/i;

// [{ store, status }] a partir de la respuesta, venga como venga.
function storesOf(data) {
  const list = listOf(data);
  if (list.length) return list.map((s) => ({ store: String(s.dsp || s.store || s.name || s.platform || s.code || "?"), status: String(s.status || s.state || s.deliveryStatus || "") }));
  if (data && typeof data === "object") return Object.entries(data).filter(([, v]) => typeof v === "string" || (v && v.status)).map(([k, v]) => ({ store: k, status: String(typeof v === "string" ? v : v.status) }));
  return [];
}

async function syncRelease(id, { force } = {}) {
  const { labelSession } = require("./_lib/zil-release");
  const r = await db(`releases?id=eq.${id}&select=*,profiles(display_name,full_name,email)`);
  const rel = r.ok && r.data[0];
  if (!rel || !rel.zil_album_id) return { ok: false, error: "Ese lanzamiento todavía no está en ZIL." };
  if (rel.status === "published" && rel.smart_link && !force) return { ok: true, unchanged: true };
  const z = await labelSession();
  const stores = storesOf(await z.call("Estado en las tiendas", "GET", `/albums/${rel.zil_album_id}/distributionStatus`));
  const live = stores.filter((s) => LIVE.test(s.status));
  const bad = stores.filter((s) => BAD.test(s.status));
  const prev = rel.zil_status || {};
  const next = Object.assign({}, prev, { stores, live: live.length, total: stores.length, checked_at: new Date().toISOString() });
  const patch = { zil_status: next };

  if (live.length && !rel.smart_link) {
    const sl = await z.call("Link único", "POST", `/albums/${rel.zil_album_id}/smartLink`, {}).catch(() => null);
    const link = sl && (sl.smartLink || sl.link || sl.url || (sl.data && (sl.data.smartLink || sl.data.link || sl.data.url)));
    if (link) patch.smart_link = link;
  }
  const nowLive = live.length > 0 && rel.status !== "published";
  if (nowLive) patch.status = "published";
  await db(`releases?id=eq.${rel.id}`, { method: "PATCH", body: patch });

  const artist = rel.profiles || {};
  const name = artist.display_name || artist.full_name || "";
  if (nowLive && artist.email && !(isDev())) {
    const link = patch.smart_link || rel.smart_link;
    await sendMail({
      to: artist.email, from: FROM, replyTo: notifyEmail(),
      subject: `«${rel.title}» ya está en las plataformas`,
      html: `<div style="background:#241105;padding:32px 16px;font-family:Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#2E1607;border-radius:16px;padding:28px;color:#FFF4DC">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#F5A623">ZECHE GRUV</p>
        <h1 style="margin:0 0 14px;font-size:26px;line-height:1.1">${esc(name)}, «${esc(rel.title)}» ya se puede escuchar</h1>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#F0E0C0">Todo lo que trabajamos sesión a sesión ya está en las plataformas. Compartilo con este link, que lleva a todas.</p>
        ${link ? `<p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#F07800;color:#241105;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Escuchar y compartir</a></p>` : ""}
        <p style="margin:18px 0 0;font-size:13px;color:#C9A980">En el portal también tenés tu tarjeta para historias.</p></div></div>`,
    });
  }
  const newBad = bad.filter((b) => !(prev.stores || []).some((s) => s.store === b.store && s.status === b.status));
  if (newBad.length) {
    await sendMail({
      to: notifyEmail(), from: FROM, subject: `Revisar en ZIL: ${name} — ${rel.title}`,
      html: `<p>Hay tiendas con problemas en «${esc(rel.title)}» de ${esc(name)}:</p><ul>${newBad.map((b) => `<li>${esc(b.store)}: ${esc(b.status)}</li>`).join("")}</ul><p><a href="${PORTAL_URL}#lanzamiento-${rel.id}">Abrir en el panel</a></p>`,
    });
  }
  return { ok: true, stores, live: live.length, published: nowLive };
}

exports.syncRelease = syncRelease;
exports.handler = async () => {
  if (!token()) return { statusCode: 200 };
  const r = await db("releases?status=eq.loaded&zil_album_id=not.is.null&select=id");
  const ids = (r.ok && r.data || []).map((x) => x.id);
  const results = [];
  for (const id of ids) results.push(await syncRelease(id).catch((e) => ({ ok: false, id, error: e.message })));
  if (ids.length) console.log("zil-sync:", JSON.stringify(results.map((x) => ({ ok: x.ok, live: x.live, error: x.error }))));
  return { statusCode: 200 };
};
