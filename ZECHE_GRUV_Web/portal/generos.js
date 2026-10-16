// ZECHE GRUV — Portal: buscador de géneros de la ficha de lanzamiento.
// Usa la lista oficial de ZIL (netlify/functions/zil-genres.js): el artista
// escribe y aparecen los más parecidos; entiende palabras en castellano
// (reggaetón, cumbia, folklore…) aunque ZIL los tenga en inglés. El valor que
// queda en el campo es el nombre exacto de ZIL, así se carga sin errores.
(() => {
  const input = document.getElementById("rGenre");
  if (!input) return;
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.placeholder = "Escribí y elegí de la lista (ej: pop, trap, cumbia)";

  const wrap = document.createElement("div");
  wrap.className = "genre-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.append(input);
  const list = document.createElement("ul");
  list.className = "genre-list";
  list.id = "genreResults";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(list);
  input.setAttribute("aria-controls", list.id);
  const hint = document.createElement("p");
  hint.className = "hint genre-hint";
  wrap.after(hint);

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  // Palabras en castellano -> cómo las llama ZIL.
  const SYN = {
    reggaeton: "latin urban reggaeton", regueton: "latin urban reggaeton", urbano: "latin urban", trap: "hip hop rap trap",
    rap: "hip hop rap", cumbia: "latin cumbia tropical", rkt: "latin urban cumbia", folklore: "folk latin", folclore: "folk latin",
    electronica: "electronic dance", tango: "latin tango", salsa: "latin salsa tropical", bachata: "latin bachata tropical",
    balada: "pop ballad", cantautor: "singer songwriter", romantica: "latin pop ballad", rock: "rock", nacional: "latin rock",
    alternativo: "alternative", jazz: "jazz", soul: "soul r and b", rnb: "r and b", "r b": "r and b", funk: "funk", gospel: "gospel christian",
    cristiana: "christian gospel", infantil: "children", clasica: "classical", instrumental: "instrumental", lofi: "lo fi chill", "lo fi": "lo fi chill",
  };

  let genres = null, loading = null, active = -1, shown = [];

  async function load() {
    if (genres) return genres;
    if (!loading) loading = (async () => {
      try {
        const { data: { session } } = await window.ZGPortal.db.auth.getSession();
        const res = await fetch("/.netlify/functions/zil-genres", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await res.json();
        genres = (data.genres || []).map((g) => ({ ...g, key: norm(g.name) }));
      } catch (err) { genres = []; }
      return genres;
    })();
    return loading;
  }

  function search(q) {
    const nq = norm(q);
    if (!nq) return genres.slice(0, 30);
    const terms = [...new Set((nq + " " + Object.entries(SYN).filter(([k]) => nq.includes(k)).map(([, v]) => v).join(" ")).split(" ").filter((w) => w.length > 1))];
    return genres
      .map((g) => {
        let s = 0;
        if (g.key === nq) s += 100;
        if (g.key.startsWith(nq)) s += 40;
        if (g.key.includes(nq)) s += 25;
        terms.forEach((w) => { if (g.key.split(" ").some((x) => x.startsWith(w))) s += 8; else if (g.key.includes(w)) s += 4; });
        return { g, s: s - g.key.length / 100 };
      })
      .filter((x) => x.s > 1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.g);
  }

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  function paint() {
    list.innerHTML = shown.length
      ? shown.map((g, i) => `<li role="option" id="genre-opt-${i}" data-i="${i}" class="${i === active ? "is-active" : ""}" aria-selected="${i === active}">${esc(g.name)}</li>`).join("")
      : `<li class="genre-empty">No hay un género así en ZIL. Probá con otra palabra.</li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `genre-opt-${active}`); else input.removeAttribute("aria-activedescendant");
  }

  function closeList() { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; }

  function check() {
    if (!genres || !genres.length) { hint.textContent = ""; return; }
    const v = input.value.trim();
    const ok = !v || genres.some((g) => g.key === norm(v));
    hint.textContent = ok ? "" : "Elegí un género de la lista para que la distribuidora lo acepte.";
    hint.classList.toggle("is-off", !ok);
  }

  function pick(g) {
    input.value = g.name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    closeList();
    check();
  }

  async function update() {
    await load();
    if (!genres.length) return;
    shown = search(input.value);
    active = -1;
    paint();
  }

  input.addEventListener("focus", update);
  input.addEventListener("input", (e) => { if (e.isTrusted) update(); });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !shown.length) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, shown.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(shown[active]); e.preventDefault(); }
    else if (e.key === "Escape") closeList();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) { e.preventDefault(); pick(shown[+li.dataset.i]); }
  });
  input.addEventListener("blur", () => setTimeout(() => { closeList(); check(); }, 120));

  // Para la validación de la ficha: ¿el género es uno de ZIL?
  window.ZGGenres = {
    isValid: (v) => !genres || !genres.length || genres.some((g) => g.key === norm(v)),
    refresh: () => { load().then(check); },
  };
})();
