// Entregas automáticas de mezclas y masters.
//
// Cuando Zeche sube un audio (WAV, MP3 o M4A) con "mix"/"mezcla" o "master"
// en el nombre a la carpeta del artista (Exports o Masters, ver
// song-audio.js), la canción se marca sola como entregada. Sin tocar nada:
//   1. Notion → Canciones → "Entrega": Mezcla entregada / Master entregado.
//      Si es el master, se borra la "Fecha de entrega" (ya no hay nada que
//      entregar, solo falta que el artista lo apruebe).
//   2. Notion → Tareas Pendientes: las sesiones de Mix / Master de esa
//      canción que seguían abiertas pasan a COMPLETADO, así no siguen
//      apareciendo en el Inicio del panel. Solo las que ya existían cuando
//      se subió el audio: si después el artista pide cambios y agendás una
//      sesión nueva, esa queda abierta hasta que subas la versión nueva.
//   3. Supabase → song_approvals: queda registrada la entrega (source
//      'admin'). Así el aviso viejo del Inicio de esa canción (p. ej. "pidió
//      cambios") se va solo y al artista le aparece para escuchar y aprobar.
//   4. Google Calendar (si está conectado): el evento "Entrega:" de esa
//      canción queda tildado con ✓ (no se borra nada).
//
// Cada audio se procesa una sola vez: si ya hay algo registrado para esa
// canción después de que se subió (la entrega automática, el botón
// Entregado o la respuesta del artista), no se vuelve a tocar. Si la
// canción ya figura aprobada, tampoco.
//
// Corre: cada 15 minutos (auto-entregas.js, programada en netlify.toml), al
// abrir el Inicio del panel y cuando un artista abre sus canciones.
const { db, sendMail, esc } = require("./pass");
const { listAudio, matchAudio, norm } = require("./song-audio");
const gc = require("./gcal");

// portal-songs.js también usa este archivo: se pide recién al usarlo.
const ps = () => require("../portal-songs");

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const TZ = "America/Argentina/Buenos_Aires";
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const time = (iso) => Date.parse(iso || "") || 0;
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const KIND_OF_STEP = { 3: "mezcla", 4: "master" };
const LABEL = {
  mezcla: { entregada: "Mezcla entregada", aprobada: "Mezcla aprobada", stage: "Mix", short: "Mix" },
  master: { entregada: "Master entregado", aprobada: "Master aprobado", stage: "Master", short: "Master" },
};

async function notion(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

// ¿Esta tarea es la sesión de mezcla (o de master)? Por la columna Etapa o,
// si está vacía, por cómo empieza el nombre ("Mix Seu amor", "Master ...").
function taskKind(p) {
  const etapa = p.Etapa && p.Etapa.select && p.Etapa.select.name;
  if (etapa === "Mix") return "mezcla";
  if (etapa === "Master") return "master";
  if (etapa) return null;
  const name = plain(p.Nombre && p.Nombre.title);
  if (/^(master|mastering)\b/i.test(name)) return "master";
  if (/^(mix|mezcla)\b/i.test(name)) return "mezcla";
  return null;
}

// Cierra las sesiones de esa canción y etapa que ya existían al subir el audio.
async function closeTasks(song, kind, clientId, uploadedAt) {
  const q = await notion(`/data_sources/${ps().TASKS_DS}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { and: [
        { property: "Estado de Tarea", select: { does_not_equal: "COMPLETADO" } },
        { property: "Estado de Tarea", select: { does_not_equal: "INACTIVA" } },
        { or: [
          { property: "Canción", relation: { contains: song.id } },
          { property: "Nombre", title: { contains: song.title } },
        ] },
      ] },
      page_size: 50,
    }),
  });
  if (!q.ok) return [];
  const key = ` ${norm(song.title)} `;
  const picked = (q.data.results || []).filter((t) => {
    const p = t.properties || {};
    if (taskKind(p) !== kind) return false;
    if (time(t.created_time) > uploadedAt) return false; // agendada después del audio
    const songs = (p["Canción"] && p["Canción"].relation) || [];
    if (songs.length) return songs.some((r) => sameId(r.id, song.id));
    // Sin canción vinculada: tiene que nombrarla y ser del mismo artista.
    const clients = (p.Cliente && p.Cliente.relation) || [];
    if (clientId && clients.length && !clients.some((r) => sameId(r.id, clientId))) return false;
    return ` ${norm(plain(p.Nombre && p.Nombre.title))} `.includes(key);
  });
  const done = await Promise.all(picked.map((t) => notion(`/pages/${t.id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { "Estado de Tarea": { select: { name: "COMPLETADO" } } } }),
  })));
  return picked.filter((t, i) => done[i].ok).map((t) => plain(t.properties.Nombre && t.properties.Nombre.title));
}

// Tilda con ✓ el evento "Entrega:" de la canción en Google Calendar.
async function tickCalendar(song, kind, deliveryDate) {
  try {
    if (!(await gc.status()).connected) return "sin-google";
    const ref = deliveryDate || dayAR(new Date());
    const list = await gc.events(`${addDays(ref, -10)}T00:00:00-03:00`, `${addDays(ref, 30)}T00:00:00-03:00`);
    if (!list) return "error";
    const key = norm(song.title);
    const isStage = kind === "master" ? /master/i : /\b(mix|mezcla)/i;
    const ev = list.find((e) => e.start && e.start.date && /^entrega/i.test(e.summary || "") && isStage.test(e.summary || "") && norm(e.summary).includes(key));
    if (!ev) return "sin-evento";
    const r = await gc.patchEvent(ev.id, {
      summary: `✓ ${ev.summary}`,
      description: `${ev.description ? `${ev.description}\n\n` : ""}✓ ${LABEL[kind].entregada} (se marcó solo al subir el audio a la carpeta).`,
    });
    return r.ok ? "tildado" : "error";
  } catch (e) {
    return "error";
  }
}

async function deliver({ profileId, clientId, song, kind, file, deliveryDate }) {
  const props = { Entrega: { select: { name: LABEL[kind].entregada } } };
  if (kind === "master") props["Fecha de entrega"] = { date: null };
  const upd = await notion(`/pages/${song.id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
  if (!upd.ok) return { song: song.title, kind, error: `notion ${upd.status}` }; // se reintenta en la próxima pasada

  const uploadedAt = time(file.modified);
  const [saved, tasks, calendar] = await Promise.all([
    db("song_approvals", { method: "POST", prefer: "return=minimal", body: {
      profile_id: profileId, song_id: song.id, song_title: song.title, kind, action: "entregada", source: "admin",
      note: `Entregado solo al subir «${file.name}» a la carpeta.`.slice(0, 1000),
    } }),
    closeTasks(song, kind, clientId, uploadedAt),
    tickCalendar(song, kind, deliveryDate),
  ]);
  if (!saved.ok) console.error("auto-entregas song_approvals:", saved.status);
  return { song: song.title, kind, file: file.name, tasks, calendar, saved: saved.ok };
}

// ---------- Recordatorio al artista ----------
// Si una mezcla o un master lleva 3 días esperando que el artista lo
// escuche (y no respondió nada), le llega un mail cálido de ZG Portal. Si
// a los 7 días sigue igual, uno más. Nunca más de eso por versión, solo de
// 10 a 20 h y solo desde la función programada.
const REMIND_DAYS = [3, 7];
const PORTAL = "https://www.zechegruv.com/portal/";
const TZ_AR = "America/Argentina/Buenos_Aires";
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
function remindMail({ name, song, kind, step, since }) {
  const master = kind === "master";
  const what = master ? `el master de «${song}»` : `tu mezcla de «${song}»`;
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: TZ_AR, weekday: "long", day: "numeric", month: "long" }).format(new Date(since)).replace(",", "");
  const subject = step === 0
    ? (master ? `El master de «${song}» te está esperando` : `Tu mezcla de «${song}» te está esperando`)
    : `«${song}» sigue esperando tu oído`;
  const lead = step === 0
    ? `${capFirst(what)} está ${master ? "listo" : "lista"} desde el ${day}. Ponete los auriculares, ${master ? "escuchalo" : "escuchala"} de punta a punta y contanos qué sentís.`
    : `Para que tu canción siga avanzando, necesitamos tu oído: ${what} sigue esperando desde el ${day}.`;
  const next = master
    ? "Si lo aprobás, pasa a distribución y empieza a acercarse el día del lanzamiento. Si algo no te cierra, marcá el segundo exacto y lo ajustamos."
    : "Si la aprobás, arrancamos con el master. Si algo no te cierra, marcá el segundo exacto en el audio y lo ajustamos.";
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;background:#241105;color:#FFF4DC;padding:28px;border-radius:18px;max-width:520px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">ZECHE GRUV · ${master ? "Master" : "Mezcla"} para escuchar</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700;line-height:1.25">${name ? `${esc(name)}, ` : ""}${esc(lead.charAt(0).toLowerCase() + lead.slice(1))}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#F0E0C0">${esc(next)}</p>
<p style="margin:0 0 18px"><a href="${PORTAL}" style="display:inline-block;background:#F07800;color:#241105;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Escuchar en el portal</a></p>
<p style="margin:0;font-size:13px;color:#C9A980">¿Alguna duda? Respondé este mail y lo hablamos.</p>
</div>`;
  return { subject, html };
}
const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);

async function remindArtist({ profileId, email, name, songs, files, rows }, now = Date.now()) {
  if (!email) return [];
  const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: TZ_AR, hour: "2-digit", hour12: false }).format(new Date(now));
  if (hour < 10 || hour >= 20) return [];
  const sent = [];
  for (const song of songs) {
    const kind = KIND_OF_STEP[song.step];
    const file = kind && files[song.id] && files[song.id][kind];
    if (!file || song.entrega === LABEL[kind].aprobada) continue;
    const since = time(file.modified);
    // ¿El artista ya respondió algo sobre esta versión?
    if (rows.some((r) => sameId(r.song_id, song.id) && r.kind === kind && (r.source || "artist") === "artist" && time(r.created_at) >= since)) continue;
    const age = (now - since) / 86400000;
    const step = REMIND_DAYS.filter((d) => age >= d).length - 1;
    if (step < 0) continue;
    const key = `recordatorio|${song.id}|${kind}|${file.name}|${file.modified}|${step}`;
    const claim = await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key, kind: "recordatorio", profile_id: profileId, song_id: song.id } });
    if (!claim.ok || !claim.data || !claim.data[0]) continue; // ya se mandó (o falta 025)
    // El primer aviso que se perdió no se manda tarde si ya toca el segundo.
    if (step === 1) await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { key: key.replace(/\|1$/, "|0"), kind: "recordatorio", profile_id: profileId, song_id: song.id } });
    const mail = remindMail({ name: firstName(name), song: song.title, kind, step, since: file.modified });
    const ok = await sendMail({ to: email, from: "ZG Portal <portal@zechegruv.com>", replyTo: require("./pass").notifyEmail(), ...mail }).catch(() => false);
    sent.push({ song: song.title, kind, step, ok });
  }
  return sent;
}

// Revisa la carpeta de un artista y marca lo que haya para entregar.
//   pageId: su ficha en Clientes (Notion). folder: link de su OneDrive.
//   songPages / audios: si ya se leyeron (portal-songs), no se piden de nuevo.
async function syncArtist({ profileId, pageId, folder, songPages, audios, remind }) {
  if (!notionToken() || !pageId || !folder) return [];
  const pages = songPages || await ps()._notionQuery(ps().SONGS_DS, { property: "Artista", relation: { contains: pageId } });
  const raw = Object.fromEntries(pages.map((pg) => [pg.id, pg]));
  const songs = pages.map(ps()._toSong);
  const open = songs.filter((s) => KIND_OF_STEP[s.step]);
  if (!open.length) return [];

  const files = matchAudio(songs, audios || await listAudio(folder));
  const todo = open.map((s) => ({ song: s, kind: KIND_OF_STEP[s.step] })).filter(({ song, kind }) => files[song.id] && files[song.id][kind]);
  if (!todo.length) return [];

  const rows = await db(`song_approvals?profile_id=eq.${profileId}&select=song_id,kind,action,source,created_at&order=created_at.desc&limit=300`);
  if (!rows.ok) return []; // sin la tabla no hay forma de saber qué ya se procesó
  const out = [];
  if (remind) {
    const reminded = await remindArtist({ profileId, email: remind.email, name: remind.name, songs: open, files, rows: rows.data }).catch(() => []);
    reminded.forEach((r) => out.push({ ...r, reminder: true }));
  }
  for (const { song, kind } of todo) {
    const file = files[song.id][kind];
    if (song.entrega === LABEL[kind].aprobada) continue; // ya está aprobada
    const last = rows.data.find((r) => sameId(r.song_id, song.id) && r.kind === kind);
    if (last && time(last.created_at) >= time(file.modified)) continue; // ya procesado (o el artista ya respondió)
    const p = (raw[song.id] && raw[song.id].properties) || {};
    const deliveryDate = p["Fecha de entrega"] && p["Fecha de entrega"].date && p["Fecha de entrega"].date.start;
    out.push(await deliver({ profileId, clientId: pageId, song, kind, file, deliveryDate: deliveryDate ? deliveryDate.slice(0, 10) : null }));
  }
  return out;
}

// Todos los artistas activos con carpeta. Devuelve lo que se marcó.
async function syncAll({ remind = false } = {}) {
  if (!notionToken()) return { ok: false, error: "Falta NOTION_TOKEN." };
  const [profiles, privs] = await Promise.all([
    db("profiles?select=*"),
    db("artist_private?select=profile_id,notion_page_id,onedrive_link,onedrive_edit_link"),
  ]);
  if (!profiles.ok || !privs.ok) return { ok: false, error: "No se pudo leer Supabase." };
  const priv = Object.fromEntries((privs.data || []).map((r) => [r.profile_id, r]));
  const artists = (profiles.data || []).filter((p) => p.role !== "admin" && p.active !== false && priv[p.id] && (priv[p.id].onedrive_edit_link || priv[p.id].onedrive_link));

  const delivered = [], errors = [], reminders = [];
  // De a 4 artistas a la vez, para no saturar OneDrive ni Notion.
  for (let i = 0; i < artists.length; i += 4) {
    await Promise.all(artists.slice(i, i + 4).map(async (a) => {
      try {
        const r = priv[a.id];
        const pageId = ps()._parsePageId(r.notion_page_id) || ps()._parsePageId(await ps()._findClient(a));
        const done = await syncArtist({ profileId: a.id, pageId, folder: r.onedrive_edit_link || r.onedrive_link, remind: remind ? { email: a.email, name: a.display_name || a.full_name } : null });
        done.forEach((d) => (d.error ? errors : d.reminder ? reminders : delivered).push({ ...d, artist: a.display_name || a.full_name || "" }));
      } catch (e) {
        errors.push({ artist: a.display_name || a.full_name || "", error: String(e && e.message).slice(0, 80) });
      }
    }));
  }
  return { ok: true, artists: artists.length, delivered, errors, reminders };
}

module.exports = { syncArtist, syncAll, _taskKind: taskKind, _closeTasks: closeTasks, _remindArtist: remindArtist, _remindMail: remindMail };
