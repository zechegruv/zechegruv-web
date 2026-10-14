// ZECHE GRUV — Auditoría responsive del portal del artista (solo mira, no cambia nada).
//
//   node auditoria.js
//
// Recorre cada pantalla del portal en escritorio (1920 × 1080), tablet
// (820 × 1180) y celular (390 × 844, iPhone táctil) y revisa:
//   - scroll horizontal y elementos que se salen de la pantalla
//   - textos cortados o demasiado chicos
//   - botones y links difíciles de tocar con el dedo (menos de 44 × 44)
//   - elementos tapados por otros (no se pueden tocar)
//   - imágenes y videos que desbordan
// Deja capturas y un informe en video-tour/auditoria/ (informe.md + datos.json).
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { newDemoContext, BASE, ROOT } = require("./lib/entorno");

const OUT = path.join(ROOT, "auditoria");
const KINDS = ["desktop", "tablet", "mobile"];
const LABEL = { desktop: "Escritorio 1920 × 1080", tablet: "Tablet 820 × 1180", mobile: "Celular 390 × 844" };

// Pantallas del portal y cómo llegar a cada una.
const SCREENS = [
  { id: "login", name: "Ingreso (login)", loggedOut: true, go: async (p) => { await p.waitForSelector("#view-login:not([hidden])"); } },
  { id: "proyecto", name: "Mi proyecto", go: async (p) => { await p.waitForSelector("#projectCards:not([hidden]) .ap-hello"); } },
  { id: "canciones", name: "Canciones", go: async (p, tab) => { await tab("canciones"); await p.waitForSelector("#songsCard .song"); } },
  { id: "revision", name: "Escuchar y aprobar (reproductor)", go: async (p, tab) => { await tab("canciones"); await p.locator('#songsList [data-listen="demo-song-1"]').first().click(); await p.waitForSelector(".rv:not([hidden]) #rvPlay"); await p.waitForTimeout(900); } },
  { id: "nota", name: "Dejar una nota (formulario)", go: async (p, tab) => { await tab("canciones"); await p.locator('#songsList [data-listen="demo-song-1"]').first().click(); await p.waitForSelector(".rv:not([hidden]) #rvPlay"); await p.waitForTimeout(600); const m = p.locator("#rvMark"); if (await m.isVisible()) await m.click(); await p.waitForTimeout(500); } },
  { id: "archivos", name: "Archivos (tu espacio)", go: async (p, tab) => { await tab("archivos"); await p.waitForSelector(".space-card .section-btn"); } },
  { id: "letras", name: "Letras (cuaderno)", go: async (p, tab) => { await tab("archivos"); await p.click('.section-btn[data-section="letras"]'); await p.waitForSelector("#lyricsList [data-lyric]"); } },
  { id: "letra", name: "Editor de una letra", go: async (p, tab) => { await tab("archivos"); await p.click('.section-btn[data-section="letras"]'); await p.waitForSelector("#lyricsList [data-lyric]"); await p.click('#lyricsList [data-lyric="demo-lyric-1"]'); await p.waitForSelector("#panel-lyric:not([hidden])"); } },
  { id: "exports", name: "Exports (archivos abiertos)", go: async (p, tab) => { await tab("archivos"); await p.click('.section-btn[data-section="exports"]'); await p.waitForTimeout(800); const all = p.locator("text=Desplegar todo"); if (await all.count()) await all.first().click(); await p.waitForTimeout(500); } },
  { id: "masters", name: "Masters", go: async (p, tab) => { await tab("archivos"); await p.click('.section-btn[data-section="masters"]'); await p.waitForTimeout(800); } },
  { id: "distribucion", name: "Distribución (lanzamientos)", go: async (p, tab) => { await tab("distribucion"); await p.waitForSelector("#panel-releases:not([hidden])"); await p.waitForTimeout(600); } },
  { id: "lanzamiento", name: "Nuevo lanzamiento (formulario)", go: async (p, tab) => { await tab("distribucion"); await p.waitForSelector("#newReleaseBtn"); await p.click("#newReleaseBtn"); await p.waitForTimeout(900); } },
  { id: "invitar", name: "Invitá a un amigo", go: async (p, tab) => { await tab("invitar"); await p.waitForTimeout(600); } },
  { id: "perfil", name: "Mi perfil", go: async (p, tab) => { await tab("perfil"); await p.waitForTimeout(600); } },
];

// Lo que se mide dentro de la página.
function inspect(kind) {
  const mobile = kind !== "desktop";
  const W = document.documentElement.clientWidth;
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const txt = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` «${txt}»` : ""}`;
  };
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  const issues = [];
  const add = (type, sev, el, detail) => issues.push({ type, sev, el: el ? describe(el) : "", detail });

  // 1) Scroll horizontal de la página
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) add("scroll-horizontal", "alta", null, `La página mide ${sw}px de ancho en una pantalla de ${W}px.`);

  const all = [...document.querySelectorAll("body *")].filter((el) => !el.closest("#zgTourCursor") && vis(el));
  // 2) Elementos que se salen por la derecha/izquierda (fuera de contenedores con scroll propio)
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if ((r.right > W + 2 || r.left < -2) && !inScroller(el) && getComputedStyle(el).position !== "fixed") {
      add("desborde", "alta", el, `Va de ${Math.round(r.left)} a ${Math.round(r.right)}px (pantalla ${W}px).`);
    }
  }
  // 3) Imágenes / videos más anchos que su contenedor
  for (const el of all.filter((e) => /^(IMG|VIDEO|CANVAS|SVG|IFRAME)$/i.test(e.tagName))) {
    const r = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect();
    if (r.width > pr.width + 2 && !inScroller(el)) add("imagen-desborda", "media", el, `${Math.round(r.width)}px dentro de un contenedor de ${Math.round(pr.width)}px.`);
  }
  // 4) Texto cortado (se corta sin "…") y texto muy chico
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    if (fs < (mobile ? 12 : 11)) add("texto-chico", fs < 10 ? "media" : "baja", el, `Letra de ${fs}px.`);
    const clipX = el.scrollWidth > el.clientWidth + 1 && (s.overflowX === "hidden" || s.overflow === "hidden") && s.textOverflow !== "ellipsis";
    const clipY = el.scrollHeight > el.clientHeight + 2 && (s.overflowY === "hidden" || s.overflow === "hidden") && !s.webkitLineClamp?.match(/\d/);
    if (clipX || clipY) add("texto-cortado", "media", el, `Muestra ${el.clientWidth}×${el.clientHeight}px de ${el.scrollWidth}×${el.scrollHeight}px.`);
  }
  // 5) Botones y links: tamaño para el dedo y si algo los tapa
  const targets = all.filter((el) => el.matches("a[href], button, [role=button], [role=tab], input:not([type=hidden]), select, textarea, summary, label[for]"));
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue; // solo lo que está a la vista
    if (mobile && (r.width < 44 || r.height < 44)) {
      // Links dentro de un párrafo se toleran (son texto); el resto, a la lista.
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
      const sev = (r.width < 32 || r.height < 32) ? (inline ? "baja" : "media") : "baja";
      add("toque-chico", sev, el, `${Math.round(r.width)}×${Math.round(r.height)}px (se recomienda 44×44).`);
    }
    const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest("#zgTourCursor")) {
      const lbl = el.tagName === "INPUT" && el.id && document.querySelector(`label[for="${el.id}"]`);
      if (!(lbl && (lbl === top || lbl.contains(top)))) add("tapado", "media", el, `Lo tapa ${describe(top)}.`);
    }
  }
  return { W, H: innerHeight, scrollHeight: document.documentElement.scrollHeight, issues };
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "capturas"), { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  for (const kind of KINDS) {
    for (const sc of SCREENS) {
      const { ctx } = await newDemoContext(browser, kind, { loggedOut: !!sc.loggedOut });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${BASE}/portal/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      if (!sc.loggedOut) await page.waitForSelector("#projectCards:not([hidden]) .ap-hello", { timeout: 15000 });
      const tab = async (name) => { await page.locator(`#artistTabs [data-atab="${name}"]`).click(); await page.waitForTimeout(500); };
      let r;
      try {
        await sc.go(page, tab);
        await page.waitForTimeout(800); // que terminen las animaciones de entrada
        r = await page.evaluate(inspect, kind);
      } catch (e) { r = { issues: [{ type: "no-se-pudo-abrir", sev: "alta", el: "", detail: e.message.split("\n")[0] }] }; }
      const shot = `capturas/${kind}-${sc.id}.png`;
      await page.screenshot({ path: path.join(OUT, shot), fullPage: true }).catch(() => {});
      results.push({ kind, screen: sc.id, name: sc.name, shot, errors, ...r });
      console.log(`${kind.padEnd(8)} ${sc.name.padEnd(36)} ${r.issues.length} hallazgos${errors.length ? ` · ${errors.length} errores JS` : ""}`);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "datos.json"), JSON.stringify(results, null, 2));

  // Informe: agrupa lo repetido (mismo tipo + mismo elemento) y ordena por gravedad.
  const SEV = { alta: 0, media: 1, baja: 2 };
  const TYPE = { "scroll-horizontal": "Scroll horizontal", desborde: "Se sale de la pantalla", "imagen-desborda": "Imagen/video desborda", "texto-cortado": "Texto cortado", "texto-chico": "Texto muy chico", "toque-chico": "Difícil de tocar con el dedo", tapado: "Tapado por otro elemento", "no-se-pudo-abrir": "No se pudo abrir la pantalla" };
  let md = `# Auditoría responsive — Portal del artista ZECHE GRUV\n\nGenerado: ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} · Modo demo (Artista Demo)\n\n`;
  for (const kind of KINDS) {
    md += `## ${LABEL[kind]}\n\n`;
    for (const r of results.filter((x) => x.kind === kind)) {
      const groups = new Map();
      r.issues.forEach((i) => { const k = `${i.sev}|${i.type}|${i.el}`; if (!groups.has(k)) groups.set(k, { ...i, n: 0 }); groups.get(k).n++; });
      const list = [...groups.values()].sort((a, b) => SEV[a.sev] - SEV[b.sev]);
      md += `### ${r.name} — ${list.length ? `${list.length} hallazgos` : "sin problemas"}\n\n![](${r.shot})\n\n`;
      list.slice(0, 40).forEach((i) => { md += `- **${i.sev}** · ${TYPE[i.type] || i.type} · \`${i.el}\` — ${i.detail}${i.n > 1 ? ` (×${i.n})` : ""}\n`; });
      if (list.length > 40) md += `- … y ${list.length - 40} más (ver datos.json)\n`;
      if (r.errors && r.errors.length) md += `- **Errores de JavaScript:** ${r.errors.join(" · ")}\n`;
      md += "\n";
    }
  }
  fs.writeFileSync(path.join(OUT, "informe.md"), md);
  console.log(`\nInforme: auditoria/informe.md · Capturas: auditoria/capturas/`);
})();
