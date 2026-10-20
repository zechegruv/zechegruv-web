// OneDrive falso (API de visitante) para S.extraFetch. Se arma con un árbol:
//   tree = { "Exports": { "Faro": { "Faro mix.wav": item } , "x.wav": item }, ... }
// item = { modified (fecha del servidor), fsModified (fecha de la compu), created, size }
let n = 0;
function build(tree, folder = "root") {
  const out = [];
  for (const [name, v] of Object.entries(tree)) {
    const id = `it${++n}`;
    if (v && v.__file) {
      out.push({
        id, name, file: {}, size: v.size || 1000,
        createdDateTime: v.created || v.modified,
        lastModifiedDateTime: v.modified,
        fileSystemInfo: { createdDateTime: v.fsModified || v.modified, lastModifiedDateTime: v.fsModified || v.modified },
        "@content.downloadUrl": `https://dl.example/${encodeURIComponent(name)}?v=${v.urlVersion || 1}`,
      });
    } else {
      const kids = build(v, id);
      out.push({ id, name, folder: { childCount: kids.length }, __kids: kids });
    }
  }
  return out;
}
const file = (modified, extra = {}) => ({ __file: true, modified, ...extra });

function oneDrive(tree, log = []) {
  const root = build(tree);
  const byId = {};
  const walk = (list) => list.forEach((i) => { byId[i.id] = i; if (i.__kids) walk(i.__kids); });
  walk(root);
  const strip = (i) => { const { __kids, ...rest } = i; return rest; };
  const res = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  return async (url, init = {}) => {
    log.push([init.method || "GET", url, init.body]);
    if (url.includes("api-badgerp.svc.ms")) return res(200, { token: "od", expiryTimeUtc: new Date(Date.now() + 864e5).toISOString() });
    if (!url.includes("microsoftpersonalcontent.com")) return null;
    const u = new URL(url);
    if (/\/shares\/[^/]+\/driveitem/.test(u.pathname)) return res(200, { id: "rootid", name: "Carpeta", folder: {}, parentReference: { driveId: "drv" }, children: root.map(strip) });
    let m = u.pathname.match(/\/drives\/drv\/items\/([^/:]+)\/children$/);
    if (m && (init.method || "GET") === "POST") {
      const b = JSON.parse(init.body || "{}");
      const parent = m[1] === "rootid" ? root : byId[m[1]].__kids;
      if (parent.some((i) => i.name === b.name)) return res(409, {});
      const made = { id: `it${++n}`, name: b.name, folder: { childCount: 0 }, __kids: [] };
      parent.push(made); byId[made.id] = made;
      return res(201, strip(made));
    }
    if (m) {
      const kids = m[1] === "rootid" ? root : (byId[m[1]] && byId[m[1]].__kids) || [];
      return res(200, { value: kids.map(strip) });
    }
    m = u.pathname.match(/createUploadSession$/);
    if (m) return res(200, { uploadUrl: "https://up.microsoftpersonalcontent.com/sesion-1" });
    return res(404, {});
  };
}
module.exports = { oneDrive, file };
