// POST /.netlify/functions/portal-shows
// Pistas de los shows de ZG PASS. Quien toca en un evento sube sus pistas y
// llegan a la carpeta "Shows" del evento en OneDrive (pass_events.
// shows_folder_link, link de edición), en una subcarpeta con su nombre.
// Solo agrega archivos: no se borra, mueve ni renombra nada, y si el nombre
// ya existe OneDrive guarda el nuevo aparte. Nadie recibe el link.
//
// Dos formas de entrar:
//   · Artista del sello: su sesión del portal (Authorization: Bearer <token>).
//     Tiene que estar anotado en pass_show_artists. El administrador puede
//     mandar "artist" para ver o subir por otro.
//   · Invitado sin cuenta: { k } con la clave de su link único
//     (pass_show_guests.token), desde zechegruv.com/pistas?k=…
//     Sube, igual que los artistas, a la carpeta con su nombre dentro de
//     Shows; o a su propia carpeta si se cargó su link (folder_link). El link
//     deja de andar 24 h después de la hora del show.
//
// Acciones (campo "action"):
//   mine                                         → sus shows y lo que ya subió
//   start  { event_id, name, size }              → { mode: "session", uploadUrl } | { mode: "simple" }
//   simple { event_id, name, data(base64) }      → archivos chicos, de una sola vez
//   chunk  { uploadUrl, start, end, total, data(base64) } → reenvía una parte
//   status { uploadUrl }                         → qué partes faltan
//   done   { event_id, files: [{ name, size }] } → terminó una tanda: se registra y se avisa por mail
// (El invitado no manda event_id: su link es de un solo evento.)
const { SUPABASE_URL, UUID, json, db, esc, sendMail, notifyEmail, serviceKey, testMode } = require("./_lib/pass");
const drive = require("./_lib/onedrive");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const MB = 1024 * 1024;
const MAX_SIZE = 2048 * MB;
const SIMPLE_MAX = 4 * MB; // lo que entra en un solo pedido a esta function
const TYPES = /\.(wav|mp3|aif|aiff|flac|m4a|zip|rar|pdf|txt)$/i;
const EVENT = "id,name,starts_at,venue_name,venue_address,status,is_test,shows_folder_link,shows_deadline";
const INACTIVE = "Tu acceso al portal está pausado. Si querés retomar, escribinos por WhatsApp.";
const GUEST_GONE = "Este link ya no está activo. Si tenés que subir tus pistas, escribinos y te mandamos uno nuevo.";
const GUEST_DAYS_AFTER = 24 * 3600 * 1000; // el link del invitado vence 24 h después del show

async function userOf(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  return user && user.id ? user : null;
}

function closedReason(ev, who) {
  if (ev.status === "cancelled") return "El evento se canceló.";
  if (!(who && who.folderLink) && !ev.shows_folder_link) return "La subida de pistas todavía no está habilitada. Te avisamos cuando abra.";
  if (Date.now() > Date.parse(ev.shows_deadline || ev.starts_at)) return "La subida de pistas para este show ya cerró. Si te falta algo, escribinos.";
  return "";
}

const showView = (ev, files, who) => {
  const reason = closedReason(ev, who);
  return {
    event_id: ev.id, name: ev.name, starts_at: ev.starts_at, venue_name: ev.venue_name, venue_address: ev.venue_address,
    open: !reason, closed_reason: reason, deadline: ev.shows_deadline || ev.starts_at, files,
  };
};

// Carpeta de quien sube: la propia del invitado, o la suya adentro de
// "Shows" para los artistas del sello. { target, prefix } o { error }.
async function folderFor(ev, who) {
  const name = who.name;
  if (who.folderLink) {
    const own = await drive.folder(who.folderLink);
    if (own.error) { console.error("ZG shows: carpeta invitado", own.error); return { error: "No pudimos abrir tu carpeta. Avisanos por WhatsApp." }; }
    return { target: own, prefix: "" };
  }
  const root = await drive.folder(ev.shows_folder_link);
  if (root.error) { console.error("ZG shows: carpeta", root.error); return { error: "No pudimos abrir la carpeta del show. Avisanos por WhatsApp." }; }
  const sub = await drive.subfolder(root, drive.cleanName(name) || "Artista");
  // Si no se pudo crear la subcarpeta, va suelto con el nombre adelante.
  return sub ? { target: sub, prefix: "" } : { target: root, prefix: `${drive.cleanName(name)} - ` };
}

// Quién sube: { kind, id, name, email, filter, row, events? } o una respuesta de error.
async function whoIs(event, body) {
  if (body.k !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(String(body.k))) return { error: json(404, { error: GUEST_GONE }) };
    const res = await db(`pass_show_guests?token=eq.${body.k}&select=id,name,email,folder_link,gift_session,plural,revoked_at,pass_events(${EVENT})`);
    const g = res.ok && res.data[0];
    if (!g || g.revoked_at || !g.pass_events || g.pass_events.is_test !== testMode()) return { error: json(404, { error: GUEST_GONE }) };
    if (Date.now() > Date.parse(g.pass_events.starts_at) + GUEST_DAYS_AFTER) return { error: json(410, { error: "Este link ya venció: el show ya pasó. ¡Gracias por subirte al escenario con nosotros!" }) };
    return {
      kind: "guest", id: g.id, name: g.name, email: g.email, folderLink: g.folder_link, gift: g.gift_session, plural: g.plural,
      filter: `guest_id=eq.${g.id}`, row: { guest_id: g.id }, guestEvent: g.pass_events,
    };
  }

  const user = await userOf(event);
  if (!user) return { error: json(401, { error: "Iniciá sesión de nuevo." }) };
  const meRes = await db(`profiles?id=eq.${user.id}&select=*`);
  if (!meRes.ok) return { error: json(500, { error: "No pudimos leer tu perfil." }) };
  const me = meRes.data[0];
  if (!me) return { error: json(403, { error: "Iniciá sesión de nuevo." }) };
  if (me.role !== "admin" && me.active === false) return { error: json(403, { error: INACTIVE }) };
  let artist = me;
  if (body.artist && body.artist !== me.id) {
    if (me.role !== "admin") return { error: json(403, { error: "No tenés permiso para ver eso." }) };
    if (!UUID.test(String(body.artist))) return { error: json(400, { error: "Artista inválido." }) };
    const a = await db(`profiles?id=eq.${body.artist}&select=*`);
    if (!a.ok || !a.data[0]) return { error: json(404, { error: "No encontramos al artista." }) };
    artist = a.data[0];
  }
  return {
    kind: "artist", id: artist.id, name: artist.display_name || artist.full_name || "Artista", email: artist.email,
    filter: `profile_id=eq.${artist.id}`, row: { profile_id: artist.id },
  };
}

// El evento en el que sube (tiene que estar anotado), o null.
async function eventFor(who, eventId) {
  if (who.kind === "guest") return who.guestEvent;
  if (!UUID.test(String(eventId || ""))) return null;
  const res = await db(`pass_show_artists?event_id=eq.${eventId}&profile_id=eq.${who.id}&select=pass_events(${EVENT})`);
  return res.ok && res.data[0] ? res.data[0].pass_events : null;
}

const filesOf = async (who, ev) => {
  const res = await db(`pass_show_files?event_id=eq.${ev.id}&${who.filter}&select=file_name,file_size,uploaded_at&order=uploaded_at.asc`);
  return res.ok ? res.data : [];
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }

  try {
    // ---- Partes de una subida ya abierta (la dirección de OneDrive ya es la llave) ----
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

    const who = await whoIs(event, body);
    if (who.error) return who.error;

    // ---- Sus shows ----
    if (body.action === "mine") {
      if (who.kind === "guest") {
        const ev = who.guestEvent;
        return json(200, { guest: { name: who.name, gift_session: who.gift === true, plural: who.plural === true }, shows: [showView(ev, await filesOf(who, ev), who)] });
      }
      const res = await db(`pass_show_artists?profile_id=eq.${who.id}&select=pass_events(${EVENT})`);
      if (!res.ok) return json(200, { shows: [] }); // p. ej. todavía no se corrió 016_shows_pistas.sql
      const since = Date.now() - 12 * 3600 * 1000;
      const events = res.data.map((r) => r.pass_events)
        .filter((ev) => ev && ev.is_test === testMode() && ev.status !== "cancelled" && Date.parse(ev.starts_at) > since)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      return json(200, { shows: await Promise.all(events.map(async (ev) => showView(ev, await filesOf(who, ev)))) });
    }

    const ev = await eventFor(who, body.event_id);
    if (!ev) return json(404, { error: "No figurás en el line up de ese show. Si es un error, escribinos." });

    // ---- Terminó una tanda: se registra y se avisa ----
    if (body.action === "done") {
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 50)
        .map((f) => ({ name: drive.cleanName(f && f.name), size: Number(f && f.size) || null }))
        .filter((f) => f.name);
      if (!files.length) return json(400, { error: "No hay archivos para registrar." });
      await db("pass_show_files", { method: "POST", body: files.map((f) => ({ event_id: ev.id, ...who.row, file_name: f.name, file_size: f.size })) });
      const list = files.map((f) => `<li style="padding:3px 0">${esc(f.name)}${f.size ? ` <span style="color:#8a6a45">(${(f.size / MB).toFixed(1)} MB)</span>` : ""}</li>`).join("");
      await sendMail({
        to: notifyEmail(),
        replyTo: who.email || undefined,
        subject: `Pistas: ${who.name}${who.kind === "guest" ? " (invitado)" : ""} — ${ev.name}`,
        html: `<div style="font-family:Arial,sans-serif;color:#241105"><p><strong>${esc(who.name)}</strong>${who.kind === "guest" ? " (invitado)" : ""} subió ${files.length > 1 ? `${files.length} archivos` : "un archivo"} para <strong>${esc(ev.name)}</strong>:</p><ul>${list}</ul>`
          + `<p style="color:#8a6a45;font-size:13px">${who.folderLink ? "Ya están en su carpeta." : `Ya están en la carpeta Shows del evento, en la subcarpeta “${esc(drive.cleanName(who.name))}”.`}</p></div>`,
      }).catch((e) => console.error("ZG shows: mail", e));
      return json(200, { done: true });
    }

    // ---- Abrir una subida ----
    if (body.action !== "start" && body.action !== "simple") return json(400, { error: "Acción desconocida." });
    const reason = closedReason(ev, who);
    if (reason) return json(409, { error: reason });
    const name = drive.cleanName(body.name);
    if (!name || !TYPES.test(name)) return json(400, { error: "Ese tipo de archivo no se puede subir. Mandá WAV, MP3, AIFF, FLAC o un ZIP con las pistas." });

    const where = await folderFor(ev, who);
    if (where.error) return json(502, { error: where.error });
    const fileName = where.prefix + name;

    if (body.action === "simple") {
      const data = Buffer.from(String(body.data || ""), "base64");
      if (!data.length || data.length > SIMPLE_MAX) return json(400, { error: "El archivo es demasiado grande para esta forma de subida." });
      const saved = await drive.putSmall(where.target, fileName, data);
      return saved ? json(200, { done: true, name: saved }) : json(502, { error: "OneDrive no aceptó el archivo. Probá de nuevo." });
    }

    const size = Number(body.size);
    if (!(size > 0)) return json(400, { error: "El archivo está vacío." });
    if (size > MAX_SIZE) return json(400, { error: "El archivo pesa más de 2 GB. Partilo en varios." });
    const uploadUrl = await drive.createUploadSession(where.target, fileName);
    if (uploadUrl) return json(200, { mode: "session", uploadUrl, name: fileName });
    if (size <= SIMPLE_MAX) return json(200, { mode: "simple", name: fileName });
    return json(502, { error: "OneDrive no aceptó abrir la subida. Probá de nuevo en un momento." });
  } catch (err) {
    console.error("ZG shows:", err);
    return json(502, { error: "No pudimos conectar con la carpeta del show. Probá de nuevo en un momento." });
  }
};
