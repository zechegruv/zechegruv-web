// POST /.netlify/functions/portal-mark
// Botones "Entregado" y "Aprobado" del administrador para la mezcla o el
// master de una canción. Body: { song: "<id de Notion>", kind: "mezcla"|"master",
// action: "entregada"|"aprobada", artist: "<id del perfil del artista>" }
//
// - Solo el administrador (sesión de Supabase en Authorization: Bearer).
// - Queda en Notion (Canciones → "Entrega": Mezcla entregada / Mezcla
//   aprobada / Master entregado / Master aprobado) y en song_approvals con
//   source = 'admin' (023_entregas_y_avisos.sql). Así el portal del artista,
//   Notion y el Inicio del panel dicen lo mismo, y el aviso anterior de esa
//   canción se reemplaza solo.
// - "Entregado": al artista le aparece para escuchar y aprobar aunque el
//   audio no esté en su carpeta (p. ej. si se lo mandaste por WhatsApp). Igual
//   que al subir el audio: las sesiones de esa etapa que estaban abiertas
//   pasan a COMPLETADO y el calendario queda tildado (cierre-etapa.js →
//   deliverStage). Si es el master, se borra la fecha de entrega. Al artista
//   le llega un mail para escucharlo (aviso-entrega.js).
// - "Aprobado": exactamente lo mismo que cuando aprueba el artista
//   (cierre-etapa.js → closeStage): tarea completada, la canción avanza
//   (Mezcla → Master, Master → Distribución) y el calendario tildado.
const { json, db, dbDetail, serviceKey } = require("./_lib/pass");
const { _parsePageId: parsePageId } = require("./portal-songs");
const { closeStage, deliverStage, nextSong } = require("./_lib/cierre-etapa");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const STAGE_OF = { mezcla: "Mix", master: "Master" };
const LABEL = {
  mezcla: { entregada: "Mezcla entregada", aprobada: "Mezcla aprobada" },
  master: { entregada: "Master entregado", aprobada: "Master aprobado" },
};
const notionToken = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();

// Con reintentos ante 429/502/503 y pocos pedidos a la vez (_lib/notion.js).
const notion = (path, init) => require("./_lib/notion").notion(path, init);

// ¿Este «Entregado» es el segundo clic de un doble clic? Hay otro marcado
// a mano (sin nota: los automáticos llevan nota) de la misma canción y etapa
// hasta 2 minutos ANTES que este. Solo mira hacia atrás: de dos clics
// simultáneos, el primero manda el mail y el segundo no.
const DOUBLE_MS = 2 * 60 * 1000;
async function clickedTwice(row, songId, kind) {
  if (!row || !row.id || !row.created_at) return false;
  const mine = Date.parse(row.created_at);
  const prev = await db(`song_approvals?song_id=eq.${encodeURIComponent(songId)}&kind=eq.${kind}&action=eq.entregada&source=eq.admin&note=is.null&select=id,created_at&order=created_at.desc&limit=10`);
  return ((prev.ok && prev.data) || []).some((r) => r.id !== row.id && Date.parse(r.created_at) <= mine && mine - Date.parse(r.created_at) < DOUBLE_MS && (Date.parse(r.created_at) < mine || String(r.id) < String(row.id)));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!serviceKey()) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify." });
  if (!notionToken()) return json(500, { error: "Falta NOTION_TOKEN en Netlify." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  const { kind, action } = body;
  const songId = parsePageId(body.song);
  const artist = String(body.artist || "");
  if (!songId || !LABEL[kind] || !["entregada", "aprobada"].includes(action) || !/^[0-9a-f-]{36}$/i.test(artist)) return json(400, { error: "Pedido inválido." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const userRes = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }) : null;
  const user = userRes && userRes.ok ? await userRes.json() : null;
  if (!user || !user.id) return json(401, { error: "Iniciá sesión de nuevo." });
  const me = await db(`profiles?id=eq.${user.id}&select=role`);
  if (!me.ok || !me.data || !me.data[0] || me.data[0].role !== "admin") return json(403, { error: "Solo para el administrador." });

  const page = await notion(`/pages/${songId}`);
  if (!page.ok) return json(502, { error: "No pudimos leer la canción en Notion." });
  const p = page.data.properties || {};
  const stage = p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name;
  if (stage !== STAGE_OF[kind]) return json(409, { error: `La canción ya no está en ${kind}. Actualizá la página.` });
  const title = plain(p["Canción"] && p["Canción"].title) || "Sin título";

  let synced = null;
  if (action === "aprobada") {
    synced = await closeStage({ page: page.data, kind }).catch(() => ({ notion: false }));
    if (!synced.notion) return json(502, { error: "Notion no dejó guardarlo (falta la columna «Entrega» o la integración no puede editar). Probá de nuevo en un momento." });
  } else {
    const props = { Entrega: { select: { name: LABEL[kind][action] } } };
    if (kind === "master") props["Fecha de entrega"] = { date: null }; // ya no hay nada que entregar
    const upd = await notion(`/pages/${songId}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
    if (!upd.ok) {
      const hint = upd.status === 400 ? "Falta la columna «Entrega» en Canciones o la integración no puede editar." : "Notion no dejó guardarlo.";
      return json(502, { error: `${hint} Probá de nuevo en un momento.` });
    }
    synced = await deliverStage({ page: page.data, kind }).catch(() => null);
  }

  const saved = await db("song_approvals", { method: "POST", prefer: "return=representation", body: { profile_id: artist, song_id: songId, song_title: title, kind, action, source: "admin" } });
  if (!saved.ok) console.error("portal-mark song_approvals:", dbDetail(saved));
  const row = (saved.ok && saved.data && saved.data[0]) || {};
  // Entregado: le avisamos al artista por mail (mezcla, master o modificaciones).
  // Cada entrega es una versión distinta (la fila recién guardada), así dos
  // entregas en la misma hora mandan dos mails. Pero un doble clic no: si
  // hubo otro «Entregado» de esta canción en los 2 minutos anteriores, el
  // mail ya lo mandó ese.
  let notice = null;
  if (action === "entregada" && !(await clickedTwice(row, songId, kind))) {
    const version = row.id ? `manual|${row.id}` : `manual|${new Date().toISOString().slice(0, 16)}`;
    notice = await require("./_lib/aviso-entrega").notifyArtistDelivered({ profileId: artist, song: { id: songId, title }, kind, version }).catch(() => null);
  }
  return json(200, { ok: true, kind, action, at: row.created_at || new Date().toISOString(), saved: saved.ok, tasks: (synced && synced.tasks) || [], calendar: synced && synced.calendar, next: action === "aprobada" ? nextSong(kind) : null, notified: !!(notice && notice.sent) });
};
