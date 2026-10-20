// Avisos al artista por WhatsApp, además del mail (nunca en lugar del mail).
//
// Se mandan por la API oficial de WhatsApp Cloud (Meta). Fuera de la
// "ventana de 24 h" (cuando el artista no nos escribió en el último día)
// WhatsApp solo deja mandar plantillas aprobadas por Meta: por eso todos los
// avisos son de tipo "template". Los textos de las plantillas y cómo
// crearlas están en docs/WHATSAPP.md.
//
// Cuándo sale cada uno (los mismos casos que el mail):
//   · mezcla lista, master listo o modificaciones listas → aviso-entrega.js
//   · recordatorio a los 3 y 7 días si no la escuchó → auto-entregas.js
// Una sola vez por entrega o recordatorio: se anota en portal_reminders con
// la misma clave que el mail y el prefijo "wa|".
//
// Variables de entorno en Netlify:
//   WHATSAPP_TOKEN (secreta): token permanente del usuario del sistema de Meta.
//   WHATSAPP_PHONE_ID: el "Identificador del número de teléfono" (no el número).
//   WHATSAPP_LANG (opcional): idioma de las plantillas, por defecto "es_AR".
//   WHATSAPP_TPL_MEZCLA, WHATSAPP_TPL_MASTER, WHATSAPP_TPL_CAMBIOS,
//   WHATSAPP_TPL_RECORDATORIO (opcionales): nombres de las plantillas, si en
//   Meta se crearon con otro nombre.
// Si falta el token o el phone id, no se manda nada y todo sigue igual
// (devuelve { sent:false, why:"sin-configurar" }). Nada de acá tira error:
// si WhatsApp falla, el mail y el resto del flujo siguen como si nada.
const API = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 8000; // si Meta no contesta en 8 s, se corta (no frena la entrega)
const clean = (v) => String(v || "").replace(/[\s"'“”‘’]/g, "");

const TEMPLATES = {
  mezcla: ["WHATSAPP_TPL_MEZCLA", "zg_mezcla_lista"],
  master: ["WHATSAPP_TPL_MASTER", "zg_master_listo"],
  cambios: ["WHATSAPP_TPL_CAMBIOS", "zg_modificaciones_listas"],
  recordatorio: ["WHATSAPP_TPL_RECORDATORIO", "zg_recordatorio_escucha"],
};
const templateName = (which) => {
  const [env, def] = TEMPLATES[which];
  return clean(process.env[env]) || def;
};
const configured = () => !!(clean(process.env.WHATSAPP_TOKEN) && clean(process.env.WHATSAPP_PHONE_ID));

// ---------- Teléfono ----------
// El número de la ficha de Notion, como lo haya escrito cada uno, pasado al
// formato que pide WhatsApp: código de país + número, solo dígitos (E.164
// sin el "+"). Para Argentina el celular va con el 9: 54 9 11 3328 7422.
//   "+54 9 11 3328-7422" · "011 15 3328-7422" · "11 3328 7422" ·
//   "54 11 3328 7422" (sin el 9)              → "5491133287422"
//   "0351 15 612-3456" (Córdoba, con el 15)   → "5493516123456"
// Un número de otro país que empieza con + y otro código (+58, +55…) queda
// tal cual. Si no se puede interpretar, devuelve null y no se manda nada.
function normalizePhone(raw) {
  const text = String(raw == null ? "" : raw).trim();
  let digits = text.replace(/\D/g, "");
  if (!digits) return null;
  let intl = text.startsWith("+");
  if (!intl && digits.startsWith("00")) { digits = digits.slice(2); intl = true; } // 00 = salida internacional
  // Otro país: se respeta como vino.
  if (intl && !digits.startsWith("54")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  // Argentina: se saca el 54 (si vino con código de país) y el 9 de celular.
  let n = digits;
  if (intl || (n.startsWith("54") && n.length >= 12)) {
    n = n.slice(2);
    if (n.startsWith("9") && n.length === 11) n = n.slice(1);
  }
  n = n.replace(/^0/, ""); // el 0 de la característica (011, 0351)
  // El 15 va entre la característica y el número: 11 15 3328 7422. Las
  // características tienen 2 cifras (solo el 11), 3 o 4.
  if (n.length === 12) {
    const spots = n.startsWith("11") ? [2] : [3, 4];
    const at = spots.find((i) => n.slice(i, i + 2) === "15");
    if (at !== undefined) n = n.slice(0, at) + n.slice(at + 2);
  }
  // Queda característica + número: 10 cifras, empezando con 1, 2 o 3.
  if (!/^[123]\d{9}$/.test(n)) return null;
  return `549${n}`;
}

// ---------- Envío ----------
// to: el número ya normalizado. template: nombre de la plantilla aprobada.
// params: los {{1}}, {{2}}… del cuerpo, en orden. El botón con el link al
// portal es fijo en la plantilla (botón de URL estática), así que no lleva
// parámetros.
async function sendTemplate({ to, template, params = [], timeoutMs = TIMEOUT_MS }) {
  if (!configured()) return { sent: false, why: "sin-configurar" };
  if (!to || !/^\d{8,15}$/.test(String(to))) return { sent: false, why: "sin-telefono" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/${clean(process.env.WHATSAPP_PHONE_ID)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clean(process.env.WHATSAPP_TOKEN)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to),
        type: "template",
        template: {
          name: template,
          language: { code: clean(process.env.WHATSAPP_LANG) || "es_AR" },
          components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p || "").slice(0, 200) })) }],
        },
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Lo más común: la plantilla todavía no está aprobada o tiene otro nombre.
      console.error("WhatsApp rechazó el aviso", template, res.status, data && data.error && data.error.message);
      return { sent: false, why: `meta-${res.status}` };
    }
    return { sent: true, id: data && data.messages && data.messages[0] && data.messages[0].id };
  } catch (e) {
    const why = e && e.name === "AbortError" ? "timeout" : "red";
    console.error("WhatsApp no respondió", template, why);
    return { sent: false, why };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- El número del artista ----------
// Sale de su ficha en Notion → Clientes Zeche Gruv → "Teléfono" (la ficha
// vinculada en artist_private.notion_page_id). Devuelve { raw, phone }:
// raw es lo que está escrito en la ficha, phone el número listo para
// WhatsApp (null si no hay o no se entiende).
const pageIdOf = (v) => {
  const h = String(v || "").replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return h ? h[0].toLowerCase() : null;
};
function phoneProp(props) {
  const all = Object.entries(props || {}).filter(([, p]) => p && p.type === "phone_number");
  const byName = all.find(([k]) => /^tel[eé]fono$/i.test(k.trim()));
  const hit = byName || all[0];
  return hit ? String(hit[1].phone_number || "").trim() : "";
}
async function artistPhone(profileId) {
  const { db } = require("./pass");
  const priv = await db(`artist_private?profile_id=eq.${profileId}&select=notion_page_id`);
  const pageId = pageIdOf(priv.ok && priv.data && priv.data[0] && priv.data[0].notion_page_id);
  if (!pageId) return { raw: "", phone: null };
  const pg = await require("./notion").notion(`/pages/${pageId}`);
  if (!pg.ok || !pg.data) return { raw: "", phone: null };
  const raw = phoneProp(pg.data.properties);
  return { raw, phone: normalizePhone(raw) };
}

// ---------- Aviso a un artista ----------
// which: mezcla | master | cambios | recordatorio. key: la misma clave del
// mail (se anota como "wa|<key>", así sale una sola vez). params: los {{n}}.
// profile (opcional): la fila de profiles si ya se leyó. songId: la canción.
// Orden: si no está configurado no se toca nada; si el artista lo apagó en su
// perfil (profiles.whatsapp_avisos, 033_whatsapp.sql) o no tiene teléfono,
// tampoco. Recién ahí se anota el turno y se manda. Nunca tira error.
async function notifyArtist({ profileId, profile, songId, which, key, params }) {
  try {
    if (!configured()) return { sent: false, why: "sin-configurar" };
    if (!profileId || !key) return { sent: false, why: "datos" };
    const { db } = require("./pass");
    let p = profile;
    if (!p) {
      // "*": así anda también antes de correr 033 (sin la columna, queda prendido).
      const r = await db(`profiles?id=eq.${profileId}&select=*`);
      p = r.ok && r.data && r.data[0];
    }
    if (!p || p.active === false) return { sent: false, why: "sin-perfil" };
    if (p.whatsapp_avisos === false) return { sent: false, why: "desactivado" };
    const { phone } = await artistPhone(profileId);
    if (!phone) return { sent: false, why: "sin-telefono" };
    const waKey = `wa|${key}`.slice(0, 500);
    const claim = await db("portal_reminders?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key: waKey, kind: "whatsapp", profile_id: profileId, song_id: songId || null } });
    if (!claim.ok || !claim.data || !claim.data[0]) return { sent: false, why: "ya-avisado" };
    return await sendTemplate({ to: phone, template: templateName(which), params });
  } catch (e) {
    console.error("WhatsApp: no se pudo avisar", e && e.message);
    return { sent: false, why: "error" };
  }
}

module.exports = { normalizePhone, sendTemplate, templateName, configured, artistPhone, notifyArtist, TIMEOUT_MS };
