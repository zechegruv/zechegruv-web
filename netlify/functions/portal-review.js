// POST /.netlify/functions/portal-review
// El artista aprueba la mezcla o el master de una canción, o pide cambios
// con una nota. Body: { song: "<id de Notion>", kind: "mezcla"|"master",
// action: "aprobada"|"cambios", note?: "..." }
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Solo el propio artista, sobre una canción suya y en la etapa que
//   corresponde: la mezcla mientras está en Mezcla; el master cuando está
//   en Master y ya no tiene fecha de entrega (ya se le mandó).
// - Queda guardado en song_approvals (supabase/020_aprobaciones.sql), a
//   Zeche le llega un mail (Resend, a PASS_NOTIFY_EMAIL) y, si la
//   integración de Notion tiene permiso para comentar, queda un comentario
//   en la ficha de la canción. La etapa en Notion no se toca: la mueve Zeche.
const { json, db, esc, sendMail, notifyEmail, serviceKey } = require("./_lib/pass");
const { _findClient: findClient, _parsePageId: parsePageId } = require("./portal-songs");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const STAGE_OF = { mezcla: "Mix", master: "Master" };
const LABEL = { mezcla: "la mezcla", master: "el master" };
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();

async function notion(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify." });
  if (!notionToken()) return json(500, { error: "Falta NOTION_TOKEN en Netlify." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  const kind = body.kind, action = body.action;
  const note = String(body.note || "").trim().slice(0, 1000) || null;
  const songId = parsePageId(body.song);
  if (!songId || !STAGE_OF[kind] || !["aprobada", "cambios"].includes(action)) return json(400, { error: "Pedido inválido." });
  if (action === "cambios" && !note) return json(400, { error: "Contanos qué te gustaría cambiar." });

  // Quién es.
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });
  const prof = await db(`profiles?id=eq.${user.id}&select=*`);
  const me = prof.ok && prof.data && prof.data[0];
  if (!me) return json(500, { error: "No pudimos leer tu perfil." });
  if (me.role !== "artist") return json(403, { error: "Solo el artista puede aprobar sus canciones." });
  if (me.active === false) return json(403, { error: "Tu acceso al portal está pausado. Si querés retomar, escribinos por WhatsApp." });

  // La canción tiene que ser suya y estar en la etapa que corresponde.
  const priv = await db(`artist_private?profile_id=eq.${me.id}&select=notion_page_id`);
  const clientId = parsePageId(priv.ok && priv.data && priv.data[0] && priv.data[0].notion_page_id) || parsePageId(await findClient(me).catch(() => null));
  if (!clientId) return json(403, { error: "No encontramos tus canciones." });
  const page = await notion(`/pages/${songId}`);
  if (!page.ok) return json(502, { error: "No pudimos leer la canción. Probá de nuevo en un momento." });
  const p = page.data.properties || {};
  const owners = ((p.Artista && p.Artista.relation) || []).map((r) => r.id.replace(/-/g, ""));
  if (!owners.includes(clientId.replace(/-/g, ""))) return json(403, { error: "Esa canción no es tuya." });
  const stage = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
  if (stage !== STAGE_OF[kind]) return json(409, { error: `Esta canción ya no está en ${kind}. Actualizá la página.` });
  if (kind === "master" && p["Fecha de entrega"] && p["Fecha de entrega"].date) return json(409, { error: "El master todavía está en proceso. Te avisamos apenas esté." });
  const title = plain(p["Canción"] && p["Canción"].title) || "Sin título";

  const saved = await db("song_approvals", { method: "POST", prefer: "return=representation", body: { profile_id: me.id, song_id: songId, song_title: title, kind, action, note } });
  if (!saved.ok) return json(500, { error: saved.status === 404 ? "Falta correr supabase/020_aprobaciones.sql." : "No pudimos guardarlo. Probá de nuevo." });
  const row = saved.data[0];

  const who = me.display_name || me.full_name || me.email;
  const verb = action === "aprobada" ? `aprobó ${LABEL[kind]}` : `pidió cambios en ${LABEL[kind]}`;
  // Aviso a Zeche (mail) y comentario en la ficha de Notion. Si alguno
  // falla, la aprobación ya quedó guardada igual.
  await Promise.all([
    sendMail({
      to: notifyEmail(),
      subject: `${who} ${verb} de «${title}»`,
      replyTo: me.email || undefined,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;background:#241105;color:#FFF4DC;padding:28px;border-radius:18px;max-width:520px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">Portal de artistas · ${kind === "mezcla" ? "Mezcla" : "Master"}</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700">${esc(who)} ${esc(verb)} de «${esc(title)}»</p>
${note ? `<p style="margin:0 0 14px;padding:14px 16px;background:#2E1607;border-radius:12px;font-size:15px;line-height:1.5">${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
<p style="margin:0;font-size:13px;color:#C9A980">${action === "aprobada" && kind === "master" ? "Ya se puede pasar a Distribución en Notion." : action === "aprobada" ? "Ya podés arrancar con el master." : "Respondé este mail para hablar con el artista."}</p>
</div>`,
    }).catch(() => false),
    notion("/comments", {
      method: "POST",
      body: JSON.stringify({ parent: { page_id: songId }, rich_text: [{ type: "text", text: { content: `Portal: ${who} ${verb}.${note ? ` «${note}»` : ""}`.slice(0, 1900) } }] }),
    }).catch(() => null),
  ]);

  return json(200, { ok: true, review: { kind, action, note, at: row.created_at } });
};
