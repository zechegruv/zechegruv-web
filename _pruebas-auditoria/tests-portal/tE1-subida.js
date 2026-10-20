// Extra E1: el tope de tamaño de las subidas lo controla OneDrive (no solo
// lo que dice el navegador) y un artista pausado no puede seguir subiendo.
const { S } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive, file } = require("./onedrive-fake");
const upload = require("../portal/netlify/functions/portal-upload");

const ME = "50000000-0000-4000-8000-000000000001";
const OFF = "50000000-0000-4000-8000-000000000002";
S.tables.profiles = [{ id: ME, role: "artist", active: true }, { id: OFF, role: "artist", active: false }];
S.tables.artist_private = [{ profile_id: ME, onedrive_edit_link: "https://1drv.ms/f/s!edit" }, { profile_id: OFF, onedrive_edit_link: "https://1drv.ms/f/s!edit2" }];
const log = [];
S.extraFetch = oneDrive({ Referencias: { "vieja.mp3": file("2026-10-01T00:00:00Z") } }, log);
const call = (id, body) => upload.handler({ httpMethod: "POST", headers: { authorization: `Bearer tok-${id}` }, body: JSON.stringify(body) });

(async () => {
  await test("al abrir la subida, OneDrive recibe el tamaño real del archivo (fileSize)", async () => {
    const r = await call(ME, { action: "start", section: "referencias", name: "demo.wav", size: 12345678 });
    assert(r.statusCode === 200, r.body);
    const sent = log.find((l) => /createUploadSession$/.test(l[1]));
    const body = sent && JSON.parse(sent[2]);
    assert(body && body.item && body.item.fileSize === 12345678, `pedido: ${sent && sent[2]}`);
  });

  await test("un artista pausado no puede mandar partes de una subida ya abierta", async () => {
    const before = log.length;
    const r = await call(OFF, { action: "chunk", uploadUrl: "https://up.microsoftpersonalcontent.com/sesion-1", start: 0, end: 9, total: 10, data: Buffer.from("0123456789").toString("base64") });
    assert(r.statusCode === 403, `status ${r.statusCode}`);
    assert(!log.slice(before).some((l) => /sesion-1/.test(l[1])), "reenvió la parte a OneDrive");
  });

  await test("un artista pausado tampoco puede consultar el estado de la subida", async () => {
    const r = await call(OFF, { action: "status", uploadUrl: "https://up.microsoftpersonalcontent.com/sesion-1" });
    assert(r.statusCode === 403, `status ${r.statusCode}`);
  });

  await test("una parte que dice un total más grande que el máximo se rechaza", async () => {
    const r = await call(ME, { action: "chunk", uploadUrl: "https://up.microsoftpersonalcontent.com/sesion-1", start: 0, end: 9, total: 400 * 1024 * 1024, data: Buffer.from("0123456789").toString("base64") });
    assert(r.statusCode === 400, `status ${r.statusCode}`);
  });
  done();
})();
