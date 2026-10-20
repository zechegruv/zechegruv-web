// Bug 27: "Lo que viene" mostraba un lanzamiento del 6 de noviembre como 5 (leía la fecha como medianoche UTC).
const { home } = require("./home-stub");
const { check, done } = require("./h");
const ok = (body) => ({ ok: true, json: async () => body });
const { window, home: root } = home({ releases: [{ id: 1, title: "Faro", status: "loaded", release_date: "2026-11-06", profiles: { display_name: "Pazz" } }], ingresos: () => ok({ connected: true, month: "octubre", goal: 100, cobrado: 0, pendiente: 0, gastos: 0, neto: 0, pagos: 0 }) });
(async () => {
  window.ZGHome.open();
  await new Promise((r) => setTimeout(r, 60));
  const d = root.byClass("zh-date").map((n) => n.textContent);
  check("el lanzamiento del 2026-11-06 dice «Vie 6 nov»", d[0] === "Vie 6 nov", d);
  done("t27 fecha de Lo que viene");
})().catch((e) => { console.error(e); process.exitCode = 1; });
