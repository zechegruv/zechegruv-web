// Bug 38: no se puede reprogramar a una hora de hoy que ya pasó.
const H = require("./h");
const { S, page, title, sel, relp, date, dayAR, F, check, done, setup, adminEvent, parse } = H;
setup();
const { SONGS_DS } = F("portal-songs");
const fn = F("admin-reschedule");
const today = dayAR(new Date());
const song = page(SONGS_DS, "b3800000-0000-4000-8000-000000000001", { "Canción": title("Faro"), "Etapa actual": sel("Mix"), "Fecha de entrega": date(today) });
(async () => {
  S.log.length = 0;
  const r = parse(await fn.handler(adminEvent("POST", { task: song.id, kind: "entrega", date: today, time: "00:00", dur: 120 })));
  check("rechaza hoy a las 00:00 (ya pasó)", r.status === 400 && /ya pas/i.test(r.body.error || ""), r);
  check("no toca Notion ni el calendario", !S.log.some((l) => l[1] === "PATCH" || l[1] === "CREATE"), S.log);
  // El navegador solo ofrece desde ahora + 15 min (freeSlots, que usa admin-reprogramar.js).
  const now = new Date();
  const days = fn._freeSlots([], 60, now);
  const nowMin = (() => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split(":"); return +p[0] * 60 + +p[1]; })();
  const t0 = days.find((d) => d.today);
  check("los huecos de hoy arrancan después de ahora + 15 min", !t0 || t0.slots.every((s) => +s.slice(0, 2) * 60 + +s.slice(3) >= nowMin + 15), t0 && t0.slots[0]);
  done("t38 hora pasada");
})().catch((e) => { console.error(e); process.exitCode = 1; });
