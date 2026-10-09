// ZG PASS — carpetas de OneDrive de cada evento.
//
// Se pega UNA vez la carpeta madre (pass_settings.root_folder_link, link de
// edición). Cada evento usa, adentro, su carpeta de edición
// (pass_events.folder_name) con "Open Mic" y "Shows"; si no existen, se
// crean solas:
//
//   Carpeta madre / Edición 3 · 07-11-2026 / Open Mic
//                                          / Shows / <artista>
//
// Si un evento tiene un link propio (openmic_folder_link o
// shows_folder_link), se usa ese en lugar de la estructura automática.
const drive = require("./onedrive");
const { db } = require("./pass");

const KINDS = {
  openmic: { link: "openmic_folder_link", name: "Open Mic" },
  shows: { link: "shows_folder_link", name: "Shows" },
};
const TZ = "America/Argentina/Buenos_Aires";

async function rootLink() {
  const res = await db("pass_settings?key=eq.root_folder_link&select=value");
  return res.ok && res.data[0] ? res.data[0].value || null : null;
}

async function setRootLink(value) {
  const res = await db("pass_settings?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { key: "root_folder_link", value: value || null, updated_at: new Date().toISOString() },
  });
  return res.ok;
}

// Número de edición, a partir del nombre ("… Open Mic #2" → 2).
const editionNumber = (ev) => { const m = String(ev.name || "").match(/#\s*(\d+)\s*$/); return m ? Number(m[1]) : null; };

// Nombre de la carpeta de la edición: el elegido, o "Edición N" (o, si el
// nombre no tiene número, "Nombre del show · dd-mm-aaaa").
function folderName(ev) {
  if (ev.folder_name) return drive.cleanName(ev.folder_name);
  const n = editionNumber(ev);
  if (n) return `Edición ${n}`;
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ev.starts_at)).replace(/\//g, "-");
  return drive.cleanName(`${ev.name} · ${day}`);
}

// ¿Hay a dónde subir? (link propio del evento, o carpeta madre cargada)
const available = (ev, kind, root) => !!(ev[KINDS[kind].link] || root);

// Carpeta de Open Mic o Shows del evento: { target } | { error }.
async function eventFolder(ev, kind, root) {
  const k = KINDS[kind];
  if (ev[k.link]) {
    const own = await drive.folder(ev[k.link]);
    return own.error ? { error: `link propio: ${own.error}` } : { target: own };
  }
  const base = root === undefined ? await rootLink() : root;
  if (!base) return { error: "sin carpeta madre" };
  const top = await drive.folder(base);
  if (top.error) return { error: `carpeta madre: ${top.error}` };
  const edition = await drive.subfolder(top, folderName(ev));
  if (!edition) return { error: "no se pudo crear la carpeta de la edición" };
  const sub = await drive.subfolder(edition, k.name);
  return sub ? { target: sub } : { error: `no se pudo crear ${k.name}` };
}

// Arma (si faltan) las carpetas del evento: la de la edición con Open Mic
// y Shows, y adentro de Shows una por nombre. Nunca falla: devuelve si
// salió todo bien.
async function ensure(ev, names = [], root) {
  if (ev.kind !== "show") return null;
  const base = root === undefined ? await rootLink() : root;
  if (!available(ev, "shows", base)) return null;
  try {
    let ok = true;
    // Las ediciones anteriores que falten se crean vacías ("Edición 1"…),
    // así la carpeta madre queda completa y en orden.
    const n = editionNumber(ev);
    if (n && n > 1 && folderName(ev).toLowerCase() === `edición ${n}` && !ev.shows_folder_link && !ev.openmic_folder_link) {
      const top = await drive.folder(base);
      if (!top.error) for (let k = 1; k < n; k++) await drive.subfolder(top, `Edición ${k}`);
    }
    if (ev.openmic_enabled && available(ev, "openmic", base)) ok = !(await eventFolder(ev, "openmic", base)).error && ok;
    const shows = await eventFolder(ev, "shows", base);
    if (shows.error) return false;
    for (const n of names.filter(Boolean)) ok = !!(await drive.subfolder(shows.target, drive.cleanName(n))) && ok;
    return ok;
  } catch (e) {
    console.error("ZG PASS: carpetas", e);
    return false;
  }
}

module.exports = { KINDS, rootLink, setRootLink, folderName, available, eventFolder, ensure };
