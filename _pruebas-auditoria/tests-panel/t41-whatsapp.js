// WhatsApp: el aviso al artista sale además del mail (nunca en su lugar),
// una sola vez, con la plantilla que corresponde, y nunca frena la entrega.
const H = require("./h");
const { S, page, title, sel, relp, F, check, done, setup, adminEvent, parse } = H;
setup();
const wa = require(require("path").join(H.ROOT, "netlify/functions/_lib/whatsapp"));
const { SONGS_DS } = F("portal-songs");
const mark = F("portal-mark");
const status = F("portal-whatsapp");
const auto = require(require("path").join(H.ROOT, "netlify/functions/_lib/auto-entregas"));

// Meta simulado: anota cada envío. S.meta = "400" | "red" para que falle.
const sent = [];
S.extraFetch = async (url, init) => {
  if (!url.includes("graph.facebook.com")) return null;
  if (S.meta === "red") throw new TypeError("fetch failed");
  if (S.meta === "400") return { ok: false, status: 400, json: async () => ({ error: { message: "Template name does not exist in the translation" } }) };
  const b = JSON.parse(init.body);
  sent.push({ url, auth: init.headers.Authorization, ...b });
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sent.length}` }] }) };
};
const on = () => Object.assign(process.env, { WHATSAPP_TOKEN: "tok-meta", WHATSAPP_PHONE_ID: "1234567890" });
const off = () => { delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_ID; };

const PROF = "41414141-4141-4141-8141-414141414141";
const CLIENT = "c4100000-0000-4000-8000-000000000001";
page("clientes", CLIENT, { Nombre: title("Pazz"), "Teléfono": { type: "phone_number", phone_number: "011 15 3328-7422" } });
S.tables.profiles.push({ id: PROF, role: "artist", email: "pazz@prueba.test", display_name: "Pazz Rivera", active: true });
S.tables.artist_private = [{ profile_id: PROF, notion_page_id: CLIENT.replace(/-/g, "") }];
S.tables.song_approvals = S.tables.song_approvals || [];
S.tables.portal_reminders = S.tables.portal_reminders || [];
let n = 0;
const song = (t) => page(SONGS_DS, `b4100000-0000-4000-8000-00000000000${++n}`, { "Canción": title(t), "Etapa actual": sel("Mix"), Artista: relp([CLIENT]) });
const deliver = (s, kind = "mezcla") => mark.handler(adminEvent("POST", { song: s.id, kind, action: "entregada", artist: PROF })).then(parse);
const mailsTo = () => S.mails.filter((m) => (m.to || []).includes("pazz@prueba.test")).length;

(async () => {
  // ---------- Teléfonos ----------
  const P = {
    "+54 9 11 3328-7422": "5491133287422", "011 15 3328-7422": "5491133287422", "11 3328 7422": "5491133287422",
    "54 11 3328 7422": "5491133287422", "0351 15 612-3456": "5493516123456", "+58 412 555 1234": "584125551234",
    "0054 9 11 3328 7422": "5491133287422", "": null, "hola": null, "1234": null,
  };
  const badPhones = Object.entries(P).filter(([raw, want]) => wa.normalizePhone(raw) !== want).map(([raw, want]) => `${raw} -> ${wa.normalizePhone(raw)} (quería ${want})`);
  check("teléfonos escritos de distintas formas se entienden igual", !badPhones.length, badPhones);

  // ---------- Sin configurar: solo mail ----------
  off();
  const s0 = song("Antes de Meta");
  await deliver(s0);
  check("sin conectar WhatsApp: sale el mail y no se llama a Meta", mailsTo() === 1 && sent.length === 0, { mails: mailsTo(), sent: sent.length });

  // ---------- Mezcla lista ----------
  on();
  const s1 = song("Faro");
  const r1 = await deliver(s1);
  const m1 = sent[0];
  check("Entregado: sale el mail y un WhatsApp", r1.status === 200 && mailsTo() === 2 && sent.length === 1, { status: r1.status, mails: mailsTo(), sent: sent.length });
  check("plantilla de mezcla, en es_AR, al número de la ficha, con nombre y canción",
    m1 && m1.template.name === "zg_mezcla_lista" && m1.template.language.code === "es_AR" && m1.to === "5491133287422"
    && m1.template.components[0].parameters.map((p) => p.text).join("|") === "Pazz|Faro" && m1.auth === "Bearer tok-meta" && /\/1234567890\/messages$/.test(m1.url), m1);

  // Doble clic: un solo WhatsApp más (y un solo mail).
  S.tables.song_approvals.forEach((r) => { r.created_at = new Date(Date.now() - 30 * 60000).toISOString(); });
  const s2 = song("Niebla");
  await Promise.all([deliver(s2), deliver(s2)]);
  check("doble clic: un solo WhatsApp", sent.length === 2, sent.length);

  // ---------- Modificaciones listas ----------
  S.tables.song_approvals.forEach((r) => { r.created_at = new Date(Date.now() - 20 * 60000).toISOString(); });
  S.tables.song_approvals.push({ id: "w1", profile_id: PROF, song_id: s1.id, kind: "mezcla", action: "cambios", source: "artist", created_at: new Date(Date.now() - 10 * 60000).toISOString(), marks: [{ t: 12 }] });
  await deliver(s1);
  check("después de pedir modificaciones: plantilla «modificaciones listas»", sent.length === 3 && sent[2].template.name === "zg_modificaciones_listas", sent[2] && sent[2].template.name);

  // ---------- Master listo ----------
  const s3 = song("Seu amor");
  s3.properties["Etapa actual"] = sel("Master");
  await deliver(s3, "master");
  check("master: plantilla «master listo»", sent.length === 4 && sent[3].template.name === "zg_master_listo", sent[3] && sent[3].template.name);

  // ---------- Nombre de plantilla cambiado en Netlify ----------
  process.env.WHATSAPP_TPL_MEZCLA = "zg_mezcla_v2";
  await deliver(song("Brisa"));
  delete process.env.WHATSAPP_TPL_MEZCLA;
  check("si la plantilla tiene otro nombre en Meta, se usa la variable", sent[4] && sent[4].template.name === "zg_mezcla_v2", sent[4] && sent[4].template.name);

  // ---------- El artista lo apagó ----------
  S.tables.profiles.find((p) => p.id === PROF).whatsapp_avisos = false;
  const before = { mails: mailsTo(), sent: sent.length };
  await deliver(song("Calma"));
  check("con los avisos apagados: sale el mail, no el WhatsApp", mailsTo() === before.mails + 1 && sent.length === before.sent, { mails: mailsTo(), sent: sent.length });
  S.tables.profiles.find((p) => p.id === PROF).whatsapp_avisos = true;

  // ---------- Meta falla ----------
  for (const mode of ["400", "red"]) {
    S.meta = mode;
    const b = mailsTo();
    const r = await deliver(song(`Falla ${mode}`));
    check(`si Meta ${mode === "400" ? "rechaza la plantilla" : "no responde"}: la entrega y el mail salen igual`, r.status === 200 && mailsTo() === b + 1, { status: r.status, body: r.body });
  }
  S.meta = null;

  // ---------- Sin teléfono en la ficha ----------
  S.pages[CLIENT].properties["Teléfono"].phone_number = "";
  const b2 = sent.length;
  await deliver(song("Sin número"));
  check("sin teléfono en la ficha: no se manda nada", sent.length === b2, sent.length);
  S.pages[CLIENT].properties["Teléfono"].phone_number = "+54 9 11 3328-7422";

  // ---------- Recordatorio a los 3 días ----------
  const s4 = song("Lunes");
  s4.properties["Etapa actual"] = sel("Mix");
  const since = new Date(Date.now() - 4 * 86400000).toISOString();
  const noon = (() => { const d = new Date(); d.setUTCHours(15, 0, 0, 0); return d.getTime(); })(); // 12 h en Argentina
  const b3 = sent.length;
  await auto._remindArtist({ profileId: PROF, email: "pazz@prueba.test", name: "Pazz Rivera", songs: [{ id: s4.id, title: "Lunes", step: 3, entrega: "" }], files: { [s4.id]: { mezcla: { name: "Lunes mix.wav", modified: since } } }, rows: [] }, Math.max(noon, Date.parse(since) + 4 * 86400000 - 86400000));
  const rem = sent[b3];
  check("recordatorio a los 3 días: WhatsApp con la plantilla de recordatorio", sent.length === b3 + 1 && rem.template.name === "zg_recordatorio_escucha", rem && rem.template.name);
  await auto._remindArtist({ profileId: PROF, email: "pazz@prueba.test", name: "Pazz Rivera", songs: [{ id: s4.id, title: "Lunes", step: 3, entrega: "" }], files: { [s4.id]: { mezcla: { name: "Lunes mix.wav", modified: since } } }, rows: [] }, Math.max(noon, Date.parse(since) + 4 * 86400000 - 86400000));
  check("el mismo recordatorio no sale dos veces", sent.length === b3 + 1, sent.length);

  // ---------- Lo que ve el portal (portal-whatsapp) ----------
  const own = parse(await status.handler({ httpMethod: "GET", headers: { authorization: `Bearer tok-${PROF}` }, queryStringParameters: {} }));
  check("el artista ve si tiene número (solo las últimas 4 cifras) y si está prendido",
    own.status === 200 && own.body.configured && own.body.phone && own.body.last4 === "7422" && own.body.on === true && !JSON.stringify(own.body).includes("3328"), own);
  const other = parse(await status.handler({ httpMethod: "GET", headers: { authorization: `Bearer tok-${PROF}` }, queryStringParameters: { artist: H.ADMIN } }));
  check("un artista no puede ver el de otro", other.status === 403, other);
  const adm = parse(await status.handler(adminEvent("GET", null, { artist: PROF })));
  check("el administrador ve el de cualquier artista", adm.status === 200 && adm.body.last4 === "7422", adm);

  done("t41 WhatsApp");
})().catch((e) => { console.error(e); process.exitCode = 1; });
