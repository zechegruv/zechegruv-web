// DOM mínimo para correr los scripts del panel (admin-avisos.js, admin-home.js)
// en Node, sin navegador. Solo lo que esos archivos usan.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class ClassList {
  constructor(n) { this.n = n; }
  get set() { return new Set(String(this.n.className || "").split(/\s+/).filter(Boolean)); }
  add(...c) { const s = this.set; c.forEach((x) => s.add(x)); this.n.className = [...s].join(" "); }
  remove(...c) { const s = this.set; c.forEach((x) => s.delete(x)); this.n.className = [...s].join(" "); }
  toggle(c, on) { const has = this.set.has(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; }
  contains(c) { return this.set.has(c); }
}
class Node {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null; this.className = ""; this._text = ""; this.attrs = {}; this.style = { setProperty() {} }; this.listeners = {}; this.hidden = false; this.classList = new ClassList(this); this.dataset = {}; }
  get textContent() { return this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html || ""; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === global.__body; }
  get lastChild() { return this.children[this.children.length - 1]; }
  get offsetWidth() { return 10; } get offsetHeight() { return 10; }
  append(...xs) { xs.forEach((x) => { if (x === "" || x == null) return; if (typeof x === "string") x = Object.assign(new Node("#text"), { _text: x }); if (x.parent) x.remove(); x.parent = this; this.children.push(x); }); }
  prepend(...xs) { xs.reverse().forEach((x) => { if (x.parent) x.remove(); x.parent = this; this.children.unshift(x); }); }
  replaceChildren(...xs) { this.children.forEach((c) => (c.parent = null)); this.children = []; this._text = ""; this.append(...xs); }
  replaceWith(x) { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); if (x.parent) x.remove(); p.children[i] = x; x.parent = p; this.parent = null; }
  after(x) { const p = this.parent; const i = p.children.indexOf(this); if (x.parent) x.remove(); p.children.splice(i + 1, 0, x); x.parent = p; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { return Promise.all((this.listeners.click || []).map((f) => f({ preventDefault() {} }))); }
  animate() { return { finished: Promise.resolve() }; }
  focus() {} scrollIntoView() {}
  all(pred, out = []) { this.children.forEach((c) => { if (typeof c !== "string") { if (pred(c)) out.push(c); c.all(pred, out); } }); return out; }
  byClass(c) { return this.all((n) => n.classList.contains(c)); }
  querySelector(sel) { const m = sel.match(/^\.([\w-]+)$/); return m ? this.byClass(m[1])[0] || null : null; }
}

function load(files, { fetch, extraWindow = {} } = {}) {
  const body = new Node("body");
  global.__body = body;
  const home = new Node("div"); home.id = "panel-home"; body.append(home);
  const document = {
    body, hidden: false, documentElement: new Node("html"),
    createElement: (t) => new Node(t),
    createTextNode: (t) => Object.assign(new Node("#text"), { _text: String(t) }),
    getElementById: (id) => (id === "panel-home" ? home : null),
    querySelector: (sel) => (sel === ".zn-body" ? body.byClass("zn-body")[0] : null),
    addEventListener() {}, activeElement: null,
  };
  const window = { matchMedia: () => ({ matches: true }), ...extraWindow };
  const ctx = { window, document, fetch, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: (f) => setTimeout(f, 0), navigator: { platform: "Linux", userAgent: "node" }, performance: { now: () => Date.now() }, Intl, Date, Promise, JSON, Math, Set, Map, Array, Object, String, Number, URLSearchParams, location: { search: "", pathname: "/", hash: "" }, history: { replaceState() {} }, Audio: function () {} };
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) }));
  return { window, document, body, home, Node };
}
module.exports = { load, Node };
