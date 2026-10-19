// POST /.netlify/functions/admin-ingresos
// Ingresos del mes para el Inicio del panel de administrador.
// Lee la base "Gastos e ingresos" de Notion (solo lectura) y devuelve los
// totales del mes en curso: cobrado, por cobrar, gastos y neto.
//
// - Solo para el administrador (sesión de Supabase en Authorization: Bearer).
// - Variables en Netlify: NOTION_TOKEN (la misma integración "Portal ZECHE GRUV"
//   del portal, con acceso compartido a "Gastos e ingresos") y, opcional, ZG_META_MENSUAL.
// - Sin NOTION_TOKEN responde { connected: false } y el panel muestra cómo conectarlo.
const { SUPABASE_URL, db } = require("./_lib/pass");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";
const DATA_SOURCE = "52f1e043-55b6-8379-88e5-87814d3bc69f"; // Gastos e ingresos
const TZ = "America/Argentina/Buenos_Aires";

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

async function isAdmin(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  if (!user || !user.id) return false;
  const role = await db(`profiles?id=eq.${user.id}&select=role`);
  return !!(role.ok && role.data[0] && role.data[0].role === "admin");
}

// Primer día de este mes y del siguiente, en hora de Buenos Aires.
function monthRange(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  const name = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, month: "long" }).format(now);
  return { start: `${y}-${pad(m)}-01`, end: `${next[0]}-${pad(next[1])}-01`, name };
}

// Todas las filas del mes (con reintentos ante 429/502/503, _lib/notion.js).
async function queryMonth(token, range) {
  const r = await require("./_lib/notion").queryAll(DATA_SOURCE, {
    filter: { and: [
      { property: "Fecha", date: { on_or_after: range.start } },
      { property: "Fecha", date: { before: range.end } },
    ] },
  }, { max: 5000 });
  if (!r.ok) {
    const err = new Error(r.status === 404 || r.status === 403 ? "not_shared" : "notion_error");
    err.status = r.status;
    throw err;
  }
  return r.results;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Método no permitido." });
  if (!(await isAdmin(event))) return reply(401, { error: "Solo para el administrador." });

  const token = (process.env.NOTION_TOKEN || "").replace(/[\s"'“”‘’]/g, "");
  const goal = Number(process.env.ZG_META_MENSUAL) || 5000000;
  const range = monthRange();
  if (!token) return reply(200, { connected: false, goal, month: range.name });

  try {
    const rows = await queryMonth(token, range);
    let cobrado = 0, pendiente = 0, gastos = 0, pagos = 0;
    for (const r of rows) {
      const p = r.properties || {};
      const tipo = p["Tipo"] && p["Tipo"].select && p["Tipo"].select.name;
      const valor = (p["Valor"] && p["Valor"].number) || 0;
      const recibido = !!(p["Pago Recibido"] && p["Pago Recibido"].checkbox);
      const estado = p["Estado del pago"] && p["Estado del pago"].select && p["Estado del pago"].select.name;
      if (tipo === "Entrada") {
        if (recibido || estado === "Pago") { cobrado += valor; pagos += 1; }
        else pendiente += valor;
      } else if (tipo === "Salida") gastos += valor;
    }
    return reply(200, { connected: true, month: range.name, goal, cobrado, pendiente, gastos, neto: cobrado - gastos, pagos });
  } catch (err) {
    return reply(200, { connected: false, goal, month: range.name, problem: err.message });
  }
};
