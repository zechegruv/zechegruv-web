// ZECHE GRUV — Edición del tour del portal (FFmpeg + títulos renderizados con Chromium).
//
//   node edicion/editar.js            arma los dos videos
//   node edicion/editar.js desktop    solo el horizontal 1920 × 1080
//   node edicion/editar.js reel       solo el vertical 1080 × 1920 (Reels, pantalla completa)
//
// Usa la última grabación real de grabaciones/desktop y grabaciones/reel
// (tour.js). La grabación es la protagonista: acá solo se corta, se le da un
// acercamiento lento, un color cálido, grano y viñeta, y se suman la placa de
// apertura, las etiquetas de cada parte y el cierre (edicion/titulos.html).
// Nada se inventa ni se reemplaza: cada plano es la captura del portal.
// Sin música: no hay un archivo autorizado. El video lleva una pista de audio
// en silencio para poder sumarle música en Instagram (biblioteca con licencia).
// Las piezas intermedias quedan en edicion/render/ para repetir o ajustar.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const ROOT = path.resolve(__dirname, "..");
const ED = __dirname;
const RENDER = path.join(ED, "render");
const FPS = 30;
// Transiciones: fundido suave al salir de la placa de apertura y al entrar al
// cierre. Entre partes del portal, corte limpio sobre la acción (un fundido
// entre dos pantallas parecidas superpone textos y se ve sucio).
const XF = { abre: 0.5, corte: 1 / 30, cierra: 0.6 };
// Etiquetas de cada parte ("Tu disco, etapa por etapa"…). Apagadas: el video
// va con voz narrada y subtítulos. Para volver a ponerlas: ZG_ETIQUETAS=1.
const ETIQUETAS = process.env.ZG_ETIQUETAS === "1";

// ---------- Guion: qué parte de la grabación va y con qué etiqueta ----------
// Los cortes se ubican con los pasos que tour.js anotó en el .json, así si se
// vuelve a grabar, el guion se acomoda solo.
const GUION = {
  desktop: {
    size: [1920, 1080], fmt: "h", out: "ZECHE-GRUV-Tour-Desktop-1920x1080.mp4",
    intro: 2.6, outro: 3.2, zoom: 0, // sin zoom: los acercamientos se hacen a mano en la edición
    focusX: 0.5,
    tag: { x: 320, bottom: 110 },
    // Una sola toma, sin cortes: cada menú de arriba a abajo y deslizar al siguiente.
    segs: [
      { from: [/^Menú: proyecto/, 0], to: [/^Fin del recorrido/, 0.6], tags: [] },
    ],
  },
  reel: {
    size: [1080, 1920], fmt: "v", out: "ZECHE-GRUV-Tour-Mobile-1080x1920.mp4",
    intro: 2.4, outro: 3.0, zoom: 0, // sin zoom: los acercamientos se hacen a mano en la edición
    focusX: 0.5,
    // Encima de la zona que tapan los botones de Instagram (abajo y a la derecha).
    tag: { center: true, bottom: 470 },
    // Una sola toma, sin cortes: cada menú de arriba a abajo y deslizar al siguiente.
    segs: [
      { from: [/^Menú: proyecto/, 0], to: [/^Fin del recorrido/, 0.6], tags: [] },
    ],
  },
};

const run = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,r_frame_rate,codec_name,codec_type", "-show_entries", "format=duration", "-of", "json", f]).toString());

function latestTake(kind) {
  const dir = path.join(ROOT, "grabaciones", kind);
  const metas = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const m of metas.reverse()) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, m)));
    if (meta.ok && meta.video && meta.video.endsWith(".mp4") && fs.existsSync(path.join(dir, meta.video))) return { meta, file: path.join(dir, meta.video) };
  }
  throw new Error(`No hay una grabación de alta calidad en grabaciones/${kind}. Corré: node tour.js ${kind}`);
}

const stepTime = (meta, [re, off]) => {
  const p = meta.pasos.find((x) => re.test(x.what));
  if (!p) throw new Error(`No encontré el paso ${re} en la grabación`);
  return p.t + off;
};

// ---------- Placas y etiquetas (Chromium, cuadro por cuadro) ----------
const KEY = (out) => `${out}.clave`;
const fresh = (out, key) => fs.existsSync(out) && fs.existsSync(KEY(out)) && fs.readFileSync(KEY(out), "utf8") === key;
const remember = (out, key) => fs.writeFileSync(KEY(out), key);

async function renderCard(browser, fmt, size, placa, seconds, out) {
  const [W, H] = size;
  const key = JSON.stringify({ placa, fmt, size, seconds, html: fs.statSync(path.join(ED, "titulos.html")).mtimeMs });
  if (fresh(out, key)) return;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(ED, "titulos.html")}?placa=${placa}&fmt=${fmt}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("load");
  const dir = fs.mkdtempSync(path.join(RENDER, `.${placa}-${fmt}-`));
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    const ms = (i * 1000) / FPS;
    await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 95 });
  }
  await page.close();
  run(["-framerate", String(FPS), "-i", path.join(dir, "%04d.jpg"), "-vf", "noise=c0s=6:c0f=t+u,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "14", out]);
  fs.rmSync(dir, { recursive: true, force: true });
  remember(out, key);
}

async function renderTag(browser, fmt, text, out) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(ED, "titulos.html")}?placa=etiqueta&fmt=${fmt}&texto=${encodeURIComponent(text)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("load");
  await page.evaluate(() => { const t = document.getElementById("tag"); t.style.left = "60px"; t.style.top = "60px"; });
  const b = await page.locator("#tag").boundingBox();
  // Margen para que entre la sombra.
  await page.screenshot({ path: out, omitBackground: true, clip: { x: b.x - 50, y: b.y - 40, width: b.width + 100, height: b.height + 100 } });
  await page.close();
  return { w: Math.round(b.width + 100), h: Math.round(b.height + 100), pad: 50 };
}

// ---------- Armado ----------
async function edit(kind, browser) {
  const G = GUION[kind];
  const [W, H] = G.size;
  const { meta, file } = latestTake(kind);
  console.log(`\n${kind}: grabación ${path.basename(file)}`);
  fs.mkdirSync(RENDER, { recursive: true });

  const intro = path.join(RENDER, `${kind}-placa-apertura.mp4`);
  const outro = path.join(RENDER, `${kind}-placa-cierre.mp4`);
  console.log("  placas de apertura y cierre…");
  await renderCard(browser, G.fmt, G.size, "intro", G.intro, intro);
  await renderCard(browser, G.fmt, G.size, "cierre", G.outro, outro);

  // Segmentos: inicio, duración en la grabación y duración final (con velocidad).
  const segs = G.segs.map((s) => {
    const a = stepTime(meta, s.from), b = stepTime(meta, s.to);
    const speed = s.speed || 1;
    return { ...s, a, src: b - a, dur: (b - a) / speed, speed };
  });

  // Cada pieza en su propio archivo (corte, velocidad, acercamiento, color, grano).
  console.log("  cortes de la grabación…");
  const parts = [];
  segs.forEach((s, i) => {
    const out = path.join(RENDER, `${kind}-parte-${i + 1}.mp4`);
    const D = s.dur.toFixed(3);
    // Movimiento de cámara suave y continuo: una parte se acerca y la
    // siguiente se aleja, así en cada corte la escala coincide y no hay
    // saltos. Curva suave (arranca y frena despacio), nunca lineal.
    const k = `(1-cos(PI*min(t/${D},1)))/2`;
    const z = i % 2 === 0 ? `(1+${G.zoom}*${k})` : `(1+${G.zoom}*(1-${k}))`;
    const vf = [
      `setpts=(PTS-STARTPTS)/${s.speed}`,
      `fps=${FPS}`,
      `scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame:flags=lanczos`,
      `crop=${W}:${H}:(iw-${W})*${G.focusX ?? 0.5}:(ih-${H})/2`,
      "eq=contrast=1.03:saturation=1.05:gamma=0.99",
      "colorbalance=rm=0.025:gm=0.005:bm=-0.03:rh=0.015:bh=-0.02",
      "vignette=angle=PI/7",
      "noise=c0s=5:c0f=t+u",
      "format=yuv420p",
    ].join(",");
    const key = JSON.stringify({ file: path.basename(file), a: s.a, src: s.src, vf });
    if (!fresh(out, key)) { run(["-ss", s.a.toFixed(3), "-t", s.src.toFixed(3), "-i", file, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", out]); remember(out, key); }
    parts.push({ file: out, dur: +probe(out).format.duration });
  });

  // Línea de tiempo: apertura → partes → cierre, con transiciones de empuje.
  const clips = [{ file: intro, dur: G.intro }, ...parts, { file: outro, dur: G.outro }];
  const trans = clips.slice(1).map(() => "fade");
  const xf = clips.slice(1).map((_, i) => (i === 0 ? XF.abre : i === clips.length - 2 ? XF.cierra : XF.corte));
  const starts = [];
  let acc = 0;
  clips.forEach((c, i) => { starts.push(acc); acc += c.dur - (i < clips.length - 1 ? xf[i] : 0); });
  const total = acc;

  // Etiquetas: PNG con transparencia, entran subiendo y con fundido.
  if (ETIQUETAS) console.log("  etiquetas…");
  const tags = [];
  segs.forEach((s, i) => {
    for (const [text, at, dur] of ETIQUETAS ? s.tags : []) {
      const local = Array.isArray(at) ? (stepTime(meta, at) - s.a) / s.speed : at;
      tags.push({ text, t0: starts[i + 1] + local, dur });
    }
  });
  for (const [i, t] of tags.entries()) {
    t.file = path.join(RENDER, `${kind}-etiqueta-${i + 1}.png`);
    Object.assign(t, await renderTag(browser, G.fmt, t.text, t.file));
  }

  console.log("  armado final…");
  const inputs = [];
  clips.forEach((c) => inputs.push("-i", c.file));
  tags.forEach((t) => inputs.push("-loop", "1", "-t", (t.dur + 0.1).toFixed(2), "-framerate", String(FPS), "-i", t.file));
  inputs.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");

  const f = [];
  clips.forEach((_, i) => f.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p,setsar=1[c${i}]`));
  let last = "c0";
  for (let i = 1; i < clips.length; i++) {
    const offset = (starts[i]).toFixed(3);
    const outL = i === clips.length - 1 ? "base" : `x${i}`;
    f.push(`[${last}][c${i}]xfade=transition=${trans[i - 1]}:duration=${xf[i - 1]}:offset=${offset}[${outL}]`);
    last = outL;
  }
  tags.forEach((t, k) => {
    const idx = clips.length + k;
    const d = t.dur.toFixed(2), T0 = t.t0.toFixed(3);
    f.push(`[${idx}:v]format=rgba,fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st=${(t.dur - 0.3).toFixed(2)}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${T0}/TB[t${k}]`);
    const x = G.tag.center ? `(W-w)/2` : `${G.tag.x - t.pad}`;
    const y0 = `H-${G.tag.bottom}-h`;
    // Sube 28 px con curva de salida (ease-out cúbica) mientras aparece.
    const y = `${y0}+28*pow(1-min(1\\,max(0\\,(t-${T0})/0.5))\\,3)`;
    const next = k === tags.length - 1 ? "vout" : `o${k}`;
    f.push(`[${k === 0 ? "base" : `o${k - 1}`}][t${k}]overlay=x=${x}:y=${y}:eval=frame:enable='between(t,${T0},${(t.t0 + t.dur).toFixed(3)})'[${next}]`);
  });
  if (!tags.length) f.push("[base]null[vout]");

  const final = path.join(ROOT, G.out);
  run([...inputs, "-filter_complex", f.join(";"), "-map", "[vout]", "-map", `${clips.length + tags.length}:a`,
    // 8 Mbps como máximo: calidad de sobra para Instagram y archivos de menos de 30 MB.
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "8M", "-bufsize", "16M", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", final]);

  // Guion de la edición, para repetirla o ajustarla.
  fs.writeFileSync(path.join(RENDER, `${kind}-guion.json`), JSON.stringify({ grabacion: path.basename(file), total, clips: clips.map((c, i) => ({ archivo: path.basename(c.file), inicio: +starts[i].toFixed(3), duracion: +c.dur.toFixed(3) })), transiciones: trans, etiquetas: tags.map((t) => ({ texto: t.text, inicio: +t.t0.toFixed(3), duracion: t.dur })) }, null, 2));
  const p = probe(final);
  const v = p.streams.find((s) => s.codec_type === "video");
  console.log(`  listo: ${G.out} · ${v.width}×${v.height} · ${(+p.format.duration).toFixed(1)} s`);
  return final;
}

(async () => {
  const which = process.argv[2];
  const kinds = which ? [which] : ["desktop", "reel"];
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  try { for (const k of kinds) await edit(k, browser); }
  finally { await browser.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
