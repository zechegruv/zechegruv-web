// GET /.netlify/functions/admin-status  -> Estado del sistema (panel → Inicio)
//
// Revisa, todos a la vez y con 5 segundos como máximo cada uno, que cada
// servicio del que depende el portal esté respondiendo:
//   Supabase · Notion (base Canciones) · Google Calendar · OneDrive ·
//   Resend (mails) · Mercado Pago · WhatsApp · ZIL
// Cada uno vuelve con:
//   state: "ok" (anda) · "atencion" (anda a medias o falta un paso) ·
//          "caido" (no anda o no contesta) · "sin_configurar" (no está
//          cargado en Netlify; no cuenta como problema)
//   text:  una frase corta para vos, sin claves ni tokens
//   ms:    cuánto tardó en contestar
// Además, las últimas corridas de cada automatización programada
// (automation_runs, supabase/034_estado.sql): hace cuánto corrió, si salió
// bien y el último error. Si la última revisión de entregas tiene más de
// 45 minutos, alerta: la programada (cada 15 min) no está corriendo.
//
// Solo lee: no cambia nada en ningún servicio. Solo el administrador (el
// mismo chequeo que admin-tasks.js).
const { json, db, serviceKey, mpToken, mp, testMode } = require("./_lib/pass");
const { SONGS_DS } = require("./portal-songs");

const TIMEOUT_MS = 5000;
const clean = (v) => String(v || "").replace(/[\s"'“”‘’]/g, "");

// Cada revisión corre contra reloj: si en 5 s no contestó, "no responde"
// (y las demás siguen; nadie espera a nadie).
async function timed(id, name, check) {
  const t0 = Date.now();
  let timer = null;
  try {
    const out = await Promise.race([
      check(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { timeout: true })), TIMEOUT_MS); }),
    ]);
    return { id, name, ...out, ms: Date.now() - t0 };
  } catch (e) {
    // El mensaje técnico no se muestra (podría traer datos de la conexión).
    return { id, name, state: "caido", text: e && e.timeout ? `No responde (más de ${TIMEOUT_MS / 1000} s)` : "No se pudo conectar", ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
const signal = () => AbortSignal.timeout(TIMEOUT_MS);
const ok = (text) => ({ state: "ok", text });
const warn = (text) => ({ state: "atencion", text });
const down = (text) => ({ state: "caido", text });
const unset = (text) => ({ state: "sin_configurar", text });

// ---------- Servicios ----------
async function supabase() {
  if (!serviceKey()) return unset("Falta SUPABASE_SERVICE_ROLE_KEY en Netlify");
  const r = await db("profiles?select=id&limit=1");
  return r.ok ? ok("Responde") : down(`No responde como debería (${r.status})`);
}

async function notion() {
  const lib = require("./_lib/notion");
  if (!lib.token()) return unset("Falta NOTION_TOKEN en Netlify");
  const r = await lib.notion(`/data_sources/${SONGS_DS}/query`, { method: "POST", body: JSON.stringify({ page_size: 1 }) });
  if (r.ok) return ok("Responde (base Canciones)");
  if (r.status === 401) return down("La llave de Notion no sirve (revisá NOTION_TOKEN)");
  if (r.status === 403 || r.status === 404) return warn("La base Canciones no está compartida con la integración");
  if (r.status === 429) return warn("Saturado por un momento: se recupera solo");
  return down(`Notion no responde (${r.status})`);
}

async function google() {
  const gc = require("./_lib/gcal");
  if (!gc.configured()) return unset("Faltan las credenciales de Google en Netlify");
  const st = await gc.status();
  if (!st.connected) return warn("No conectado: conectalo desde el Inicio");
  // Un freeBusy de una hora: lo más liviano que confirma que Google deja leer el calendario.
  const now = Date.now();
  const busy = await gc.busy(new Date(now).toISOString(), new Date(now + 3600000).toISOString());
  if (!busy) return down("Conectado, pero Google no responde (puede que haya que volver a conectarlo)");
  return ok(`Conectado${st.account ? ` (${st.account})` : ""}`);
}

async function onedrive() {
  // El mismo acceso de visitante que usan Archivos, Letras y las entregas automáticas.
  await require("./_lib/onedrive").auth({ fresh: true });
  return ok("Se obtuvo el acceso a las carpetas");
}

async function resend() {
  const key = clean(process.env.RESEND_API_KEY);
  if (!key) return unset("Falta RESEND_API_KEY: no salen los mails");
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, signal: signal() });
  const data = await res.json().catch(() => null);
  if (res.ok) {
    const list = (data && Array.isArray(data.data) && data.data) || [];
    const verified = list.filter((d) => d.status === "verified").map((d) => d.name);
    if (verified.length) return ok(`Listo para mandar (${verified.slice(0, 2).join(", ")} verificado)`);
    return warn(list.length ? "El dominio no está verificado: los mails pueden no llegar" : "No hay ningún dominio cargado en Resend");
  }
  // Una clave "solo para mandar" no deja ver los dominios, pero sirve.
  if (res.status === 401 && data && data.name === "restricted_api_key") return ok("Clave cargada (solo para mandar mails)");
  if (res.status === 401 || res.status === 403) return down("La clave de Resend no sirve");
  return down(`Resend no responde (${res.status})`);
}

async function mercadopago() {
  if (!mpToken()) return unset("Falta MP_ACCESS_TOKEN: ZG PASS no puede cobrar");
  const r = await mp("/users/me");
  if (r.ok) {
    if (/^TEST-/.test(mpToken()) && !testMode()) return warn("Está con la credencial de prueba: no cobra de verdad");
    return ok("Cuenta conectada");
  }
  if (r.status === 401 || r.status === 403) return down("La credencial de Mercado Pago no sirve o venció");
  return down(`Mercado Pago no responde (${r.status})`);
}

async function whatsapp() {
  const token = clean(process.env.WHATSAPP_TOKEN);
  const phone = clean(process.env.WHATSAPP_PHONE_ID).replace(/\D/g, "");
  if (!token || !phone) return unset("Sin configurar: los avisos van solo por mail");
  const res = await fetch(`https://graph.facebook.com/v21.0/${phone}`, { headers: { Authorization: `Bearer ${token}` }, signal: signal() });
  const data = await res.json().catch(() => null);
  if (res.ok) return ok("Configurado y respondiendo");
  const code = data && data.error && data.error.code;
  if (res.status === 401 || code === 190) return down("El token de WhatsApp venció o no sirve");
  if (res.status === 400 || res.status === 404) return warn("El número (WHATSAPP_PHONE_ID) no coincide con la cuenta");
  return down(`WhatsApp no responde (${res.status})`);
}

async function zil() {
  const z = require("./_lib/zil");
  if (!z.token()) return unset("Falta ZIL_API_TOKEN: los lanzamientos no van a ZIL");
  try {
    await z.client(undefined, { timeoutMs: TIMEOUT_MS }).call("Perfil", "GET", "/me");
  } catch (e) {
    if (e.status === 401 || e.status === 403) return down("El token de ZIL no sirve");
    return down(e.status === "sin respuesta" ? "ZIL no responde" : `ZIL no responde como debería (${e.status})`);
  }
  return ok(z.isDev() ? "Conectado (entorno de pruebas: no sale a las tiendas)" : "Conectado");
}

const SERVICES = [
  ["supabase", "Supabase", supabase],
  ["notion", "Notion", notion],
  ["google", "Google Calendar", google],
  ["onedrive", "OneDrive", onedrive],
  ["resend", "Resend (mails)", resend],
  ["mercadopago", "Mercado Pago", mercadopago],
  ["whatsapp", "WhatsApp", whatsapp],
  ["zil", "ZIL", zil],
];

// ---------- Automatizaciones ----------
// staleMin: a partir de cuántos minutos sin correr se avisa.
const JOBS = [
  { job: "auto-entregas", name: "Entregas automáticas", every: "cada 15 min", what: "revisión de entregas", staleMin: 45, active: () => true },
  { job: "zil-sync", name: "Estado en las tiendas (ZIL)", every: "cada hora", what: "revisión de ZIL", staleMin: 180, active: () => !!require("./_lib/zil").token() },
];
const COLS = "select=started_at,finished_at,ok,summary,error";
const human = (min) => (min < 120 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} días`);

async function automations() {
  const now = Date.now();
  const rows = await Promise.all(JOBS.map(async (j) => {
    const [last, err] = await Promise.all([
      db(`automation_runs?job=eq.${j.job}&${COLS}&order=started_at.desc&limit=1`),
      db(`automation_runs?job=eq.${j.job}&ok=eq.false&${COLS}&order=started_at.desc&limit=1`),
    ]);
    return { j, last, err };
  }));
  // La tabla todavía no existe: se dice qué falta y no se inventan alertas.
  if (rows.some((r) => r.last.status === 404 || r.err.status === 404)) {
    return { available: false, text: "Falta correr supabase/034_estado.sql en Supabase para ver las corridas.", list: [], alerts: [] };
  }
  if (rows.some((r) => !r.last.ok)) return { available: false, text: "No se pudieron leer las corridas.", list: [], alerts: [] };
  const alerts = [];
  const list = rows.map(({ j, last, err }) => {
    const l = (last.data || [])[0] || null;
    const e = (err.data || [])[0] || null;
    const minutes = l ? Math.max(0, Math.floor((now - Date.parse(l.started_at)) / 60000)) : null;
    // Sin "fin" hace más de 10 minutos: Netlify la cortó antes de terminar.
    const cut = !!(l && !l.finished_at && minutes > 10);
    const running = !!(l && !l.finished_at && !cut);
    if (l && j.active() && minutes > j.staleMin) {
      alerts.push({ job: j.job, level: "caido", text: `La programada no está corriendo: la última ${j.what} fue hace ${human(minutes)} (tendría que ser ${j.every}).` });
    } else if (l && l.ok === false) {
      alerts.push({ job: j.job, level: "atencion", text: `La última corrida de «${j.name}» salió con error: ${String(l.error || "sin detalle").slice(0, 160)}` });
    } else if (cut) {
      alerts.push({ job: j.job, level: "atencion", text: `La última corrida de «${j.name}» se cortó sin terminar.` });
    }
    return {
      job: j.job, name: j.name, every: j.every, minutes, running, cut,
      last: l ? { started_at: l.started_at, finished_at: l.finished_at, ok: l.ok, summary: l.summary || {} } : null,
      lastError: e ? { at: e.started_at, error: String(e.error || "Sin detalle").slice(0, 500) } : null,
    };
  });
  return { available: true, text: "", list, alerts };
}

const RANK = { ok: 0, sin_configurar: 0, atencion: 1, caido: 2 };

exports.handler = async (event) => {
  const { _isAdmin: isAdmin } = require("./admin-tasks");
  if (!(await isAdmin(event))) return json(403, { error: "Solo para el administrador." });

  const [services, autos] = await Promise.all([
    Promise.all(SERVICES.map(([id, name, check]) => timed(id, name, check))),
    (async () => {
      let timer = null;
      try {
        return await Promise.race([
          automations(),
          new Promise((r) => { timer = setTimeout(() => r({ available: false, text: "Supabase no respondió a tiempo para leer las corridas.", list: [], alerts: [] }), TIMEOUT_MS); }),
        ]);
      } catch (e) {
        return { available: false, text: "No se pudieron leer las corridas.", list: [], alerts: [] };
      } finally {
        clearTimeout(timer);
      }
    })(),
  ]);
  const worst = Math.max(0, ...services.map((s) => RANK[s.state] || 0), ...autos.alerts.map((a) => RANK[a.level] || 0));
  const problems = services.filter((s) => s.state === "atencion" || s.state === "caido").length + autos.alerts.length;
  return json(200, {
    checked_at: new Date().toISOString(),
    overall: ["ok", "atencion", "caido"][worst],
    problems,
    services,
    automations: autos.list,
    runsAvailable: autos.available,
    runsText: autos.text,
    alerts: autos.alerts,
  });
};
