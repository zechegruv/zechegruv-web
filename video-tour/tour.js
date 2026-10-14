// ZECHE GRUV — Tour grabado del portal del artista (Playwright + Chromium).
//
//   node tour.js            graba los dos recorridos (escritorio y celular)
//   node tour.js desktop    solo escritorio, 1920 × 1080
//   node tour.js reel       solo celular para Reels: pantalla completa 9:16 (1080 × 1920)
//   node tour.js mobile     celular 390 × 844 (iPhone emulado, táctil; modo simple)
//
// Ritmo: por defecto "menus" (cada menú de arriba a abajo y deslizar al
// siguiente, en una sola toma). ZG_RITMO=corto (tour rápido con la mezcla y
// las letras) o ZG_RITMO=largo (recorrido pausado de ≈1:30).
// Grabador: por defecto "hq" (pantalla virtual + FFmpeg, nítido, ver
// lib/grabador.js). ZG_GRABADOR=playwright usa la grabación propia de
// Playwright (más liviana; sirve en cualquier compu).
//
// Cada recorrido es independiente (contexto y grabación propios) y queda en
// video-tour/grabaciones/<desktop|mobile>/ como .webm, más un .json con el
// guion de lo que pasó y cuándo (sirve para editar el video después).
// Modo demo: ver lib/entorno.js. No paga, no envía formularios, no descarga
// ni sube nada; cualquier pedido a internet se corta.
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { newDemoContext, VIEWPORTS, BASE, ROOT } = require("./lib/entorno");
const grabador = require("./lib/grabador");

const OUT = path.join(ROOT, "grabaciones");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Puntero visible en la grabación (el modo sin ventana no lo dibuja) y círculo
// al tocar en el celular. Es solo una capa encima del video: no cambia la web.
const POINTER = () => {
  const css = `
    #zgTourCursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(255,244,220,.92);box-shadow:0 0 0 2px rgba(36,17,5,.55),0 6px 18px rgba(0,0,0,.35);
      pointer-events:none;z-index:2147483647;transition:transform 120ms ease,opacity 200ms ease;opacity:0}
    #zgTourCursor.is-down{transform:scale(.72)}
    .zgTourTap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;pointer-events:none;z-index:2147483647;
      background:rgba(255,244,220,.35);box-shadow:0 0 0 2px rgba(255,244,220,.8);animation:zgTourTap 560ms cubic-bezier(.23,1,.32,1) forwards}
    @keyframes zgTourTap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}`;
  const add = () => {
    if (document.getElementById("zgTourCursor")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.append(s);
    const c = document.createElement("div"); c.id = "zgTourCursor"; document.body.append(c);
    const touch = matchMedia("(pointer: coarse)").matches;
    if (!touch) {
      addEventListener("mousemove", (e) => { c.style.opacity = "1"; c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", () => c.classList.add("is-down"), true);
      addEventListener("mouseup", () => c.classList.remove("is-down"), true);
    } else {
      addEventListener("touchstart", (e) => {
        const t = e.touches[0]; if (!t) return;
        const r = document.createElement("div"); r.className = "zgTourTap";
        r.style.left = t.clientX + "px"; r.style.top = t.clientY + "px";
        document.body.append(r); setTimeout(() => r.remove(), 700);
      }, true);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
};

function makeDirector(page, kind, t0) {
  const log = [];
  const reset = () => { t0 = Date.now(); log.length = 0; };
  const mark = (what) => { log.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what }); console.log(`  [${kind}] ${log[log.length - 1].t}s  ${what}`); };
  const mobile = kind !== "desktop";
  let cdp = null;

  async function center(locator) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    if (!b) throw new Error("Elemento sin posición");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  // Ir hasta un elemento y tocarlo/hacer clic, con el ritmo de una persona.
  async function press(locator, what, after = 900) {
    if (mobile) { await locator.scrollIntoViewIfNeeded(); await wait(350); await locator.tap(); }
    else {
      const p = await center(locator); await page.mouse.move(p.x, p.y, { steps: 28 }); await wait(260); await page.mouse.down(); await wait(90); await page.mouse.up();
    }
    mark(what);
    await wait(after);
  }
  // Scroll suave hasta una posición (px) en un tiempo dado.
  async function scrollTo(y, ms = 1800) {
    await page.evaluate(([to, dur]) => new Promise((done) => {
      const from = scrollY, dist = to - from, start = performance.now();
      const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => { const k = Math.min(1, (now - start) / dur); scrollTo(0, from + dist * ease(k)); k < 1 ? requestAnimationFrame(step) : done(); };
      requestAnimationFrame(step);
    }), [y, ms]);
  }
  async function scrollToEnd(ms) { const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight); await scrollTo(Math.max(0, h), ms); }
  // Deslizar de costado con el dedo (cambia de pestaña en el portal).
  async function swipe(dir, what, after = 1200) {
    cdp = cdp || await page.context().newCDPSession(page);
    const y = 560, x0 = dir === "next" ? 330 : 60, x1 = dir === "next" ? 70 : 320;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 14; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * (i / 14), y: y + i * 0.6 }] });
      await wait(18);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    mark(what);
    await wait(after);
  }
  // Puntero con movimiento suave (arranca y frena despacio), no en línea recta a velocidad fija.
  let mx = null, my = null;
  async function glide(x, y, ms = 520) {
    if (mx === null) { mx = x; my = y - 120; await page.mouse.move(mx, my); }
    const n = Math.max(8, Math.round(ms / 16)), x0 = mx, y0 = my;
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      await wait(ms / n);
    }
    mx = x; my = y;
  }
  // Ir a un elemento y tocarlo (celu) o hacerle clic (compu), con ritmo natural.
  async function go(locator, what, after = 900) {
    await locator.scrollIntoViewIfNeeded();
    if (mobile) { await wait(300); await locator.tap(); }
    else {
      const b = await locator.boundingBox();
      await glide(b.x + b.width / 2, b.y + b.height / 2);
      await wait(140); await page.mouse.down(); await wait(80); await page.mouse.up();
    }
    mark(what);
    await wait(after);
  }
  // Dos dedos de costado en el trackpad (la compu): el portal pasa al menú siguiente.
  async function trackpad(what) {
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(32, 0); await wait(16); }
    mark(what);
  }
  return { log, mark, reset, press, go, scrollTo, scrollToEnd, swipe, trackpad, wait };
}

// ---------- El recorrido (mismo guion, adaptado a cada pantalla) ----------
async function recorrido(page, d, kind, onReady) {
  const mobile = kind !== "desktop";
  const tab = (name) => page.locator(`#artistTabs [data-atab="${name}"]`);

  await page.goto(`${BASE}/portal/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#projectCards:not([hidden]) .ap-hello", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (onReady) await onReady();
  d.mark("Mi proyecto: saludo, avance del disco y para aprobar");
  await d.wait(3200);
  await d.scrollTo(mobile ? 900 : 520, 2600); await d.wait(1800);
  await d.scrollToEnd(2200); await d.wait(1600);
  await d.scrollTo(0, 1600); await d.wait(800);

  // Canciones
  if (mobile) await d.swipe("next", "Desliza a Canciones");
  else await d.press(tab("canciones"), "Canciones", 1400);
  await page.waitForSelector("#songsCard:not([hidden]) .song");
  await d.wait(1200);
  await d.scrollTo(mobile ? 700 : 380, 2400); await d.wait(1200);
  // Escuchar y aprobar la mezcla (se abre el reproductor; no se aprueba nada).
  await d.press(page.locator('#songsList [data-listen="demo-song-1"]').first(), "Abre la mezcla para escuchar", 1600);
  await page.waitForSelector(".rv:not([hidden]) #rvPlay");
  await d.press(page.locator("#rvPlay"), "Reproduce la mezcla", 3200);
  const wave = page.locator("#rvWave");
  const wb = await wave.boundingBox();
  if (wb) {
    if (mobile) await page.touchscreen.tap(wb.x + wb.width * 0.42, wb.y + wb.height / 2);
    else { await page.mouse.move(wb.x + wb.width * 0.42, wb.y + wb.height / 2, { steps: 24 }); await d.wait(200); await page.mouse.click(wb.x + wb.width * 0.42, wb.y + wb.height / 2); }
    d.mark("Salta a un momento de la canción");
    await d.wait(2600);
  }
  const markBtn = page.locator("#rvMark:not([hidden])");
  if (await markBtn.count()) { await d.press(markBtn, "Muestra «Dejar una nota» en el segundo exacto", 1800); }
  // Se cierra sin mandar nada.
  await page.keyboard.press("Escape").catch(() => {});
  await d.wait(300);
  if (await page.locator(".rv:not([hidden])").count()) await d.press(page.locator(".rv-x"), "Cierra el reproductor (sin enviar)", 1200);
  else d.mark("Cierra el reproductor (sin enviar)");
  await d.scrollToEnd(1800); await d.wait(1000);
  await d.scrollTo(0, 1400); await d.wait(600);

  // Archivos
  if (mobile) await d.swipe("next", "Desliza a Archivos");
  else await d.press(tab("archivos"), "Archivos", 1400);
  await page.waitForSelector(".space-card .section-btn");
  await d.wait(800);
  await d.press(page.locator('.section-btn[data-section="letras"]'), "Letras: el cuaderno del artista", 1800);
  await page.waitForSelector("#lyricsList [data-lyric]");
  await d.press(page.locator('#lyricsList [data-lyric="demo-lyric-1"]'), "Abre la letra «Ciudad dormida»", 2200);
  await d.scrollTo(mobile ? 700 : 400, 2400); await d.wait(1400);
  await d.scrollTo(0, 1200);
  await d.press(page.locator("#lyricBack"), "Vuelve a Letras", 1200);
  await d.press(page.locator('#filesNav [data-fsec="exports"]'), "Exports: versiones para escuchar", 1600);
  await page.locator(".files-group, details").first().waitFor({ timeout: 4000 }).catch(() => {});
  await d.press(page.locator('#filesNav [data-fsec="masters"]'), "Masters (y versiones para vivo)", 2200);
  await d.press(page.locator("#filesBack"), "Vuelve a Archivos", 1200);

  // Distribución y Mi perfil
  if (mobile) await d.scrollTo(0, 700);
  await d.press(tab("distribucion"), "Distribución: sus lanzamientos", 2200);
  await d.scrollTo(mobile ? 900 : 500, 2600); await d.wait(1200);
  await d.scrollTo(0, 1400);
  await d.press(tab("perfil"), "Mi perfil", 2200);

  // Cierre en Mi proyecto
  await d.press(tab("proyecto"), "Vuelve a Mi proyecto", 2600);
  d.mark("Fin del recorrido");
  await d.wait(1200);
}

// ---------- Recorrido corto y fluido (para el video de 20–30 s) ----------
// Todo en una sola toma, sin cortes: cada pantalla lleva a la siguiente con
// el gesto real (tocar la pestaña o deslizar), con pausas cortas.
async function recorridoCorto(page, d, kind, onReady) {
  const mobile = kind !== "desktop";
  const tab = (name) => page.locator(`#artistTabs [data-atab="${name}"]`);
  await page.goto(`${BASE}/portal/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#projectCards:not([hidden]) .ap-hello", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (onReady) await onReady();
  d.mark("Mi proyecto");
  await d.wait(1500);
  // Un solo scroll lento que muestra el resto de Mi proyecto (sin volver arriba:
  // al tocar la próxima pestaña el portal sube solo).
  await d.scrollTo(mobile ? 430 : 230, 2000); await d.wait(500);

  await d.go(tab("canciones"), "Canciones", 1100);
  await page.waitForSelector("#songsCard:not([hidden]) .song");
  await d.go(page.locator('#songsList [data-listen="demo-song-1"]').first(), "Abre la mezcla", 900);
  await page.waitForSelector(".rv:not([hidden]) #rvPlay");
  await d.go(page.locator("#rvPlay"), "Reproduce la mezcla", 1300);
  const markBtn = page.locator("#rvMark:not([hidden])");
  if (await markBtn.count()) await d.go(markBtn, "Dejar una nota", 1300);
  if (await page.locator(".rv:not([hidden])").count()) await d.go(page.locator(".rv-x"), "Cierra el reproductor (sin enviar)", 500);

  await d.go(tab("archivos"), "Archivos", 900);
  await page.waitForSelector(".space-card .section-btn");
  await d.go(page.locator('.section-btn[data-section="letras"]'), "Letras", 900);
  await page.waitForSelector("#lyricsList [data-lyric]");
  await d.go(page.locator('#lyricsList [data-lyric="demo-lyric-1"]'), "Abre una letra", 1400);
  await d.go(page.locator("#lyricBack"), "Vuelve a Letras", 500);
  await d.go(page.locator('#filesNav [data-fsec="masters"]'), "Masters", 1200);
  await d.go(page.locator("#filesBack"), "Vuelve a Archivos", 400);

  await d.go(tab("distribucion"), "Distribución", 1300);
  await d.go(tab("perfil"), "Mi perfil", 1000);
  await d.go(tab("proyecto"), "Vuelve a Mi proyecto", 1400);
  d.mark("Fin del recorrido");
  await d.wait(300);
}
// ---------- Recorrido por menús (walkthrough en una sola toma) ----------
// Cada menú del portal se muestra completo, de arriba hasta abajo con un
// scroll lento y parejo, y después se desliza de costado al siguiente
// (en el celu con el dedo, en la compu con dos dedos en el trackpad), uno
// por uno: Mi proyecto → Canciones → Archivos → Invitá a un amigo →
// Distribución → Mi perfil.
async function recorridoMenus(page, d, kind, onReady) {
  const mobile = kind !== "desktop";
  await page.goto(`${BASE}/portal/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#projectCards:not([hidden]) .ap-hello", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900); // que terminen las animaciones de entrada antes de grabar
  const visibles = await page.evaluate(() => [...document.querySelectorAll("#artistTabs [data-atab]")].filter((b) => !b.hidden).map((b) => b.dataset.atab));
  if (onReady) await onReady();
  const PX_POR_SEG = mobile ? 380 : 420; // velocidad de lectura cómoda
  for (let i = 0; i < visibles.length; i++) {
    const name = visibles[i];
    d.mark(`Menú: ${name}`);
    await d.wait(i === 0 ? 1100 : 900); // se ve el menú desde arriba
    const alto = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (alto > 8) {
      await d.scrollTo(alto, Math.max(1200, (alto / PX_POR_SEG) * 1000));
      d.mark(`Final de ${name}`);
      await d.wait(700); // se ve el final de la página
    } else await d.wait(1300); // la página entra entera: un poco más de tiempo para verla
    if (i === visibles.length - 1) break;
    if (mobile) await d.swipe("next", `Desliza a ${visibles[i + 1]}`, 0);
    else await d.trackpad(`Desliza a ${visibles[i + 1]}`);
    await page.waitForFunction((n) => document.body.dataset.atab === n, visibles[i + 1], { timeout: 4000 });
    await d.wait(450); // termina de entrar el menú nuevo
  }
  d.mark("Fin del recorrido");
  await d.wait(700);
}
const RITMO = process.env.ZG_RITMO || "menus";
const elegirRecorrido = () => ({ largo: recorrido, corto: recorridoCorto, menus: recorridoMenus }[RITMO] || recorridoMenus);

function stampName(kind) {
  return `portal-${kind}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

function saveMeta(dir, name, meta) {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

const LAUNCH_ARGS = ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--hide-scrollbars", "--disable-infobars", "--no-first-run"];

// Modo simple: la grabación propia de Playwright (.webm).
async function grabarPlaywright(kind, browser) {
  const dir = path.join(OUT, kind);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(dir, ".tmp-"));
  const vp = VIEWPORTS[kind].viewport;
  const { ctx, blocked, posted } = await newDemoContext(browser, kind, { video: tmp, videoSize: vp });
  await ctx.addInitScript(POINTER);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const d = makeDirector(page, kind, Date.now());
  let ok = true;
  try { await elegirRecorrido()(page, d, kind); }
  catch (e) { ok = false; errors.push(`El recorrido se cortó: ${e.message}`); console.error(e); }
  const video = page.video();
  await ctx.close();
  const name = stampName(kind);
  const webm = path.join(dir, `${name}.webm`);
  fs.renameSync(await video.path(), webm);
  fs.rmSync(tmp, { recursive: true, force: true });
  return saveMeta(dir, name, { kind, ok, grabador: "playwright", video: path.basename(webm), viewport: `${vp.width}x${vp.height}`, grabado: new Date().toISOString(), pasos: d.log, erroresDeLaPagina: errors, enviosInterceptados: posted, dominiosBloqueados: [...new Set(blocked)] });
}

// Modo alta calidad: Chromium a pantalla completa en una pantalla virtual del
// tamaño del video, grabada con FFmpeg a 30 fps.
async function grabarHQ(kind) {
  const dir = path.join(OUT, kind);
  fs.mkdirSync(dir, { recursive: true });
  const preset = VIEWPORTS[kind];
  const W = Math.round(preset.viewport.width * preset.deviceScaleFactor);
  const H = Math.round(preset.viewport.height * preset.deviceScaleFactor);
  const screen = await grabador.startScreen(W, H);
  const browser = await chromium.launch({
    headless: false,
    env: { ...process.env, DISPLAY: screen.display },
    args: [...LAUNCH_ARGS, `--force-device-scale-factor=${preset.deviceScaleFactor}`, "--window-position=0,0", `--window-size=${preset.viewport.width},${preset.viewport.height}`],
  });
  const { ctx, blocked, posted } = await newDemoContext(browser, kind);
  await ctx.addInitScript(POINTER);
  const page = await ctx.newPage();
  await grabador.fullscreen(ctx, page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const name = stampName(kind);
  const mp4 = path.join(dir, `${name}.mp4`);
  let capture = null;
  const d = makeDirector(page, kind, Date.now());
  let ok = true;
  try {
    await elegirRecorrido()(page, d, kind, async () => {
      await page.waitForTimeout(600); // que termine de dibujarse antes del primer cuadro
      capture = grabador.startCapture(screen.display, W, H, mp4);
      await page.waitForTimeout(300);
      d.reset();
    });
  } catch (e) { ok = false; errors.push(`El recorrido se cortó: ${e.message}`); console.error(e); }
  const res = capture ? await capture.stop() : { code: -1, err: "no arrancó" };
  if (res.code !== 0 && res.code !== 255) { ok = false; errors.push(`FFmpeg: ${res.err.trim()}`); }
  await browser.close();
  screen.stop();
  return saveMeta(dir, name, { kind, ok, ritmo: RITMO, grabador: "hq (Xvfb + FFmpeg x11grab, 30 fps)", video: path.basename(mp4), pantalla: `${W}x${H}`, viewport: `${preset.viewport.width}x${preset.viewport.height} @${(+preset.deviceScaleFactor).toFixed(3)}x`, grabado: new Date().toISOString(), pasos: d.log, erroresDeLaPagina: errors, enviosInterceptados: posted, dominiosBloqueados: [...new Set(blocked)] });
}

(async () => {
  const which = process.argv[2];
  const mode = process.env.ZG_GRABADOR || "hq";
  const kinds = which ? [which] : ["desktop", "reel"];
  const results = [];
  if (mode === "playwright") {
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    for (const k of kinds) { console.log(`Grabando ${k} (Playwright)…`); results.push(await grabarPlaywright(k, browser)); }
    await browser.close();
  } else {
    for (const k of kinds) { console.log(`Grabando ${k} (alta calidad)…`); results.push(await grabarHQ(k)); }
  }
  for (const r of results) console.log(`${r.ok ? "OK " : "ERROR"} ${r.kind}: grabaciones/${r.kind}/${r.video} · ${r.pasos.length} pasos · errores: ${r.erroresDeLaPagina.length}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
