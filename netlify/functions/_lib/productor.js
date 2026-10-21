// Cuenta de Productor (supabase/036_productor.sql): solo seguimiento.
// ¿Este productor puede ver a este artista? Sí solo si el administrador se
// lo asignó, la cuenta del productor está activa y el artista también.
// Lo usan portal-songs.js y portal-files.js (las dos de solo lectura).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdstltihskdcartkmgii.supabase.co";

// Puede mirar como productor: la cuenta Productor (036) o un artista con
// "también es productor" prendido (037_productor_artista.sql).
const canProduce = (c) => !!c && c.active !== false && (c.role === "producer" || (c.role === "artist" && c.also_producer === true));

async function producerCanSee(caller, artistId, serviceKey) {
  if (!canProduce(caller)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(String(artistId || "")) || artistId === caller.id) return false;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const [link, artist] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/producer_artists?producer_id=eq.${caller.id}&artist_id=eq.${artistId}&select=artist_id`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${artistId}&select=id,role,active`, { headers }),
  ]);
  if (!link.ok || !artist.ok) return false;
  const [l, a] = await Promise.all([link.json().catch(() => []), artist.json().catch(() => [])]);
  return !!(l && l[0] && a && a[0] && a[0].role === "artist" && a[0].active !== false);
}

// Lo que el productor NO ve de cada canción: lo que dijo el artista
// (aprobó, pidió modificaciones, sus notas en el tiempo y notas de voz) y
// quién lo marcó. Ve la etapa, si la mezcla/master está en proceso,
// entregado o aprobado, y el audio para escucharlo.
function forProducer(song) {
  const d = song.delivery;
  return {
    id: song.id, title: song.title, feat: song.feat, stage: song.stage, step: song.step,
    done: song.done, release: song.release,
    delivery: d ? {
      kind: d.kind,
      // "cambios" (el artista pidió modificaciones) se ve como "en proceso":
      // es una charla entre el artista y Zeche.
      state: d.state === "cambios" ? "proceso" : d.state,
      file: d.state === "cambios" ? null : d.file,
      versions: d.versions || [],
    } : null,
  };
}

module.exports = { producerCanSee, forProducer, canProduce };
