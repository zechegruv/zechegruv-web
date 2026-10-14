// ZECHE GRUV — Reemplazo de Supabase SOLO para grabar el tour (modo demo).
// Durante la grabación, el pedido a supabase-js se responde con este archivo:
// el portal arranca con la sesión de "Artista Demo" y lee los datos de
// demo/datos-demo.js. Nada se guarda en ningún servidor: lo que se escriba
// durante el tour queda en la memoria de esa pestaña y se pierde al cerrarla.
(() => {
  const DEMO = window.__ZG_DEMO || { me: null, tables: {} };
  const tables = DEMO.tables;
  let seq = 1;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function query(table) {
    let rows = (tables[table] || []).slice();
    let single = false;
    let op = "select";
    let payload = null;
    const filters = [];
    const api = {
      select() { return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      neq(k, v) { filters.push((r) => r[k] !== v); return api; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return api; },
      is() { return api; }, gte() { return api; }, lte() { return api; }, ilike() { return api; },
      order() { return api; }, limit() { return api; }, range() { return api; },
      single() { single = true; return api; }, maybeSingle() { single = true; return api; },
      insert(v) { op = "insert"; payload = v; return api; },
      upsert(v) { op = "insert"; payload = v; return api; },
      update(v) { op = "update"; payload = v; return api; },
      delete() { op = "delete"; return api; },
      then(resolve, reject) {
        const list = tables[table] || (tables[table] = []);
        let data;
        if (op === "insert") {
          const items = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `demo-${table}-${seq++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
          list.unshift(...items);
          data = single ? items[0] : items;
        } else {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") { hit.forEach((r) => Object.assign(r, payload, { updated_at: new Date().toISOString() })); }
          if (op === "delete") { hit.forEach((r) => list.splice(list.indexOf(r), 1)); }
          data = single ? (hit[0] ? clone(hit[0]) : null) : clone(hit);
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  const session = DEMO.me ? { access_token: "demo", user: { id: DEMO.me.id, email: DEMO.me.email } } : null;
  window.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session } }),
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          signInWithPassword: async () => ({ data: null, error: { message: "Modo demo" } }),
          signOut: async () => ({ error: null }),
          verifyOtp: async () => ({ error: null }),
          updateUser: async () => ({ data: { user: session && session.user }, error: null }),
          resetPasswordForEmail: async () => ({ error: null }),
        },
        from: query,
        storage: { from() { return { upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }; } },
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
        removeChannel() {},
      };
    },
  };
})();
