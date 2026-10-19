// Pedidos a Notion para el panel y las automatizaciones, con paciencia.
//
// Notion a veces contesta "esperá un poco" (429, demasiados pedidos juntos) o
// se cae un instante (502/503). Antes eso se tomaba como "no hay datos" y,
// por ejemplo, una mezcla entregada salía "Vencida" o volvían avisos viejos.
// Acá:
//   · Si contesta 429, 502 o 503, se espera lo que pide (Retry-After, con un
//     tope corto de 2 segundos) y se prueba de nuevo: hasta 3 intentos.
//   · Nunca van más de 3 pedidos a la vez (Notion permite unos 3 por
//     segundo): los demás esperan su turno.
// Devuelve siempre { ok, status, data }, igual que las funciones que había
// en cada archivo.
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const RETRY = [429, 502, 503];
const MAX_TRIES = 3;
const MAX_WAIT_MS = 2000;
const MAX_AT_ONCE = 3;
const token = () => (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Turnos: como mucho MAX_AT_ONCE pedidos en vuelo.
let running = 0;
const queue = [];
async function turn() {
  if (running < MAX_AT_ONCE) { running++; return; }
  await new Promise((r) => queue.push(r));
}
function release() {
  const next = queue.shift();
  if (next) next(); else running--;
}

// Cuánto esperar antes del próximo intento.
function waitFor(res, attempt) {
  const h = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
  const s = Number(h);
  if (h !== null && h !== "" && Number.isFinite(s)) return Math.min(MAX_WAIT_MS, Math.max(0, s * 1000));
  return Math.min(MAX_WAIT_MS, 300 * attempt);
}

async function notion(path, init = {}) {
  let res = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    await turn();
    try {
      res = await fetch(`${NOTION_API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      });
    } finally {
      release();
    }
    if (!RETRY.includes(res.status) || attempt === MAX_TRIES) break;
    await sleep(waitFor(res, attempt));
  }
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

// Consulta completa de una base (recorre todas las páginas: has_more).
// body: { filter, sorts } · Devuelve { ok, status, results }.
async function queryAll(dataSource, body = {}, { max = 1000 } = {}) {
  const results = [];
  let cursor = null;
  do {
    const r = await notion(`/data_sources/${dataSource}/query`, { method: "POST", body: JSON.stringify({ ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
    if (!r.ok) return { ok: false, status: r.status, results };
    results.push(...((r.data && r.data.results) || []));
    cursor = r.data && r.data.has_more ? r.data.next_cursor : null;
  } while (cursor && results.length < max);
  return { ok: true, status: 200, results };
}

module.exports = { notion, queryAll, token };
