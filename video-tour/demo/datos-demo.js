// ZECHE GRUV — Datos de DEMOSTRACIÓN para grabar el tour del portal.
// Nada de esto es real: ninguna canción, letra, archivo ni persona existe.
// Sirve para mostrar el portal del artista tal como funciona, sin datos
// privados de los artistas del sello y sin tocar Supabase, Notion ni OneDrive.
// Para cambiar lo que aparece en el video, editá este archivo.

const DAY = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const dayStr = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
// Próxima sesión: pasado mañana de 15 a 17 h (hora de Buenos Aires).
function nextSession() {
  const d = new Date(Date.now() + 2 * DAY);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
  return { start: `${ymd}T15:00:00-03:00`, end: `${ymd}T17:00:00-03:00` };
}

const AUDIO = "/__demo/audio-demo.mp3";

const ARTISTA = {
  id: "d0000000-0000-4000-8000-00000000a001",
  role: "artist",
  display_name: "Artista Demo",
  full_name: "Artista Demo",
  email: "demo@zechegruv.test",
  active: true,
  format: "album",
  avatar_url: null,
  spotify_artist_id: null,
};

const audioFile = (name, daysAgo, size = 8.4e6) => ({ name, url: AUDIO, created: iso(-daysAgo * DAY), modified: iso(-daysAgo * DAY), size });

const CANCIONES = {
  configured: true,
  next: { ...nextSession(), plan: [{ stage: "grabacion", song: "Ciudad dormida" }] },
  active: [
    {
      id: "demo-song-1", title: "Brisa de abril", feat: null, step: 3, stage: "mezcla", done: false, release: null,
      ready: true, review: null,
      delivery: { kind: "mezcla", state: "aprobar", file: audioFile("Brisa de abril - Mix v2.mp3", 0.2), review: null },
    },
    {
      id: "demo-song-2", title: "Marea alta", feat: null, step: 4, stage: "master", done: false, release: null,
      ready: false, review: null, delivery: { kind: "master", state: "proceso", file: null, review: null },
    },
    { id: "demo-song-3", title: "Ciudad dormida", feat: null, step: 2, stage: "grabacion", done: false, release: null, ready: false, review: null, delivery: null },
    { id: "demo-song-4", title: "Primer intento", feat: null, step: 1, stage: "produccion", done: false, release: null, ready: false, review: null, delivery: null },
    { id: "demo-song-5", title: "Fuego lento", feat: null, step: 0, stage: "estructura", done: false, release: null, ready: false, review: null, delivery: null },
  ],
  done: [
    {
      id: "demo-song-6", title: "Luz de enero", feat: null, step: -1, stage: "publicada", done: true, release: dayStr(-40),
      ready: false, review: { kind: "master", action: "aprobada", at: iso(-52 * DAY), marks: [] },
      delivery: { kind: "master", state: "aprobada", file: null, review: { action: "aprobada", at: iso(-52 * DAY), marks: [] } },
    },
  ],
};

const group = (name, files) => ({ name, files });
const ARCHIVOS = {
  referencias: { configured: true, canUpload: false, files: [], groups: [
    group("Brisa de abril", [audioFile("Brisa de abril - maqueta celu.mp3", 34, 3.1e6)]),
    group("Ciudad dormida", [audioFile("Ciudad dormida - idea guitarra.mp3", 12, 2.6e6), audioFile("Ciudad dormida - referencia ritmo.mp3", 11, 4.2e6)]),
  ] },
  letras: { configured: true, canUpload: false, files: [], groups: [] },
  exports: { configured: true, canUpload: false, files: [], groups: [
    group("Brisa de abril", [audioFile("Brisa de abril - Mix v1.mp3", 5), audioFile("Brisa de abril - Mix v2.mp3", 0.2)]),
    group("Marea alta", [audioFile("Marea alta - Rec voces.mp3", 9, 9.8e6)]),
  ] },
  masters: { configured: true, canUpload: false, files: [], groups: [
    group("Luz de enero", [audioFile("Luz de enero - Master.wav", 52, 48.2e6), audioFile("Luz de enero - Vivo.wav", 50, 47.9e6)]),
  ] },
  membresia: { configured: true, canUpload: false, files: [
    { name: "Membresía Álbum - Artista Demo.pdf", url: null, modified: iso(-60 * DAY), size: 2.1e5 },
  ], groups: [] },
};
// La versión para vivo se separa sola en Masters.
ARCHIVOS.masters.groups[0].files[1].tag = "vivo";

const LETRAS = [
  {
    id: "demo-lyric-1", artist_id: ARTISTA.id, title: "Ciudad dormida", updated_at: iso(-0.3 * DAY),
    sections: [
      { kind: "verso", text: "Las luces se apagan de a una\nla avenida respira lento\nyo sigo buscando una rima\nque se parezca a lo que siento" },
      { kind: "estribillo", text: "Ciudad dormida, no me despiertes\ntodavía queda una canción\nciudad dormida, si me encontrás\nguardame el último renglón" },
      { kind: "verso", text: "Tengo el celu lleno de ideas\nnotas de voz a medio terminar\nmañana vuelvo al estudio\na ver si esta vez la puedo cerrar" },
      { kind: "estribillo", text: "Ciudad dormida, no me despiertes\ntodavía queda una canción" },
    ],
  },
  {
    id: "demo-lyric-2", artist_id: ARTISTA.id, title: "Fuego lento", updated_at: iso(-4 * DAY),
    sections: [
      { kind: "verso", text: "Empezó como una chispa\nen una tarde cualquiera" },
      { kind: "estribillo", text: "Fuego lento, fuego lento\nque no se apague lo que tengo" },
    ],
  },
];

const LANZAMIENTOS = [
  {
    id: "demo-release-1", title: "Luz de enero", status: "published", release_type: "single", release_date: dayStr(-40),
    tracks: [{ title: "Luz de enero" }], artist_id: ARTISTA.id, updated_at: iso(-40 * DAY),
    profiles: { id: ARTISTA.id, display_name: ARTISTA.display_name, full_name: ARTISTA.full_name, email: ARTISTA.email },
  },
];

// Respuestas de las Netlify Functions que usa el portal del artista.
// Cualquier envío (aprobar, pedir cambios, subir) responde "ok" sin salir
// de la computadora: no hay forma de que el tour toque algo real.
function functionResponse(fn, method, body) {
  switch (fn) {
    case "portal-songs": return [200, CANCIONES];
    case "portal-files": return [200, ARCHIVOS[new URLSearchParams(body.query || "").get("section")] || { configured: true, files: [], groups: [] }];
    case "pass-events": return [200, { events: [] }];
    case "portal-shows": return [200, { shows: [] }];
    case "portal-review": return [200, { ok: true, saved: false, review: { action: (body.json || {}).action, note: (body.json || {}).note || null, marks: (body.json || {}).marks || [], at: new Date().toISOString() } }];
    default: return [200, { ok: true, demo: true }];
  }
}

module.exports = { ARTISTA, CANCIONES, ARCHIVOS, LETRAS, LANZAMIENTOS, functionResponse };
