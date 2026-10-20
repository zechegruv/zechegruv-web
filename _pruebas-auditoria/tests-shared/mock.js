// Banco de pruebas: Notion, Supabase, Google Calendar y Resend simulados en memoria.
// Uso: const { S, page, title, sel, relp, date, dayAR } = require("<ruta>/mock");  (antes de requerir las functions)
// S.pages (Notion), S.tables (Supabase), S.events (Google Calendar), S.mails (Resend), S.log.
const S = { pages: {}, tables: {}, events: {}, mails: [], log: [], failCalendarPatch: false };
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const dayAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
const res = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });

// ---------- Notion ----------
const title = (t) => ({ type: "title", title: [{ plain_text: t }] });
const sel = (n) => ({ type: "select", select: n ? { name: n } : null });
const relp = (ids) => ({ type: "relation", relation: ids.map((id) => ({ id })) });
const date = (start, end) => ({ type: "date", date: start ? { start, end: end || null } : null });
function page(ds, id, properties, created = "2026-10-01T12:00:00.000Z") {
  S.pages[id] = { object: "page", id, url: `https://notion.so/${id.replace(/-/g, "")}`, parent: { data_source_id: ds }, created_time: created, last_edited_time: created, properties };
  return S.pages[id];
}
function propVal(p) {
  if (!p) return null;
  if (p.type === "title") return p.title.map((x) => x.plain_text || (x.text && x.text.content) || "").join("");
  if (p.type === "select") return p.select && p.select.name;
  if (p.type === "relation") return p.relation.map((r) => r.id.replace(/-/g, ""));
  if (p.type === "date") return p.date && p.date.start;
  return null;
}
const dk = (s) => (/T/.test(s) ? dayAR(new Date(s)) : s.slice(0, 10));
function match(pg, f) {
  if (!f) return true;
  if (f.and) return f.and.every((x) => match(pg, x));
  if (f.or) return f.or.some((x) => match(pg, x));
  const v = propVal(pg.properties[f.property]);
  if (f.relation) return (v || []).includes(f.relation.contains.replace(/-/g, ""));
  if (f.select) { if ("equals" in f.select) return v === f.select.equals; if ("does_not_equal" in f.select) return v !== f.select.does_not_equal; }
  if (f.date) { if (!v) return false; if (f.date.on_or_before) return dk(v) <= f.date.on_or_before; if (f.date.on_or_after) return dk(v) >= f.date.on_or_after; }
  if (f.title) return String(v || "").toLowerCase().includes(f.title.contains.toLowerCase());
  throw new Error("filtro no simulado " + JSON.stringify(f));
}
function applyProps(pg, props) {
  for (const [k, v] of Object.entries(props)) {
    if ("select" in v) pg.properties[k] = sel(v.select && v.select.name);
    else if ("date" in v) pg.properties[k] = date(v.date && v.date.start, v.date && v.date.end);
    else if ("relation" in v) pg.properties[k] = relp(v.relation.map((r) => r.id));
    else if ("title" in v) pg.properties[k] = title(v.title.map((t) => t.text.content).join(""));
    else if ("multi_select" in v || "rich_text" in v) pg.properties[k] = { type: "other", ...v };
  }
  pg.last_edited_time = new Date().toISOString();
}
function notion(url, init) {
  const u = new URL(url); const m = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : null;
  let r;
  if ((r = u.pathname.match(/^\/v1\/pages\/([^/]+)$/))) {
    const id = Object.keys(S.pages).find((k) => k.replace(/-/g, "") === r[1].replace(/-/g, ""));
    if (!id) return res(404, {});
    if (m === "PATCH") {
      if (body.archived || body.in_trash) { S.pages[id].archived = true; S.log.push(["notion", "ARCHIVE", id]); return res(200, S.pages[id]); }
      applyProps(S.pages[id], body.properties || {}); S.log.push(["notion", "PATCH", id, body.properties]);
    }
    return res(200, JSON.parse(JSON.stringify(S.pages[id])));
  }
  if (u.pathname === "/v1/pages" && m === "POST") {
    const id = uid(); const pg = page(body.parent.data_source_id, id, {}, new Date().toISOString()); applyProps(pg, body.properties);
    S.log.push(["notion", "CREATE", id, body.properties]); return res(200, pg);
  }
  if ((r = u.pathname.match(/^\/v1\/data_sources\/([^/]+)\/query$/))) {
    // Paginación real: page_size (máx 100) y start_cursor = índice.
    const all = Object.values(S.pages).filter((p) => !p.archived && p.parent.data_source_id === r[1] && match(p, body && body.filter));
    const size = Math.min(100, (body && body.page_size) || 100);
    const start = body && body.start_cursor ? +body.start_cursor : 0;
    const list = all.slice(start, start + size);
    const more = start + size < all.length;
    return res(200, { results: JSON.parse(JSON.stringify(list)), has_more: more, next_cursor: more ? String(start + size) : null });
  }
  if (u.pathname === "/v1/comments") return res(200, {});
  return res(404, { error: "notion " + u.pathname });
}

// ---------- Supabase (PostgREST mínimo) ----------
function filt(rows, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    rows = rows.filter((row) => {
      const x = row[k];
      if (v.startsWith("eq.")) return String(x) === decodeURIComponent(v.slice(3));
      if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(x));
      if (v === "not.is.null") return x != null;
      if (v === "is.null") return x == null;
      return true;
    });
  }
  const order = params.get("order");
  if (order) { const [c, dir] = order.split("."); rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
  if (params.get("limit")) rows = rows.slice(0, +params.get("limit"));
  return rows;
}
function supa(url, init) {
  const u = new URL(url); const m = init.method || "GET";
  if (u.pathname === "/auth/v1/user") {
    const tok = (init.headers.Authorization || "").replace("Bearer ", "");
    return tok.startsWith("tok-") ? res(200, { id: tok.slice(4) }) : res(401, {});
  }
  if (u.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = u.pathname.slice("/rest/v1/rpc/".length);
    const h = S.rpc && S.rpc[fn];
    if (!h) return res(404, { code: "PGRST202", message: `rpc ${fn} no simulada` });
    try { return res(200, h(init.body ? JSON.parse(init.body) : {})); } catch (e) { return res(400, { message: e.message }); }
  }
  const table = u.pathname.replace("/rest/v1/", ""); const params = u.searchParams;
  if ((S.missingTables || []).includes(table)) return res(404, { code: "42P01" });
  const all = (S.tables[table] = S.tables[table] || []);
  const body = init.body ? JSON.parse(init.body) : null;
  if (m === "GET") return res(200, filt(all, params).map((r) => ({ ...r })));
  if (m === "POST") {
    const conflict = params.get("on_conflict");
    if (conflict && all.some((r) => r[conflict] === body[conflict])) return res(201, []);
    const row = { id: uid(), created_at: new Date(Date.now() + seq).toISOString(), ...body }; all.push(row); S.log.push(["db", "INSERT", table, body]); return res(201, [row]);
  }
  if (m === "PATCH") { const hit = filt(all, params); hit.forEach((r) => Object.assign(r, body)); S.log.push(["db", "PATCH", table, body, hit.length]); return res(200, hit); }
  if (m === "DELETE") { const hit = filt(all, params); S.tables[table] = all.filter((r) => !hit.includes(r)); return res(200, hit); }
  return res(405, {});
}

// ---------- Google Calendar ----------
function gcal(url, init) {
  const u = new URL(url); const m = init.method || "GET"; const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
  if (u.hostname === "oauth2.googleapis.com") return res(200, { access_token: "g", expires_in: 3600 });
  const t = (x) => Date.parse(x.dateTime || `${x.date}T00:00:00-03:00`);
  if (u.pathname.endsWith("/freeBusy")) {
    if (S.failFreeBusy) return res(500, {});
    const busy = Object.values(S.events).filter((e) => e.transparency !== "transparent" && e.start.dateTime).map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));
    return res(200, { calendars: { primary: { busy } } });
  }
  let r;
  if ((r = u.pathname.match(/\/events\/([^/]+)$/)) && m === "PATCH") {
    if (S.failCalendarPatch) return res(500, {});
    const e = S.events[decodeURIComponent(r[1])]; if (!e) return res(404, {});
    Object.assign(e, body); S.log.push(["gcal", "PATCH", e.id, body]); return res(200, e);
  }
  if ((r = u.pathname.match(/\/events\/([^/]+)$/)) && m === "DELETE") {
    const id = decodeURIComponent(r[1]); if (!S.events[id]) return res(404, {});
    delete S.events[id]; S.log.push(["gcal", "DELETE", id]); return { ok: true, status: 204, json: async () => null, text: async () => "" };
  }
  if ((r = u.pathname.match(/\/events\/([^/]+)$/)) && m === "GET") {
    const e = S.events[decodeURIComponent(r[1])]; return e ? res(200, JSON.parse(JSON.stringify(e))) : res(404, {});
  }
  if (u.pathname.endsWith("/events") && m === "POST") {
    if (S.failCalendarCreate) return res(500, {});
    const id = "ev" + seq++; S.events[id] = { id, ...body }; S.log.push(["gcal", "CREATE", id, body]); return res(200, S.events[id]);
  }
  if (u.pathname.endsWith("/events")) {
    // Paginación real: maxResults y pageToken = índice.
    const a = Date.parse(u.searchParams.get("timeMin")), b = Date.parse(u.searchParams.get("timeMax"));
    const q = (u.searchParams.get("q") || "").toLowerCase();
    const all = Object.values(S.events).filter((e) => t(e.start) < b && t(e.end) > a && (!q || `${e.summary} ${e.description || ""}`.toLowerCase().includes(q)))
      .sort((x, y) => t(x.start) - t(y.start));
    const max = Math.min(2500, +u.searchParams.get("maxResults") || 250);
    const start = +(u.searchParams.get("pageToken") || 0);
    const items = all.slice(start, start + max).map((e) => JSON.parse(JSON.stringify(e)));
    return res(200, { items, ...(start + max < all.length ? { nextPageToken: String(start + max) } : {}) });
  }
  return res(404, {});
}

global.fetch = async (url, init = {}) => {
  url = String(url); init.headers = init.headers || {};
  if (url.includes("api.notion.com")) { if (S.notion429 && S.notion429-- > 0) return { ok: false, status: 429, headers: { get: (h) => (/retry-after/i.test(h) ? "0" : null) }, json: async () => ({}), text: async () => "" }; return notion(url, init); }
  if (url.includes("supabase.co")) return supa(url, init);
  if (url.includes("googleapis.com")) return gcal(url, init);
  if (url.includes("api.resend.com")) { if (S.failMail) return res(500, {}); const b = JSON.parse(init.body); S.mails.push(b); return res(200, {}); }
  if (S.extraFetch) { const r = await S.extraFetch(url, init); if (r) return r; }
  throw new Error("Red bloqueada en la simulación: " + url);
};
Object.assign(process.env, { NOTION_TOKEN: "x", SUPABASE_SERVICE_ROLE_KEY: "x", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x", RESEND_API_KEY: "x", SUPABASE_URL: "https://sim.supabase.co" });
module.exports = { S, page, title, sel, relp, date, dayAR, uid };
