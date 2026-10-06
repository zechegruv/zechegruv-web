// Inscripción al open mic de un evento. Solo para quien ya tiene su
// entrada paga. Una inscripción, con una canción, por entrada.
//
// Quién es se sabe de dos maneras (van en cada pedido):
//   { t }            la clave de la orden (así se llega desde la página de
//                    la entrada o desde el mail)
//   { slug, email }  el evento y el mail con el que se compró la entrada
//                    (así se llega desde el sitio)
//
// POST /.netlify/functions/pass-openmic   { t | slug+email, action, … }
//   info   → evento, si la inscripción está abierta y las entradas de la persona
//   start  { code, full_name, aka, instagram, email, song_title, tune_note, file_name, file_size }
//          guarda la inscripción y abre la subida → { mode: "session", uploadUrl } | { mode: "simple" }
//   simple { code, data(base64) }                       → archivos chicos, de una sola vez
//   chunk  { uploadUrl, start, end, total, data(base64) } → reenvía una parte
//   status { uploadUrl }                                 → qué partes faltan
//   done   { code }                                      → la canción terminó de subir: avisa por mail
//
// La canción va a la carpeta de OneDrive del evento (pass_events.
// openmic_folder_link, link de edición), con el nombre
// "AKA - Canción - Nota.mp3". El archivo no pasa entero por acá: el
// navegador lo manda en partes, directo a OneDrive o a través de esta function.
const { json, db, esc, sendMail, notifyEmail, serviceKey, testMode } = require("./_lib/pass");
const drive = require("./_lib/onedrive");

const MB = 1024 * 1024;
const MAX_SIZE = 150 * MB;
const SIMPLE_MAX = 4 * MB;  // lo que entra en un solo pedido a esta function
const TYPES = /\.(mp3|wav)$/i;
const TUNE = /^((Do|Re|Mi|Fa|Sol|La|Si)#? (mayor|menor)|Sin tune)$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENT = "id,slug,kind,name,starts_at,openmic_enabled,openmic_deadline,openmic_folder_link";
const TICKET = "id,code,status,holder_name";
const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

// Evento y entradas válidas de quien hace el pedido: { ev, tickets, buyer } o null.
async function loadContext(body) {
  if (body.t) {
    if (!/^[0-9a-f]{64}$/.test(String(body.t))) return null;
    const res = await db(`pass_orders?access_token=eq.${body.t}&select=status,buyer_first_name,buyer_last_name,buyer_email,pass_events(${EVENT}),pass_tickets(${TICKET})`);
    const order = res.ok && res.data[0];
    if (!order || order.status !== "paid") return null;
    return {
      ev: order.pass_events,
      tickets: order.pass_tickets.filter((t) => t.status === "valid" || t.status === "used"),
      buyer: { name: `${order.buyer_first_name} ${order.buyer_last_name}`, email: order.buyer_email },
    };
  }
  const slug = String(body.slug || "").toLowerCase();
  const email = text(body.email, 160).toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !EMAIL.test(email)) return null;
  const evRes = await db(`pass_events?slug=eq.${slug}&is_test=eq.${testMode()}&select=${EVENT}`);
  const ev = evRes.ok && evRes.data[0];
  if (!ev) return null;
  const tk = await db(`pass_tickets?event_id=eq.${ev.id}&holder_email=eq.${encodeURIComponent(email)}&status=in.(valid,used)&select=${TICKET}&order=code.asc`);
  if (!tk.ok || !tk.data.length) return null;
  return { ev, tickets: tk.data, buyer: { name: tk.data[0].holder_name, email } };
}

function closedReason(ev) {
  if (!ev.openmic_enabled) return "Este evento no tiene inscripción al open mic.";
  if (ev.openmic_deadline && Date.now() > Date.parse(ev.openmic_deadline)) return "La inscripción al open mic ya cerró.";
  return "";
}

async function signupOf(ticketId) {
  const res = await db(`pass_openmic?ticket_id=eq.${ticketId}&select=*`);
  return res.ok ? res.data[0] || null : undefined;
}

// La canción ya está en la carpeta: se marca y se avisa por mail (una sola vez).
async function finish(ev, signup, finalName) {
  if (signup.uploaded_at) return;
  const patch = { uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (finalName) patch.file_name = finalName;
  await db(`pass_openmic?id=eq.${signup.id}&uploaded_at=is.null`, { method: "PATCH", body: patch });
  const row = (label, value) => `<tr><td style="padding:6px 16px 6px 0;color:#8a6a45;font-size:13px">${label}</td><td style="padding:6px 0;font-size:15px"><strong>${esc(value)}</strong></td></tr>`;
  await sendMail({
    to: notifyEmail(),
    replyTo: signup.email,
    subject: `Open mic: ${signup.aka} — ${signup.song_title}`,
    html: `<div style="font-family:Arial,sans-serif;color:#241105"><p>Nueva inscripción al open mic de <strong>${esc(ev.name)}</strong>.</p><table>`
      + row("AKA", signup.aka) + row("Nombre completo", signup.full_name) + row("Instagram", signup.instagram ? `@${signup.instagram}` : "—")
      + row("Mail", signup.email) + row("Canción", signup.song_title) + row("Nota del tune", signup.tune_note)
      + row("Archivo", finalName || signup.file_name)
      + "</table><p style=\"color:#8a6a45;font-size:13px\">El archivo ya está en la carpeta del open mic.</p></div>",
  });
}

exports.handler = async (event) => {
  if (!serviceKey()) return json(500, { error: "Falta configurar el servidor." });

  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const ctx = await loadContext(body);
  if (!ctx) return json(404, { error: "No encontramos una entrada comprada con esos datos." });
  const ev = ctx.ev;

  // ---------- Estado de la inscripción ----------
  if (body.action === "info") {
    const tickets = await Promise.all(ctx.tickets.map(async (t) => {
      const s = await signupOf(t.id);
      return { code: t.code, holder_name: t.holder_name, signup: s ? { aka: s.aka, song_title: s.song_title, uploaded: !!s.uploaded_at } : null };
    }));
    const reason = closedReason(ev);
    return json(200, {
      event: { slug: ev.slug, kind: ev.kind, name: ev.name, starts_at: ev.starts_at },
      open: !reason,
      closed_reason: reason,
      deadline: ev.openmic_deadline,
      buyer: ctx.buyer,
      tickets,
    });
  }

  try {
    // ---- Partes de una subida ya abierta ----
    if (body.action === "chunk" || body.action === "status") {
      const url = String(body.uploadUrl || "");
      if (!drive.UPLOAD_HOST.test(url)) return json(400, { error: "Subida inválida." });
      if (body.action === "status") {
        const state = await drive.sessionStatus(url);
        return state ? json(200, state) : json(502, { error: "Se cortó la subida. Probá de nuevo." });
      }
      const start = Number(body.start), end = Number(body.end), total = Number(body.total);
      if (!(start >= 0 && end >= start && total > end)) return json(400, { error: "Subida inválida." });
      const out = await drive.putChunk(url, start, end, total, Buffer.from(String(body.data || ""), "base64"));
      return out ? json(200, out) : json(502, { error: "Se cortó la subida. Probá de nuevo." });
    }

    const ticket = ctx.tickets.find((t) => t.code === String(body.code || ""));
    if (!ticket) return json(400, { error: "Esa entrada no es tuya." });
    const reason = closedReason(ev);
    if (reason) return json(409, { error: reason });
    let signup = await signupOf(ticket.id);
    if (signup === undefined) return json(502, { error: "No pudimos leer tu inscripción. Probá de nuevo." });

    // ---- Formulario + apertura de la subida ----
    if (body.action === "start") {
      if (signup && signup.uploaded_at) return json(409, { error: "Con esta entrada ya hay una canción inscripta." });
      const fields = {
        full_name: text(body.full_name, 120),
        aka: text(body.aka, 80),
        instagram: text(body.instagram, 60).replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, ""),
        email: text(body.email, 160).toLowerCase(),
        song_title: text(body.song_title, 120),
        tune_note: text(body.tune_note, 20),
      };
      if (!fields.full_name || !fields.aka || !fields.song_title) return json(400, { error: "Completá nombre completo, AKA y nombre de la canción." });
      if (!/^[A-Za-z0-9._]{1,30}$/.test(fields.instagram)) return json(400, { error: "Escribí tu usuario de Instagram (sin espacios)." });
      if (!EMAIL.test(fields.email)) return json(400, { error: "Ese mail no parece válido." });
      if (!TUNE.test(fields.tune_note)) return json(400, { error: "Elegí la nota del tune." });

      const original = String(body.file_name || "");
      const size = Number(body.file_size);
      if (!TYPES.test(original)) return json(400, { error: "La canción tiene que ser un archivo MP3 o WAV." });
      if (!(size > 0)) return json(400, { error: "El archivo está vacío." });
      if (size > MAX_SIZE) return json(400, { error: `El archivo pesa más de ${MAX_SIZE / MB} MB.` });
      if (!ev.openmic_folder_link) return json(409, { error: "La subida de canciones todavía no está habilitada. Probá más tarde." });

      const ext = original.match(TYPES)[1].toLowerCase();
      const fileName = `${drive.cleanName(`${fields.aka} - ${fields.song_title} - ${fields.tune_note}`)}.${ext}`;
      const saved = await db("pass_openmic?on_conflict=ticket_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: { ...fields, event_id: ev.id, ticket_id: ticket.id, file_name: fileName, file_size: size, updated_at: new Date().toISOString() },
      });
      if (!saved.ok) return json(502, { error: "No pudimos guardar tu inscripción. Probá de nuevo." });

      if (size <= SIMPLE_MAX) return json(200, { mode: "simple" });
      const target = await drive.folder(ev.openmic_folder_link);
      if (target.error) { console.error("ZG PASS open mic: carpeta", target.error); return json(502, { error: "No pudimos abrir la carpeta de canciones. Avisanos por Instagram." }); }
      const uploadUrl = await drive.createUploadSession(target, fileName);
      if (!uploadUrl) return json(502, { error: "No pudimos iniciar la subida. Probá de nuevo en un momento." });
      return json(200, { mode: "session", uploadUrl });
    }

    if (!signup) return json(400, { error: "Primero completá el formulario." });

    if (body.action === "simple") {
      if (signup.uploaded_at) return json(200, { done: true });
      const data = Buffer.from(String(body.data || ""), "base64");
      if (!data.length || data.length > SIMPLE_MAX) return json(400, { error: "Subida inválida." });
      const target = await drive.folder(ev.openmic_folder_link);
      if (target.error) return json(502, { error: "No pudimos abrir la carpeta de canciones. Avisanos por Instagram." });
      const name = await drive.putSmall(target, signup.file_name, data);
      if (!name) return json(502, { error: "No pudimos subir el archivo. Probá de nuevo." });
      await finish(ev, signup, name);
      return json(200, { done: true });
    }

    if (body.action === "done") {
      await finish(ev, signup, text(body.name, 200) && drive.cleanName(body.name));
      return json(200, { done: true });
    }

    return json(400, { error: "Acción desconocida." });
  } catch (err) {
    console.error("ZG PASS open mic:", err);
    return json(502, { error: "No pudimos conectar con la carpeta de canciones. Probá de nuevo en un momento." });
  }
};
