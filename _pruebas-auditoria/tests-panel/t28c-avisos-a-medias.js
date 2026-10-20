// Bug 28 (navegador): si Avisos vuelve "a medias" (Notion no respondió), el
// Inicio deja lo que ya mostraba en vez de repintar con avisos viejos.
const path = require("path");
const { load, Node } = require("./dom");
const { check, done } = require("./h");
const FILE = process.env.AVISOS_FILE || path.join(__dirname, "../panel/ZECHE_GRUV_Web/portal/admin-avisos.js");
const r1 = { id: "r1", profile_id: "p1", artist: "Pazz", song_id: "s1", song: "Faro", kind: "mezcla", action: "aprobada", final: false, notes: 0, marks: [], resolved: [], note: null, at: new Date().toISOString() };
const viejo = { ...r1, id: "r0", song_id: "s0", song: "Aviso viejo" };
let calls = 0;
const fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (/portal-reviews/.test(url)) { calls++; return { ok: true, json: async () => (calls === 1 ? { reviews: [r1] } : { reviews: [viejo, r1], partial: true }) }; }
  if (/admin-tasks/.test(url)) return { ok: true, json: async () => (body && body.sync ? { delivered: [{ song: "Faro", kind: "mezcla", artist: "Pazz" }] } : { connected: true, tasks: [] }) };
  return { ok: false, json: async () => ({}) };
};
const P = { db: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } };
const { window, body } = load([FILE], { fetch, extraWindow: { ZGPortal: P } });
(async () => {
  const slot = new Node("div"); body.append(slot);
  window.ZGAvisos.mount(slot);
  await new Promise((r) => setTimeout(r, 80));
  check("se pidió Avisos dos veces (al abrir y después de la entrega automática)", calls === 2, calls);
  const texts = body.byClass("zn-text").map((n) => n.textContent);
  check("no aparece el aviso viejo de la respuesta a medias", !texts.some((t) => /Aviso viejo/.test(t)), texts);
  check("sigue el aviso que ya estaba", texts.some((t) => /Faro/.test(t)), texts);
  done("t28c avisos a medias");
})().catch((e) => { console.error(e); process.exitCode = 1; });
