// Carpeta del master aprobado con sus versiones finales.
//
// Cuando el artista aprueba el master (desde el portal, o lo marcás vos como
// "Master aprobado" y la canción pasa a Distribución), en su carpeta de
// OneDrive se arma sola:
//
//   Masters / <Canción> /
//     <Artista> - <Canción> (Master aprobado).wav   ← el que aprobó, tal cual
//     <Artista> - <Canción> (WAV 24bit 48kHz).wav
//     <Artista> - <Canción> (WAV 16bit 44.1kHz).wav
//     <Artista> - <Canción> (MP3 320kbps).mp3
//
// Las versiones las hace ffmpeg (_lib/master-versiones.js). Te llega un mail
// con el link a la carpeta, el loudness del master y avisos si hace falta
// (p. ej. si el master aprobado era un MP3 o si el MP3 se pasa de 0 dB).
//
// Corre en una función de fondo (masters-finales-background.js, hasta 15
// minutos) porque bajar, convertir y subir los WAV lleva su tiempo.
// Cada canción se hace una sola vez (Supabase → masters_finales,
// 039_masters_finales.sql). Si falla (OneDrive no responde, etc.) se
// reintenta sola en la pasada de cada 15 minutos, hasta 3 veces; si el
// artista aprueba otra versión del master más adelante, se vuelve a armar
// con la nueva (los archivos de la carpeta se reemplazan).
//
// Las versiones anteriores del master de esa canción (sueltas en Masters o
// en su carpeta) se mueven a Exports / <Canción> (se crea si no está): en
// Masters queda solo la carpeta de la canción con lo final. Las versiones en
// vivo de esa canción (sueltas o en "Pistas Show en vivo") también se juntan
// en Masters / <Canción>, con "Vivo" en el nombre si no lo tenía.
// Si la carpeta de la canción ya existe en Masters, se usa esa. La detección
// de entregas (song-audio.js) reconoce estos archivos por el nombre ("(Master
// aprobado)", "(WAV 24bit 48kHz)", ...) y no los toma como master nuevo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { db, sendMail, notifyEmail, esc, serviceKey, PUBLIC_URL } = require("./pass");
const { listAudio, matchAudio, norm } = require("./song-audio");
const drive = require("./onedrive");
const { makeVersions } = require("./master-versiones");

const ps = () => require("../portal-songs");
const notion = (p, init) => require("./notion").notion(p, init);
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("").trim();
const sameId = (a, b) => String(a || "").replace(/-/g, "") === String(b || "").replace(/-/g, "");

const FOLDER_MASTERS = "Masters";
const FOLDER_EXPORTS = "Exports";
const MAX_ATTEMPTS = 3;
const STALE_MS = 20 * 60 * 1000; // una corrida "procesando" más vieja que esto se cortó
const CHUNK = 320 * 1024 * 32; // 10 MiB (múltiplo de 320 KiB, como pide OneDrive)

// Clave para que solo el portal pueda pedir la función de fondo (sale de la
// clave secreta de Supabase: no hace falta otra variable en Netlify).
const key = () => crypto.createHash("sha256").update(`${serviceKey()}|masters-finales`).digest("hex");
const validKey = (event) => {
  const got = String((event.headers && (event.headers["x-zg-finales"] || event.headers["X-Zg-Finales"])) || "");
  const want = key();
  return !!serviceKey() && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

// Pide la función de fondo y no espera a que termine (Netlify responde 202
// apenas la recibe). version: el archivo que aprobó el artista, si se sabe.
async function trigger(songId, { version = null, force = false } = {}) {
  const base = process.env.URL || PUBLIC_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${base}/.netlify/functions/masters-finales-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zg-finales": key() },
      body: JSON.stringify({ song: songId, version, force }),
      signal: ctrl.signal,
    });
    return res.status;
  } catch (e) {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// Los archivos que arma esto (para que song-audio.js no los tome como entregas).
const FINAL_NAME = /\((master aprobado|wav 24 ?bit 48 ?khz|wav 16 ?bit 44[.,]1 ?khz|mp3 320 ?kbps)\)(\s*\(\d+\))?\.[a-z0-9]{2,4}$/i;

const APPROVED_NAME = /\(master aprobado\)(?:\s*\(\d+\))?\.([a-z0-9]{2,4})$/i;

// Al pasar a Exports, una versión de master nombrada solo con el título y el
// número («OKEY V4.wav») lleva "Master" en el nombre («OKEY Master V4.wav»):
// en Exports, sin esa palabra, el portal la tomaría por una mezcla.
function exportName(name) {
  if (/(^|[^a-z])(master|mastered|mstr)\d*([^a-z]|$)/i.test(String(name).replace(/\.[a-z0-9]{2,4}$/i, ""))) return null;
  const out = String(name).replace(/(\s*[-_]?\s*)((?:v|ver|version)?\s?\d{1,3})(\.[a-z0-9]{2,4})$/i, " Master $2$3");
  return out !== name ? out : String(name).replace(/(\.[a-z0-9]{2,4})$/i, " Master$1");
}

// Una versión en vivo que estaba en "Pistas Show en vivo" y no dice "vivo" en
// el nombre lo suma al pasar a la carpeta de la canción («Seu amor.wav» →
// «Seu amor Vivo.wav»): ahí el portal la reconoce por el nombre.
function liveName(name, title) {
  if (/ (vivo|live)\d* /.test(` ${` ${norm(String(name).replace(/\.[a-z0-9]{2,4}$/i, ""))} `.split(` ${norm(title)} `).join(" ")} `)) return null;
  return String(name).replace(/(\.[a-z0-9]{2,4})$/i, " Vivo$1");
}

// Nombre de archivo prolijo: "Pazz - Seu amor (WAV 24bit 48kHz).wav".
const fileBase = (artist, title) => drive.cleanName([artist, title].filter(Boolean).join(" - ")) || "Master";
function namesFor(artist, title, sourceName) {
  const base = fileBase(artist, title);
  const ext = (String(sourceName || "").match(/\.([a-z0-9]{2,4})$/i) || [, "wav"])[1].toLowerCase();
  return {
    original: `${base} (Master aprobado).${ext}`,
    wav48: `${base} (WAV 24bit 48kHz).wav`,
    wav44: `${base} (WAV 16bit 44.1kHz).wav`,
    mp3: `${base} (MP3 320kbps).mp3`,
  };
}

// ---------- Registro (una vez por canción) ----------
const songKey = (id) => String(id || "").replace(/-/g, "");

async function readRow(songId) {
  const r = await db(`masters_finales?song_id=eq.${songKey(songId)}&select=*`);
  if (!r.ok) return { error: r.status === 404 || /masters_finales/.test(JSON.stringify(r.data || "")) ? "Falta correr 039_masters_finales.sql en Supabase." : `masters_finales ${r.status}` };
  return { row: (r.data || [])[0] || null };
}

// Se queda con la canción para esta corrida, o dice por qué no.
async function claim(songId, { version, force }) {
  const id = songKey(songId);
  const now = new Date().toISOString();
  const ins = await db("masters_finales?on_conflict=song_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { song_id: id, status: "procesando", attempts: 1, started_at: now } });
  if (!ins.ok) {
    const r = await readRow(songId);
    return { skip: r.error || `masters_finales ${ins.status}` };
  }
  if (ins.data && ins.data[0]) return { row: ins.data[0] };
  const { row, error } = await readRow(songId);
  if (error || !row) return { skip: error || "sin registro" };
  const newVersion = version && row.source_version && version !== row.source_version;
  const stale = row.status === "procesando" && Date.now() - Date.parse(row.started_at || 0) > STALE_MS;
  if (row.status === "procesando" && !stale) return { skip: "ya se está armando" };
  if (row.status === "lista" && !force && !newVersion) return { skip: "ya está lista" };
  if (row.status !== "lista" && !force && !newVersion && (row.attempts || 0) >= MAX_ATTEMPTS) return { skip: "sin más reintentos" };
  const attempts = newVersion || force ? 1 : (row.attempts || 0) + 1;
  // Solo una corrida gana: el cambio vale si nadie lo tocó en el medio.
  const upd = await db(`masters_finales?song_id=eq.${id}&status=eq.${row.status}&attempts=eq.${row.attempts || 0}`, { method: "PATCH", prefer: "return=representation", body: { status: "procesando", attempts, started_at: now, error: null } });
  return upd.ok && upd.data && upd.data[0] ? { row: upd.data[0] } : { skip: "la tomó otra corrida" };
}

const finish = (songId, patch) => db(`masters_finales?song_id=eq.${songKey(songId)}`, { method: "PATCH", body: { ...patch, finished_at: new Date().toISOString() } });

// ---------- Datos de la canción ----------
async function songData(songId) {
  const page = await notion(`/pages/${songId}`);
  if (!page.ok) throw new Error(`Notion no dejó leer la canción (${page.status}).`);
  const p = page.data.properties || {};
  const clientId = ((p.Artista && p.Artista.relation) || [])[0]?.id || null;
  let artist = "";
  if (clientId) {
    const c = await notion(`/pages/${clientId}`);
    const t = c.ok && Object.values(c.data.properties || {}).find((x) => x && x.type === "title");
    artist = t ? plain(t.title) : "";
  }
  return {
    id: page.data.id,
    title: plain(p["Canción"] && p["Canción"].title) || "Sin título",
    stage: (p["Etapa actual"] && p["Etapa actual"].select && p["Etapa actual"].select.name) || null,
    entrega: (p.Entrega && p.Entrega.select && p.Entrega.select.name) || null,
    clientId,
    artist,
  };
}

// Carpeta de OneDrive del artista de esa ficha de Notion (como en
// auto-entregas: la ficha guardada o la que coincide por mail o nombre).
async function artistFolder(clientId) {
  const [profiles, privs] = await Promise.all([
    db("profiles?select=*"),
    db("artist_private?select=profile_id,notion_page_id,onedrive_link,onedrive_edit_link"),
  ]);
  if (!profiles.ok || !privs.ok) throw new Error("No se pudo leer Supabase.");
  const priv = Object.fromEntries((privs.data || []).map((r) => [r.profile_id, r]));
  const withFolder = (profiles.data || []).filter((p) => p.role !== "admin" && priv[p.id] && (priv[p.id].onedrive_edit_link || priv[p.id].onedrive_link));
  const saved = withFolder.find((p) => sameId(ps()._parsePageId(priv[p.id].notion_page_id), clientId));
  let hit = saved || null;
  if (!hit) {
    for (const p of withFolder.filter((x) => !priv[x.id].notion_page_id)) {
      if (sameId(ps()._parsePageId(await ps()._findClient(p).catch(() => null)), clientId)) { hit = p; break; }
    }
  }
  if (!hit) return null;
  const r = priv[hit.id];
  // Para crear la carpeta y subir hace falta el link de edición.
  return { profileId: hit.id, edit: r.onedrive_edit_link || null, view: r.onedrive_link || null, email: hit.email || null };
}

// El master que aprobó el artista: el de la aprobación (song_approvals) o,
// si no figura, el más nuevo de la canción.
async function approvedAudio(song, link, versionHint) {
  const [audios, pages] = await Promise.all([
    listAudio(link),
    ps()._notionQuery(ps().SONGS_DS, { property: "Artista", relation: { contains: song.clientId } }),
  ]);
  // Para el portal, esta canción sigue siendo la del master (aunque ya haya
  // pasado a Distribución): así se reconoce también un «Master 3.wav» sin título.
  const songs = pages.map(ps()._toSong).map((s) => (sameId(s.id, song.id) ? { ...s, step: 4 } : s));
  const mine = songs.find((s) => sameId(s.id, song.id));
  const slot = (mine && matchAudio(songs, audios)[mine.id]) || null;
  const masters = (slot && slot.versions && slot.versions.master) || [];
  // Versiones para show en vivo de esta canción que están en Masters
  // (sueltas o en una carpeta como "Pistas Show en vivo").
  const live = mine ? audios.filter((a) => a.section === "masters" && a.id && !FINAL_NAME.test(a.name)
    && ((matchAudio(songs, [a])[mine.id] || {}).vivo)) : [];
  if (!masters.length) return { best: null, all: [], live };
  let wanted = versionHint;
  if (!wanted) {
    const last = await db(`song_approvals?song_id=eq.${song.id}&kind=eq.master&action=eq.aprobada&select=version&order=created_at.desc&limit=1`);
    wanted = (last.ok && last.data && last.data[0] && last.data[0].version) || null;
    if (!wanted) {
      // Guardado con o sin guiones según por dónde entró.
      const alt = await db(`song_approvals?song_id=eq.${songKey(song.id)}&kind=eq.master&action=eq.aprobada&select=version&order=created_at.desc&limit=1`);
      wanted = (alt.ok && alt.data && alt.data[0] && alt.data[0].version) || null;
    }
  }
  const byName = wanted && masters.find((a) => a.name === wanted);
  // La aprobada o, si no figura, la más nueva.
  const best = byName || slot.master || masters[0];
  return { best: best || null, all: masters, live };
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`OneDrive no dejó bajar el master (${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  return fs.statSync(file).size;
}

// Sube un archivo del disco por partes, reemplazando el anterior si existe.
async function upload(target, name, file) {
  const total = fs.statSync(file).size;
  const url = await drive.createUploadSession(target, name, "replace");
  if (!url) throw new Error(`OneDrive no dejó subir «${name}».`);
  const fd = fs.openSync(file, "r");
  try {
    let start = 0;
    while (start < total) {
      const len = Math.min(CHUNK, total - start);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      let out = null;
      for (let i = 0; i < 3 && !out; i++) {
        out = await drive.putChunk(url, start, start + len - 1, total, buf).catch(() => null);
        if (!out) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
      if (!out) throw new Error(`Se cortó la subida de «${name}».`);
      start += len;
      if (out.done) break;
    }
  } finally {
    fs.closeSync(fd);
  }
  return name;
}

const mb = (n) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const fmtNum = (v, unit) => (v == null ? "—" : `${v.toFixed(1)} ${unit}`);

function mailBox(title, body) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;background:#241105;color:#FFF4DC;padding:28px;border-radius:18px;max-width:560px">
<p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">Portal · Master aprobado</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700">${title}</p>${body}</div>`;
}

// ---------- La corrida ----------
// Devuelve { ok, skipped?, folderUrl?, files? } y nunca tira error.
async function build(songId, { version = null, force = false } = {}) {
  const id = ps()._parsePageId(songId);
  if (!id) return { ok: false, error: "canción inválida" };
  const claimed = await claim(id, { version, force });
  if (claimed.skip) return { ok: true, skipped: claimed.skip };
  const attempt = claimed.row.attempts || 1;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "zg-finales-"));
  let song = null;
  try {
    song = await songData(id);
    if (song.entrega !== "Master aprobado" && !["Distribución", "Publicada"].includes(song.stage)) throw new Error("La canción todavía no tiene el master aprobado.");
    if (!song.clientId) throw new Error("La canción no tiene artista en Notion.");
    const owner = await artistFolder(song.clientId);
    if (!owner || !(owner.edit || owner.view)) throw new Error("El artista no tiene la carpeta de OneDrive cargada en el portal.");
    if (!owner.edit) throw new Error("Falta el link de edición de la carpeta del artista (para poder crear la carpeta y subir).");

    // Masters / <Canción> (si ya existe, esa misma) y Exports / <Canción>.
    const root = await drive.folder(owner.edit);
    if (root.error) throw new Error(`OneDrive: ${root.error}.`);
    const folderName = drive.cleanName(song.title) || "Sin título";
    const masters = await drive.subfolder(root, FOLDER_MASTERS);
    const dest = masters && await drive.subfolder(masters, folderName);
    if (!dest) throw new Error(`OneDrive no dejó crear la carpeta Masters/${song.title}.`);
    const destItems = (await drive.list(dest)) || [];

    const found = await approvedAudio(song, owner.edit, version);
    let audio = found && found.best;
    // Una corrida anterior ya pudo haber movido el aprobado a su carpeta:
    // si no aparece suelto, se usa el que quedó ahí.
    const keptApproved = destItems.find((i) => i.file && APPROVED_NAME.test(i.name));
    if (!audio && keptApproved) audio = { name: keptApproved.name, url: keptApproved["@content.downloadUrl"], id: null, kept: true };
    if (!audio || !audio.url) throw new Error("No encontré el audio del master en la carpeta del artista.");
    const names = namesFor(song.artist, song.title, audio.name);
    const src = path.join(work, names.original);
    await download(audio.url, src);

    // Las versiones anteriores del master (y, si se aprobó otra versión
    // más adelante, el aprobado de antes) se van a Exports / <Canción>.
    // Solo las de esta canción y que estaban en Masters; las versiones en
    // vivo no se tocan. Nunca se pisa nada: si el nombre ya existe en
    // Exports, OneDrive le agrega un número.
    let exportsDest = null;
    const toExports = async () => {
      if (exportsDest) return exportsDest;
      const ex = await drive.subfolder(root, FOLDER_EXPORTS);
      exportsDest = ex && await drive.subfolder(ex, folderName);
      if (!exportsDest) throw new Error(`OneDrive no dejó crear la carpeta Exports/${song.title}.`);
      return exportsDest;
    };
    const moved = [], notMoved = [];
    const sendToExports = async (item, name) => {
      const ok = await drive.move(root, item.id, await toExports(), name || null, "rename").catch(() => null);
      (ok ? moved : notMoved).push(name || item.name);
      return ok;
    };
    if (keptApproved && !audio.kept) {
      // Ya había un aprobado (de una versión anterior): pasa a Exports con
      // un nombre que diga que fue el aprobado antes.
      await sendToExports(keptApproved, keptApproved.name.replace(APPROVED_NAME, (m, ext) => `(Master aprobado antes).${ext}`));
    }

    // El aprobado entra a Masters / <Canción> con su nombre final (se mueve,
    // no queda duplicado). Si OneDrive no deja moverlo, se sube una copia.
    const files = [{ key: "original", label: "Master aprobado (original)", name: names.original, size: fs.statSync(src).size }];
    let approvedMoved = false;
    if (audio.id) approvedMoved = !!(await drive.move(root, audio.id, dest, names.original, "replace").catch(() => null));
    else if (audio.kept) approvedMoved = audio.name === names.original;
    if (!approvedMoved) await upload(dest, names.original, src);

    // Las demás versiones de esta canción que estaban en Masters (sueltas o
    // en subcarpetas), a Exports.
    const others = ((found && found.all) || []).filter((a) => a.id && a.id !== audio.id && a.section === "masters" && !FINAL_NAME.test(a.name));
    for (const a of others) await sendToExports(a, exportName(a.name));

    // Las versiones en vivo de la canción se juntan en Masters / <Canción>.
    const liveMoved = [], liveFailed = [];
    const destKey = norm(folderName);
    for (const a of (found && found.live) || []) {
      if (norm(a.folder || "") === destKey) continue; // ya está ahí
      const name = liveName(a.name, song.title);
      const ok = await drive.move(root, a.id, dest, name, "rename").catch(() => null);
      (ok ? liveMoved : liveFailed).push(name || a.name);
    }

    // Cada versión apenas está hecha: se sube y se borra del disco temporal.
    const meta = { title: song.title, artist: song.artist, publisher: "ZECHE GRUV" };
    const made = await makeVersions(src, path.join(work, "versiones"), names, meta, {
      onFile: async (f) => { await upload(dest, f.name, f.path); fs.rmSync(f.path, { force: true }); },
    });
    files.push(...made.files);
    const folderInfo = await drive.info(dest).catch(() => null);
    const folderUrl = (folderInfo && folderInfo.webUrl) || null;

    const summary = files.map((f) => ({ key: f.key, label: f.label, name: f.name, size: f.size }));
    await finish(id, { status: "lista", error: null, source_version: audio.name, folder_url: folderUrl, files: summary, moved: { toExports: moved, failed: notMoved, approvedMoved, live: liveMoved, liveFailed }, loudness: { ...made.loudness, mp3Peak: made.mp3Peak, source: made.source } });

    const src16 = made.source;
    await sendMail({
      to: notifyEmail(),
      from: "ZG Portal <portal@zechegruv.com>",
      subject: `Versiones finales listas: «${song.title}»${song.artist ? ` de ${song.artist}` : ""}`,
      html: mailBox(`«${esc(song.title)}»${song.artist ? ` · ${esc(song.artist)}` : ""}: carpeta del master lista`,
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">En su carpeta de OneDrive, en <b>Masters → ${esc(song.title)}</b>, quedaron:</p>
<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;line-height:1.7">${summary.map((f) => `<li>${esc(f.name)} <span style="color:#C9A980">(${mb(f.size)})</span></li>`).join("")}</ul>
<p style="margin:0 0 6px;font-size:13px;color:#C9A980">Master aprobado: ${esc(audio.name)} · ${src16.bits ? `${src16.bits} bit` : esc(String(src16.codec || "").toUpperCase())}${src16.rate ? ` · ${src16.rate / 1000} kHz` : ""}</p>
<p style="margin:0 0 14px;font-size:13px;color:#C9A980">Loudness: ${fmtNum(made.loudness.lufs, "LUFS")} integrado · true peak ${fmtNum(made.loudness.truePeak, "dBTP")} · rango ${fmtNum(made.loudness.lra, "LU")}</p>
${moved.length ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#C9A980">Pasé a <b>Exports → ${esc(song.title)}</b> las versiones anteriores: ${moved.map(esc).join(", ")}.</p>` : ""}
${liveMoved.length ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#C9A980">Junté en la carpeta las versiones en vivo: ${liveMoved.map(esc).join(", ")}.</p>` : ""}
${liveFailed.length ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#FF9C7A">No pude mover las versiones en vivo: ${liveFailed.map(esc).join(", ")}.</p>` : ""}
${notMoved.length ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#FF9C7A">No pude mover a Exports: ${notMoved.map(esc).join(", ")}. Quedaron en Masters.</p>` : ""}
${approvedMoved ? "" : `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#FF9C7A">No pude mover el master aprobado (${esc(audio.name)}): subí una copia a la carpeta y el original quedó donde estaba.</p>`}
${made.notes.length ? `<div style="margin:0 0 14px;padding:12px 14px;background:#2E1607;border-radius:12px;font-size:13px;line-height:1.5;color:#FFD9A0">${made.notes.map(esc).join("<br>")}</div>` : ""}
${folderUrl ? `<a href="${esc(folderUrl)}" style="display:inline-block;background:#F5A623;color:#241105;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:999px">Abrir la carpeta</a>` : ""}`),
    }).catch(() => false);
    return { ok: true, folderUrl, files: summary.map((f) => f.name) };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    console.error("masters-finales:", songId, msg);
    await finish(id, { status: "error", error: msg }).catch(() => null);
    // Aviso solo cuando ya no se va a reintentar solo.
    if (attempt >= MAX_ATTEMPTS) {
      await sendMail({
        to: notifyEmail(),
        from: "ZG Portal <portal@zechegruv.com>",
        subject: `No pude armar las versiones finales${song ? ` de «${song.title}»` : ""}`,
        html: mailBox(`No pude armar la carpeta del master${song ? ` de «${esc(song.title)}»` : ""}`,
          `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">Lo intenté ${attempt} veces. El último error fue:</p><p style="margin:0 0 14px;padding:12px 14px;background:#2E1607;border-radius:12px;font-size:14px">${esc(msg)}</p><p style="margin:0;font-size:13px;color:#C9A980">Cuando lo resuelvas, se vuelve a armar sola si el artista aprueba de nuevo, o pedímelo y la disparo a mano.</p>`),
      }).catch(() => false);
    }
    return { ok: false, error: msg };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Para la pasada de cada 15 minutos: lo que falló o quedó cortado se vuelve
// a pedir (hasta MAX_ATTEMPTS).
async function retryPending() {
  const r = await db(`masters_finales?status=in.(error,procesando)&attempts=lt.${MAX_ATTEMPTS}&select=song_id,status,started_at,attempts`);
  if (!r.ok) return { retried: 0 };
  const due = (r.data || []).filter((x) => x.status === "error" || Date.now() - Date.parse(x.started_at || 0) > STALE_MS);
  await Promise.all(due.map((x) => trigger(x.song_id)));
  return { retried: due.length };
}

module.exports = { build, trigger, retryPending, validKey, _namesFor: namesFor, _claim: claim, _exportName: exportName, _liveName: liveName, FINAL_NAME };
