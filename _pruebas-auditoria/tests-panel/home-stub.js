// Inicio del panel (admin-home.js) en el DOM mínimo, con Supabase y ZG PASS de mentira.
const path = require("path");
const { load } = require("./dom");
const WEB = path.join(__dirname, "../panel/ZECHE_GRUV_Web");
function chain(result) {
  const c = { select: () => c, eq: () => c, gte: () => c, order: () => c, limit: () => c, single: () => c, then: (ok, ko) => Promise.resolve(result).then(ok, ko) };
  return c;
}
function home({ releases = [], ingresos }) {
  const P = {
    me: { display_name: "Zeche" },
    showPanel() {}, openTab() {}, showProfile() {},
    db: {
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
      from: (t) => chain(t === "releases" ? { data: releases } : { data: [] }),
    },
  };
  const calls = { ingresos: 0 };
  const fetch = async (url) => {
    if (/admin-ingresos/.test(url)) { calls.ingresos++; return ingresos(calls.ingresos); }
    return { ok: false, json: async () => ({}) };
  };
  const env = load([path.join(WEB, "pass/ticket.js"), process.env.HOME_FILE || path.join(WEB, "portal/admin-home.js")], { fetch, extraWindow: { ZGPortal: P, ZGPassAdmin: { call: async () => ({ events: [] }) } } });
  return { ...env, calls };
}
module.exports = { home };
