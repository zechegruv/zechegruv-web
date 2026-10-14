// ZECHE GRUV — Grabador en alta calidad para el tour.
//
// La grabación propia de Playwright sale liviana (≈650 kbps) y en el celular
// toma la imagen a 405 px de ancho y la agranda, así que se ve blanda. Acá se
// abre Chromium "de verdad" en una pantalla virtual (Xvfb) del tamaño exacto
// del video y se graba esa pantalla con FFmpeg, cuadro por cuadro, a 30 fps:
//   - escritorio: pantalla 1920 × 1080, densidad 1
//   - reel:       pantalla 1080 × 1920, el portal a 405 × 720 con densidad 2,667
//                 (el celular a pantalla completa, nítido, sin agrandar nada)
// Solo funciona en Linux con Xvfb y FFmpeg (el entorno de Claude los tiene).
// En la Mac se puede usar el modo simple: ZG_GRABADOR=playwright node tour.js
const { spawn } = require("child_process");
const fs = require("fs");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startScreen(width, height) {
  for (let n = 90; n < 140; n++) {
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    const proc = spawn("Xvfb", [`:${n}`, "-screen", "0", `${width}x${height}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
    for (let i = 0; i < 40 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) await wait(100);
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) return { display: `:${n}`, stop: () => proc.kill("SIGTERM") };
    proc.kill("SIGKILL");
  }
  throw new Error("No se pudo abrir la pantalla virtual (Xvfb).");
}

// Graba la pantalla virtual a un mp4 casi sin pérdida (se re-codifica en la edición).
function startCapture(display, width, height, out) {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", `${width}x${height}`, "-i", `${display}.0+0,0`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", out,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err += d; });
  return {
    stop: () => new Promise((resolve) => {
      ff.on("close", (code) => resolve({ code, err }));
      ff.stdin.write("q"); // FFmpeg cierra el archivo prolijo
      setTimeout(() => ff.kill("SIGINT"), 4000);
    }),
  };
}

// Pone la ventana del navegador a pantalla completa (sin barras).
async function fullscreen(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await cdp.detach().catch(() => {});
  // Chromium muestra "Para salir de la pantalla completa…" unos segundos: se espera a que se vaya.
  await wait(5200);
}

module.exports = { startScreen, startCapture, fullscreen };
