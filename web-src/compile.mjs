// Arma la web de inicio de ZECHE GRUV a partir del diseño (src/home.dc.html).
//
//   node compile.mjs            → genera:
//     ../ZECHE_GRUV_Web/index.html        (español)
//     ../ZECHE_GRUV_Web/en/index.html     (inglés)
//     ../ZECHE_GRUV_Web/pt/index.html     (portugués)
//     ../ZECHE_GRUV_Web/assets/web/home.css
//     ../ZECHE_GRUV_Web/assets/web/home.js
//
// Cómo funciona: el diseño está escrito como un componente (marcado con
// {{ huecos }}, <sc-for> y <sc-if>, y una clase con su lógica). Acá se
// convierte en un componente de Preact (3 KB), se dibuja la página
// completa en HTML para cada idioma (así Google la lee y aparece al toque,
// sin esperar al código) y en el navegador el código solo "despierta" lo
// que ya está dibujado para las animaciones y lo interactivo.
//
// Textos: el español está en el diseño. Las traducciones, en i18n/en.json
// y i18n/pt.json (texto en español → traducción). Si falta alguna, el
// armado avisa y deja el español.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "htmlparser2";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, "..", "ZECHE_GRUV_Web");
const OUT = path.join(SITE, "assets", "web");
const src = fs.readFileSync(path.join(here, "src", "home.dc.html"), "utf8");
const LANGS = ["es", "en", "pt"];

// ---------- 1. Partes del diseño ----------
const helmet = src.slice(src.indexOf("<helmet>") + 8, src.indexOf("</helmet>"));
const css = (helmet.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
// Las tipografías se sirven desde la web (assets/fonts); si quedara un link a Google en el diseño, se usa.
const fontsHref = ((helmet.match(/<link href="([^"]+fonts\.googleapis[^"]+)"/) || [])[1] || "").replace(/&amp;/g, "&");
const markup = src.slice(src.indexOf("</helmet>") + 9, src.indexOf("</x-dc>"));
const scriptTag = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
const logic = fs.readFileSync(path.join(here, "src", "logic.js"), "utf8");

// ---------- 2. Marcado → función que arma la página ----------
const doc = parseDocument(markup, { lowerCaseAttributeNames: false, lowerCaseTags: false, recognizeSelfClosing: true, decodeEntities: true });
const TRANSLATE_ATTRS = new Set(["aria-label", "placeholder", "alt", "title"]);
const strings = new Set(); // todo lo que hay que traducir
const q = (s) => JSON.stringify(s);

// "{{ a.b }}" → expresión JS según las variables de los <sc-for> abiertos.
function expr(raw, scope) {
  const name = raw.trim();
  if (name === "true" || name === "false") return name;
  const [head, ...rest] = name.split(".");
  const base = scope.includes(head) ? head : `v.${head}`;
  return rest.length ? `${base}?.${rest.join("?.")}` : base;
}
function parts(text, scope, translate) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{([^}]+)\}\}/g)) {
    if (m.index > last) out.push({ s: text.slice(last, m.index) });
    out.push({ e: expr(m[1], scope) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ s: text.slice(last) });
  return out.map((p) => {
    if (p.e) return `__S(${p.e})`;
    if (!translate) return q(p.s);
    const core = p.s.trim();
    if (!core || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(core)) return q(p.s);
    strings.add(core);
    const lead = p.s.slice(0, p.s.indexOf(core)), tail = p.s.slice(p.s.indexOf(core) + core.length);
    return [lead && q(lead), `__t(${q(core)})`, tail && q(tail)].filter(Boolean).join("+");
  });
}
const DROP_ATTR = /^hint-placeholder-/;
function propsOf(el, scope) {
  const props = [];
  for (const [k0, val] of Object.entries(el.attribs || {})) {
    if (DROP_ATTR.test(k0)) continue;
    let k = k0;
    // En Preact, onChange es el "change" nativo (al salir del campo): el
    // diseño lo usa para cada tecla, que es onInput.
    if (k === "onChange" && el.name === "input") k = "onInput";
    const whole = val.match(/^\s*\{\{([^}]+)\}\}\s*$/);
    let v;
    if (whole) v = expr(whole[1], scope);
    else if (/\{\{/.test(val)) v = parts(val, scope, false).join("+");
    else if (TRANSLATE_ATTRS.has(k) && /[A-Za-z]/.test(val)) { strings.add(val); v = `__t(${q(val)})`; }
    else v = q(val);
    if (k === "disabled") v = `!!(${v})`;
    props.push(`${q(k)}:${v}`);
  }
  return `{${props.join(",")}}`;
}
function gen(node, scope) {
  if (node.type === "text") {
    if (!node.data.trim() && !/ /.test(node.data)) return null;
    const p = parts(node.data, scope, true);
    return p.length === 1 ? p[0] : `(${p.join("+")})`;
  }
  if (node.type === "comment") return null;
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return null;
  const kids = () => (node.children || []).map((c) => gen(c, scope)).filter(Boolean);
  if (node.name === "sc-for") {
    const list = expr(node.attribs.list.replace(/[{}]/g, ""), scope);
    const as = node.attribs.as;
    const inner = (node.children || []).map((c) => gen(c, [...scope, as])).filter(Boolean);
    return `...((${list})||[]).map((${as})=>[${inner.join(",")}])`;
  }
  if (node.name === "sc-if") {
    const cond = expr(node.attribs.value.replace(/[{}]/g, ""), scope);
    return `...((${cond})?[${kids().join(",")}]:[])`;
  }
  return `__h(${q(node.name)},${propsOf(node, scope)}${kids().length ? "," + kids().join(",") : ""})`;
}
const roots = doc.children.filter((n) => n.type === "tag");
if (roots.length !== 1) throw new Error("El diseño tiene que tener un solo elemento raíz.");
const templateJs = `export function template(__h,v,__t){const __S=(x)=>x==null?"":String(x);return ${gen(roots[0], [])};}`;

// Textos dentro de la lógica: T('...') o T("...").
for (const m of logic.matchAll(/\bT\((['"])((?:\\.|(?!\1).)*)\1\)/g)) strings.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));

// ---------- 3. Traducciones ----------
const dict = { es: {} };
const missing = {};
for (const lang of LANGS.filter((l) => l !== "es")) {
  const file = path.join(here, "i18n", `${lang}.json`);
  dict[lang] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  missing[lang] = [...strings].filter((s) => !(s in dict[lang]));
}
fs.writeFileSync(path.join(here, "i18n", "_textos.json"), JSON.stringify([...strings].sort(), null, 1));

// ---------- 4. Código del navegador ----------
const shim = `
import { h, Component, hydrate } from "preact";
import { template } from "./template.js";
const LANG = (typeof window !== "undefined" && window.ZG_LANG) || "es";
const DICT = (typeof window !== "undefined" && window.ZG_I18N) || {};
export function T(s) { return (DICT && DICT[s]) || s; }
export class DCLogic extends Component {
  render() { return template(h, this.renderVals(), T); }
}
`;
fs.mkdirSync(path.join(here, ".gen"), { recursive: true });
fs.writeFileSync(path.join(here, ".gen", "template.js"), templateJs);
fs.writeFileSync(path.join(here, ".gen", "dc.js"), shim);
// La lógica del diseño, tal cual, como módulo.
fs.writeFileSync(path.join(here, ".gen", "component.js"),
  `import { DCLogic, T } from "./dc.js";\n${logic}\nexport default Component;\n`);
fs.writeFileSync(path.join(here, ".gen", "client.js"), `
import { h, hydrate } from "preact";
import Component from "./component.js";
const root = document.getElementById("zg-root");
hydrate(h(Component, {}), root);
`);

await esbuild.build({
  entryPoints: [path.join(here, ".gen", "client.js")],
  bundle: true, minify: !process.env.DEV, format: "iife", target: ["es2018"],
  outfile: path.join(OUT, "home.js"), legalComments: "none",
});

// ---------- 5. Estilos ----------
fs.writeFileSync(path.join(OUT, "home.css"), css.trim() + "\n");

// ---------- 6. Página completa en cada idioma ----------
const ssrBundle = path.join(here, ".gen", "ssr.mjs");
await esbuild.build({
  stdin: { contents: `
    import { h } from "preact";
    import renderToString from "preact-render-to-string";
    import Component from "./component.js";
    export function render() { return renderToString(h(Component, {})); }
  `, resolveDir: path.join(here, ".gen"), loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: ssrBundle,
});
const page = fs.readFileSync(path.join(here, "src", "page.html"), "utf8");
for (const lang of LANGS) {
  globalThis.window = { ZG_LANG: lang, ZG_I18N: dict[lang] };
  const mod = await import(`${ssrBundle}?${lang}`);
  const body = mod.render();
  delete globalThis.window;
  const head = JSON.parse(fs.readFileSync(path.join(here, "src", "head.json"), "utf8"))[lang];
  const html = page
    .replaceAll("%LANG%", lang)
    .replaceAll("%TITLE%", head.title)
    .replaceAll("%DESC%", head.description)
    .replaceAll("%OGTITLE%", head.ogTitle)
    .replaceAll("%LOCALE%", head.locale)
    .replaceAll("%URL%", head.url)
    .replaceAll("%FONTS%", fontsHref)
    .replace("%I18N%", JSON.stringify(dict[lang]).replace(/</g, "\\u003c"))
    .replace("%BODY%", body);
  const dir = lang === "es" ? SITE : path.join(SITE, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

const miss = Object.entries(missing).filter(([, l]) => l.length);
console.log(`Listo: ${strings.size} textos.`);
for (const [l, list] of miss) console.log(`  Faltan ${list.length} traducciones en ${l} (quedan en español). Ver i18n/_textos.json`);
