// Pruebas sin navegador: el comando de publicación de netlify.toml, el
// generador de páginas de artistas y los textos de la subida de pistas.
// Trabaja sobre una copia temporal del sitio (no toca el repo).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const REPO = path.join(__dirname, "../pass");
const WEB = path.join(REPO, "ZECHE_GRUV_Web");
const only = process.argv[2] || process.env.ONLY || "";
const tests = [];
const test = (name, run) => tests.push([name, run]);
function ok(v, what) { if (!v) throw new Error(what || "esperaba verdadero"); }
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

// Copia del sitio (sin imágenes ni videos) + generador corrido + build de Netlify.
function buildCopy() {
  fs.mkdirSync(path.join(__dirname, "tmp"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(__dirname, "tmp", "build-"));
  execSync(`cp -r "${WEB}" "${tmp}/ZECHE_GRUV_Web" && cp "${REPO}/netlify.toml" "${tmp}/"`);
  execSync(`python3 -I -B "${tmp}/ZECHE_GRUV_Web/scripts/generate_artist_pages.py"`, { stdio: "pipe" });
  const toml = fs.readFileSync(path.join(tmp, "netlify.toml"), "utf8");
  const cmd = JSON.parse(`"${toml.match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/m)[1]}"`);
  execSync(cmd, { cwd: tmp, env: { ...process.env, COMMIT_REF: "abc123" }, shell: "/bin/bash" });
  return tmp;
}
let built = null;
const copy = () => (built = built || buildCopy());

test("43 · las páginas de ZG PASS y la plantilla de artistas piden medicion.js con la versión de la publicación", () => {
  const files = [...walk(path.join(WEB, "pass")).filter((f) => f.endsWith(".html")), path.join(WEB, "scripts/artist-page-template.html")];
  const fixed = files.filter((f) => /medicion\.js\?v=(?!__BUILD__)/.test(fs.readFileSync(f, "utf8")));
  ok(!fixed.length, `con versión fija: ${fixed.map((f) => path.relative(WEB, f)).join(", ")}`);
});
test("43 · el build reemplaza __BUILD__ en inicio, ZG PASS y artistas", () => {
  const tmp = copy();
  const site = path.join(tmp, "ZECHE_GRUV_Web");
  const files = walk(site).filter((f) => /\.(html|js)$/.test(f) && /(^|\/)(index\.html|site\.js|pass\/|artistas\/)/.test(path.relative(site, f)));
  const left = files.filter((f) => fs.readFileSync(f, "utf8").includes("__BUILD__"));
  ok(!left.length, `quedó __BUILD__ en: ${left.map((f) => path.relative(site, f)).join(", ")}`);
  ok(fs.readFileSync(path.join(site, "pass/orden/index.html"), "utf8").includes("medicion.js?v=abc123"), "pass/orden sin la versión");
  ok(fs.readFileSync(path.join(site, "artistas/layla-mar.html"), "utf8").includes("medicion.js?v=abc123"), "artistas sin la versión");
});

test("48 · páginas de artistas: canonical, og:* y twitter:card", () => {
  const html = fs.readFileSync(path.join(copy(), "ZECHE_GRUV_Web/artistas/layla-mar.html"), "utf8");
  const need = [
    '<link rel="canonical" href="https://www.zechegruv.com/artistas/layla-mar.html">',
    '<meta property="og:url" content="https://www.zechegruv.com/artistas/layla-mar.html">',
    '<meta property="og:title" content="Layla Mar',
    '<meta property="og:description" content="',
    '<meta property="og:image" content="https://',
    '<meta name="twitter:card" content="summary_large_image">',
  ];
  const missing = need.filter((n) => !html.includes(n));
  ok(!missing.length, `faltan: ${missing.join(" | ")}`);
});
test("48 · páginas de artistas: el inicio se enlaza con \"/\" (no ../index.html)", () => {
  const html = fs.readFileSync(path.join(copy(), "ZECHE_GRUV_Web/artistas/layla-mar.html"), "utf8");
  ok(!html.includes("../index.html"), "sigue con ../index.html");
  ok(/href="\/"/.test(html) && html.includes('href="/#artists"'), "sin links a / y /#artists");
});
test("48 · un nombre con comillas o & no rompe las etiquetas", () => {
  const tmp = copy();
  const tpl = fs.readFileSync(path.join(WEB, "scripts/artist-page-template.html"), "utf8");
  const gen = path.join(tmp, "ZECHE_GRUV_Web/scripts/generate_artist_pages.py");
  const out = execSync(`python3 -I -B -c "import importlib.util,sys;s=importlib.util.spec_from_file_location('g','${gen}');g=importlib.util.module_from_spec(s);s.loader.exec_module(g);print(g.render(open('${path.join(WEB, "scripts/artist-page-template.html")}').read(), {'name':'Ana \\"La\\" & Cía','id':'x','img':'abc','photo':'','slug':'ana'}, {}))"`).toString();
  ok(out.includes('content="Ana &quot;La&quot; &amp; Cía'), "og sin escapar");
  ok(tpl.length > 0);
});

test("45 · el texto de la subida de pistas dice todos los formatos que se aceptan", () => {
  const js = fs.readFileSync(path.join(WEB, "pass/pistas-card.js"), "utf8");
  const accept = js.match(/ACCEPT = "([^"]+)"/)[1].split(",").map((e) => e.slice(1).toUpperCase());
  const hint = js.match(/const hint = el\("p", "hint", `([^`]+)`/)[1];
  const bad = js.match(/no se puede subir\. ([^`]+)`/)[1];
  const names = (t) => accept.filter((e) => e !== "AIF").filter((e) => !new RegExp(`\\b${e}\\b`).test(t.toUpperCase()));
  ok(!names(hint).length, `el texto de ayuda no menciona: ${names(hint)}`);
  ok(!names(bad).length, `el aviso de archivo no válido no menciona: ${names(bad)}`);
});

let pass = 0, fail = 0;
for (const [name, run] of tests) {
  if (only && !name.startsWith(only)) continue;
  try { run(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); fail++; }
}
if (built) fs.rmSync(built, { recursive: true, force: true });
console.log(`\nEstáticas: ${pass} ok, ${fail} con fallas`);
process.exitCode = fail ? 1 : 0;
