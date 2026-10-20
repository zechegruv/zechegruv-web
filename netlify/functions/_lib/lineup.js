// Line up de un evento → artistas del sello que tocan (pass_show_artists).
// Cuando se guarda el evento con su line up (los nombres, tal como se
// escriben en la página), cada nombre se busca entre los artistas del
// portal y los que coinciden quedan como "quién toca", solos:
//   · da igual mayúsculas, tildes, espacios o signos: "ROUSE BBY" = "Rouse Bby";
//   · se perdona una letra de diferencia (dos en nombres largos): "Rose Bby";
//   · los dúos y bandas se separan: "Bastian & Kaino", "Pazz y Maki",
//     "A x B", "A feat. B" → se busca cada uno (y el nombre entero).
// Si un nombre sale del line up, ese artista deja de figurar como que toca.
// Los que se tildaron a mano en "Carpetas" y nunca estuvieron en el line up
// no se tocan.
const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const parts = (name) => {
  const whole = norm(name);
  const split = String(name || "").split(/\s*(?:&|\+|,|\/|\by\b|\bx\b|\bfeat\.?|\bft\.?|\bcon\b)\s*/i).map(norm).filter(Boolean);
  return [...new Set([whole, ...split])].filter((p) => p.length >= 2);
};

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
const close = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && distance(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1));

// names: el line up. artists: perfiles [{ id, display_name, full_name }].
// Devuelve { ids, matched: [{ name, id, artist }], unmatched: [name] }.
function matchLineup(names, artists) {
  const pool = (artists || []).map((a) => ({ a, keys: [norm(a.display_name), norm(a.full_name)].filter((k) => k.length >= 2) }));
  const ids = new Set(), matched = [], unmatched = [];
  for (const name of names || []) {
    let hits = [];
    for (const p of parts(name)) {
      // Primero lo exacto; si no hay, lo parecido (y solo si hay uno solo).
      const exact = pool.filter((x) => x.keys.includes(p));
      const near = exact.length ? exact : pool.filter((x) => x.keys.some((k) => close(k, p)));
      if (near.length === 1 || exact.length) hits.push(...(exact.length ? exact : near));
    }
    hits = [...new Set(hits)];
    if (!hits.length) { unmatched.push(name); continue; }
    for (const h of hits) {
      if (!ids.has(h.a.id)) matched.push({ name, id: h.a.id, artist: h.a.display_name || h.a.full_name });
      ids.add(h.a.id);
    }
  }
  return { ids: [...ids], matched, unmatched };
}

// Sincroniza pass_show_artists de un evento con su line up.
// oldLineup: el line up que tenía antes de guardar (para saber a quién sacar).
// Devuelve { added, removed, matched, unmatched }.
async function syncFromLineup(ev, oldLineup) {
  const { db } = require("./pass");
  const prof = await db("profiles?role=eq.artist&select=id,display_name,full_name,active");
  const artists = ((prof.ok && prof.data) || []).filter((a) => a.active !== false);
  const now = matchLineup(ev.lineup || [], artists);
  const before = matchLineup(oldLineup || [], artists);
  const cur = await db(`pass_show_artists?event_id=eq.${ev.id}&select=profile_id`);
  const had = new Set(((cur.ok && cur.data) || []).map((r) => r.profile_id));
  const added = now.ids.filter((id) => !had.has(id));
  // Solo salen los que estaban por el line up viejo y ya no están en el nuevo.
  const removed = before.ids.filter((id) => had.has(id) && !now.ids.includes(id));
  if (removed.length) await db(`pass_show_artists?event_id=eq.${ev.id}&profile_id=in.(${removed.join(",")})`, { method: "DELETE" });
  if (added.length) await db("pass_show_artists?on_conflict=event_id,profile_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: added.map((id) => ({ event_id: ev.id, profile_id: id })) });
  return { added, removed, matched: now.matched, unmatched: now.unmatched };
}

module.exports = { matchLineup, syncFromLineup, _norm: norm };
