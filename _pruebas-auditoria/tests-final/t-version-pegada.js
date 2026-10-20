// «mix2», «master3», «mezcla2»: el número de versión pegado no impide reconocer el audio.
const sa = require(__dirname + "/../" + (process.env.ZG_REPO || "panel") + "/netlify/functions/_lib/song-audio");
let fails = 0;
const ok = (c, w) => { console.log(`${c ? "PASA " : "FALLA"} ${w}`); if (!c) fails++; };
const songs = [{ id: "s1", title: "Busco Más" }, { id: "s2", title: "Mixtape" }, { id: "s3", title: "Faro" }];
const A = (name, folder = "Exports") => ({ name, folder, modified: "2026-10-19T12:00:00Z", url: "x", fresh: true });
const m = sa.matchAudio(songs, [A("Busco Más mix2.wav"), A("Faro master3.wav", "Masters"), A("Mixtape demo.wav"), A("Faro remix.wav")]);
ok(m.s1 && m.s1.mezcla && m.s1.mezcla.name === "Busco Más mix2.wav", "«Busco Más mix2.wav» es la mezcla de Busco Más");
ok(m.s3 && m.s3.master && m.s3.master.name === "Faro master3.wav", "«Faro master3.wav» es el master de Faro");
ok(!(m.s2 && m.s2.mezcla), "«Mixtape demo.wav» no es una mezcla (el título no cuenta)");
ok(!(m.s3 && m.s3.mezcla), "«Faro remix.wav» no se toma como mezcla");
console.log(fails ? `${fails} FALLAN` : "TODAS PASAN"); process.exit(fails ? 1 : 0);
