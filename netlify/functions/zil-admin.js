// POST /.netlify/functions/zil-admin  { action, id }
// Solo administrador. Acciones:
//   "diagnose": prueba la conexión con ZIL (solo lee: cuentas, géneros,
//               tiendas, lanzamientos) y muestra qué devuelve.
//   "preview":  revisa un lanzamiento antes de mandarlo (no escribe en ZIL).
//   "publish":  lo carga en ZIL y lo manda a revisión de las tiendas.
//   "sync":     consulta ya mismo el estado en las tiendas (zil-sync.js).
const { SUPABASE_URL, json, db } = require("./_lib/pass");
const { client, listOf, base, token, isDev } = require("./_lib/zil");
const { prepare, publish, labelSession, genreCode, allDsps } = require("./_lib/zil-release");
const { syncRelease } = require("./zil-sync");

const PUBLISHABLE_KEY = "sb_publishable_9M2gY0XZr7xIrV-1s9AiUA_XA1uNm0V";

async function isAdmin(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const t = auth.replace(/^Bearer\s+/i, "");
  if (!t) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${t}` } });
  const user = res.ok ? await res.json().catch(() => null) : null;
  if (!user || !user.id) return false;
  const me = await db(`profiles?id=eq.${user.id}&select=role`);
  return !!(me.ok && me.data[0] && me.data[0].role === "admin");
}

// Muestra corta de una respuesta: claves y primeros elementos, para ver su forma.
const sample = (x) => JSON.stringify(Array.isArray(x) ? x.slice(0, 2) : x, (k, v) => (/token|password|iban|cbu|account/i.test(k) ? "•••" : v)).slice(0, 700);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!(await isAdmin(event))) return json(403, { error: "Solo el administrador." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Pedido inválido." }); }
  if (!token()) return json(500, { error: "Falta ZIL_API_TOKEN en las variables de Netlify." });
  const id = String(body.id || "");
  if (body.action !== "diagnose" && !/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Lanzamiento inválido." });

  try {
    if (body.action === "diagnose") {
      // Cada consulta por separado (solo lectura), para ver qué permite el token.
      const z = client();
      const out = { entorno: isDev() ? "pruebas (dev)" : "real", url: base(), token: `cargado (${token().length} caracteres)` };
      const tryCall = async (label, path) => {
        try { const d = await z.call(label, "GET", path); out[label] = `OK · ${sample(d)}`; return d; }
        catch (e) { out[label] = `✕ ${e.status}${e.detail ? ` (${e.detail})` : ""}`; return null; }
      };
      await tryCall("perfil", "/me");
      await tryCall("cuentas", "/users");
      await tryCall("generos", "/genres");
      await tryCall("tiendas", "/dsps");
      await tryCall("proyectos", "/projects");
      const albums = await tryCall("lanzamientos", "/albums");
      if (albums) out.lanzamientos = `OK · ${listOf(albums).length} lanzamientos`;
      return json(200, { ok: true, ...out });
    }
    if (body.action === "preview") {
      const p = await prepare(id);
      return json(200, {
        ok: !p.problems.length, problems: p.problems, entorno: isDev() ? "pruebas (dev)" : "real",
        resumen: { titulo: p.rel.title, salida: p.rel.release_date, genero: p.rel.genre, canciones: p.tracks.map((t) => `${t.title} · máster: ${t.master}`) },
      });
    }
    if (body.action === "publish") {
      const r = await db(`releases?id=eq.${id}&select=status`);
      const st = r.ok && r.data[0] && r.data[0].status;
      if (st !== "submitted") return json(409, { error: "Solo se publica un lanzamiento enviado por el artista y revisado (estado Recibido)." });
      const res = await publish(id);
      return json(res.ok ? 200 : 422, res.ok ? res : { error: `No se mandó (${res.step}).`, problems: res.problems });
    }
    if (body.action === "sync") return json(200, await syncRelease(id, { force: true }));
    return json(400, { error: "Acción desconocida." });
  } catch (err) {
    console.error("zil-admin:", err.message);
    return json(502, { error: err.message || "ZIL no respondió." });
  }
};
