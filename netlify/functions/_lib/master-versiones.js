// Versiones finales de un master aprobado, hechas con ffmpeg:
//
//   · WAV 24 bit · 48 kHz   (video, sync, plataformas que piden 48 kHz)
//   · WAV 16 bit · 44.1 kHz (distribuidoras y CD)
//   · MP3 320 kbps · 44.1 kHz (para mandar, escuchar y redes)
//
// Calidad: el cambio de frecuencia lo hace SoX (soxr, precisión 28 bits,
// el mismo motor que usan muchos programas de mastering) y el paso a 16 bit
// lleva dither triangular (TPDF), para que el recorte de bits no deje
// distorsión de cuantización en los finales y los fade outs.
// Además se mide el master (loudness integrado, rango y true peak) y el pico
// del MP3 ya decodificado, para avisar si el MP3 se pasa de 0 dB.
//
// ffmpeg: el de ffmpeg-static (viene con soxr y LAME). FFMPEG_PATH lo
// cambia (p. ej. para probar en la compu con el ffmpeg del sistema).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const VERSIONS = [
  { key: "wav48", label: "WAV 24 bit · 48 kHz", tag: "WAV 24bit 48kHz", ext: "wav", rate: 48000 },
  { key: "wav44", label: "WAV 16 bit · 44.1 kHz", tag: "WAV 16bit 44.1kHz", ext: "wav", rate: 44100 },
  { key: "mp3", label: "MP3 320 kbps · 44.1 kHz", tag: "MP3 320kbps", ext: "mp3", rate: 44100 },
];

// SoX, la máxima precisión. Si este ffmpeg no lo tuviera, el resampler propio
// de ffmpeg con filtro largo (también de muy buena calidad).
const SOXR = "resampler=soxr:precision=28";
const SWR = "resampler=swr:filter_size=256:phase_shift=10:cutoff=0.97";

let binCache = null;
function ffmpegBin() {
  if (binCache) return binCache;
  const wanted = process.env.FFMPEG_PATH || require("ffmpeg-static");
  if (!wanted) throw new Error("No está ffmpeg (ffmpeg-static).");
  try {
    fs.accessSync(wanted, fs.constants.X_OK);
    binCache = wanted;
  } catch (e) {
    // En Netlify el archivo a veces llega sin permiso de ejecución: se copia
    // a la carpeta temporal y se le da.
    const copy = path.join(os.tmpdir(), "zg-ffmpeg");
    if (!fs.existsSync(copy)) fs.copyFileSync(wanted, copy);
    fs.chmodSync(copy, 0o755);
    binCache = copy;
  }
  return binCache;
}

function run(args, { timeoutMs = 8 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; if (err.length > 400000) err = err.slice(-200000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg (${code}): ${err.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`));
    });
  });
}

// Formato del audio original: { codec, rate, channels, bits, seconds }.
async function probe(file) {
  // Sin archivo de salida, ffmpeg termina "con error" pero ya imprimió los datos.
  const full = await new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-nostdin", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", () => resolve(err));
    child.on("error", reject);
  });
  const line = (full.match(/Stream #\d+:\d+.*?: Audio: ([^\n]+)/) || [])[1] || "";
  const dur = full.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const codec = (line.match(/^([a-z0-9_]+)/i) || [])[1] || null;
  const rate = Number((line.match(/(\d+) Hz/) || [])[1]) || null;
  const channels = /stereo/.test(line) ? 2 : /mono/.test(line) ? 1 : Number((line.match(/(\d+) channels/) || [])[1]) || null;
  let bits = Number((line.match(/\((\d+) bit\)/) || [])[1]) || null;
  if (!bits && codec) {
    const m = codec.match(/^pcm_[suf](\d+)/);
    if (m) bits = Number(m[1]);
  }
  return {
    codec,
    rate,
    channels,
    bits,
    float: /^pcm_f/.test(codec || ""),
    lossy: !!codec && !/^pcm_|^flac|^alac/.test(codec),
    seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}

// Loudness del master (EBU R128): integrado (LUFS), rango (LU) y true peak (dBTP).
async function loudness(file) {
  const err = await run(["-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"]);
  const summary = err.slice(err.lastIndexOf("Summary:"));
  const num = (re) => { const m = summary.match(re); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) ? v : null; };
  return {
    lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

// Pico de muestra (dBFS) de un archivo ya decodificado (para el MP3).
async function samplePeak(file) {
  const err = await run(["-i", file, "-map", "0:a:0", "-af", "astats=measure_perchannel=none:measure_overall=Peak_level", "-f", "null", "-"]);
  const m = err.match(/Peak level dB:\s+(-?[\d.]+|-inf)/g);
  if (!m) return null;
  const v = Number(m[m.length - 1].replace(/.*:\s+/, ""));
  return Number.isFinite(v) ? v : null;
}

function argsFor(version, input, output, { resampler, meta }) {
  const tags = [];
  if (meta && meta.title) tags.push("-metadata", `title=${meta.title}`);
  if (meta && meta.artist) tags.push("-metadata", `artist=${meta.artist}`);
  if (meta && meta.publisher) tags.push("-metadata", version.ext === "mp3" ? `publisher=${meta.publisher}` : `copyright=${meta.publisher}`);
  const base = ["-y", "-i", input, "-map", "0:a:0", "-map_metadata", "-1", ...tags];
  if (version.key === "wav48") {
    return [...base, "-af", `aresample=48000:${resampler}:osf=s32`, "-c:a", "pcm_s24le", "-ar", "48000", output];
  }
  if (version.key === "wav44") {
    return [...base, "-af", `aresample=44100:${resampler}:osf=s16:dither_method=triangular_hp`, "-c:a", "pcm_s16le", "-ar", "44100", output];
  }
  // MP3: CBR 320, estéreo completo (sin joint) para no tocar la imagen
  // del master, máxima calidad del codificador y encabezado con la duración.
  return [...base, "-af", `aresample=44100:${resampler}`, "-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100", "-compression_level", "0", "-joint_stereo", "0", "-write_xing", "1", "-id3v2_version", "3", output];
}

// Hace las tres versiones en outDir. names: { wav48, wav44, mp3 } con el
// nombre de cada archivo. onFile (opcional): se llama con cada versión apenas
// está hecha (p. ej. para subirla y borrarla, así no se juntan todas en el
// disco). Devuelve { source, loudness, files: [{ key, label, name, path,
// size }], mp3Peak, notes: [] }.
async function makeVersions(input, outDir, names, meta, { onFile } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const source = await probe(input);
  if (!source.codec) throw new Error("El archivo del master no se pudo leer como audio.");
  const level = await loudness(input).catch(() => ({ lufs: null, lra: null, truePeak: null }));
  const files = [];
  let resampler = SOXR;
  for (const v of VERSIONS) {
    const out = path.join(outDir, names[v.key]);
    try {
      await run(argsFor(v, input, out, { resampler, meta }));
    } catch (e) {
      if (resampler !== SOXR || !/soxr/i.test(e.message)) throw e;
      resampler = SWR;
      await run(argsFor(v, input, out, { resampler, meta }));
    }
    const file = { key: v.key, label: v.label, name: names[v.key], path: out, size: fs.statSync(out).size };
    // El pico del MP3 se mide antes de entregarlo (después puede ya no estar).
    if (v.key === "mp3") file.peak = await samplePeak(out).catch(() => null);
    files.push(file);
    if (onFile) await onFile(file);
  }
  const mp3 = files.find((f) => f.key === "mp3");
  const mp3Peak = mp3 ? mp3.peak : null;

  // Avisos para Zeche, en criollo.
  const notes = [];
  if (source.lossy) notes.push(`El master aprobado es ${String(source.codec).toUpperCase()} (con pérdida): las versiones WAV salen de ese archivo y no recuperan calidad. Conviene subir el WAV del master y volver a generarlas.`);
  else {
    if (source.bits && source.bits <= 16) notes.push(`El master aprobado es de ${source.bits} bit: la versión de 24 bit sale de ahí (no suma resolución).`);
    if (source.rate && source.rate < 48000) notes.push(`El master aprobado es de ${source.rate / 1000} kHz: la versión de 48 kHz está remuestreada desde ahí.`);
  }
  if (mp3Peak != null && mp3Peak > -0.05) notes.push(`El MP3 tiene picos de ${mp3Peak.toFixed(1)} dBFS (el códec suma picos entre muestras). Si querés un MP3 sin clip, el master necesita un techo de true peak más bajo (−1 dBTP).`);
  else if (level.truePeak != null && level.truePeak > -1) notes.push(`True peak del master: ${level.truePeak.toFixed(1)} dBTP. Las plataformas recomiendan −1 dBTP o menos para que la conversión a sus códecs no recorte.`);
  return { source, loudness: level, files, mp3Peak, notes };
}

module.exports = { VERSIONS, makeVersions, probe, loudness, samplePeak, _argsFor: argsFor };
