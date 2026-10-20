// Bug 4: gcal.events() traía solo los primeros 100 eventos.
const H = require("./h");
const { S, F, check, done, ev, dayAR } = H;
H.setup();
const gc = F("_lib/gcal");
const add = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = dayAR(new Date());
(async () => {
  for (let i = 0; i < 620; i++) {
    const d = add(today, 1 + Math.floor(i / 20));
    const h = String(8 + (i % 20) / 2 | 0).padStart(2, "0");
    ev(`e${i}`, `Ensayo ${i}`, `${d}T${h}:${i % 2 ? "30" : "00"}:00-03:00`, `${d}T${h}:${i % 2 ? "59" : "29"}:00-03:00`);
  }
  const urls = [];
  const f = global.fetch;
  global.fetch = (u, i) => { if (/\/events\?/.test(String(u))) urls.push(String(u)); return f(u, i); };
  const list = await gc.events(`${today}T00:00:00-03:00`, `${add(today, 60)}T00:00:00-03:00`);
  check("trae los 620 eventos", list && list.length === 620, list && list.length);
  check("pide de a 250", urls.length && urls.every((u) => /maxResults=250/.test(u)), urls[0]);
  check("recorre las páginas (3 pedidos)", urls.length === 3, urls.length);
  done("t04 eventos paginados");
})().catch((e) => { console.error(e); process.exitCode = 1; });
