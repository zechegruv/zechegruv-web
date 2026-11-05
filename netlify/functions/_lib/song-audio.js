// Mezclas y masters entregados, detectados solos en la carpeta de OneDrive
// del artista. Zeche no marca nada a mano: cuando sube a la carpeta un
// audio (MP3, WAV o M4A) con "mix" / "mezcla" o "master" en el nombre,
// el portal lo reconoce como la mezcla o el master de esa canción y se lo
// muestra al artista para escucharlo y aprobarlo.
//
// Dónde se busca: los archivos sueltos de la carpeta del artista y las
// subcarpetas Exports y Masters (con sus subcarpetas por canción).
//
// Mayúsculas o minúsculas da igual ("MIX", "Mix", "mix").
// En Exports y en Masters alcanza con el título y el número de versión:
// «OKEY V4.wav», «OKEY 4.wav» o «OKEY v 4.wav» es la mezcla 4 si está en
// Exports y el master 4 si está en Masters (no hace falta escribir "Mix").
// El número de versión («Mix 3», «Mix v3», «mix3», «V3», «3») se guarda
// para mostrarle al artista «Mix 4» y «Mix 3» al comparar. Un archivo con
// "vivo" en el nombre es la versión para show en vivo: no se toma como
// mezcla ni master para aprobar (va aparte, en Masters → Para show en vivo).
// Todo lo que está en una subcarpeta para vivo ("Para show en vivo") también.
// El título de la canción no cuenta: se saca del nombre antes de mirar, así
// «Estoy vivo - Mix v2.wav» es una mezcla y la maqueta de «Mix de emociones»
// es la maqueta.
//
// Solo cuentan los audios subidos desde que existe esto (AUTO_SINCE, según
// la fecha en que llegaron a OneDrive): los
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

// El nombre del archivo, ya comparable, sin el título de la canción: lo que
// dice el título no cuenta para saber qué es el archivo. Así «Estoy vivo -
// Mix v2.wav» es una mezcla (no la versión en vivo) y la maqueta de «Mix de
// emociones» es la maqueta (no la mezcla).
function withoutTitle(text, title) {
  const n = ` ${norm(text)} `;
  const key = norm(title);
  return key ? n.split(` ${key} `).join(" ") : n;
}
// Subcarpeta para show en vivo (p. ej. Masters → "Para show en vivo",
// "Vivo", "Versiones en vivo"): todo lo que hay adentro es la versión en
// vivo, diga lo que diga el nombre. Una carpeta de canción que se llama
// "Estoy vivo" no cuenta: tiene que decir solo eso (vivo/live y palabras
// sueltas como "para", "show", "en", "versiones").
const LIVE_WORDS = new Set(["vivo", "live", "para", "show", "shows", "en", "el", "la", "los", "las", "de", "del", "version", "versiones", "tracks", "pistas"]);
function liveFolder(folder, title) {
  if (!folder) return false;
  const w = withoutTitle(folder, title).trim().split(" ").filter(Boolean);
  return w.some((x) => x === "vivo" || x === "live") && w.every((x) => LIVE_WORDS.has(x));
}

// "mix", "mezcla" o "master" como palabra (no "remix" ni "premaster").
// Si dice las dos ("mix master"), es master. title: el de la canción, si
// ya se sabe de cuál es (se saca del nombre antes de mirar).
// El número de versión puede ir pegado: «mix2», «master3», «vivo2», «demo2».
function kindOf(name, title, folder) {
  const n = withoutTitle(String(name).replace(AUDIO, ""), title);
  if (/ (vivo|live)\d* /.test(n) || liveFolder(folder, title)) return null; // versión para show en vivo
  if (/ (master|mastered|mstr)\d* /.test(n)) return "master";
  if (/ (mix|mezcla|mixdown)\d* /.test(n)) return "mezcla";
  return null;
}
// Además de mezcla y master: la maqueta / demo (para el "antes y después") y
// la versión para show en vivo (para el kit de lanzamiento). Estas no se
// aprueban ni se entregan: solo se escuchan y se descargan.
function extraKindOf(name, title, folder) {
  const n = withoutTitle(String(name).replace(AUDIO, ""), title);
  if (/ (vivo|live)\d* /.test(n) || liveFolder(folder, title)) return "vivo";
  if (/ (maqueta|demo)\d* /.test(n)) return "demo";
  return null;
}
// Sección de la carpeta del artista que dice qué es un archivo nombrado solo
// con el título y el número de versión.
const SECTION_KIND = { exports: "mezcla", masters: "master" };
// ¿Lo que queda del nombre, sin el título, es solo un número de versión?
// «v4», «4», «v 4», «version 4», «ver4».
const bareVersion = (rest) => /^(v|ver|version)? ?\d{1,3}$/.test(String(rest).trim());
function sectionKindOf(name, title, section) {
  const kind = SECTION_KIND[section];
  if (!kind || !title) return null; // sin saber la canción no se adivina
  return bareVersion(withoutTitle(String(name).replace(AUDIO, ""), title)) ? kind : null;
}
const anyKind = (name, title, folder, section) => kindOf(name, title, folder) || extraKindOf(name, title, folder) || sectionKindOf(name, title, section);

// Número de versión del archivo: «Mix 4», «Mix v4», «mix4», «Master 2»,
// «V3» o el número suelto al final («OKEY 4»). null si no tiene.
function versionOf(name, title) {
  const n = withoutTitle(String(name).replace(AUDIO, ""), title).trim();
  const m = n.match(/(?:^| )(?:mix|mezcla|mixdown|master|mastered|mstr|v|ver|version) ?(\d{1,3})(?= |$)/) || n.match(/(?:^| )(\d{1,3})$/);
  return m ? Number(m[1]) : null;
}

// Fecha del audio: cuándo llegó a OneDrive (la del servidor: se subió o se
// reemplazó, la más nueva), no la del archivo en la compu de Zeche
// (fileSystemInfo). Una mezcla exportada antes de que el artista pida
// cambios y subida después es nueva igual: lo que importa es cuándo la puede
// escuchar el artista.
const serverDate = (item) => {
  const dates = [item.lastModifiedDateTime, item.createdDateTime].filter((d) => Date.parse(d || ""));
  if (!dates.length) return (item.fileSystemInfo || {}).lastModifiedDateTime || null;
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
};

const toAudio = (item, folder, section) => {
  return {
    name: item.name,
    folder: folder || null,
    section: section || null,
    // Provisorio: al saber de qué canción es, se vuelve a mirar sin su
    // título (matchAudio).
    kind: anyKind(item.name, null, folder),
    modified: serverDate(item),
    size: item.size || 0,
    url: item["@content.downloadUrl"] || null,
    id: item.id || null, // para moverlo (masters-finales.js)
  };
};

// fresh: subido desde AUTO_SINCE. Solo esos cuentan como entrega para
// aprobar; los anteriores sirven igual para comparar versiones y para el kit.
// Acá todavía no se sabe de qué canción es cada archivo: pasan todos los que
// podrían ser algo (con el título incluido) y matchAudio decide.
// En Exports y Masters pasan todos los audios: uno nombrado solo con el
// título y la versión («OKEY V4.wav») se reconoce recién al saber la canción.
// Las versiones finales que se arman solas al aprobar el master (Masters →
// <canción> → "… (Master aprobado).wav", "… (WAV 24bit 48kHz).wav", etc.,
// masters-finales.js) no son una entrega nueva: no cuentan.
const FINAL_NAME = /\((master aprobado|wav 24 ?bit 48 ?khz|wav 16 ?bit 44[.,]1 ?khz|mp3 320 ?kbps)\)(\s*\(\d+\))?\.[a-z0-9]{2,4}$/i;
const audioOf = (items, folder, section) => items
  .filter((i) => i.file && AUDIO.test(i.name) && !FINAL_NAME.test(i.name) && (SECTION_KIND[section] || anyKind(i.name) || (folder && anyKind(i.name, null, folder))))
  .map((i) => toAudio(i, folder, section))
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
    const section = norm(sec.name);
    found.push(...audioOf(items, null, section));
    const subs = items.filter((i) => i.folder && i.folder.childCount);
    await Promise.all(subs.map(async (sub) => {
      found.push(...audioOf(await children(driveId, sub.id), sub.name, section));
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
  const titled = songs.map((s) => ({ id: s.id, step: s.step, title: s.title, key: norm(s.title) })).filter((s) => s.key)
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
    if (song) {
      // Ya se sabe de qué canción es: se clasifica sin su título.
      const kind = anyKind(a.name, song.title, a.folder, a.section);
      if (kind) put(song.id, { ...a, kind, num: versionOf(a.name, song.title) });
    } else if (a.fresh && (a.kind === "mezcla" || a.kind === "master")) loose.push(a);
  });
  // Sin título en el nombre: si hay una sola canción en esa etapa, es suya.
  const STEP = { mezcla: 3, master: 4 };
  loose.forEach((a) => {
    const candidates = songs.filter((s) => s.step === STEP[a.kind]);
    if (candidates.length === 1) put(candidates[0].id, { ...a, num: versionOf(a.name, null) });
  });
  Object.values(out).forEach((slot) => {
    Object.values(slot.versions).forEach((list) => list.sort((x, y) => (y.modified || "").localeCompare(x.modified || "")));
  });
  return out;
}

module.exports = { listAudio, matchAudio, kindOf, extraKindOf, versionOf, norm };
