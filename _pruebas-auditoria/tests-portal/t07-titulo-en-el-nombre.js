// Bug 7: el título de la canción no tiene que decidir qué tipo de archivo es.
const { S } = require("../tests-shared/mock");
const { test, done, assert } = require("./harness-node");
const { oneDrive, file } = require("./onedrive-fake");
const audio = require("../portal/netlify/functions/_lib/song-audio");
const files = require("../portal/netlify/functions/portal-files");

const T = "2026-10-18T15:00:00Z";
const LINK = "https://1drv.ms/f/s!prueba";

(async () => {
  await test("«Estoy vivo - Mix v2.wav» es la mezcla de «Estoy vivo» (no una versión en vivo)", async () => {
    S.extraFetch = oneDrive({ Exports: { "Estoy vivo - Mix v2.wav": file(T) } });
    const got = audio.matchAudio([{ id: "s1", title: "Estoy vivo", step: 3 }], await audio.listAudio(LINK));
    assert(got.s1 && got.s1.mezcla && got.s1.mezcla.name === "Estoy vivo - Mix v2.wav", `quedó: ${JSON.stringify(got.s1 && Object.keys(got.s1).filter((k) => got.s1[k] && k !== "versions"))}`);
    assert(!got.s1.vivo, "la tomó también como versión en vivo");
  });

  await test("la maqueta de «Mix de emociones» es la maqueta (no la mezcla)", async () => {
    S.extraFetch = oneDrive({ Exports: { "Mix de emociones - maqueta.wav": file(T) } });
    const got = audio.matchAudio([{ id: "s2", title: "Mix de emociones", step: 3 }], await audio.listAudio(LINK));
    assert(got.s2 && got.s2.demo, "no la tomó como maqueta");
    assert(!got.s2.mezcla, "la tomó como mezcla para aprobar");
  });

  await test("un archivo que solo tiene el título («Estoy vivo.wav») no es entrega ni versión en vivo", async () => {
    S.extraFetch = oneDrive({ Exports: { "Estoy vivo.wav": file(T) } });
    const got = audio.matchAudio([{ id: "s1", title: "Estoy vivo", step: 3 }], await audio.listAudio(LINK));
    assert(!got.s1 || (!got.s1.vivo && !got.s1.mezcla), JSON.stringify(got.s1));
  });

  await test("Masters → Para show en vivo: no se toma como el master para aprobar", async () => {
    S.extraFetch = oneDrive({ Masters: { "Para show en vivo": { "Faro master.wav": file(T) }, "Faro master v1.wav": file("2026-10-17T10:00:00Z") } });
    const got = audio.matchAudio([{ id: "s3", title: "Faro", step: 4 }], await audio.listAudio(LINK));
    assert(got.s3.master && got.s3.master.name === "Faro master v1.wav", `master: ${got.s3.master && got.s3.master.name}`);
    assert(got.s3.vivo && got.s3.vivo.name === "Faro master.wav", "la versión en vivo no quedó como vivo");
  });

  await test("sigue igual: «Faro - Vivo.wav» es en vivo y «Faro master.wav» el master", async () => {
    S.extraFetch = oneDrive({ Masters: { "Faro - Vivo.wav": file(T), "Faro master.wav": file(T) } });
    const got = audio.matchAudio([{ id: "s3", title: "Faro", step: 4 }], await audio.listAudio(LINK));
    assert(got.s3.vivo && got.s3.vivo.name === "Faro - Vivo.wav" && got.s3.master && got.s3.master.name === "Faro master.wav", JSON.stringify(got.s3));
  });

  await test("Archivos: en la carpeta de la canción «Estoy vivo», «Estoy vivo - Mix v2.wav» lleva la etiqueta Mezcla", async () => {
    S.extraFetch = oneDrive({ Exports: { "Estoy vivo": { "Estoy vivo - Mix v2.wav": file(T) } } });
    const out = await files._listSection(LINK, "Exports");
    const f = out.groups[0].files[0];
    assert(f.tag === "mezcla", `etiqueta: ${f.tag}`);
  });

  await test("Archivos: la maqueta suelta de «Mix de emociones» no se etiqueta como Mezcla", async () => {
    S.extraFetch = oneDrive({ Exports: { "Mix de emociones": { "Mix de emociones mix final.wav": file(T) }, "Mix de emociones - maqueta.wav": file(T) } });
    const out = await files._listSection(LINK, "Exports");
    const loose = out.files.find((f) => /maqueta/.test(f.name));
    assert(loose.tag !== "mezcla", `etiqueta: ${loose.tag}`);
    assert(out.groups[0].files[0].tag === "mezcla", "la mezcla de verdad perdió la etiqueta");
  });

  await test("Archivos: Masters → Para show en vivo queda del lado de vivo", async () => {
    S.extraFetch = oneDrive({ Masters: { "Para show en vivo": { "Faro master.wav": file(T) } } });
    const out = await files._listSection(LINK, "Masters");
    assert(out.groups[0].files[0].tag === "vivo", `etiqueta: ${out.groups[0].files[0].tag}`);
  });
  done();
})();
