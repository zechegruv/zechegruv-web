// GET  /.netlify/functions/portal-reviews  -> avisos del Inicio del panel
// POST /.netlify/functions/portal-reviews  { song } -> borra el aviso (✕)
// POST /.netlify/functions/portal-reviews  { resolve: { id, i, done } } -> tilda
//      la nota i del artista como resuelta (checklist de la mezcla, 025)
// Solo para el administrador: lo que dijeron los artistas sobre sus mezclas
// y masters desde el portal (aprobaciones y pedidos de cambios con sus notas
// en el tiempo). Ordenado y sin que se acumule:
// - Un solo aviso por canción: lo último que pasó.
// - Si después Zeche tocó "Entregado"/"Aprobado" (o lo cambió en Notion →
//   Entrega), el aviso anterior se va solo.
// - Si la canción cambió de etapa (Mix -> Master, Master -> Distribución),
//   el aviso de la etapa anterior se va solo. El master aprobado queda hasta
//   que lo borrás con ✕ o pasan 7 días.
// Lee song_approvals (020–023) con la clave secreta y la etapa de cada
// canción en Notion.
const { json, db, serviceKey } = require("./_lib/pass");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const KEEP_FINAL_DAYS = 7;
const MAX = 15;
const STAGE_OF = { mezcla: "Mix", master: "Master" };
const MANUAL = { "Mezcla entregada": ["mezcla", "entregada"], "Mezcla aprobada": ["mezcla", "aprobada"], "Master entregado": ["master", "entregada"], "Master aprobado": ["master", "aprobada"] };
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const time = (iso) => Date.parse(iso || "") || 0;

async function notionPage(id) {
  if (!notionToken()) return null;
  const res = await fetch(`${NOTION_API}/pages/${id}`, { headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": NOTION_VERSION } }).catch(() => null);
  return res && res.ok ? res.json() : null;
}

// ¿Sigue valiendo este aviso? (la canción no avanzó ni se marcó otra cosa después)
function stillValid(row, page, now = Date.now()) {
  const final = row.kind === "master" && row.action === "aprobada";
  if (final && now - time(row.created_at) > KEEP_FINAL_DAYS * 86400000) return false;
  if (!page) return true; // si Notion no responde, se muestra igual
  const p = page.properties || {};
  const stage = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
  if (stage !== STAGE_OF[row.kind]) {
    // Pasó de etapa: solo queda el master aprobado (ya está en Distribución).
    if (!(final && (stage === "Distribución" || stage === "Publicada"))) return false;
  }
  const manual = MANUAL[p.Entrega && p.Entrega.select && p.Entrega.select.name];
  if (manual && manual[0] === row.kind && manual[1] !== row.action && time(page.last_edited_time) > time(row.created_at) + 60000) return false;
  return true;
}

async function whoIs(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return { status: 401 };
  const me = await db(`profiles?id=eq.${user.id}&select=role`);
  if (!me.ok || !me.data || !me.data[0] || me.data[0].role !== "admin") return { status: 403 };
  return { ok: true };
}

exports.handler = async (event) => {
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify." });
  const who = await whoIs(event);
  if (who.status === 401) return json(401, { error: "Iniciá sesión de nuevo." });
  if (who.status === 403) return json(403, { error: "Solo para el administrador." });

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
    // Checklist: tildar / destildar una nota del artista ya resuelta en la mezcla.
    if (body.resolve) {
      const id = String(body.resolve.id || "").replace(/[^0-9a-f-]/gi, "");
      const i = Number(body.resolve.i);
      if (!id || !Number.isInteger(i) || i < 0 || i > 59) return json(400, { error: "Pedido inválido." });
      const cur = await db(`song_approvals?id=eq.${id}&select=resolved,marks`);
      if (!cur.ok || !cur.data || !cur.data[0]) return json(cur.status === 400 ? 500 : 404, { error: cur.status === 400 ? "Falta correr 025_automatizaciones.sql en Supabase." : "No encontramos esas notas." });
      const set = new Set(Array.isArray(cur.data[0].resolved) ? cur.data[0].resolved : []);
      if (body.resolve.done) set.add(i); else set.delete(i);
      const resolved = [...set].filter((n) => n < (cur.data[0].marks || []).length).sort((a, b) => a - b);
      const up = await db(`song_approvals?id=eq.${id}`, { method: "PATCH", body: { resolved } });
      if (!up.ok) return json(500, { error: "No pudimos guardarlo." });
      return json(200, { ok: true, resolved });
    }
    const song = String(body.song || "").replace(/[^0-9a-f-]/gi, "");
    if (!song) return json(400, { error: "Pedido inválido." });
    const res = await db(`song_approvals?song_id=eq.${song}&dismissed_at=is.null`, { method: "PATCH", body: { dismissed_at: new Date().toISOString() } });
    if (!res.ok) return json(500, { error: res.status === 400 ? "Falta correr 023_entregas_y_avisos.sql en Supabase." : "No pudimos borrarlo." });
    return json(200, { ok: true });
  }

  // Sin 023 no existe dismissed_at: se lee igual, sin ese filtro.
  let rows = await db("song_approvals?select=*,profiles(id,display_name,full_name)&dismissed_at=is.null&order=created_at.desc&limit=300");
  if (!rows.ok && rows.status === 400) rows = await db("song_approvals?select=*,profiles(id,display_name,full_name)&order=created_at.desc&limit=300");
  if (!rows.ok) return json(200, { reviews: [], missing: rows.status === 404 });

  // Lo último de cada canción. Si lo último lo hizo Zeche, no hay aviso.
  const seen = new Set();
  const latest = [];
  for (const r of rows.data || []) {
    if (seen.has(r.song_id)) continue;
    seen.add(r.song_id);
    if ((r.source || "artist") === "artist") latest.push(r);
    if (latest.length >= MAX) break;
  }
  const pages = await Promise.all(latest.map((r) => notionPage(r.song_id)));
  const reviews = latest.filter((r, i) => stillValid(r, pages[i])).map((r) => ({
    profile_id: r.profile_id,
    artist: r.profiles ? (r.profiles.display_name || r.profiles.full_name || "") : "",
    song_id: r.song_id,
    song: r.song_title,
    kind: r.kind,
    action: r.action,
    final: r.kind === "master" && r.action === "aprobada",
    id: r.id,
    notes: Array.isArray(r.marks) ? r.marks.length : 0,
    // Checklist de la mezcla: cada nota del artista y cuáles ya resolviste.
    marks: r.action === "cambios" && Array.isArray(r.marks) ? r.marks.map((m) => ({ t: m.t, text: m.text })) : [],
    resolved: Array.isArray(r.resolved) ? r.resolved : [],
    note: r.note || null,
    at: r.created_at,
  }));
  return json(200, { reviews });
};

exports._stillValid = stillValid;
