// Notificaciones del portal (Web Push): activar un dispositivo, avisos del
// proyecto (una sola vez, con preferencias), horario de silencio 00–9 h,
// avisos de eventos (open mic a quien no toca, día del show a quien toca,
// tope semanal) y line up → quién toca, solo.
const H = require("./h");
const crypto = require("crypto");
const path = require("path");
const { S, page, title, sel, relp, F, check, done, setup, adminEvent, parse } = H;
setup();

// ---------- Lo que el simulador compartido no trae ----------
// Filtros de PostgREST gte./lte./gt./lt., insertar varias filas y
// on_conflict con columnas compuestas o "merge-duplicates".
const base = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("supabase.co/rest/v1/") || u.includes("/rpc/")) return base(url, init);
  const x = new URL(u);
  const table = x.pathname.replace("/rest/v1/", "");
  const m = init.method || "GET";
  const cmp = [...x.searchParams].filter(([, v]) => /^(gte|lte|gt|lt)\./.test(v));
  const body = init.body ? JSON.parse(init.body) : null;
  const conflict = x.searchParams.get("on_conflict");
  const prefer = (init.headers && init.headers.Prefer) || "";
  if (m === "POST" && (Array.isArray(body) || (conflict && (conflict.includes(",") || /merge-duplicates/.test(prefer))))) {
    const all = (S.tables[table] = S.tables[table] || []);
    const cols = (conflict || "").split(",").filter(Boolean);
    const out = [];
    for (const b of Array.isArray(body) ? body : [body]) {
      const hit = cols.length && all.find((r) => cols.every((c) => String(r[c]) === String(b[c])));
      if (hit) { if (/merge-duplicates/.test(prefer)) { Object.assign(hit, b); out.push(hit); } continue; }
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...b };
      all.push(row); out.push(row);
    }
    return { ok: true, status: 201, json: async () => out, text: async () => JSON.stringify(out) };
  }
  if (!cmp.length) return base(url, init);
  cmp.forEach(([k]) => x.searchParams.delete(k));
  const all = (S.tables[table] = S.tables[table] || []);
  const pass = (r) => cmp.every(([k, v]) => {
    const [op, ...rest] = v.split("."); const want = decodeURIComponent(rest.join("."));
    const a = Date.parse(r[k]), b = Date.parse(want);
    const [p, q] = isNaN(a) || isNaN(b) ? [String(r[k]), want] : [a, b];
    return op === "gte" ? p >= q : op === "lte" ? p <= q : op === "gt" ? p > q : p < q;
  });
  const hidden = all.filter((r) => !pass(r));
  S.tables[table] = all.filter((r) => pass(r));
  try { return await base(x.toString(), init); } finally { S.tables[table].push(...hidden); }
};

// ---------- Servicio de notificaciones simulado ----------
const pushes = [];
S.extraFetch = async (url, init) => {
  if (!/push\.apple\.com/.test(url)) return null;
  if (/gone/.test(url)) return { ok: false, status: 410, json: async () => ({}), text: async () => "" };
  pushes.push({ url, headers: init.headers, size: init.body && init.body.length });
  return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
};
const webpush = require(path.join(H.ROOT, "node_modules/web-push"));
const vapid = webpush.generateVAPIDKeys();
const on = () => Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });
const off = () => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; };
// Una suscripción de navegador con claves de verdad (para que web-push cifre).
function browserSub(host = "web.push.apple.com", tag = "") {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint: `https://${host}/fcm/send/${tag}${crypto.randomBytes(8).toString("hex")}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } };
}

const push = require(path.join(H.ROOT, "netlify/functions/_lib/push"));
const eventos = require(path.join(H.ROOT, "netlify/functions/_lib/push-eventos"));
const { matchLineup } = require(path.join(H.ROOT, "netlify/functions/_lib/lineup"));
const { SONGS_DS } = F("portal-songs");
const mark = F("portal-mark");
const portalPush = F("portal-push");
const at = (iso) => { push._clock.now = () => new Date(iso); };
const real = () => { push._clock.now = () => new Date(); };

const PAZZ = "42000000-0000-4000-8000-000000000001";
const LUNA = "42000000-0000-4000-8000-000000000002";
const BAST = "42000000-0000-4000-8000-000000000003";
const ROUSE = "42000000-0000-4000-8000-000000000004";
S.tables.profiles.push(
  { id: PAZZ, role: "artist", email: "pazz@prueba.test", display_name: "Pazz", active: true },
  { id: LUNA, role: "artist", email: "luna@prueba.test", display_name: "Luna Prisma", active: true },
  { id: BAST, role: "artist", email: "bastian@prueba.test", display_name: "Bastian", active: true },
  { id: ROUSE, role: "artist", email: "rouse@prueba.test", display_name: "Rouse Bby", active: true },
);
S.tables.song_approvals = S.tables.song_approvals || [];
S.tables.portal_reminders = S.tables.portal_reminders || [];
S.tables.push_subscriptions = [];
S.tables.push_queue = [];
const ev = (who, method, body, qs) => ({ httpMethod: method, headers: { authorization: `Bearer tok-${who}` }, body: body ? JSON.stringify(body) : undefined, queryStringParameters: qs || {} });
let n = 0;
const song = (t, stage = "Mix") => page(SONGS_DS, `b4200000-0000-4000-8000-00000000000${++n}`, { "Canción": title(t), "Etapa actual": sel(stage), Artista: relp([]) });
const deliver = (s, who, kind = "mezcla") => mark.handler(adminEvent("POST", { song: s.id, kind, action: "entregada", artist: who })).then(parse);
const queueOf = (who) => S.tables.push_queue.filter((r) => r.profile_id === who);

(async () => {
  // ---------- Sin claves: nada se muestra ni se manda ----------
  off();
  const g0 = parse(await portalPush.handler(ev(PAZZ, "GET")));
  check("sin claves VAPID: el portal sabe que no está configurado", g0.status === 200 && g0.body.configured === false && g0.body.publicKey === null, g0.body);

  // ---------- Activar un dispositivo ----------
  on();
  const g1 = parse(await portalPush.handler(ev(PAZZ, "GET")));
  check("con las claves: da la clave pública y los dos tipos prendidos", g1.body.configured && g1.body.publicKey === vapid.publicKey && g1.body.proyecto && g1.body.novedades && g1.body.devices === 0, g1.body);
  const bad = parse(await portalPush.handler(ev(PAZZ, "POST", { action: "subscribe", subscription: { endpoint: "https://evil.example.com/x", keys: browserSub().keys } })));
  check("una dirección que no es de un navegador se rechaza", bad.status === 400, bad);
  const subPazz = browserSub();
  const s1 = parse(await portalPush.handler(ev(PAZZ, "POST", { action: "subscribe", subscription: subPazz, device: "iPhone" })));
  await portalPush.handler(ev(PAZZ, "POST", { action: "subscribe", subscription: subPazz, device: "iPhone" }));
  check("activar este celu guarda el dispositivo (y repetirlo no lo duplica)", s1.status === 200 && S.tables.push_subscriptions.filter((r) => r.profile_id === PAZZ).length === 1, S.tables.push_subscriptions);

  // ---------- Mezcla lista: notificación una sola vez ----------
  at("2026-10-21T15:00:00-03:00");
  const sA = song("Faro");
  await deliver(sA, PAZZ);
  const q1 = queueOf(PAZZ);
  check("Entregado: sale la notificación al toque (15 h)", pushes.length === 1 && q1.length === 1 && q1[0].sent_at && /^ok 1\/1/.test(q1[0].result), { pushes: pushes.length, q1 });
  check("con el título de la mezcla y abre Tus canciones", q1[0].title === "Tu mezcla de «Faro» está lista" && q1[0].url === "/portal/#canciones" && /Hola Pazz/.test(q1[0].body) && /modificaciones/.test(q1[0].body), q1[0]);
  const h = pushes[0].headers;
  check("va cifrada y firmada (aes128gcm + VAPID)", h["Content-Encoding"] === "aes128gcm" && /^vapid t=/.test(h.Authorization) && +h.TTL > 0, h);
  await Promise.all([deliver(sA, PAZZ), deliver(sA, PAZZ)]);
  check("doble clic en Entregado: no sale otra", pushes.length === 1, pushes.length);

  // ---------- Horario de silencio ----------
  S.tables.song_approvals.forEach((r) => { r.created_at = new Date(Date.parse("2026-10-21T15:00:00-03:00") - 3600e3).toISOString(); });
  at("2026-10-22T03:10:00-03:00");
  const sB = song("Niebla");
  await deliver(sB, PAZZ);
  const qB = queueOf(PAZZ).find((r) => /Niebla/.test(r.title));
  check("a las 3 de la mañana no sale: queda para las 9", pushes.length === 1 && qB && !qB.sent_at && Date.parse(qB.not_before) === Date.parse("2026-10-22T09:00:00-03:00"), qB);
  at("2026-10-22T08:55:00-03:00"); await push.flush();
  check("a las 8:55 todavía no", pushes.length === 1, pushes.length);
  at("2026-10-22T09:05:00-03:00"); await push.flush(); await push.flush();
  check("a las 9:05 sale, una sola vez", pushes.length === 2 && qB.sent_at, { pushes: pushes.length, qB });

  // ---------- Preferencias ----------
  at("2026-10-22T16:00:00-03:00");
  S.tables.profiles.find((p) => p.id === PAZZ).notif_proyecto = false;
  await deliver(song("Calma"), PAZZ);
  check("con «Tu proyecto» apagado: no sale (el mail sí)", pushes.length === 2 && S.mails.some((m) => (m.to || []).includes("pazz@prueba.test") && /Calma/.test(m.subject)), pushes.length);
  S.tables.profiles.find((p) => p.id === PAZZ).notif_proyecto = true;

  // ---------- Dispositivo dado de baja ----------
  const gone = browserSub("web.push.apple.com", "gone");
  await portalPush.handler(ev(ROUSE, "POST", { action: "subscribe", subscription: gone, device: "Android" }));
  await deliver(song("Brisa"), ROUSE);
  check("si el navegador dice que el dispositivo ya no existe (410), se borra", !S.tables.push_subscriptions.some((r) => r.endpoint === gone.endpoint), S.tables.push_subscriptions.map((r) => r.endpoint));

  // ---------- Sin dispositivo: no se encola ----------
  const before = S.tables.push_queue.length;
  await deliver(song("Sin celu"), LUNA);
  check("sin dispositivo activado: no se guarda nada en la cola", S.tables.push_queue.length === before, S.tables.push_queue.length - before);

  // ---------- Prueba desde Mi perfil ----------
  const t1 = parse(await portalPush.handler(ev(PAZZ, "POST", { action: "test" })));
  check("«Probar» manda una al toque", t1.body.ok && pushes.length === 3, t1.body);

  // ---------- Line up → quién toca ----------
  const artists = S.tables.profiles.filter((p) => p.role === "artist");
  const m1 = matchLineup(["PAZZ", "Rose Bby", "Bastian & Kaino", "Invitado Sorpresa", "Luna"], artists);
  const name = (id) => artists.find((a) => a.id === id).display_name;
  check("line up: mayúsculas, una letra de diferencia y dúos se reconocen",
    m1.ids.map(name).sort().join(",") === "Bastian,Pazz,Rouse Bby" && m1.unmatched.join(",") === "Invitado Sorpresa,Luna", { ids: m1.ids.map(name), unmatched: m1.unmatched });

  const admin = F("pass-admin");
  S.tables.pass_events = []; S.tables.pass_ticket_types = []; S.tables.pass_show_artists = []; S.tables.pass_settings = []; S.tables.pass_audit = [];
  const EVT = { kind: "show", name: "Shows & Open Mic 3", starts_at: "2026-10-31T20:00:00-03:00", venue_name: "Teatro Sergio Souza", capacity: 100, max_per_buyer: 2, openmic_enabled: true, lineup: ["Pazz", "Rose Bby", "Bastian & Kaino", "Invitado Sorpresa"] };
  const TT = [{ name: "General", price: 5000 }];
  const c = parse(await admin.handler(adminEvent("POST", { action: "event_save", event: EVT, ticket_types: TT })));
  const evId = c.body.id;
  const playing = () => S.tables.pass_show_artists.filter((r) => r.event_id === evId).map((r) => name(r.profile_id)).sort().join(",");
  check("al guardar el evento, los del line up que son del sello quedan como que tocan", c.status === 200 && playing() === "Bastian,Pazz,Rouse Bby", { status: c.status, body: c.body, playing: playing() });
  check("y el panel dice quiénes son y quién no tiene cuenta", c.body.lineup && c.body.lineup.others.join() === "Invitado Sorpresa" && c.body.lineup.artists.length === 3, c.body.lineup);
  // Luna tildada a mano en Carpetas (no está en el line up).
  S.tables.pass_show_artists.push({ event_id: evId, profile_id: LUNA });
  const e2 = parse(await admin.handler(adminEvent("POST", { action: "event_save", event_id: evId, event: { ...EVT, lineup: ["Rouse Bby", "Bastian & Kaino"] }, ticket_types: TT })));
  check("si sacás a Pazz del line up, sale solo; la tildada a mano se queda", e2.status === 200 && playing() === "Bastian,Luna Prisma,Rouse Bby", playing());
  S.tables.pass_show_artists = S.tables.pass_show_artists.filter((r) => r.profile_id !== LUNA);

  // ---------- Avisos del evento ----------
  const evRow = S.tables.pass_events.find((e) => e.id === evId);
  Object.assign(evRow, { status: "published", is_test: false });
  const subLuna = browserSub(); await portalPush.handler(ev(LUNA, "POST", { action: "subscribe", subscription: subLuna, device: "Android" }));
  const subBast = browserSub(); await portalPush.handler(ev(BAST, "POST", { action: "subscribe", subscription: subBast, device: "Mac" }));
  const newsTo = (who) => queueOf(who).filter((r) => r.category === "novedades");

  at("2026-10-26T10:30:00-03:00"); await eventos.runEvents();
  check("invitación al open mic: no a las 10:30 (sale entre las 12 y las 21)", !newsTo(LUNA).length, newsTo(LUNA));
  at("2026-10-26T15:00:00-03:00"); await eventos.runEvents(); await eventos.runEvents();
  const inv = newsTo(LUNA);
  check("a las 15: invitación a quien no toca (Luna), una sola vez", inv.length === 1 && inv[0].sent_at && inv[0].title === "Open mic del sábado 31" && /cantar una canción tuya/.test(inv[0].body) && /en el Teatro Sergio Souza/.test(inv[0].body) && inv[0].url === `/pass/?e=${evRow.slug}`, inv);
  check("a quien toca (Bastian) no le llega la invitación; a Pazz, que salió del line up, sí", !newsTo(BAST).length && newsTo(PAZZ).length === 1, { b: newsTo(BAST), p: newsTo(PAZZ) });

  // Tope de 2 por semana.
  S.tables.push_queue.push({ id: crypto.randomUUID(), key: "x1", profile_id: LUNA, category: "novedades", title: "x", body: "", created_at: "2026-10-27T12:00:00-03:00", sent_at: "2026-10-27T12:00:00-03:00" });
  const ev2 = { ...evRow, id: crypto.randomUUID(), slug: "shows-open-mic-4", name: "Shows & Open Mic 4", starts_at: "2026-11-07T20:00:00-03:00" };
  S.tables.pass_events.push(ev2);
  at("2026-10-28T15:00:00-03:00"); await eventos.runEvents();
  check("tope: con 2 de eventos en la semana, la tercera no sale", newsTo(LUNA).length === 2, newsTo(LUNA).map((r) => r.title));
  S.tables.pass_events = S.tables.pass_events.filter((e) => e.id !== ev2.id);

  // Día del show.
  at("2026-10-31T09:30:00-03:00"); await eventos.runEvents();
  check("el día del show a las 9:30 todavía no", !newsTo(BAST).length, newsTo(BAST));
  at("2026-10-31T10:15:00-03:00"); await eventos.runEvents(); await eventos.runEvents();
  const day = newsTo(BAST);
  check("a las 10:15: «Hoy tocás» a quien toca, una sola vez", day.length === 1 && day[0].title === "Hoy tocás en Shows & Open Mic 3" && /20 h/.test(day[0].body) && /en el Teatro Sergio Souza/.test(day[0].body), day);
  check("el día del show no les llega a los que no tocan", newsTo(LUNA).length === 2, newsTo(LUNA).length);

  // ---------- Cerrar sesión ----------
  const u = parse(await portalPush.handler(ev(LUNA, "POST", { action: "unsubscribe", endpoint: subLuna.endpoint })));
  check("desactivar (o cerrar sesión) borra este dispositivo", u.status === 200 && !S.tables.push_subscriptions.some((r) => r.endpoint === subLuna.endpoint));
  const steal = parse(await portalPush.handler(ev(LUNA, "POST", { action: "unsubscribe", endpoint: subBast.endpoint })));
  check("nadie puede borrar el dispositivo de otro", steal.status === 200 && S.tables.push_subscriptions.some((r) => r.endpoint === subBast.endpoint));

  // ---------- Textos ----------
  const tx = ["mezcla", "master", "cambios", "recordatorio", "fecha"].map((w) => push.projectText(w, { name: "Pazz Rivera", song: "Seu amor", kind: w === "master" ? "master" : "mezcla", day: "jueves 23" }));
  check("textos: en primera persona, con el nombre y sin «correcciones» ni «notas»", tx.every((t) => /Hola Pazz,/.test(t.body) && !/correcci|\bnotas?\b/i.test(t.title + t.body)), tx);

  real();
  done("t42 notificaciones");
})().catch((e) => { console.error(e); process.exitCode = 1; });
