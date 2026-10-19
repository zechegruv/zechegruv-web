// POST /.netlify/functions/portal-review
// El artista aprueba la mezcla o el master de una canción, o pide cambios
// con notas. Body: { song: "<id de Notion>", kind: "mezcla"|"master",
// action: "aprobada"|"cambios", note?: "...", version?: "<archivo>",
// marks?: [{ t: <segundo>, text: "..." }] }
// marks son las notas que dejó en el momento exacto del audio.
//
// - Hay que mandar la sesión de Supabase (Authorization: Bearer <token>).
// - Solo el propio artista, sobre una canción suya, en la etapa que
//   corresponde (Mezcla o Master) y cuando el audio ya está entregado: un
//   archivo con "mix"/"master" en el nombre en su carpeta de OneDrive
//   (_lib/song-audio.js). Mientras Zeche mezcla, no hay nada que aprobar.
// - Aprobar cierra la etapa sola (_lib/cierre-etapa.js), sin que Zeche toque
//   nada: Entrega = "Mezcla aprobada"/"Master aprobado", la tarea de Mix o
//   Master pasa a COMPLETADO, la canción avanza (Mezcla → Master, Master →
//   Distribución), el calendario queda tildado y el portal recibe la canción
//   ya en su etapa nueva ("next").
// - Queda guardado en song_approvals (supabase/020_aprobaciones.sql), a
//   Zeche le llega un mail (Resend, a PASS_NOTIFY_EMAIL) y, si la
//   integración de Notion tiene permiso para comentar, queda un comentario
//   en la ficha de la canción.
const { json, db, dbDetail, esc, sendMail, notifyEmail, serviceKey } = require("./_lib/pass");
const { _findClient: findClient, _parsePageId: parsePageId, _notionQuery: notionQuery, _toSong: toSong, SONGS_DS } = require("./portal-songs");
const { listAudio, matchAudio } = require("./_lib/song-audio");
const { MANUAL } = require("./portal-songs");
const { closeStage, reopenStage, nextSong } = require("./_lib/cierre-etapa");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const STAGE_OF = { mezcla: "Mix", master: "Master" };
const LABEL = { mezcla: "la mezcla", master: "el master" };
// "1:05" a partir de 65 segundos.
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// Notas en el tiempo: hasta 60, ordenadas, con segundo y texto. Si la nota
// es de voz (026_notas_de_voz.sql), "voice" es la ruta del audio en el
// espacio privado notas-voz, siempre dentro de la carpeta del artista.
function cleanMarks(list, ownerId) {
  if (!Array.isArray(list)) return [];
  const voiceOk = (v) => typeof v === "string" && ownerId && new RegExp(`^${ownerId}/[A-Za-z0-9._-]{1,120}$`).test(v);
  return list
    .map((m) => {
      const out = { t: Math.round(Number(m && m.t) * 10) / 10, text: String((m && m.text) || "").trim().slice(0, 500) };
      if (voiceOk(m && m.voice)) { out.voice = m.voice; if (!out.text) out.text = "Nota de voz"; }
      return out;
    })
    .filter((m) => Number.isFinite(m.t) && m.t >= 0 && m.t <= 4 * 3600 && m.text)
    .sort((a, b) => a.t - b.t)
    .slice(0, 60);
}

// Link para escuchar una nota de voz desde el mail (vale 14 días).
async function voiceLink(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/notas-voz/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 14 * 86400 }),
  }).catch(() => null);
  const data = res && res.ok ? await res.json().catch(() => null) : null;
  const signed = data && (data.signedURL || data.signedUrl);
  return signed ? `${SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
}

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
  let marks = [];
  const songId = parsePageId(body.song);
  if (!songId || !STAGE_OF[kind] || !["aprobada", "cambios"].includes(action)) return json(400, { error: "Pedido inválido." });

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
  marks = cleanMarks(body.marks, me.id);
  if (action === "cambios" && !note && !marks.length) return json(400, { error: "Contanos qué te gustaría cambiar." });
  const voiceLinks = await Promise.all(marks.map((m) => (m.voice ? voiceLink(m.voice) : null)));

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
  // Tiene que estar entregado: el audio con "mix"/"master" en su carpeta.
  // Si OneDrive no responde, vale el archivo que escuchó el artista.
  let version = String(body.version || "").slice(0, 300) || null;
  const folderRow = await db(`artist_private?profile_id=eq.${me.id}&select=onedrive_link,onedrive_edit_link`);
  const link = folderRow.ok && folderRow.data && folderRow.data[0] && (folderRow.data[0].onedrive_edit_link || folderRow.data[0].onedrive_link);
  if (link) {
    const checked = await (async () => {
      const [audios, pages] = await Promise.all([listAudio(link), notionQuery(SONGS_DS, { property: "Artista", relation: { contains: clientId } })]);
      const songs = pages.map(toSong);
      return ((matchAudio(songs, audios)[songs.find((x) => x.id.replace(/-/g, "") === songId.replace(/-/g, ""))?.id] || {})[kind]) || false;
    })().catch(() => null);
    // Sin audio en la carpeta vale igual si Zeche lo marcó "Entregado"
    // (botón del panel o Notion → Entrega), p. ej. si lo mandó por WhatsApp.
    let marked = false;
    if (checked === false) {
      const manual = MANUAL[p.Entrega && p.Entrega.select && p.Entrega.select.name];
      if (manual && manual[0] === kind) marked = true;
      else {
        const lastRow = await db(`song_approvals?song_id=eq.${songId}&kind=eq.${kind}&select=action,source&order=created_at.desc&limit=1`);
        const r = lastRow.ok && lastRow.data && lastRow.data[0];
        marked = !!(r && r.action === "entregada");
      }
    }
    if (checked === false && !marked) return json(409, { error: kind === "mezcla" ? "La mezcla todavía está en proceso. Te avisamos apenas esté." : "El master todavía está en proceso. Te avisamos apenas esté." });
    if (checked) version = checked.name;
  }
  const title = plain(p["Canción"] && p["Canción"].title) || "Sin título";

  const saved = await db("song_approvals", { method: "POST", prefer: "return=representation", body: { profile_id: me.id, song_id: songId, song_title: title, kind, action, note, version, marks } });
  // Sin 021_notas_en_el_tiempo.sql la tabla no tiene version ni marks: se
  // guarda igual, con las notas pasadas al texto.
  if (!saved.ok && saved.status === 400 && /version|marks/.test(JSON.stringify(saved.data || ""))) {
    const flat = [note, ...marks.map((m) => `${clock(m.t)} ${m.text}`)].filter(Boolean).join("\n").slice(0, 1000) || null;
    Object.assign(saved, await db("song_approvals", { method: "POST", prefer: "return=representation", body: { profile_id: me.id, song_id: songId, song_title: title, kind, action, note: flat } }));
  }
  // Si la base no lo guarda (p. ej. falta el permiso de 022), las notas del
  // artista no se pierden: igual le llegan a Zeche por mail y a Notion.
  if (!saved.ok) console.error("song_approvals insert:", dbDetail(saved));
  const row = (saved.ok && saved.data && saved.data[0]) || {};

  // Aprobada: se cierra la etapa en Notion y el calendario antes de avisar,
  // así el mail ya dice cómo quedó todo.
  const closed = action === "aprobada" ? await closeStage({ page: page.data, kind }).catch((e) => ({ notion: false, error: String(e && e.message) })) : null;
  if (closed && !closed.notion) console.error("cierre-etapa:", closed.error || "notion");
  const closedLine = !closed ? "" : closed.notion
    ? `La canción pasó sola a ${kind === "mezcla" ? "Master" : "Distribución"} en Notion${closed.tasks.length ? ` y quedó completada la tarea ${closed.tasks.map((n) => `«${n}»`).join(", ")}` : ""}.${closed.master && closed.master.date ? ` Entrega del master: ${closed.master.date}.` : ""}${closed.calendar === "error" ? " Ojo: Google Calendar no respondió, revisá el evento." : ""}`
    : "Ojo: Notion no dejó cerrar la etapa. Revisá la canción (Entrega, Etapa actual y su tarea).";

  // Cambios: se limpia Canciones → Entrega, así el próximo "Entregado"
  // (botón o Notion) vale como versión nueva, y queda una sesión para
  // corregir con la entrega ese día (_lib/cierre-etapa.js → reopenStage).
  let reopened = null;
  if (action === "cambios") {
    await notion(`/pages/${songId}`, { method: "PATCH", body: JSON.stringify({ properties: { Entrega: { select: null } } }) }).catch(() => null);
    reopened = await reopenStage({ page: page.data, kind }).catch((e) => ({ scheduled: false, error: String(e && e.message) }));
  }
  const fmtWhen = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const reopenLine = !reopened ? "" : reopened.scheduled
    ? `Te agendé la sesión para corregir${kind === "mezcla" ? " la mezcla" : " el master"}: ${fmtWhen(reopened.start)} h (Notion y Google Calendar), con la entrega ese día. Si no te sirve, movela desde el Inicio (Reprogramar). `
    : reopened.existing ? `Ya tenías una sesión por delante (${fmtWhen(reopened.start)} h): la entrega pasó a ese día. `
      : reopened.google === false ? "No pude agendar la sesión para corregir porque Google Calendar no está conectado: conectalo y reprogramala desde el Inicio. "
        : "No encontré un hueco libre para la sesión de corrección: agendala desde el Inicio. ";

  const who = me.display_name || me.full_name || me.email;
  const verb = action === "aprobada" ? `aprobó ${LABEL[kind]}` : `pidió cambios en ${LABEL[kind]}`;
  // Aviso a Zeche (mail) y comentario en la ficha de Notion. Si alguno
  // falla, la aprobación ya quedó guardada igual.
  const [mailed, commented] = await Promise.all([
    sendMail({
      to: notifyEmail(),
      from: "ZG Portal <portal@zechegruv.com>",
      subject: `${who} ${verb} de «${title}»`,
      replyTo: me.email || undefined,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;background:#241105;color:#FFF4DC;padding:28px;border-radius:18px;max-width:520px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">Portal de artistas · ${kind === "mezcla" ? "Mezcla" : "Master"}</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700">${esc(who)} ${esc(verb)} de «${esc(title)}»</p>
${note ? `<p style="margin:0 0 14px;padding:14px 16px;background:#2E1607;border-radius:12px;font-size:15px;line-height:1.5">${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
${marks.length ? `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 6px;margin:0 0 14px">${marks.map((m) => `<tr><td style="width:64px;vertical-align:top;padding:12px 0 12px 14px;background:#2E1607;border-radius:12px 0 0 12px;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#F5A623">${clock(m.t)}</td><td style="padding:12px 14px;background:#2E1607;border-radius:0 12px 12px 0;font-size:15px;line-height:1.45">${esc(m.text)}${voiceLinks[marks.indexOf(m)] ? ` <a href="${voiceLinks[marks.indexOf(m)]}" style="color:#F5A623;font-weight:700;text-decoration:none">▶ Escuchar nota de voz</a>` : ""}</td></tr>`).join("")}</table>` : ""}
${version ? `<p style="margin:0 0 10px;font-size:12px;color:#C9A980">Escuchó: ${esc(version)}</p>` : ""}
${saved.ok ? "" : `<p style="margin:0 0 10px;font-size:12px;color:#FF9C7A">Ojo: no quedó guardado en el portal (${esc(dbDetail(saved))}). Las notas están solo en este mail y en Notion.</p>`}
<p style="margin:0;font-size:13px;color:#C9A980">${action === "aprobada" && kind === "master" ? `${esc(closedLine)} En unos minutos le avisamos al equipo de distribución.` : action === "aprobada" ? `${esc(closedLine)} Ya podés arrancar con el master.` : esc(reopenLine) + (marks.length ? "En el portal (su perfil → Canciones) tenés el audio con cada nota marcada: tocás una y salta a ese momento. " : "") + "Respondé este mail para hablar con el artista."}</p>
</div>`,
    }).catch(() => false),
    notion("/comments", {
      method: "POST",
      body: JSON.stringify({ parent: { page_id: songId }, rich_text: [{ type: "text", text: { content: [`Portal: ${who} ${verb}.${note ? ` «${note}»` : ""}`, ...marks.map((m) => `${clock(m.t)} — ${m.text}${m.voice ? " (🎙 nota de voz, escuchala en el portal)" : ""}`)].join("\n").slice(0, 1900) } }] }),
    }).catch(() => null),
  ]);
  // Nada quedó en ningún lado: ahí sí, que lo vuelva a intentar.
  const reached = mailed !== false || (commented && commented.ok);
  if (!saved.ok && !reached) return json(500, { error: "No pudimos enviarlo. Tus notas siguen acá: probá de nuevo en un momento." });

  return json(200, { ok: true, review: { kind, action, note: row.note || null, marks: Array.isArray(row.marks) ? row.marks : marks, version: row.version || version, at: row.created_at || new Date().toISOString() }, saved: saved.ok, synced: closed ? closed.notion : undefined, next: closed && closed.notion ? nextSong(kind) : null });
};
