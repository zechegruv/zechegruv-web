// Bug 26 (navegador): los tildes del checklist se mandan de a uno, en orden.
const path = require("path");
const { load, Node } = require("./dom");
const { check, done } = require("./h");
const FILE = process.env.AVISOS_FILE || path.join(__dirname, "../panel/ZECHE_GRUV_Web/portal/admin-avisos.js");
const review = { id: "r1", profile_id: "p1", artist: "Pazz", song_id: "s1", song: "Faro", kind: "mezcla", action: "cambios", final: false, notes: 2, marks: [{ t: 10, text: "voz" }, { t: 20, text: "bajo" }], resolved: [], note: null, at: new Date().toISOString() };
let inFlight = 0, peak = 0;
const sent = [];
const fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (/portal-reviews/.test(url) && body && body.resolve) {
    inFlight++; peak = Math.max(peak, inFlight); sent.push(body.resolve.i);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return { ok: true, json: async () => ({ ok: true, resolved: [] }) };
  }
  if (/portal-reviews/.test(url)) return { ok: true, json: async () => ({ reviews: [review] }) };
  if (/admin-tasks/.test(url)) return { ok: true, json: async () => (body && body.sync ? { delivered: [] } : { connected: true, tasks: [] }) };
  return { ok: false, json: async () => ({}) };
};
const P = { db: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } };
const { window, body } = load([FILE], { fetch, extraWindow: { ZGPortal: P } });
(async () => {
  const slot = new Node("div"); body.append(slot);
  window.ZGAvisos.mount(slot);
  await new Promise((r) => setTimeout(r, 50));
  const boxes = body.byClass("zc-check");
  check("se dibuja el checklist", boxes.length === 2, boxes.length);
  await Promise.all([boxes[0].click(), boxes[1].click()]);
  check("los dos tildes se mandaron", sent.join(",") === "0,1", sent);
  check("de a uno (nunca dos a la vez)", peak === 1, peak);
  done("t26b checklist en el navegador");
})().catch((e) => { console.error(e); process.exitCode = 1; });
