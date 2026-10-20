// Reprogramar la entrega desde el Inicio: al artista le llega la
// notificación con la fecha nueva (si la activó), una vez por fecha; si la
// fecha no cambia, no.
const H = require("./h");
const crypto = require("crypto");
const path = require("path");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, adminEvent, parse } = H;
setup();
const { SONGS_DS } = F("portal-songs");
const fn = F("admin-reschedule");
const webpush = require(path.join(H.ROOT, "node_modules/web-push"));
const k = webpush.generateVAPIDKeys();
Object.assign(process.env, { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey });
const pushes = [];
S.extraFetch = async (url, init) => (/push\.apple\.com/.test(url) ? (pushes.push(url), { ok: true, status: 201, json: async () => ({}), text: async () => "" }) : null);
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
const OLD = add(today, 1), NEW = add(today, 3);
const CLIENT = "a4300000-0000-4000-8000-000000000001";
const PROF = "43000000-0000-4000-8000-000000000001";
page("cli", CLIENT, { Nombre: title("Pazz") });
S.tables.profiles.push({ id: PROF, role: "artist", email: "pazz@prueba.test", display_name: "Pazz", active: true });
S.tables.artist_private = [{ profile_id: PROF, notion_page_id: CLIENT.replace(/-/g, "") }];
S.tables.push_queue = [];
const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
S.tables.push_subscriptions = [{ endpoint: "https://web.push.apple.com/abc", profile_id: PROF, p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") }];
const push = require(path.join(H.ROOT, "netlify/functions/_lib/push"));
push._clock.now = () => new Date(`${today}T15:00:00-03:00`); // de tarde: sale al toque
const song = page(SONGS_DS, "b4300000-0000-4000-8000-000000000001", { "Canción": title("Seu amor"), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]), "Fecha de entrega": date(OLD) });
const move = (d) => fn.handler(adminEvent("POST", { task: song.id, kind: "entrega", date: d, time: "16:00", dur: 120 })).then(parse);
(async () => {
  const r = await move(NEW);
  const q = S.tables.push_queue;
  const dayTxt = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric" }).format(new Date(`${NEW}T12:00:00-03:00`)).replace(",", "");
  check("reprogramar la entrega: sale la notificación con la fecha nueva", r.status === 200 && pushes.length === 1 && q[0] && q[0].title === "Nueva fecha para «Seu amor»" && q[0].body.includes(dayTxt) && /Hola Pazz/.test(q[0].body), { r: r.body, q });
  await move(NEW);
  check("volver a guardar la misma fecha: no sale otra", pushes.length === 1, pushes.length);
  done("t43 aviso de nueva fecha");
})().catch((e) => { console.error(e); process.exitCode = 1; });
