// Automatizaciones por etapa de cada canción (Notion → Canciones → "Etapa
// actual"). La función programada (auto-entregas.js, cada 15 minutos) mira
// en qué etapa está cada canción y la compara con la última vez
// (Supabase → song_stage_log, 025_automatizaciones.sql). Cuando cambia:
//
//   → Mix (voces finales grabadas):
//       · Regla de 15 días: queda anotado ese día. El master tiene que
//         estar como máximo 15 días después (mezcla la primera semana,
//         master la segunda).
//       · Si no hay una sesión de mezcla abierta para esa canción, se
//         agenda sola en el primer hueco libre de 2 h de Google Calendar
//         (respetando gym, almuerzo y la sesión fija de los jueves): tarea
//         en Notion "Mix <canción> <artista>" + evento turquesa en el
//         calendario. La fecha de entrega de la mezcla queda en la semana
//         de la regla (o el día de la sesión, si cae después).
//       · Te llega un mail con el día y la hora.
//       · Sin Google Calendar conectado no se agenda nada a medias (ni la
//         tarea sola ni la fecha sola): te llega un mail y, apenas lo
//         conectás, la próxima pasada la agenda completa (portal_reminders,
//         kind "pendiente-google").
//   → Master: la fecha de entrega pasa al día 15 de la regla. Si la cambiaste
//     a mano en Notion, también se completan las tareas de Mix que quedaban
//     abiertas y sus eventos quedan tildados en el calendario.
//   → Distribución: se crea la tarea "Distribución <canción> <artista>",
//     se cierran las sesiones de Mix/Master que quedaban abiertas (también en
//     el calendario, con ✓) y le llega un mail al equipo de distribución.
//
// La primera vez que corre solo toma nota de dónde está cada canción (no
// agenda nada de golpe).
const { db, sendMail, notifyEmail, esc } = require("./pass");
const gc = require("./gcal");
const ps = () => require("../portal-songs");
const rs = () => require("../admin-reschedule");
const ce = () => require("./cierre-etapa");
const ae = () => require("./auto-entregas");

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const TZ = "America/Argentina/Buenos_Aires";
const ORDER = ["Estructura", "Prod", "Rec", "Mix", "Master", "Distribución", "Publicada"];
const MIX_DAYS = 7, RULE_DAYS = 15, SESSION_MIN = 120;
const COLOR = { Mix: "7", Master: "8", Entrega: "11" }; // los de tu calendario
const PORTAL = "https://www.zechegruv.com/portal/";
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const fmtDay = (date) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00-03:00`)).replace(",", "");

async function notion(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

function songInfo(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    url: page.url,
    title: plain(p["Canción"] && p["Canción"].title) || "Sin título",
    stage: (p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name) || null,
    clientId: ((p.Artista && p.Artista.relation) || [])[0]?.id || null,
    delivery: (p["Fecha de entrega"] && p["Fecha de entrega"].date && p["Fecha de entrega"].date.start) ? p["Fecha de entrega"].date.start.slice(0, 10) : null,
  };
}

const artistCache = new Map();
async function artistName(clientId) {
  if (!clientId) return "";
  if (artistCache.has(clientId)) return artistCache.get(clientId);
  const r = await notion(`/pages/${clientId}`);
  const t = r.ok && Object.values(r.data.properties || {}).find((x) => x && x.type === "title");
  const name = t ? plain(t.title) : "";
  artistCache.set(clientId, name);
  return name;
}

async function openTasks(songId, etapas) {
  const q = await notion(`/data_sources/${ps().TASKS_DS}/query`, {
    method: "POST",
    body: JSON.stringify({ filter: { and: [
      { property: "Canción", relation: { contains: songId } },
      { property: "Estado de Tarea", select: { does_not_equal: "COMPLETADO" } },
      { property: "Estado de Tarea", select: { does_not_equal: "INACTIVA" } },
    ] }, page_size: 50 }),
  });
  if (!q.ok) return [];
  return (q.data.results || []).filter((t) => etapas.includes(t.properties.Etapa && t.properties.Etapa.select && t.properties.Etapa.select.name));
}

async function createTask({ name, etapa, song, start, end, description }) {
  const props = {
    Nombre: { title: [{ text: { content: name } }] },
    Etapa: { select: { name: etapa } },
    "Estado de Tarea": { select: { name: "SIN EMPEZAR" } },
    "Canción": { relation: [{ id: song.id }] },
    Responsable: { multi_select: [{ name: "Yaco Santana" }] },
    ...(song.clientId ? { Cliente: { relation: [{ id: song.clientId }] } } : {}),
    ...(start ? { "Fecha de Vencimiento": { date: { start, ...(end ? { end } : {}) } } } : {}),
    ...(description ? { "Descripción": { rich_text: [{ text: { content: description.slice(0, 1900) } }] } } : {}),
  };
  return notion("/pages", { method: "POST", body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: ps().TASKS_DS }, properties: props }) });
}

// Horario de lo que se agenda solo (mezclas, correcciones de mezcla y de
// master, master después de aprobar la mezcla): de lunes a viernes, desde
// las 15 h, sin chocar con nada de Google Calendar ni con las sesiones de
// Notion. AUTO_SESSIONS_FROM (opcional, en Netlify) = primer día en que se
// puede agendar solo; por defecto el lunes 26 de octubre de 2026 (esa semana
// ya estás al día). Pasada esa fecha no cambia nada.
const AUTO = {
  fromMin: 15 * 60,
  weekdays: [1, 2, 3, 4, 5],
  startDate: (process.env.AUTO_SESSIONS_FROM || "2026-10-26").trim(),
  days: 21,
};

// Sesiones de Notion con horario que todavía no pasaron (por si alguna no
// está en el calendario): también ocupan.
async function notionBusy(fromDay, toDay) {
  const q = await notion(`/data_sources/${ps().TASKS_DS}/query`, {
    method: "POST",
    body: JSON.stringify({ filter: { and: [
      { property: "Fecha de Vencimiento", date: { on_or_after: fromDay } },
      { property: "Fecha de Vencimiento", date: { on_or_before: toDay } },
      { property: "Estado de Tarea", select: { does_not_equal: "COMPLETADO" } },
      { property: "Estado de Tarea", select: { does_not_equal: "INACTIVA" } },
    ] }, page_size: 100 }),
  }).catch(() => null);
  return ((q && q.ok && q.data.results) || []).map((t) => t.properties["Fecha de Vencimiento"] && t.properties["Fecha de Vencimiento"].date)
    .filter((d) => d && d.start && d.end && /T/.test(d.start))
    .map((d) => ({ start: Date.parse(d.start), end: Date.parse(d.end) }));
}

// Primer hueco libre de 2 h dentro de ese horario.
async function firstSlot(now = new Date()) {
  const today = dayAR(now);
  const g = await gc.status().catch(() => ({ connected: false }));
  const until = addDays(today, AUTO.days);
  const busy = g.connected ? await gc.busy(rs()._at(today, 0), rs()._at(until, 0)) : null;
  const all = busy ? [...busy, ...(await notionBusy(today, until))] : null;
  const days = rs()._freeSlots(all, SESSION_MIN, now, AUTO);
  const day = days.find((d) => d.slots.length);
  if (!day) return null;
  const [h, m] = day.slots[0].split(":").map(Number);
  const startMin = h * 60 + m;
  return { date: day.date, time: day.slots[0], start: rs()._at(day.date, startMin), end: rs()._at(day.date, startMin + SESSION_MIN), google: !!busy };
}

const mailBox = (eyebrow, title, body, cta) => `<div style="font-family:Helvetica,Arial,sans-serif;background:#241105;color:#FFF4DC;padding:28px;border-radius:18px;max-width:520px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">${eyebrow}</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700;line-height:1.25">${title}</p>
<div style="font-size:15px;line-height:1.55;color:#F0E0C0">${body}</div>
${cta ? `<p style="margin:20px 0 0"><a href="${cta[1]}" style="display:inline-block;background:#F07800;color:#241105;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${cta[0]}</a></p>` : ""}
</div>`;

// ---------- Acciones ----------
async function onMix(song, log) {
  const out = { song: song.title, stage: "Mix", actions: [] };
  const artist = await artistName(song.clientId);
  const vocals = dayAR(new Date(log.vocals_at || Date.now()));
  const rule = addDays(vocals, RULE_DAYS);

  const existing = await openTasks(song.id, ["Mix"]);
  let slot = null;
  if (!existing.length) {
    slot = await firstSlot();
    // Sin Google Calendar no se agenda a medias: queda pendiente y se agenda
    // completa (tarea + evento + entrega) apenas se conecte.
    if (slot && !slot.google) {
      const mark = await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key: `pendiente-google|${song.id}`, kind: "pendiente-google", song_id: song.id } });
      const fresh = mark.ok && mark.data && mark.data[0];
      // Ya existía (otra vuelta por Mezcla): se vuelve a dejar pendiente.
      if (!fresh) await db(`portal_reminders?key=eq.${encodeURIComponent(`pendiente-google|${song.id}`)}`, { method: "PATCH", body: { kind: "pendiente-google" } });
      if (fresh) {
        await sendMail({
          to: notifyEmail(), from: "ZG Portal <portal@zechegruv.com>",
          subject: `«${song.title}»${artist ? ` (${artist})` : ""} pasó a Mezcla: falta conectar Google Calendar`,
          html: mailBox("Portal · Mezcla sin agendar", `${esc(song.title)}${artist ? ` · ${esc(artist)}` : ""} pasó a Mezcla`,
            `<p style="margin:0 0 10px">No agendé la sesión porque Google Calendar no está conectado (así no queda Notion por un lado y el calendario por otro).</p><p style="margin:0;color:#C9A980">Conectalo desde el Inicio del panel y en menos de 15 minutos se agenda sola en el primer hueco libre.</p>`,
            ["Abrir el panel", PORTAL]),
        }).catch(() => false);
      }
      out.actions.push("esperando-google");
      return out;
    }
    if (slot) {
      const name = `Mix ${song.title}${artist ? ` ${artist}` : ""}`;
      // Primero el evento y después la tarea: si uno falla, no queda el otro solo.
      const ev = await gc.createEvent({
        start: { dateTime: slot.start, timeZone: TZ }, end: { dateTime: slot.end, timeZone: TZ },
        summary: `Mix – ${song.title}${artist ? ` (${artist})` : ""}`, colorId: COLOR.Mix,
        description: `Agendada sola por el portal al pasar a Mezcla. Si no te sirve, movela desde el Inicio del panel (Reprogramar).\nRegla de 15 días: master hasta el ${fmtDay(rule)}.`,
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      });
      out.actions.push(ev.ok ? "calendario" : "calendario-error");
      const t = ev.ok ? await createTask({ name, etapa: "Mix", song, start: slot.start, end: slot.end, description: `Agendada sola al pasar a Mezcla (voces finales: ${vocals}). Regla de 15 días: master hasta el ${rule}.` }) : null;
      out.actions.push(t && t.ok ? "tarea" : `tarea-error ${t ? t.status : "sin-evento"}`);
      if (ev.ok && !(t && t.ok)) await gc.patchEvent(ev.data.id, { summary: `✗ ${ev.data.summary}`, transparency: "transparent", description: `${ev.data.description}\n\n✗ Notion no dejó crear la tarea: agendala desde el Inicio del panel.` }).catch(() => null);
      if (!(t && t.ok)) slot = null; // no se agendó: el mail no lo anuncia
    }
  }
  // Fecha de entrega de la mezcla: la semana de la regla (o el día de la sesión si cae después).
  const sessionDay = slot ? slot.date : null;
  let target = addDays(vocals, MIX_DAYS);
  if (sessionDay && sessionDay > target) target = sessionDay;
  if (target < dayAR(new Date())) target = dayAR(new Date());
  if (!song.delivery || song.delivery < target) {
    const r = await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: "Mezcla" }, song.delivery, target);
    out.actions.push(r.notion ? `entrega ${target}` : "entrega-error");
  }

  if (slot) {
    await sendMail({
      to: notifyEmail(), from: "ZG Portal <portal@zechegruv.com>",
      subject: `Agendé la mezcla de «${song.title}»${artist ? ` (${artist})` : ""}: ${fmtDay(slot.date)} ${slot.time} h`,
      html: mailBox("Portal · Mezcla agendada sola", `${esc(song.title)}${artist ? ` · ${esc(artist)}` : ""} pasó a Mezcla`,
        `<p style="margin:0 0 10px">Te reservé <b>${esc(fmtDay(slot.date))} de ${esc(slot.time)} a ${esc(slot.end.slice(11, 16))} h</b>, el primer hueco libre de 2 h${slot.google ? "" : " según tu rutina (Google Calendar no estaba conectado, así que no está en el calendario)"}.</p>
<p style="margin:0 0 10px">Entrega de la mezcla: <b>${esc(fmtDay(target))}</b>. Regla de 15 días: master hasta el <b>${esc(fmtDay(rule))}</b>.</p>
<p style="margin:0;color:#C9A980">Si no te sirve el horario, movelo desde el Inicio del panel con Reprogramar (cambia Notion y el calendario juntos).</p>`,
        ["Abrir el panel", PORTAL]),
    }).catch(() => false);
    out.actions.push("mail");
  } else if (!existing.length) {
    out.actions.push("sin-hueco");
  }
  return out;
}

async function onMaster(song, log) {
  const out = { song: song.title, stage: "Master", actions: [] };
  if (!log.vocals_at) return out;
  const artist = await artistName(song.clientId);
  const today = dayAR(new Date());
  let rule = addDays(dayAR(new Date(log.vocals_at)), RULE_DAYS);
  if (rule < today) rule = addDays(today, 1); // la regla ya pasó: lo antes posible
  if (song.delivery !== rule && (!song.delivery || song.delivery < today || song.delivery > rule)) {
    const r = await rs()._moveDelivery({ songId: song.id, song: song.title, artist, stage: "Master" }, song.delivery, rule);
    out.actions.push(r.notion ? `entrega ${rule}` : "entrega-error");
  }
  return out;
}

// Pasó a Master desde Notion (a mano): lo de mezcla que quedaba abierto se
// completa (Notion y calendario), y después la fecha del master como siempre.
async function onMasterFromNotion(song, log) {
  const closed = await ae()._closeTasks(song, "mezcla", song.clientId, Infinity).catch(() => []);
  const cal = await ce().tickCalendar(song, "mezcla", song.delivery, new Date(), "La canción pasó a Master").catch(() => "error");
  const out = await onMaster(song, log);
  if (closed.length) out.actions.push(`cerradas ${closed.length}`);
  if (/^tildados/.test(cal)) out.actions.push(`calendario ${cal}`);
  return out;
}

// Mezclas que quedaron sin agendar porque Google Calendar no estaba
// conectado: apenas se conecta, se agendan completas.
async function retryPendingGoogle() {
  const g = await gc.status().catch(() => ({ connected: false }));
  if (!g.connected) return [];
  const rows = await db("portal_reminders?kind=eq.pendiente-google&select=key,song_id");
  const out = [];
  for (const r of (rows.ok && rows.data) || []) {
    const page = await notion(`/pages/${r.song_id}`);
    const song = page.ok ? songInfo(page.data) : null;
    // Ya no hace falta (avanzó o ya tiene sesión): se da por resuelto.
    const claim = await db(`portal_reminders?key=eq.${encodeURIComponent(r.key)}&kind=eq.pendiente-google`, { method: "PATCH", prefer: "return=representation", body: { kind: "pendiente-google-hecho" } });
    if (!claim.ok || !claim.data || !claim.data[0] || !song || song.stage !== "Mix") continue;
    const logRow = await db(`song_stage_log?song_id=eq.${encodeURIComponent(song.id)}&select=*`);
    const res = await onMix(song, (logRow.ok && logRow.data && logRow.data[0]) || {}).catch((e) => ({ song: song.title, error: e.message }));
    // Si justo se desconectó otra vez, onMix lo vuelve a dejar pendiente.
    if (res.actions && res.actions.includes("esperando-google")) await db(`portal_reminders?key=eq.${encodeURIComponent(r.key)}`, { method: "PATCH", body: { kind: "pendiente-google" } });
    out.push(res);
  }
  return out;
}

// ¿El artista de este cliente de Notion distribuye con ZECHE GRUV?
// (028_distribuye.sql; si no se encuentra el perfil, se asume que sí.)
async function distributesWithUs(clientId) {
  if (!clientId) return true;
  const priv = await db(`artist_private?notion_page_id=eq.${clientId}&select=profile_id`);
  const id = priv.ok && priv.data[0] && priv.data[0].profile_id;
  if (!id) return true;
  const prof = await db(`profiles?id=eq.${id}&select=distributes`);
  return !(prof.ok && prof.data[0] && prof.data[0].distributes === false);
}

async function onDistribution(song) {
  const out = { song: song.title, stage: "Distribución", actions: [] };
  const artist = await artistName(song.clientId);
  const ours = await distributesWithUs(song.clientId).catch(() => true);
  // Lo que quedaba abierto de mezcla y master ya no corre.
  const left = await openTasks(song.id, ["Mix", "Master"]);
  await Promise.all(left.map((t) => notion(`/pages/${t.id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Estado de Tarea": { select: { name: "COMPLETADO" } } } }) })));
  if (left.length) out.actions.push(`cerradas ${left.length}`);
  // Y en el calendario: las entregas y sesiones por venir de mezcla y master, con ✓.
  for (const kind of ["mezcla", "master"]) {
    const c = await ce().tickCalendar(song, kind, song.delivery, new Date(), "La canción pasó a Distribución").catch(() => "error");
    if (/^tildados/.test(c)) out.actions.push(`calendario ${kind} ${c}`);
  }
  // Si distribuye por su cuenta: ni tarea ni aviso al equipo.
  if (!ours) { out.actions.push("no distribuye con ZG"); return out; }
  const already = await openTasks(song.id, ["Distribución"]);
  if (!already.length) {
    const t = await createTask({ name: `Distribución ${song.title}${artist ? ` ${artist}` : ""}`, etapa: "Distribución", song, description: "Creada sola al aprobarse el master. Portada, créditos, fecha de lanzamiento y carga en la distribuidora." });
    out.actions.push(t.ok ? "tarea" : `tarea-error ${t.status}`);
  }
  // Aviso al equipo de distribución (cuentas con rol "distribution").
  const team = await db("profiles?role=eq.distribution&select=email,display_name,full_name");
  const to = ((team.ok && team.data) || []).map((p) => p.email).filter(Boolean);
  for (const mail of to) {
    await sendMail({
      to: mail, from: "ZG Portal <portal@zechegruv.com>", replyTo: notifyEmail(),
      subject: `Nuevo para distribuir: «${song.title}»${artist ? ` de ${artist}` : ""}`,
      html: mailBox("ZECHE GRUV · Distribución", `«${esc(song.title)}»${artist ? ` de ${esc(artist)}` : ""} ya tiene el master aprobado`,
        `<p style="margin:0">Está lista para cargar. En el portal, en Distribución, tenés la ficha del artista para completar el lanzamiento.</p>`, ["Abrir Distribución", PORTAL]),
    }).catch(() => false);
  }
  if (to.length) out.actions.push(`mail ${to.length}`);
  return out;
}

// ---------- Vigilar etapas ----------
async function watchStages() {
  if (!notionToken()) return { ok: false, error: "Falta NOTION_TOKEN." };
  const logRes = await db("song_stage_log?select=song_id,stage,changed_at,vocals_at&limit=5000");
  if (!logRes.ok) return { ok: false, error: logRes.status === 404 ? "Falta correr 025_automatizaciones.sql." : `log ${logRes.status}` };
  const log = new Map((logRes.data || []).map((r) => [r.song_id, r]));
  const firstRun = log.size === 0;
  const pages = await ps()._notionQuery(ps().SONGS_DS);
  const done = [];
  for (const page of pages) {
    const song = songInfo(page);
    if (!song.stage) continue;
    const prev = log.get(song.id);
    const now = new Date().toISOString();
    if (!prev) {
      const ins = await db("song_stage_log?on_conflict=song_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { song_id: song.id, stage: song.stage, changed_at: now, vocals_at: song.stage === "Mix" && !firstRun ? now : null } });
      // Canción nueva que aparece directo en Mix: se trata como recién llegada.
      if (!firstRun && ins.ok && ins.data && ins.data[0] && song.stage === "Mix") done.push(await onMix(song, ins.data[0]).catch((e) => ({ song: song.title, error: e.message })));
      continue;
    }
    if (prev.stage === song.stage) continue;
    const forward = ORDER.indexOf(song.stage) > ORDER.indexOf(prev.stage);
    const enteringMix = song.stage === "Mix" && ORDER.indexOf(prev.stage) < ORDER.indexOf("Mix");
    const patch = { stage: song.stage, changed_at: now, ...(enteringMix ? { vocals_at: now } : {}) };
    // Solo una pasada se queda con el cambio (si corren dos juntas).
    const claim = await db(`song_stage_log?song_id=eq.${encodeURIComponent(song.id)}&stage=eq.${encodeURIComponent(prev.stage)}`, { method: "PATCH", prefer: "return=representation", body: patch });
    const row = claim.ok && claim.data && claim.data[0];
    if (!row || !forward) continue; // volvió para atrás: solo se anota
    try {
      if (enteringMix) done.push(await onMix(song, row));
      else if (song.stage === "Master") done.push(await onMasterFromNotion(song, row));
      else if (song.stage === "Distribución") done.push(await onDistribution(song));
    } catch (e) {
      done.push({ song: song.title, error: String(e && e.message).slice(0, 80) });
    }
  }
  done.push(...(await retryPendingGoogle().catch(() => [])));
  return { ok: true, firstRun, songs: pages.length, done };
}

// ---------- Regla de 15 días: aviso diario ----------
// Una vez por día (a partir de las 10 h): las canciones en Mix o Master cuyo
// día 15 llega en 2 días o menos (o ya pasó) y todavía no tienen el master entregado.
async function ruleDigest(now = new Date()) {
  const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now);
  if (hour < 10) return { skipped: "hora" };
  const today = dayAR(now);
  const claim = await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key: `regla15|${today}`, kind: "regla15" } });
  if (!claim.ok || !claim.data || !claim.data[0]) return { skipped: "ya enviado" };
  const rows = await db("song_stage_log?vocals_at=not.is.null&stage=in.(Mix,Master)&select=song_id,stage,vocals_at");
  const list = [];
  for (const r of (rows.ok && rows.data) || []) {
    const limit = addDays(dayAR(new Date(r.vocals_at)), RULE_DAYS);
    const left = daysBetween(today, limit);
    if (left > 2) continue;
    const page = await notion(`/pages/${r.song_id}`);
    if (!page.ok) continue;
    const p = page.data.properties || {};
    const entrega = p.Entrega && p.Entrega.select && p.Entrega.select.name;
    if (entrega === "Master entregado" || entrega === "Master aprobado") continue;
    const s = songInfo(page.data);
    list.push({ title: s.title, artist: await artistName(s.clientId), stage: s.stage, left, limit });
  }
  if (!list.length) return { sent: 0 };
  list.sort((a, b) => a.left - b.left);
  const line = (x) => `<li style="margin:0 0 8px"><b>${esc(x.title)}</b>${x.artist ? ` · ${esc(x.artist)}` : ""} — ${x.left < 0 ? `<span style="color:#FF9C7A">se pasó ${-x.left} ${-x.left === 1 ? "día" : "días"}</span>` : x.left === 0 ? "<span style=\"color:#FF9C7A\">vence hoy</span>" : `quedan ${x.left} ${x.left === 1 ? "día" : "días"}`} (en ${x.stage === "Mix" ? "mezcla" : "master"})</li>`;
  await sendMail({
    to: notifyEmail(), from: "ZG Portal <portal@zechegruv.com>",
    subject: `Regla de 15 días: ${list.length === 1 ? `«${list[0].title}»` : `${list.length} canciones`} ${list[0].left < 0 ? "pasadas" : "por vencer"}`,
    html: mailBox("Portal · Regla de 15 días", "Masters por vencer", `<ul style="margin:0;padding-left:18px">${list.map(line).join("")}</ul><p style="margin:12px 0 0;color:#C9A980">Desde el Inicio del panel podés reprogramar cada una según tus huecos libres.</p>`, ["Abrir el panel", PORTAL]),
  }).catch(() => false);
  return { sent: list.length };
}

// Para el Inicio del panel: día límite de la regla de cada canción.
async function ruleLimits() {
  const rows = await db("song_stage_log?vocals_at=not.is.null&stage=in.(Mix,Master)&select=song_id,vocals_at");
  const out = {};
  ((rows.ok && rows.data) || []).forEach((r) => { out[r.song_id.replace(/-/g, "")] = addDays(dayAR(new Date(r.vocals_at)), RULE_DAYS); });
  return out;
}

module.exports = { watchStages, ruleDigest, ruleLimits, _onMix: onMix, _onMaster: onMaster, _onDistribution: onDistribution, _firstSlot: firstSlot, AUTO, _createTask: createTask, _openTasks: openTasks, _artistName: artistName };
