// ZECHE GRUV — desplegables con la estética del portal.
// Reemplaza a la vista cada <select> por un botón + lista propia, sin tocar
// la lógica: el <select> original sigue ahí (oculto) con su valor y sus
// eventos "change", así el resto del código funciona igual. Se adapta solo
// a las opciones que se agregan o cambian después y a los valores que el
// código pone a mano (select.value = …). Con teclado: flechas, Enter, Esc.
(() => {
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const idxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  let open = null; // el desplegable abierto

  function close() {
    if (!open) return;
    open.wrap.classList.remove("is-open");
    open.btn.setAttribute("aria-expanded", "false");
    open = null;
  }

  function enhance(select) {
    if (select.dataset.zgSelect || select.multiple || select.hasAttribute("data-native")) return;
    select.dataset.zgSelect = "1";

    const wrap = document.createElement("div");
    wrap.className = "zg-select";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zg-select-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.className = "zg-select-label";
    const caret = document.createElement("span");
    caret.className = "zg-select-caret";
    caret.setAttribute("aria-hidden", "true");
    btn.append(label, caret);
    const list = document.createElement("ul");
    list.className = "zg-select-list";
    list.setAttribute("role", "listbox");
    select.parentNode.insertBefore(wrap, select);
    wrap.append(select, btn, list);
    select.classList.add("zg-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    // El <label for="…"> del select ahora enfoca el botón.
    if (select.id) document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach((l) => l.addEventListener("click", (e) => { e.preventDefault(); btn.focus(); }));

    let active = -1;
    function paint() {
      const opts = [...select.options];
      const cur = select.selectedIndex;
      label.textContent = cur >= 0 ? opts[cur].textContent : "";
      btn.disabled = select.disabled;
      wrap.hidden = select.hidden;
      list.replaceChildren(...opts.map((o, i) => {
        const li = document.createElement("li");
        li.className = `zg-select-opt${i === cur ? " is-selected" : ""}${o.disabled ? " is-disabled" : ""}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === cur ? "true" : "false");
        li.textContent = o.textContent;
        li.addEventListener("mousedown", (e) => e.preventDefault());
        li.addEventListener("click", () => { if (!o.disabled) choose(i); });
        return li;
      }));
    }
    function choose(i) {
      const changed = select.selectedIndex !== i;
      idxDesc.set.call(select, i);
      paint();
      close();
      btn.focus();
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    function highlight(i) {
      const items = [...list.children];
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach((li, k) => li.classList.toggle("is-active", k === active));
      items[active].scrollIntoView({ block: "nearest" });
    }
    function toggle(force) {
      const willOpen = force !== undefined ? force : !wrap.classList.contains("is-open");
      if (!willOpen) return close();
      close();
      paint();
      // Se abre hacia arriba si abajo no hay lugar.
      const r = btn.getBoundingClientRect();
      wrap.classList.toggle("opens-up", window.innerHeight - r.bottom < 240 && r.top > window.innerHeight - r.bottom);
      wrap.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      open = { wrap, btn };
      highlight(Math.max(0, select.selectedIndex));
    }

    btn.addEventListener("click", () => toggle());
    btn.addEventListener("keydown", (e) => {
      const isOpen = wrap.classList.contains("is-open");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen) return toggle(true);
        highlight(active + (e.key === "ArrowDown" ? 1 : -1));
      } else if ((e.key === "Enter" || e.key === " ") && isOpen) {
        e.preventDefault();
        if (active >= 0) choose(active);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        close();
      }
    });

    // Opciones que cambian después, o hidden/disabled que cambian.
    new MutationObserver(paint).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
    select.addEventListener("change", paint);
    // Valores que pone el código a mano.
    Object.defineProperty(select, "value", { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paint(); } });
    Object.defineProperty(select, "selectedIndex", { configurable: true, get() { return idxDesc.get.call(this); }, set(v) { idxDesc.set.call(this, v); paint(); } });
    paint();
  }

  document.addEventListener("click", (e) => { if (open && !open.wrap.contains(e.target)) close(); });
  window.addEventListener("resize", close);

  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === "SELECT") enhance(root);
    else root.querySelectorAll("select").forEach(enhance);
  };
  const start = () => {
    scan(document.body);
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
