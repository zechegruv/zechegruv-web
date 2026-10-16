// Arma y manda un lanzamiento del portal a ZIL, paso a paso y retomable:
// cada id que devuelve ZIL se guarda en el lanzamiento (zil_*), así si un
// paso falla se corrige y se vuelve a tocar "Publicar" sin duplicar nada.
// Nunca publica solo: lo llama el administrador desde el panel.
const { SUPABASE_URL, db, serviceKey } = require("./pass");
const { client, idOf, listOf, norm, isDev, ZilError } = require("./zil");
const { _listSection } = require("../portal-files");

const LABEL_NAME = "ZECHE GRUV";
const ROLE_MAP = { "Main Artist": ["primary"], Featuring: ["featuring"], Composer: ["composer"], Lyricist: ["lyricist"], Songwriter: ["composer", "lyricist"], Producer: ["producer"], Remixer: ["remixer"] };
const LANG = { espanol: "Spanish", castellano: "Spanish", ingles: "English", english: "English", portugues: "Portuguese", italiano: "Italian", frances: "French" };
const WORLD = /todo el mundo|mundial|world|global|todos/i;

// Sesión del sello: la cuenta del token puede tener varias; se usa
// ZIL_LABEL_EMAIL si está cargada, o la única cuenta de tipo sello.
async function labelSession() {
  const z = client();
  const users = listOf(await z.call("Leer cuentas", "GET", "/users?role=LABEL"));
  const wanted = (process.env.ZIL_LABEL_EMAIL || "").trim().toLowerCase();
  const label = wanted ? users.find((u) => String(u.email || "").toLowerCase() === wanted) : (users.length === 1 ? users[0] : null);
  if (!label) {
    if (!users.length) return z; // el token ya es del sello
    throw new ZilError("Elegir el sello", "varias cuentas", `cargá ZIL_LABEL_EMAIL en Netlify con una de: ${users.map((u) => u.email).join(", ")}`);
  }
  await z.loginAs(label.email);
  return z;
}

async function coverLink(path) {
  if (!path) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/covers/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 14 * 86400 }),
  }).catch(() => null);
  const data = res && res.ok ? await res.json().catch(() => null) : null;
  const signed = data && (data.signedURL || data.signedUrl);
  return signed ? `${SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
}

// Link de descarga recién pedido a OneDrive de cada máster elegido.
async function masterLinks(shareLink, names) {
  if (!shareLink) return {};
  const sec = await _listSection(shareLink, "Masters");
  const files = [...(sec.files || []), ...(sec.groups || []).flatMap((g) => g.files || [])];
  const out = {};
  for (const n of names) {
    // Solo coincidencia exacta: en Masters conviven "Master", "Master 2",
    // "Master 3"… y la versión la elige el artista; nunca se adivina.
    const f = files.find((x) => x.name === n) || files.find((x) => norm(x.name) === norm(n));
    if (f && f.url) out[n] = f.url;
  }
  return out;
}

// Junta todo y revisa que no falte nada. No escribe nada en ZIL.
async function prepare(releaseId) {
  const r = await db(`releases?id=eq.${releaseId}&select=*,profiles(id,display_name,full_name,email,apple_id,spotify_artist_id)`);
  const rel = r.ok && r.data[0];
  if (!rel) throw new Error("No encontramos el lanzamiento.");
  const owner = rel.profiles || {};
  const priv = (await db(`artist_private?profile_id=eq.${rel.artist_id}&select=*`)).data || [];
  const p = priv[0] || {};
  const tracks = Array.isArray(rel.tracks) ? rel.tracks : [];
  const problems = [];
  if (!rel.title) problems.push("Falta el título del lanzamiento.");
  if (!rel.release_date) problems.push("Falta la fecha de salida.");
  if (!rel.cover_link) problems.push("Falta la portada.");
  if (!tracks.length) problems.push("No tiene canciones.");
  tracks.forEach((t, i) => {
    if (!t.title) problems.push(`Canción ${i + 1}: falta el título.`);
    if (!t.master) problems.push(`Canción ${i + 1}: falta elegir el máster.`);
    const s = (t.credits || []).filter((c) => c.split !== "" && c.split != null).reduce((a, c) => a + Number(c.split || 0), 0);
    if (s && Math.abs(s - 100) > 0.01) problems.push(`Canción ${i + 1}: los splits suman ${s}% (tienen que sumar 100).`);
  });
  const links = await masterLinks(p.onedrive_edit_link || p.onedrive_link, tracks.map((t) => t.master).filter(Boolean)).catch(() => ({}));
  tracks.forEach((t, i) => { if (t.master && !links[t.master]) problems.push(`Canción ${i + 1}: no encontramos «${t.master}» en la carpeta Masters.`); });
  const cover = await coverLink(rel.cover_link);
  if (rel.cover_link && !cover) problems.push("No pudimos generar el link de la portada.");
  return { rel, owner, priv: p, tracks, links, cover, problems };
}

async function genreCode(z, text) {
  const list = listOf(await z.call("Leer géneros", "GET", "/genres"));
  const want = norm(text);
  const opts = list.map((g) => (typeof g === "string" ? { code: g, name: g } : { code: g.code || g.id || g.value || g._id || g.key, name: g.name || g.label || g.title || g.code || "" }));
  const hit = opts.find((g) => norm(g.code) === want || norm(g.name) === want) || opts.find((g) => norm(g.name).includes(want) || want.includes(norm(g.name)) && norm(g.name).length > 2);
  return { code: hit ? hit.code : null, options: opts.slice(0, 80).map((g) => `${g.name} (${g.code})`) };
}

async function allDsps(z) {
  return listOf(await z.call("Leer tiendas", "GET", "/dsps")).map((d) => (typeof d === "string" ? d : d.code || d.id || d.key || d.name)).filter(Boolean);
}

async function guestId(z, name, cache) {
  const key = norm(name);
  if (!key) return null;
  if (!cache.list) cache.list = listOf(await z.call("Leer invitados", "GET", "/guestArtists"));
  const found = cache.list.find((g) => norm(g.artisticName || g.name) === key);
  if (found) return idOf(found);
  const created = await z.call(`Crear artista invitado «${name}»`, "POST", "/guestArtists", { artisticName: name, isGuest: true });
  const id = idOf(created);
  if (!id) throw new ZilError(`Crear artista invitado «${name}»`, "sin id", "la respuesta no trajo id");
  cache.list.push({ artisticName: name, _id: id });
  return id;
}

async function save(id, fields) {
  await db(`releases?id=eq.${id}`, { method: "PATCH", body: fields });
}

async function publish(releaseId) {
  const prep = await prepare(releaseId);
  if (prep.problems.length) return { ok: false, step: "Revisión", problems: prep.problems };
  const { rel, owner, priv, tracks, links, cover } = prep;
  const progress = Object.assign({}, rel.zil_status && rel.zil_status.progress);
  const note = (step) => save(rel.id, { zil_status: Object.assign({}, rel.zil_status, { progress, step, at: new Date().toISOString() }) });
  const z = await labelSession();

  // 1. Artista principal en ZIL (se crea una sola vez y se guarda).
  let mainId = priv.zil_artist_id;
  if (!mainId) {
    const created = await z.call("Crear artista principal", "POST", "/artists", {
      artisticName: owner.display_name || owner.full_name, email: owner.email, fullName: owner.full_name || owner.display_name,
      appleId: owner.apple_id || undefined, newSpotifyUri: !owner.spotify_artist_id,
    });
    mainId = idOf(created);
    if (!mainId) throw new ZilError("Crear artista principal", "sin id", "la respuesta no trajo id");
    await db(`artist_private?profile_id=eq.${rel.artist_id}`, { method: "PATCH", body: { zil_artist_id: mainId } });
  }

  // 2. Ids de todos los que figuran en los créditos.
  const ownerNames = [owner.display_name, owner.full_name].map(norm).filter(Boolean);
  const cache = {};
  const idFor = async (c) => {
    if ((c.email && owner.email && c.email.toLowerCase() === owner.email.toLowerCase()) || ownerNames.includes(norm(c.artist_name)) || ownerNames.includes(norm(c.full_name))) return mainId;
    return guestId(z, c.artist_name || c.full_name, cache);
  };
  const trackArtists = [];
  for (const t of tracks) {
    const list = [];
    for (const c of t.credits || []) {
      const roles = [...new Set((c.roles || []).flatMap((r) => ROLE_MAP[r] || []))];
      if (!roles.length && c.split === "") continue;
      list.push({ id: await idFor(c), roles, split: c.split, label: (c.roles || []).join(", ") });
    }
    if (!list.some((a) => a.id === mainId && a.roles.includes("primary"))) list.unshift({ id: mainId, roles: ["primary"], split: "" });
    trackArtists.push(list);
  }

  // 3. Proyecto y lanzamiento (borrador).
  if (!rel.zil_album_id) {
    const genre = await genreCode(z, rel.genre);
    if (!genre.code) return { ok: false, step: "Género", problems: [`El género «${rel.genre}» no existe en ZIL. Cambialo por uno de estos: ${genre.options.join(", ")}`] };
    const year = Number(String(rel.release_date).slice(0, 4));
    const featuring = trackArtists.flat().filter((a) => a.roles.includes("featuring")).map((a) => a.id);
    const album = {
      fantasyName: rel.title, releaseDate: rel.release_date, saleStartDate: rel.release_date,
      dsps: await allDsps(z), coverUrl: cover, coverUrlThumbnail: cover,
      artists: [{ artist: mainId, roles: ["primary"] }, ...[...new Set(featuring)].filter((id) => id !== mainId).map((id) => ({ artist: id, roles: ["featuring"] }))],
      labelName: LABEL_NAME, variousArtists: false, pLineText: `${LABEL_NAME} ${year}`, cLineText: `${LABEL_NAME} ${year}`, pLineYear: year, cLineYear: year,
      genre: genre.code, excludeTerritories: [], status: "draft",
    };
    if (rel.territory && !WORLD.test(rel.territory)) album.albumTerritories = rel.territory.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (rel.upc) album.upc = rel.upc;

    let projectId = rel.zil_project_id;
    if (!projectId) {
      const proj = await z.call("Crear proyecto", "POST", "/projects", { title: `${owner.display_name || owner.full_name} — ${rel.title}`, artist: mainId, album });
      projectId = idOf(proj && (proj.project || proj));
      if (!projectId) throw new ZilError("Crear proyecto", "sin id", "la respuesta no trajo id");
      await save(rel.id, { zil_project_id: projectId });
      rel.zil_project_id = projectId;
      const albums = listOf((proj && (proj.albums || (proj.project && proj.project.albums) || (proj.data && proj.data.albums))) || []);
      const fromProj = albums.length ? idOf(albums[0]) : idOf(proj.album);
      if (fromProj) rel.zil_album_id = fromProj;
    }
    if (!rel.zil_album_id) {
      const detail = await z.call("Leer proyecto", "GET", `/projects/${projectId}/`);
      const existing = listOf(detail.albums || (detail.project && detail.project.albums) || (detail.data && detail.data.albums) || []).find((a) => norm(a.fantasyName) === norm(rel.title));
      rel.zil_album_id = existing ? idOf(existing) : idOf(await z.call("Crear lanzamiento", "POST", `/projects/${projectId}/albums`, album));
      if (!rel.zil_album_id) throw new ZilError("Crear lanzamiento", "sin id", "la respuesta no trajo id");
    }
    await save(rel.id, { zil_album_id: rel.zil_album_id });
  }
  const projectId = rel.zil_project_id, albumId = rel.zil_album_id;

  // 4. Canciones, con el máster recién pedido a OneDrive.
  if (!progress.tracks) {
    const body = tracks.map((t, i) => {
      const lang = LANG[norm(t.language || rel.language).split(" ")[0]];
      const tr = {
        position: i + 1, title: t.title, trackUrl: links[t.master], explicit: !!t.explicit, cover: !!t.is_cover, downloadRights: true,
        artists: trackArtists[i].filter((a) => a.roles.length).map((a) => ({ artist: a.id, roles: a.roles })),
      };
      if (t.isrc) tr.isrc = t.isrc;
      if (t.version) tr.version = t.version;
      if (lang) tr.trackLanguage = lang;
      return tr;
    });
    const res = await z.call("Subir canciones", "POST", `/projects/${projectId}/albums/${albumId}/tracks`, body);
    let ids = listOf(res).map(idOf).filter(Boolean);
    if (ids.length !== tracks.length) ids = [];
    progress.trackIds = ids;
    progress.tracks = true;
    await note("Canciones subidas");
  }

  // 5. Splits (solo si el artista cargó porcentajes).
  const hasSplits = tracks.some((t) => (t.credits || []).some((c) => c.split !== "" && c.split != null));
  if (hasSplits && !progress.splits) {
    if (!progress.trackIds || progress.trackIds.length !== tracks.length) {
      return { ok: false, step: "Splits", problems: ["ZIL no devolvió los ids de las canciones, así que los splits hay que cargarlos a mano en ZIL antes de publicar. Avisame y lo ajusto."] };
    }
    const splits = [];
    tracks.forEach((t, i) => trackArtists[i].forEach((a) => {
      if (a.split === "" || a.split == null) return;
      splits.push({ artist: a.id, shareArtist: Number(a.split), advancedPayment: 0, admin: a.id === mainId, note: a.label || "", track: progress.trackIds[i] });
    }));
    await z.call("Cargar splits", "POST", `/splits/${albumId}`, { isByTrack: true, splits });
    progress.splits = true;
    await note("Splits cargados");
  }

  // 6. Enviar a revisión de las tiendas.
  await z.call("Enviar a las tiendas", "POST", `/projects/${projectId}/albums/${albumId}/publish`, {});
  await save(rel.id, { status: "loaded", sent_to_stores_at: new Date().toISOString(), zil_status: { progress: Object.assign(progress, { published: true }), step: "Enviado a las tiendas", dev: isDev(), at: new Date().toISOString() } });
  return { ok: true, dev: isDev() };
}

module.exports = { prepare, publish, labelSession, genreCode, allDsps };
