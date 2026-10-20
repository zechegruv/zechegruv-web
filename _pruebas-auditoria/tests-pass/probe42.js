const { start } = require("./web-harness");
const EVENT = { slug: "show", kind: "show", name: "Show", starts_at: "2026-11-21T23:00:00.000Z", venue_name: "Teatro", venue_address: "Calle", lineup: ["Artista Uno", "SUPERCALIFRAGILISTICOEXPIALIDOSOMC", "Otro Nombre Bastante Largo"], on_sale: true, max_per_buyer: 2, ticket_types: [{ id: "a", name: "General", price: 1 }] };
(async () => { const h = await start(); const p = await h.page({ "pass-events": () => ({ json: EVENT }) });
await p.goto(h.base + "/pass/?e=show"); await p.waitForSelector("#view-event:not([hidden])");
console.log(await p.evaluate(() => [...document.querySelectorAll("body *")].filter((n) => n.getBoundingClientRect().right > 376).map((n) => `${n.tagName}.${n.className}#${n.id} ${Math.round(n.getBoundingClientRect().right)}`).slice(0, 12).join("\n")));
await h.close(); })();
