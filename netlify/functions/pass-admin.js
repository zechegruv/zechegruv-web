// POST /.netlify/functions/pass-admin   { action, … }
// Administración de ZG PASS desde el portal: resumen de eventos, listado de
// entradas, control de acceso (scanner), venta en puerta y bonificadas.
//
// - Solo lo puede usar el administrador (se manda su sesión de Supabase en
//   Authorization: Bearer <token>).
// - Las acciones que cambian algo quedan registradas en pass_audit.
//
// Acciones:
//   events                                   → eventos con sus datos y sus números
//   event_save { event_id?, event, ticket_types } → crea (en borrador) o edita un evento y sus entradas
//   door_list / door_add { label } / door_remove { access_id } → links de acceso de puerta del evento
//   tickets  { event_id }                    → entradas emitidas del evento
//   openmic  { event_id }                    → inscriptos al open mic
//   shows    { event_id }                    → carpetas del evento, quién toca (artistas e invitados) y pistas subidas
//   shows_save { event_id, root_folder_link, folder_name, openmic_folder_link?, shows_folder_link?, shows_deadline, artist_ids }
//            guarda la carpeta madre, la carpeta de la edición y quién toca; arma las carpetas en
//            OneDrive y avisa por mail a los artistas del sello recién sumados
//   guest_add    { event_id, name, folder_link?, email?, gift_session, plural }
//            invitado sin cuenta: sube a la carpeta con su nombre dentro de Shows (o a la suya, si se pega su link), con un link
//            único que vence 24 h después del show; si hay mail, se lo manda
//   guest_remove { event_id, guest_id }      → el link del invitado deja de andar
//   status   { event_id, status }            → publicar / cerrar la venta / volver a borrador
//   peek     { event_id, token | code }      → ¿esta entrada es válida? (no la marca)
//   checkin  { event_id, token | code }      → marcar como ingresada
//   issue    { event_id, ticket_type_id, quantity, first_name, last_name, email?, method, unit_price?, checkin? }
//            method: cash | transfer | mercadopago (cobrado por fuera) | comp (bonificada)
//            checkin: true registra el ingreso en el mismo momento
const { SUPABASE_URL, UUID, json, db, rpc, audit, sendTickets, siteUrl, testMode, serviceKey, esc, sendMail, notifyEmail } = require("./_lib/pass");
const drive = require("./_lib/onedrive");
const { summary, checkTicket, issueTickets } = require("./_lib/pass-ops");
const folders = require("./_lib/pass-folders");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

// Quién llama: tiene que ser una sesión válida de un administrador.
async function adminOf(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  if (!user || !user.id) return null;
  const role = await db(`profiles?id=eq.${user.id}&select=role`);
  return role.ok && role.data[0] && role.data[0].role === "admin" ? user.id : null;
}

// Link único de un invitado para subir sus pistas (sin cuenta en el portal).
const guestLink = (event, token) => `${siteUrl(event)}/pistas?k=${token}`;

function guestMail(ev, name, link, plural) {
  const t = (one, many) => (plural ? many : one);
  const tz = { timeZone: "America/Argentina/Buenos_Aires" };
  const day = new Intl.DateTimeFormat("es-AR", { ...tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(ev.starts_at));
  const until = new Intl.DateTimeFormat("es-AR", { ...tz, weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ev.shows_deadline || ev.starts_at)).replace(",", "");
  return {
    subject: `${name}, ${plural ? "suban sus" : "subí tus"} pistas para ${ev.name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#241105;max-width:520px;line-height:1.55">`
      + `<p style="font-size:16px">Hola ${esc(name)}:</p>`
      + `<p style="font-size:16px">Ya ${t("sos", "son")} parte del line up de <strong>${esc(ev.name)}</strong>, el ${esc(day)}${ev.venue_name ? ` en ${esc(ev.venue_name)}` : ""}. Para que esa noche todo suene como lo ${t("ensayaste", "ensayaron")}, ${t("subí tus", "suban sus")} pistas en este link:</p>`
      + `<p style="margin:26px 0"><a href="${esc(link)}" style="background:#F07800;color:#fff;padding:14px 22px;text-decoration:none;font-weight:bold;display:inline-block">${t("Subir mis pistas", "Subir nuestras pistas")}</a></p>`
      + `<p style="font-size:14px;color:#8a6a45">No ${t("necesitás", "necesitan")} usuario ni contraseña: el link es solo ${t("tuyo", "de ustedes")}, no lo compartan. ${t("Tenés", "Tienen")} tiempo para subirlas hasta el ${esc(until)} h.</p>`
      + `<p style="font-size:14px">Nos vemos en el escenario.<br>ZECHE GRUV</p></div>`,
  };
}

// Aviso al artista del sello: ya puede subir sus pistas desde su portal.
function artistMail(ev, name, portal) {
  const tz = { timeZone: "America/Argentina/Buenos_Aires" };
  const day = new Intl.DateTimeFormat("es-AR", { ...tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(ev.starts_at));
  const until = new Intl.DateTimeFormat("es-AR", { ...tz, weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ev.shows_deadline || ev.starts_at)).replace(",", "");
  return {
    subject: `${name}, ya podés subir tus pistas para ${ev.name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#241105;max-width:520px;line-height:1.55">`
      + `<p style="font-size:16px">Hola ${esc(name)}:</p>`
      + `<p style="font-size:16px">Sos parte del line up de <strong>${esc(ev.name)}</strong>, el ${esc(day)}${ev.venue_name ? ` en ${esc(ev.venue_name)}` : ""}. Ya está abierta la subida de pistas: entrá a tu portal y mandanos las que van a sonar esa noche.</p>`
      + `<p style="margin:26px 0"><a href="${esc(portal)}" style="background:#F07800;color:#fff;padding:14px 22px;text-decoration:none;font-weight:bold;display:inline-block">Subir mis pistas</a></p>`
      + `<p style="font-size:14px;color:#8a6a45">Está arriba de todo en tu perfil, en la tarjeta “Tu show”. Tenés tiempo hasta el ${esc(until)} h.</p>`
      + `<p style="font-size:14px">Nos vemos en el escenario.<br>ZECHE GRUV</p></div>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify." });
  const adminId = await adminOf(event);
  if (!adminId) return json(403, { error: "Iniciá sesión de nuevo con la cuenta de administrador." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Datos inválidos." }); }
  const eventId = String(body.event_id || "");

  // ---------- Eventos con sus números ----------
  if (body.action === "events") {
    const res = await db(`pass_events?is_test=eq.${testMode()}&select=*,pass_ticket_types(id,name,description,price,active,sort)&order=starts_at.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar los eventos." });
    const events = await Promise.all(res.data.map(async (ev) => {
      const tk = await db(`pass_tickets?event_id=eq.${ev.id}&select=status,modality,face_value,price_paid,pass_orders(channel,payment_method,status,expires_at)`);
      return {
        id: ev.id, slug: ev.slug, kind: ev.kind, name: ev.name, starts_at: ev.starts_at, ends_at: ev.ends_at, status: ev.status,
        venue_name: ev.venue_name, venue_address: ev.venue_address, description: ev.description, important_info: ev.important_info,
        image_url: ev.image_url, capacity: ev.capacity, max_per_buyer: ev.max_per_buyer, lineup: ev.lineup || [],
        openmic_enabled: ev.openmic_enabled, openmic_deadline: ev.openmic_deadline, shows_deadline: ev.shows_deadline, folder_name: ev.folder_name || "",
        ticket_types: ev.pass_ticket_types.sort((a, b) => a.sort - b.sort).map((t) => ({ id: t.id, name: t.name, description: t.description, price: Number(t.price), active: t.active })),
        stats: summary(ev, tk.ok ? tk.data : []),
      };
    }));
    return json(200, { events, site: siteUrl(event) });
  }

  // ---------- Crear o editar un evento (con sus tipos de entrada) ----------
  if (body.action === "event_save") {
    const e = body.event || {};
    const editing = UUID.test(eventId);
    const when = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? undefined : d.toISOString(); };
    const fields = {
      kind: ["show", "camp", "other"].includes(e.kind) ? e.kind : "show",
      name: text(e.name, 120),
      starts_at: when(e.starts_at),
      ends_at: when(e.ends_at),
      venue_name: text(e.venue_name, 120) || null,
      venue_address: text(e.venue_address, 200) || null,
      description: String(e.description || "").trim().slice(0, 2000) || null,
      important_info: String(e.important_info || "").trim().slice(0, 600) || null,
      image_url: /^https:\/\/\S+$/.test(String(e.image_url || "")) ? String(e.image_url).slice(0, 600) : null,
      capacity: Number(e.capacity),
      max_per_buyer: Number(e.max_per_buyer),
      lineup: (Array.isArray(e.lineup) ? e.lineup : []).map((n) => text(n, 80)).filter(Boolean).slice(0, 20),
      openmic_enabled: e.openmic_enabled === true,
      openmic_deadline: when(e.openmic_deadline),
      shows_deadline: when(e.shows_deadline),
      folder_name: text(e.folder_name, 120) || null,
      updated_at: new Date().toISOString(),
    };
    if (!fields.name) return json(400, { error: "Poné el nombre del evento." });
    if (!fields.starts_at) return json(400, { error: "Poné la fecha y la hora del evento." });
    if ([fields.ends_at, fields.openmic_deadline, fields.shows_deadline].includes(undefined)) return json(400, { error: "Revisá las fechas: alguna no es válida." });
    if (!Number.isInteger(fields.capacity) || fields.capacity < 1 || fields.capacity > 5000) return json(400, { error: "La capacidad tiene que ser un número entre 1 y 5000." });
    if (!Number.isInteger(fields.max_per_buyer) || fields.max_per_buyer < 1 || fields.max_per_buyer > 20) return json(400, { error: "El máximo de entradas por persona tiene que ser entre 1 y 20." });
    if (!fields.lineup.length) fields.lineup = null;

    const types = (Array.isArray(body.ticket_types) ? body.ticket_types : []).slice(0, 10).map((t, i) => ({
      id: UUID.test(String(t.id || "")) ? String(t.id) : null,
      name: text(t.name, 60), description: text(t.description, 200) || null,
      price: Number(t.price), active: t.active !== false, sort: i,
    }));
    if (!types.length) return json(400, { error: "Agregá al menos un tipo de entrada." });
    if (types.some((t) => !t.name || !(t.price >= 0))) return json(400, { error: "Cada tipo de entrada necesita nombre y precio." });

    let ev;
    if (editing) {
      const res = await db(`pass_events?id=eq.${eventId}&is_test=eq.${testMode()}`, { method: "PATCH", prefer: "return=representation", body: fields });
      if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos guardar el evento." });
      ev = res.data[0];
    } else {
      // Dirección de la página: a partir del nombre, sin repetir.
      const base = fields.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "evento";
      let slug = base;
      for (let n = 2; n < 50; n++) {
        const taken = await db(`pass_events?slug=eq.${slug}&select=id`);
        if (taken.ok && !taken.data.length) break;
        slug = `${base}-${n}`;
      }
      const res = await db("pass_events", { method: "POST", prefer: "return=representation", body: { ...fields, slug, status: "draft", is_test: testMode() } });
      if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos crear el evento." });
      ev = res.data[0];
    }

    // Tipos de entrada: se actualizan los que vienen, se crean los nuevos y los
    // que se sacaron quedan inactivos (no se borran: puede haber entradas vendidas).
    const current = await db(`pass_ticket_types?event_id=eq.${ev.id}&select=id`);
    const keep = new Set(types.filter((t) => t.id).map((t) => t.id));
    for (const t of types) {
      const row = { name: t.name, description: t.description, price: t.price, active: t.active, sort: t.sort };
      const r = t.id
        ? await db(`pass_ticket_types?id=eq.${t.id}&event_id=eq.${ev.id}`, { method: "PATCH", body: row })
        : await db("pass_ticket_types", { method: "POST", body: { ...row, event_id: ev.id } });
      if (!r.ok) return json(502, { error: "Se guardó el evento, pero no pudimos guardar las entradas. Probá de nuevo." });
    }
    for (const t of current.ok ? current.data : []) {
      if (!keep.has(t.id)) await db(`pass_ticket_types?id=eq.${t.id}`, { method: "PATCH", body: { active: false } });
    }
    await audit(editing ? "evento_editado" : "evento_creado", "event", ev.id, { name: ev.name }, adminId);
    return json(200, { id: ev.id, slug: ev.slug });
  }

  if (!UUID.test(eventId)) return json(400, { error: "Elegí un evento." });

  // ---------- Entradas emitidas ----------
  if (body.action === "tickets") {
    const res = await db(`pass_tickets?event_id=eq.${eventId}&status=in.(valid,used)&select=code,status,used_at,holder_name,holder_email,modality,price_paid,pass_ticket_types(name),pass_orders(number,channel,payment_method)&order=code.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar las entradas." });
    return json(200, {
      tickets: res.data.map((t) => ({
        code: t.code, status: t.status, used_at: t.used_at, holder_name: t.holder_name, holder_email: t.holder_email,
        type: t.pass_ticket_types.name, comp: t.modality === "comp", price_paid: Number(t.price_paid),
        order: t.pass_orders.number, channel: t.pass_orders.channel, method: t.pass_orders.payment_method,
      })),
    });
  }

  // ---------- Inscriptos al open mic ----------
  if (body.action === "openmic") {
    const res = await db(`pass_openmic?event_id=eq.${eventId}&select=full_name,aka,instagram,email,song_title,tune_note,file_name,uploaded_at,created_at,pass_tickets(code)&order=created_at.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar los inscriptos." });
    return json(200, {
      signups: res.data.map((s) => ({
        aka: s.aka, full_name: s.full_name, instagram: s.instagram, email: s.email, song_title: s.song_title,
        tune_note: s.tune_note, file_name: s.file_name, uploaded: !!s.uploaded_at, code: s.pass_tickets.code,
      })),
    });
  }

  // ---------- Carpetas, line up y pistas subidas ----------
  if (body.action === "shows") {
    const ev = await db(`pass_events?id=eq.${eventId}&select=*`);
    if (!ev.ok) return json(502, { error: "No pudimos cargar el evento." });
    if (!ev.data[0]) return json(404, { error: "No encontramos el evento." });
    const [artists, chosen, guests, files, root] = await Promise.all([
      db("profiles?role=eq.artist&select=*&order=display_name.asc"),
      db(`pass_show_artists?event_id=eq.${eventId}&select=*`),
      db(`pass_show_guests?event_id=eq.${eventId}&revoked_at=is.null&select=id,name,email,token,gift_session,plural,created_at&order=created_at.asc`),
      db(`pass_show_files?event_id=eq.${eventId}&select=profile_id,guest_id,file_name,file_size,uploaded_at&order=uploaded_at.asc`),
      folders.rootLink(),
    ]);
    if (!artists.ok || !chosen.ok || !guests.ok || !files.ok) return json(502, { error: "No pudimos cargar el line up. ¿Ya corriste los SQL 016 y 017 en Supabase?" });
    const e = ev.data[0];
    return json(200, {
      openmic_enabled: e.openmic_enabled, openmic_folder_link: e.openmic_folder_link, shows_folder_link: e.shows_folder_link,
      shows_deadline: e.shows_deadline, starts_at: e.starts_at, lineup: e.lineup,
      root_folder_link: root, folder_name: folders.folderName(e), folder_name_custom: e.folder_name || "",
      artists: artists.data.map((p) => ({ id: p.id, name: p.display_name || p.full_name || p.email, active: p.active !== false })),
      chosen: chosen.data.map((r) => r.profile_id),
      notified: chosen.data.filter((r) => r.notified_at).map((r) => r.profile_id),
      guests: guests.data.map((g) => ({ id: g.id, name: g.name, email: g.email, gift_session: g.gift_session, plural: g.plural, link: guestLink(event, g.token) })),
      files: files.data,
    });
  }

  if (body.action === "shows_save") {
    const link = (v) => text(v, 600);
    const rootIn = link(body.root_folder_link);
    const openmic = link(body.openmic_folder_link);
    const shows = link(body.shows_folder_link);
    for (const [label, value] of [["madre", rootIn], ["Open Mic", openmic], ["Shows", shows]]) {
      if (!value) continue;
      if (!/^https:\/\/\S+$/.test(value)) return json(400, { error: `El link de la carpeta ${label} no parece un link.` });
      const check = await drive.folder(value).catch((e) => ({ error: String(e && e.message) }));
      if (check.error) return json(400, { error: `No pudimos abrir la carpeta ${label} con ese link. Tiene que ser el link de OneDrive con permiso “Puede editar”.` });
    }
    let deadline = null;
    if (body.shows_deadline) {
      deadline = new Date(body.shows_deadline);
      if (isNaN(deadline)) return json(400, { error: "La fecha límite de las pistas no es válida." });
      deadline = deadline.toISOString();
    }
    if (rootIn !== (await folders.rootLink() || "") && !(await folders.setRootLink(rootIn))) return json(502, { error: "No pudimos guardar la carpeta madre. ¿Ya corriste supabase/017_shows_carpetas.sql?" });

    const ids = [...new Set((Array.isArray(body.artist_ids) ? body.artist_ids : []).map(String).filter((id) => UUID.test(id)))];
    const patch = {
      openmic_folder_link: openmic || null, shows_folder_link: shows || null, shows_deadline: deadline,
      folder_name: text(body.folder_name, 120) || null, updated_at: new Date().toISOString(),
    };
    const res = await db(`pass_events?id=eq.${eventId}`, { method: "PATCH", prefer: "return=representation", body: patch });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos guardar las carpetas del evento." });
    const ev = res.data[0];

    // Line up del sello: se quitan los destildados y se suman los nuevos (los
    // que siguen conservan su aviso, para no mandarles el mail dos veces).
    const before = await db(`pass_show_artists?event_id=eq.${eventId}&select=profile_id`);
    const had = new Set(before.ok ? before.data.map((r) => r.profile_id) : []);
    const gone = [...had].filter((id) => !ids.includes(id));
    const added = ids.filter((id) => !had.has(id));
    if (gone.length && !(await db(`pass_show_artists?event_id=eq.${eventId}&profile_id=in.(${gone.join(",")})`, { method: "DELETE" })).ok) return json(502, { error: "No pudimos guardar quién toca." });
    if (added.length && !(await db("pass_show_artists", { method: "POST", body: added.map((id) => ({ event_id: eventId, profile_id: id })) })).ok) return json(502, { error: "No pudimos guardar quién toca." });

    // Se arman las carpetas de la edición y la de cada artista, para que ya
    // aparezcan en OneDrive (si algo falla, se vuelve a intentar al subir).
    const root = await folders.rootLink();
    let foldersOk = null;
    if (folders.available(ev, "shows", root) || folders.available(ev, "openmic", root)) {
      foldersOk = true;
      try {
        if (ev.openmic_enabled && folders.available(ev, "openmic", root)) {
          const om = await folders.eventFolder(ev, "openmic", root);
          if (om.error) foldersOk = false;
        }
        if (folders.available(ev, "shows", root)) {
          const sh = await folders.eventFolder(ev, "shows", root);
          if (sh.error) foldersOk = false;
          else {
            const names = (await db(`pass_show_artists?event_id=eq.${eventId}&select=profiles(display_name,full_name)`)).data || [];
            const guestNames = (await db(`pass_show_guests?event_id=eq.${eventId}&revoked_at=is.null&folder_link=is.null&select=name`)).data || [];
            for (const n of [...names.map((r) => r.profiles && (r.profiles.display_name || r.profiles.full_name)), ...guestNames.map((g) => g.name)].filter(Boolean)) {
              await drive.subfolder(sh.target, drive.cleanName(n));
            }
          }
        }
      } catch (e) {
        console.error("ZG PASS: carpetas", e);
        foldersOk = false;
      }
    }

    // Aviso por mail a los artistas del sello que todavía no lo recibieron.
    const notified = [];
    if (folders.available(ev, "shows", root) && Date.parse(ev.starts_at) > Date.now() && ev.status !== "cancelled") {
      const pending = await db(`pass_show_artists?event_id=eq.${eventId}&notified_at=is.null&select=profile_id,profiles(email,display_name,full_name,active)`);
      for (const r of pending.ok ? pending.data : []) {
        const p = r.profiles;
        if (!p || !p.email || p.active === false) continue;
        const name = p.display_name || p.full_name || "";
        const sent = await sendMail({ to: p.email, replyTo: notifyEmail(), ...artistMail(ev, name, `${siteUrl(event)}/portal/`) }).catch(() => false);
        if (sent) {
          await db(`pass_show_artists?event_id=eq.${eventId}&profile_id=eq.${r.profile_id}`, { method: "PATCH", body: { notified_at: new Date().toISOString() } });
          notified.push(name);
        }
      }
    }
    await audit("evento_shows", "event", eventId, { name: ev.name, artistas: ids.length, avisados: notified.length }, adminId);
    return json(200, { saved: true, notified, folders_ok: foldersOk });
  }

  // ---------- Invitados sin cuenta: link único para subir pistas ----------
  if (body.action === "guest_add") {
    // Lo normal: solo el nombre, y sube a la carpeta con su nombre adentro de
    // Shows (la usa si ya existe, si no la crea). Si su carpeta está en otro
    // lado, se pega su link y el nombre se toma de esa carpeta.
    const folderLink = text(body.folder_link, 600);
    const email = text(body.email, 160).toLowerCase();
    if (folderLink && !/^https:\/\/\S+$/.test(folderLink)) return json(400, { error: "El link de la carpeta no parece un link." });
    if (!folderLink && !text(body.name, 80)) return json(400, { error: "Poné el nombre artístico del invitado." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Ese mail no parece válido." });
    const evRes = await db(`pass_events?id=eq.${eventId}&select=name,starts_at,venue_name,shows_deadline`);
    const ev = evRes.ok && evRes.data[0];
    if (!ev) return json(404, { error: "No encontramos el evento." });
    let name = text(body.name, 80);
    if (folderLink) {
      const folder = await drive.folder(folderLink).catch((e) => ({ error: String(e && e.message) }));
      if (folder.error) return json(400, { error: "No pudimos abrir esa carpeta. Tiene que ser el link de OneDrive con permiso “Puede editar”." });
      name = name || text(folder.name, 80) || "Artista invitado";
    }
    // Dúo o banda: lo marca el administrador, o se nota en el nombre ("Bastian & Kaino").
    const plural = body.plural === true || /\s(&|y|\+)\s/i.test(` ${name} `);
    const res = await db("pass_show_guests", { method: "POST", prefer: "return=representation", body: { event_id: eventId, name, email: email || null, folder_link: folderLink || null, gift_session: body.gift_session === true, plural } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos crear el link del invitado." });
    const g = res.data[0];
    const link = guestLink(event, g.token);
    await audit("invitado_pistas", "event", eventId, { name, email: !!email }, adminId);
    const emailed = email ? await sendMail({ to: email, replyTo: notifyEmail(), ...guestMail(ev, name, link, plural) }).catch(() => false) : false;
    return json(200, { guest: { id: g.id, name, email: g.email, link }, emailed });
  }

  if (body.action === "guest_remove") {
    const guestId = String(body.guest_id || "");
    if (!UUID.test(guestId)) return json(400, { error: "Invitado inválido." });
    const res = await db(`pass_show_guests?id=eq.${guestId}&event_id=eq.${eventId}`, { method: "PATCH", prefer: "return=representation", body: { revoked_at: new Date().toISOString() } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos desactivar el link." });
    await audit("invitado_pistas_baja", "event", eventId, { name: res.data[0].name }, adminId);
    return json(200, { removed: true });
  }

  // ---------- Acceso de puerta: link solo con scanner, venta en puerta y contador ----------
  if (body.action === "door_list") {
    const res = await db(`pass_door_access?event_id=eq.${eventId}&revoked_at=is.null&select=id,label,token,pin,failed_attempts,created_at&order=created_at.asc`);
    if (!res.ok) return json(502, { error: "No pudimos cargar los accesos de puerta. ¿Ya corriste supabase/017_shows_carpetas.sql?" });
    return json(200, { access: res.data.map((a) => ({ id: a.id, label: a.label, pin: a.pin, locked: a.failed_attempts >= 10, link: `${siteUrl(event)}/puerta?k=${a.token}` })) });
  }
  if (body.action === "door_add") {
    const label = text(body.label, 60);
    if (!label) return json(400, { error: "Poné el nombre de quien va a estar en la puerta." });
    const res = await db("pass_door_access", { method: "POST", prefer: "return=representation", body: { event_id: eventId, label } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos crear el acceso de puerta." });
    await audit("acceso_puerta", "event", eventId, { label }, adminId);
    return json(200, { id: res.data[0].id, label, pin: res.data[0].pin, link: `${siteUrl(event)}/puerta?k=${res.data[0].token}` });
  }
  if (body.action === "door_remove") {
    const id = String(body.access_id || "");
    if (!UUID.test(id)) return json(400, { error: "Acceso inválido." });
    const res = await db(`pass_door_access?id=eq.${id}&event_id=eq.${eventId}`, { method: "PATCH", prefer: "return=representation", body: { revoked_at: new Date().toISOString() } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos dar de baja el acceso." });
    await audit("acceso_puerta_baja", "event", eventId, { label: res.data[0].label }, adminId);
    return json(200, { removed: true });
  }

  // ---------- Publicar / cerrar la venta ----------
  if (body.action === "status") {
    if (!["draft", "published", "closed"].includes(body.status)) return json(400, { error: "Estado inválido." });
    if (body.status === "published") {
      const chk = await db(`pass_events?id=eq.${eventId}&select=starts_at,venue_name,capacity,pass_ticket_types(active)`);
      const e = chk.ok && chk.data[0];
      if (!e) return json(404, { error: "No encontramos el evento." });
      if (Date.parse(e.starts_at) < Date.now()) return json(400, { error: "La fecha del evento ya pasó. Revisala antes de publicar." });
      if (!e.venue_name) return json(400, { error: "Falta el lugar del evento." });
      if (!e.pass_ticket_types.some((t) => t.active)) return json(400, { error: "No hay ningún tipo de entrada activo." });
    }
    const res = await db(`pass_events?id=eq.${eventId}`, { method: "PATCH", prefer: "return=representation", body: { status: body.status, updated_at: new Date().toISOString() } });
    if (!res.ok || !res.data[0]) return json(502, { error: "No pudimos cambiar el estado del evento." });
    await audit("evento_estado", "event", eventId, { status: body.status, name: res.data[0].name }, adminId);
    return json(200, { status: body.status });
  }

  // ---------- Control de acceso ----------
  if (body.action === "peek" || body.action === "checkin") return checkTicket(eventId, body, adminId);

  // ---------- Venta en puerta y bonificadas ----------
  if (body.action === "issue") return issueTickets(event, eventId, body, adminId, { allowComp: true, allowPrice: true });

  return json(400, { error: "Acción desconocida." });
};
