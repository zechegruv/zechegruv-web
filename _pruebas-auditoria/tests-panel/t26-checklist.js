// Bug 26: dos clics rápidos en el checklist de modificaciones pierden un tilde
// (cada pedido lee la lista, le cambia una cosa y la escribe entera).
const H = require("./h");
const { S, F, check, done, setup, adminEvent, parse } = H;
setup();
const fn = F("portal-reviews");
const ID = "e2600000-0000-4000-8000-000000000001";
const marks = [{ t: 10, text: "voz más arriba" }, { t: 42, text: "menos reverb" }, { t: 80, text: "bajo" }];
const reset = () => { S.tables.song_approvals = [{ id: ID, song_id: "s", kind: "mezcla", action: "cambios", source: "artist", marks, resolved: [] }]; };
// Lo que hace la función de 030_panel.sql (en una sola operación).
const rpc = {
  zg_toggle_resolved({ p_id, p_i, p_done }) {
    const row = S.tables.song_approvals.find((r) => r.id === p_id);
    if (!row) return null;
    const set = new Set((row.resolved || []).filter((n) => n !== p_i));
    if (p_done) set.add(p_i);
    row.resolved = [...set].filter((n) => n >= 0 && n < row.marks.length).sort((a, b) => a - b);
    return row.resolved;
  },
};
const tick = (i, d = true) => fn.handler(adminEvent("POST", { resolve: { id: ID, i, done: d } })).then(parse);
(async () => {
  reset(); S.rpc = rpc;
  const rs = await Promise.all([tick(0), tick(1), tick(2)]);
  check("tres tildes a la vez: quedan los tres", JSON.stringify(S.tables.song_approvals[0].resolved) === "[0,1,2]", S.tables.song_approvals[0].resolved);
  check("cada respuesta trae la lista guardada", rs.every((r) => r.status === 200 && Array.isArray(r.body.resolved)), rs);
  const un = await tick(1, false);
  check("destildar uno deja los otros", JSON.stringify(un.body.resolved) === "[0,2]", un.body);

  // Sin la función nueva (todavía no se corrió 030): sigue andando como antes.
  reset(); S.rpc = undefined;
  const r = await tick(2);
  check("sin 030 corrido igual tilda (como antes)", r.status === 200 && JSON.stringify(r.body.resolved) === "[2]", r);
  done("t26 checklist");
})().catch((e) => { console.error(e); process.exitCode = 1; });
