// Pruebas en el navegador (Chromium a 375 px) de las páginas de ZG PASS y
// de la web pública. Uso: NODE_PATH=$(npm root -g) node web.test.js [filtro]
const { start, SHOTS } = require("./web-harness");
const path = require("path");
const only = process.argv[2] || process.env.ONLY || "";
const tests = [];
const test = (name, run) => tests.push([name, run]);
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what || "valor"}: esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`); }
function ok(v, what) { if (!v) throw new Error(what || "esperaba verdadero"); }
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

const T = "a".repeat(64);
const EVENT = { slug: "show", kind: "show", name: "ZECHE GRUV Shows & Open Mic #3", starts_at: "2026-11-21T23:00:00.000Z", venue_name: "Teatro de prueba", venue_address: "Calle Falsa 123", important_info: null, lineup: ["Artista Uno", "Artista Dos"] };
const PAY_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1";
const pending = (extra = {}) => ({ number: "ZG-000123", status: "pending", total: 8000, expires_at: new Date(Date.now() + 10 * 60e3).toISOString(), buyer_name: "Ana Prueba", buyer_email: "ana@example.com", event: EVENT, tickets: [], openmic_open: false, pay_url: PAY_URL, ...extra });
const paid = (extra = {}) => ({ number: "ZG-000123", status: "paid", total: 8000, buyer_name: "Ana Prueba", buyer_email: "ana@example.com", event: EVENT, openmic_open: false, tickets: [{ code: "ZG-26-K7Q4X2", token: "b".repeat(64), status: "valid", holder_name: "Ana Prueba", type: "General" }], ...extra });
const waitText = (p, sel, re, ms = 9000) => p.waitForFunction(([s, src]) => { const n = document.querySelector(s); return n && !n.closest("[hidden]") && new RegExp(src).test(n.textContent); }, [sel, re.source], { timeout: ms });

// ---------- Página de la orden ----------
test("12 · volvió sin pagar: 'Volver a intentar' lleva al mismo pago de Mercado Pago", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-state:not([hidden])", { timeout: 9000 });
  eq(await p.getAttribute("#stateBtn", "href"), PAY_URL, "botón");
  await shot(p, "12-orden-volver-a-pagar");
});
test("12 · sin link de pago (reserva vencida) el botón vuelve al evento", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending({ status: "expired", pay_url: undefined }) }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-state:not([hidden])", { timeout: 9000 });
  eq(await p.getAttribute("#stateBtn", "href"), "/pass/?e=show", "botón");
});
test("15 · al recargar después de pagar se sigue mandando el número de pago", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}&payment_id=123456&status=approved&collection_status=approved`);
  await p.waitForTimeout(400);
  eq(new URL(p.url()).search, `?t=${T}`, "dirección limpia");
  p.calls.length = 0;
  await p.reload();
  await p.waitForTimeout(600);
  const call = p.calls.find((c) => c.name === "pass-order");
  ok(call && call.url.includes("payment_id=123456"), `pidió sin payment_id: ${call && call.url}`);
});
test("15 · sin número de pago no afirma que no se cobró", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-state:not([hidden])", { timeout: 9000 });
  const text = await p.textContent("#view-state");
  ok(!/no se te cobró nada/i.test(text), `dice: ${text}`);
  ok(/si ya pagaste/i.test(text), `no avisa que puede tardar: ${text}`);
  await shot(p, "15-orden-sin-payment-id");
});
test("15 · si después se confirma, la misma página muestra la entrada", async (h) => {
  let n = 0;
  const p = await h.page({ "pass-order": () => ({ json: ++n < 3 ? pending() : paid() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-paid:not([hidden])", { timeout: 12000 });
});
test("15 · pago rechazado por Mercado Pago: sí dice que no se cobró", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}&payment_id=99&status=rejected`);
  await waitText(p, "#stateText", /No se te cobró nada/);
});
test("16 · sin la librería del QR, la entrada paga se muestra igual (imagen del servidor)", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: paid() }) }, { noQr: true });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-paid:not([hidden])", { timeout: 6000 });
  const src = await p.getAttribute(".pass-qr img.pass-qr-img", "src");
  eq(src, `/.netlify/functions/pass-qr?k=${"b".repeat(64)}`, "imagen del QR");
  await shot(p, "16-orden-qr-imagen");
});
test("16 · un error al dibujar no corta el refresco", async (h) => {
  let n = 0;
  const p = await h.page({ "pass-order": () => ({ json: ++n === 1 ? paid({ event: null }) : paid() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-paid:not([hidden])", { timeout: 9000 });
  ok(n >= 2, "no volvió a consultar");
});
test("41 · venta sin mail: no dice 'a null'", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: paid({ buyer_email: null }) }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-paid:not([hidden])", { timeout: 6000 });
  const text = await p.textContent("#paidText");
  ok(!/null/.test(text) && !/te la mandamos/i.test(text), `dice: ${text}`);
});
test("41 · con mail sigue diciendo a dónde se mandó", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: paid() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await waitText(p, "#paidText", /ana@example\.com/);
});

// ---------- Puerta ----------
const DK = "d".repeat(64);
const DOOR_INFO = { door: { label: "Puerta" }, event: { id: "e1", kind: "show", name: EVENT.name, starts_at: EVENT.starts_at, venue_name: EVENT.venue_name, status: "published" }, ticket_types: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General", price: 8000 }], counts: { capacity: 70, issued: 10, advance: 8, door: 2, used: 3, available: 60 } };
async function doorPage(h, fns = {}) {
  const p = await h.page({ "pass-door": (url, req) => { const b = JSON.parse(req.postData() || "{}"); return (fns[b.action] || (() => ({ json: DOOR_INFO })))(b); } });
  await p.addInitScript((k) => { try { localStorage.setItem(`zg-puerta-${k.slice(0, 16)}`, "1234"); } catch (e) {} }, DK);
  await p.goto(`${h.base}/pass/puerta/?k=${DK}`);
  await p.waitForSelector("#view-main:not([hidden])", { timeout: 6000 });
  return p;
}
test("31 · la puerta ya no ofrece cargar el código a mano (solo QR)", async (h) => {
  const p = await doorPage(h);
  eq(await p.$$eval("#zgpCode, #zgpManual", (n) => n.length), 0, "campo de código a mano");
  await shot(p, "31-puerta-solo-qr");
});

const SOLD = { number: "ZG-000200", total: 8000, emailed: false, tickets: [{ code: "ZG-26-K7Q4X2", token: "b".repeat(64), status: "valid", holder_name: "Ana Puerta", type: "General" }] };
async function fillSale(p) {
  await p.click("#doorTabs [data-view=issue]");
  await p.fill("#zgpFirst", "Ana");
  await p.fill("#zgpLast", "Puerta");
}
test("33 · venta en puerta: si se corta la conexión, el reintento lleva la misma clave", async (h) => {
  const idems = [];
  let n = 0;
  const p = await doorPage(h, { issue: (b) => { idems.push(b.idem); return ++n === 1 ? "abort" : { json: SOLD }; } });
  await fillSale(p);
  await p.click("#zgpIssueSubmit");
  await p.waitForFunction(() => document.querySelector("#zgpIssueMsg").classList.contains("is-error"));
  await p.click("#zgpIssueSubmit");
  await waitText(p, "#zgpIssueMsg", /Listo/);
  eq(idems.length, 2, "pedidos");
  ok(idems[0] && idems[0] === idems[1], `claves distintas: ${idems}`);
  await shot(p, "33-puerta-venta");
});
test("33 · venta en puerta: una venta nueva (o con datos cambiados) lleva otra clave", async (h) => {
  const idems = [];
  const p = await doorPage(h, { issue: (b) => { idems.push(b.idem); return idems.length === 2 ? "abort" : { json: SOLD }; } });
  await fillSale(p);
  await p.click("#zgpIssueSubmit");
  await waitText(p, "#zgpIssueMsg", /Listo/);
  await p.fill("#zgpFirst", "Beto"); await p.fill("#zgpLast", "Otro");
  await p.click("#zgpIssueSubmit");
  await p.waitForFunction(() => document.querySelector("#zgpIssueMsg").classList.contains("is-error"));
  await p.fill("#zgpLast", "Otra");
  await p.click("#zgpIssueSubmit");
  await waitText(p, "#zgpIssueMsg", /Listo/);
  eq(new Set(idems).size, 3, `claves: ${idems}`);
});

// ---------- Panel: lista de invitados ----------
async function glPage(h, handler) {
  const p = await h.page({ "pass-admin": (url, req) => handler(JSON.parse(req.postData() || "{}")) });
  p.on("dialog", (d) => d.accept());
  await p.goto(`${h.base}/__test/gl-page.html`);
  await p.waitForSelector("#glRows .gl-row");
  return p;
}
async function addGuests(p, n) {
  for (let i = 0; i < n; i++) {
    if (i > 0) await p.click("#glAdd");
    const row = (await p.$$("#glRows .gl-row"))[i];
    await (await row.$(".gl-first")).fill(`Invi${i}`);
    await (await row.$(".gl-last")).fill(`Tado${i}`);
    await (await row.$(".gl-email")).fill(`invi${i}@example.com`);
  }
}
const okResults = (b) => ({ json: { results: b.guests.map((g) => ({ name: `${g.first_name} ${g.last_name}`, email: g.email, ok: true, emailed: true, tickets: 1 })) } });
test("30 · lista larga: se manda en tandas chicas y cada invitado lleva su clave", async (h) => {
  const batches = [];
  const p = await glPage(h, (b) => { batches.push(b.guests); return okResults(b); });
  await addGuests(p, 12);
  await p.click("#glSend");
  await waitText(p, "#glMsg", /Listo/);
  ok(batches.length >= 3 && batches.every((g) => g.length <= 5), `tandas: ${batches.map((g) => g.length)}`);
  const keys = batches.flat().map((g) => g.idem);
  eq(keys.length, 12, "invitados enviados");
  ok(keys.every((k) => /^[A-Za-z0-9-]{8,64}$/.test(k)) && new Set(keys).size === 12, `claves: ${keys}`);
  ok(/12 de 12/.test(await p.textContent("#glMsg")), await p.textContent("#glMsg"));
});
test("30 · si una tanda se corta, al reenviar cada invitado lleva la misma clave (no se duplica)", async (h) => {
  const batches = [];
  let n = 0;
  const p = await glPage(h, (b) => { batches.push(b.guests); return ++n === 2 ? "abort" : okResults(b); });
  await addGuests(p, 8);
  await p.click("#glSend");
  await p.waitForFunction(() => document.querySelector("#glMsg").classList.contains("is-error"), null, { timeout: 6000 });
  eq(await p.$$eval("#glRows .gl-row", (r) => r.length), 3, "quedan en el formulario los no confirmados");
  await shot(p, "30-invitados-corte");
  await p.click("#glSend");
  await waitText(p, "#glMsg", /Listo/);
  const cut = batches[1].map((g) => g.idem);
  const again = batches.slice(2).flat().map((g) => g.idem);
  ok(cut.every((k) => again.includes(k)), `claves cambiaron: ${cut} → ${again}`);
  ok(!again.some((k) => batches[0].map((g) => g.idem).includes(k)), "reenvió a los que ya estaban confirmados");
});

// ---------- Open mic con el mail ----------
const MIC_INFO = { event: { slug: "show", kind: "show", name: EVENT.name, starts_at: EVENT.starts_at }, open: true, closed_reason: "", deadline: null, buyer: { name: "Cata Cantante", email: "cata@example.com" },
  tickets: [{ ref: "11111111-aaaa-4aaa-8aaa-000000000001", holder_name: "Cata Cantante", signup: null }, { ref: "11111111-aaaa-4aaa-8aaa-000000000002", holder_name: "Cata Cantante", signup: null }] };
test("32 · con el mail: elige la entrada sin ver códigos (y no dice 'undefined')", async (h) => {
  const p = await h.page({ "pass-openmic": () => ({ json: MIC_INFO }) });
  await p.goto(`${h.base}/pass/openmic/?e=show`);
  await p.waitForSelector("#view-email:not([hidden])");
  await p.fill("#buyerEmail", "cata@example.com");
  await p.click("#emailSubmit");
  await p.waitForSelector("#view-form:not([hidden])");
  const opts = await p.$$eval("#ticketSelect option", (o) => o.map((x) => [x.value, x.textContent]));
  eq(opts.map((o) => o[0]), MIC_INFO.tickets.map((t) => t.ref), "valores");
  ok(opts.every((o) => !/undefined|ZG-/.test(o[1])), `textos: ${opts.map((o) => o[1])}`);
  await shot(p, "32-openmic-con-mail");
});
test("32 · demasiados intentos: avisa en la misma pantalla del mail", async (h) => {
  const p = await h.page({ "pass-openmic": () => ({ status: 429, json: { error: "Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo." } }) });
  await p.goto(`${h.base}/pass/openmic/?e=show`);
  await p.waitForSelector("#view-email:not([hidden])");
  await p.fill("#buyerEmail", "cata@example.com");
  await p.click("#emailSubmit");
  await waitText(p, "#emailMsg", /muchos intentos/);
  eq(await p.isEnabled("#emailSubmit"), true, "botón habilitado");
});

// ---------- 34 · títulos de Spotify con comillas o "<" ----------
const ODD = 'Tema "con" comillas <b>y</b> & más';
const ODD_ARTISTS = 'Artista <i>raro</i> & "otro"';
const CATALOG = { items: [
  { id: "abc123", type: "track", name: ODD, artists: ODD_ARTISTS, url: "javascript:alert(1)", cover: "javascript:alert(2)", artistIds: ["0FFp6MN2W3zcJdWAkCxcg6"] },
  { id: "def456", type: "album", name: "Normal", artists: "Alguien", url: "https://open.spotify.com/album/def456", cover: "https://i.scdn.co/image/x", artistIds: [] },
] };
test("34 · inicio: el catálogo muestra títulos con comillas y '<' tal cual, sin romper la tarjeta", async (h) => {
  const p = await h.page({ "spotify-catalog": () => ({ json: CATALOG }), "pass-events": () => ({ json: { events: [] } }), geo: () => ({ json: {} }) });
  await p.goto(`${h.base}/`);
  await p.waitForFunction(() => document.querySelectorAll("#fullCatalogueGrid .release-card").length >= 2, null, { timeout: 8000 });
  const c = await p.$eval("#fullCatalogueGrid .release-card", (a) => ({ n: document.querySelectorAll("#fullCatalogueGrid .release-card").length, name: a.querySelector(".card-name").textContent, meta: a.querySelector(".card-meta").textContent, alt: a.querySelector("img").alt, data: a.dataset.spotifyName, href: a.getAttribute("href"), src: a.querySelector("img").getAttribute("src"), b: a.querySelectorAll("b, i").length }));
  eq(c.n, 2, "tarjetas");
  eq([c.name, c.data, c.alt], [ODD, ODD, `${ODD} — cover art`], "texto, data-* y alt");
  ok(c.meta.startsWith(ODD_ARTISTS), `artistas: ${c.meta}`);
  eq(c.b, 0, "se coló HTML");
  ok(!/^javascript:/i.test(c.href) && !/^javascript:/i.test(c.src || ""), `links: ${c.href} ${c.src}`);
});
test("34 · página de artista: top canciones y lanzamientos escapados", async (h) => {
  const p = await h.page({ "spotify-artist-stats": () => ({ json: { topTracks: [{ id: "t1", name: ODD, artists: ODD_ARTISTS, cover: "javascript:x" }] } }), "spotify-catalog": () => ({ json: CATALOG }) });
  await p.goto(`${h.base}/artistas/layla-mar.html`);
  await p.waitForSelector("#topTracksList .top-track", { timeout: 8000 });
  await p.waitForSelector("#artistReleasesGrid .release-card", { timeout: 8000 });
  const t = await p.$eval("#topTracksList .top-track", (d) => ({ name: d.querySelector(".top-track-name").textContent, artists: d.querySelector(".top-track-artists").textContent, data: d.dataset.spotifyName, tags: d.querySelectorAll("b, i").length, src: d.querySelector("img").getAttribute("src") }));
  eq([t.name, t.artists, t.data, t.tags], [ODD, ODD_ARTISTS, ODD, 0], "top canción");
  ok(!/^javascript:/i.test(t.src || ""), "portada javascript:");
  const r = await p.$eval("#artistReleasesGrid .release-card", (a) => ({ name: a.querySelector(".card-name").textContent, alt: a.querySelector("img").alt, href: a.getAttribute("href") }));
  eq([r.name, r.alt], [ODD, `${ODD} — cover art`], "lanzamiento");
  ok(!/^javascript:/i.test(r.href), `link: ${r.href}`);
});

// ---------- 42 · line up largo a 375 px ----------
const LONG = { ...EVENT, lineup: ["Artista Uno", "SUPERCALIFRAGILISTICOEXPIALIDOSOMC", "Otro Nombre Bastante Largo"], description: "", on_sale: true, sold_out: false, few_left: null, max_per_buyer: 2, openmic_open: false, ticket_types: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General", price: 8000 }] };
test("42 · página del evento: un nombre largo en el line up no hace scroll horizontal", async (h) => {
  const p = await h.page({ "pass-events": () => ({ json: LONG }) });
  await p.goto(`${h.base}/pass/?e=show`);
  await p.waitForSelector("#view-event:not([hidden])");
  await p.waitForTimeout(300);
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 375, `ancho de la página: ${w}px`);
  await shot(p, "42-evento-lineup-largo");
});
test("42 · entrada: un nombre largo en el line up no hace scroll horizontal", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: paid({ event: LONG }) }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}`);
  await p.waitForSelector("#view-paid:not([hidden])");
  await p.waitForTimeout(300);
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 375, `ancho de la página: ${w}px`);
  await shot(p, "42-entrada-lineup-largo");
});

// ---------- 46 · franja del evento en el idioma elegido ----------
const ONSALE = { events: [{ ...LONG, lineup: ["Artista Uno"], few_left: null }] };
test("46 · al pasar a inglés, la franja y el botón del evento cambian de idioma", async (h) => {
  const p = await h.page({ "pass-events": () => ({ json: ONSALE }), "spotify-catalog": () => ({ json: CATALOG }), geo: () => ({ json: {} }) });
  await p.goto(`${h.base}/`);
  await p.waitForSelector("#promoBar:not([hidden])", { timeout: 8000 });
  const before = await p.textContent("#promoWhen");
  await p.selectOption("#langSelect", "en");
  await p.waitForFunction(() => document.documentElement.lang === "en");
  await p.waitForTimeout(200);
  const when = await p.textContent("#promoWhen");
  const hero = await p.textContent(".hero-buttons .hero-ticket");
  ok(/Sat/.test(when) && !/Sáb/.test(when), `fecha: ${before} → ${when}`);
  ok(/Get your ticket/.test(hero) && /Sat/.test(hero), `botón: ${hero}`);
  ok(/Sat/.test(await p.textContent("#nextEventMeta")), "tarjeta del evento");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: path.join(SHOTS, "46-inicio-ingles.png") });
  await p.selectOption("#langSelect", "es");
  await p.waitForFunction(() => document.documentElement.lang === "es");
  ok(/Sáb/.test(await p.textContent("#promoWhen")), "vuelve al español");
});

// ---------- X2 · Google Analytics sin la clave de la orden ----------
test("X2 · medición: ni la página ni la de origen llevan la clave (?t= / ?k=)", async (h) => {
  const p = await h.page({ "pass-order": () => ({ json: pending() }) });
  await p.goto(`${h.base}/pass/orden/?t=${T}&payment_id=123`, { referer: `${h.base}/pass/openmic/?t=${"c".repeat(64)}&k=${"d".repeat(64)}` });
  await p.waitForTimeout(500);
  const dl = await p.evaluate(() => JSON.stringify((window.dataLayer || []).map((a) => Array.from(a))));
  ok(dl.includes("page_location"), `sin medición: ${dl}`);
  ok(!/[?&](t|k)=/.test(dl) && !dl.includes("a".repeat(64)) && !dl.includes("c".repeat(64)), `se filtró la clave: ${dl}`);
  ok(/page_referrer/.test(dl), "no se limpia page_referrer");
});
test("X2 · las páginas de ZG PASS piden no mandar la dirección completa como origen", async (h) => {
  const p = await h.page({ "pass-events": () => ({ json: { events: [] } }) });
  for (const url of ["/pass/", "/pass/orden/", "/pass/openmic/", "/pass/pistas/", "/pass/puerta/"]) {
    await p.goto(`${h.base}${url}`);
    const r = await p.getAttribute('meta[name="referrer"]', "content");
    ok(["strict-origin", "no-referrer"].includes(r), `${url}: ${r}`);
  }
});

// ---------- 45 · formatos de las pistas (captura) ----------
test("45 · pistas: el texto de ayuda lista los formatos que se aceptan", async (h) => {
  const show = { name: EVENT.name, starts_at: EVENT.starts_at, venue_name: EVENT.venue_name, deadline: EVENT.starts_at, open: true, files: [] };
  const p = await h.page({ "portal-shows": () => ({ json: { shows: [show], guest: { name: "Invitada", plural: false, gift_session: false } } }) });
  await p.goto(`${h.base}/pass/pistas/?k=${"e".repeat(64)}`);
  await waitText(p, ".hint", /M4A/);
  const hint = await p.textContent(".hint");
  ok(/RAR/.test(hint) && /PDF/.test(hint) && /TXT/.test(hint), hint);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= 375), "scroll horizontal");
  await shot(p, "45-pistas-formatos");
});

(async () => {
  const h = await start();
  let pass = 0, fail = 0;
  for (const [name, run] of tests) {
    if (only && !name.startsWith(only)) continue;
    try { await run(h); console.log(`PASS  ${name}`); pass++; }
    catch (e) { console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); fail++; }
  }
  await h.close();
  console.log(`\nNavegador: ${pass} ok, ${fail} con fallas`);
  process.exitCode = fail ? 1 : 0;
})();
