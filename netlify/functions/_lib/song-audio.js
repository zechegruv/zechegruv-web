// Mezclas y masters entregados, detectados solos en la carpeta de OneDrive
// del artista. Zeche no marca nada a mano: cuando sube a la carpeta un
// audio (MP3, WAV o M4A) con "mix" / "mezcla" o "master" en el nombre,
// el portal lo reconoce como la mezcla o el master de esa canción y se lo
// muestra al artista para escucharlo y aprobarlo.
//
// Dónde se busca: los archivos sueltos de la carpeta del artista y las
// subcarpetas Exports y Masters (con sus subcarpetas por canción).
//
// Mayúsculas o minúsculas da igual ("MIX", "Mix", "mix"). Un archivo con
// "vivo" en el nombre es la versión para show en vivo: no se toma como
// mezcla ni master para aprobar (va aparte, en Masters → Para show en vivo).
//
// Solo cuentan los audios subidos desde que existe esto (AUTO_SINCE): los
// archivos viejos con esos nombres no aparecen de golpe para aprobar.
// Nada se copia ni se mueve: el portal solo lee los nombres.
//
// A qué canción pertenece: la que tenga su título en el nombre del archivo
// o de la subcarpeta ("Seu amor mix v2.wav", "Exports/Seu amor/mix.wav").
// Si no nombra ninguna y hay una sola canción en esa etapa, es de esa.
// Si hay varias versiones, vale la más nueva.
const ONEDRIVE_API = "https://my.microsoftpersonalcontent.com/_api/v2.0";
const ONEDRIVE_TOKEN_URL = "https://api-badgerp.svc.ms/v1.0/token";
const ONEDRIVE_APP_ID = "5cbed6ac-a083-4e14-b191-b4ba07653de2";

const AUDIO = /\.(mp3|wav|m4a)$/i;
const FOLDERS = ["exports", "masters", "maquetas", "maqueta", "demos", "demo"];
// Desde cuándo se detectan solos (hora de Buenos Aires). Se puede cambiar
// con la variable AUDIO_AUTO_SINCE en Netlify (p. ej. 2026-10-01). Hoy arranca el 13 de octubre de 2026..
const AUTO_SINCE = Date.parse(process.env.AUDIO_AUTO_SINCE ? `${process.env.AUDIO_AUTO_SINCE}T00:00:00-03:00` : "2026-10-13T00:00:00-03:00");

let cachedToken = null;
let cachedExpiresAt = 0;
async function token() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt) return cachedToken;
  const res = await fetch(ONEDRIVE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: ONEDRIVE_APP_ID }) });
  if (!res.ok) throw new Error(`OneDrive no dio acceso (${res.status}).`);
  const data = await res.json();
  cachedToken = data.token;
  cachedExpiresAt = Math.min(new Date(data.expiryTimeUtc).getTime() || 0, now + 24 * 60 * 60 * 1000) - 60 * 60 * 1000;
  return cachedToken;
}

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: `Badger ${await token()}`, Prefer: "autoredeem" } });
  if (!res.ok) throw new Error(`OneDrive respondió ${res.status}.`);
  return res.json();
}

async function children(driveId, itemId) {
  const items = [];
  let url = `${ONEDRIVE_API}/drives/${driveId}/items/${itemId}/children?$top=200`;
  while (url) {
    const page = await get(url);
    items.push(...(page.value || []));
    url = page["@odata.nextLink"] || null;
  }
  return items;
}

// Para comparar sin tildes, mayúsculas ni signos: "Seu Amor (v2)" -> "seu amor v2".
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// "mix", "mezcla" o "master" como palabra (no "remix" ni "premaster").
// Si dice las dos ("mix master"), es master.
function kindOf(name) {
  const n = ` ${norm(String(name).replace(AUDIO, ""))} `;
  if (/ (vivo|live) /.test(n)) return null; // versión para show en vivo
  if (/ (master|mastered|mstr) /.test(n)) return "master";
  if (/ (mix|mezcla|mixdown) /.test(n)) return "mezcla";
  return null;
}
// Además de mezcla y master: la maqueta / demo (para el "antes y después") y
// la versión para show en vivo (para el kit de lanzamiento). Estas no se
// aprueban ni se entregan: solo se escuchan y se descargan.
function extraKindOf(name) {
  const n = ` ${norm(String(name).replace(AUDIO, ""))} `;
  if (/ (vivo|live) /.test(n)) return "vivo";
  if (/ (maqueta|demo) /.test(n)) return "demo";
  return null;
}
const anyKind = (name) => kindOf(name) || extraKindOf(name);

const toAudio = (item, folder) => {
  const fs = item.fileSystemInfo || {};
  return {
    name: item.name,
    folder: folder || null,
    kind: anyKind(item.name),
    modified: fs.lastModifiedDateTime || item.lastModifiedDateTime || null,
    size: item.size || 0,
    url: item["@content.downloadUrl"] || null,
  };
};

// fresh: subido desde AUTO_SINCE. Solo esos cuentan como entrega para
// aprobar; los anteriores sirven igual para comparar versiones y para el kit.
const audioOf = (items, folder) => items
  .filter((i) => i.file && AUDIO.test(i.name) && anyKind(i.name))
  .map((i) => toAudio(i, folder))
  .map((a) => ({ ...a, fresh: (Date.parse(a.modified || "") || 0) >= AUTO_SINCE }));

// Todos los audios de mezcla y master de la carpeta del artista.
async function listAudio(shareLink) {
  const shareId = "u!" + Buffer.from(shareLink, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const root = await get(`${ONEDRIVE_API}/shares/${shareId}/driveitem?$expand=children`);
  const driveId = root.parentReference && root.parentReference.driveId;
  if (!driveId) return [];
  const top = root.children || [];
  const found = audioOf(top, null);
  const sections = top.filter((c) => c.folder && FOLDERS.includes(norm(c.name)));
  await Promise.all(sections.map(async (sec) => {
    const items = await children(driveId, sec.id);
    found.push(...audioOf(items, null));
    const subs = items.filter((i) => i.folder && i.folder.childCount);
    await Promise.all(subs.map(async (sub) => {
      found.push(...audioOf(await children(driveId, sub.id), sub.name));
    }));
  }));
  return found;
}

// Le asigna a cada canción su último audio de mezcla y de master.
// songs: [{ id, title, step }] (step 3 = Mezcla, 4 = Master).
// Devuelve { [songId]: { mezcla?, master?, demo?, vivo?, versions: { mezcla: [], master: [] } } }:
//   mezcla / master -> la entrega más nueva (solo subidas desde AUTO_SINCE)
//   demo / vivo     -> la maqueta y la versión en vivo más nuevas (de cuando sea)
//   versions        -> todas las versiones de mezcla y master, de la más nueva
//                      a la más vieja (para comparar A/B y para el kit).
function matchAudio(songs, audios) {
  const titled = songs.map((s) => ({ id: s.id, step: s.step, key: norm(s.title) })).filter((s) => s.key)
    .sort((a, b) => b.key.length - a.key.length); // "Seu amor" antes que "Amor"
  const out = {};
  const put = (id, a) => {
    const slot = (out[id] = out[id] || { versions: { mezcla: [], master: [] } });
    if (slot.versions[a.kind]) slot.versions[a.kind].push(a);
    if ((a.kind === "mezcla" || a.kind === "master") && !a.fresh) return;
    const prev = slot[a.kind];
    if (!prev || (a.modified || "") > (prev.modified || "")) slot[a.kind] = a;
  };
  const loose = [];
  audios.forEach((a) => {
    const hay = ` ${norm(`${a.folder || ""} ${a.name.replace(AUDIO, "")}`)} `;
    const song = titled.find((s) => hay.includes(` ${s.key} `));
    if (song) put(song.id, a); else if (a.fresh && (a.kind === "mezcla" || a.kind === "master")) loose.push(a);
  });
  // Sin título en el nombre: si hay una sola canción en esa etapa, es suya.
  const STEP = { mezcla: 3, master: 4 };
  loose.forEach((a) => {
    const candidates = songs.filter((s) => s.step === STEP[a.kind]);
    if (candidates.length === 1) put(candidates[0].id, a);
  });
  Object.values(out).forEach((slot) => {
    Object.values(slot.versions).forEach((list) => list.sort((x, y) => (y.modified || "").localeCompare(x.modified || "")));
  });
  return out;
}

module.exports = { listAudio, matchAudio, kindOf, extraKindOf, norm };
