// Supabase-js falso para las pruebas del navegador. Se sirve en lugar del CDN.
// Todo lo configura la prueba en window.__SB (antes de que cargue la página):
//   session:   { access_token, user: { id } } | null
//   profile:   fila de profiles (o función (id) => { data, error })
//   tables:    { tabla: [filas] }
//   fail:      { "tabla:op": { message } } para forzar errores
//   verifyOtpError, calls (registro de todo lo que se pidió)
(function () {
  const SB = (window.__SB = window.__SB || {});
  SB.calls = SB.calls || [];
  SB.tables = SB.tables || {};
  let seq = 1;
  const listeners = [];

  function run(q) {
    SB.calls.push(q);
    const key = `${q.table}:${q.op}`;
    if (SB.fail && SB.fail[key]) return { data: null, error: SB.fail[key] };
    if (q.table === "profiles" && q.op === "select" && SB.profile) {
      const p = typeof SB.profile === "function" ? SB.profile(q) : { data: SB.profile, error: null };
      return p;
    }
    const rows = (SB.tables[q.table] = SB.tables[q.table] || []);
    const match = (r) => q.filters.every(([c, v]) => String(r[c]) === String(v));
    if (q.op === "select") {
      const hit = rows.filter(match).map((r) => ({ ...r }));
      if (q.single) return hit[0] ? { data: hit[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (q.maybe) return { data: hit[0] || null, error: null };
      return { data: hit, error: null };
    }
    if (q.op === "insert") {
      const row = { id: `row-${seq++}`, updated_at: new Date().toISOString(), created_at: new Date().toISOString(), ...q.payload };
      rows.push(row);
      return { data: q.single ? { ...row } : [row], error: null };
    }
    if (q.op === "update") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, q.payload, { updated_at: new Date().toISOString() }));
      return { data: q.single ? (hit[0] ? { ...hit[0] } : null) : hit, error: null };
    }
    if (q.op === "upsert") { rows.push({ ...q.payload }); return { data: null, error: null }; }
    if (q.op === "delete") {
      const hit = rows.filter(match);
      SB.tables[q.table] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table) {
    const q = { table, op: "select", filters: [], payload: null, single: false, maybe: false };
    let proxy;
    const api = {
      select() { return proxy; },
      insert(p) { q.op = "insert"; q.payload = p; return proxy; },
      update(p) { q.op = "update"; q.payload = p; return proxy; },
      upsert(p) { q.op = "upsert"; q.payload = p; return proxy; },
      delete() { q.op = "delete"; return proxy; },
      eq(c, v) { q.filters.push([c, v]); return proxy; },
      single() { q.single = true; return proxy; },
      maybeSingle() { q.maybe = true; return proxy; },
      then(ok, no) {
        const delay = SB.delay && SB.delay[`${q.table}:${q.op}`];
        return new Promise((r) => setTimeout(r, delay || 0)).then(() => run(q)).then(ok, no);
      },
    };
    proxy = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => proxy) });
    return proxy;
  }

  const auth = {
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { SB.calls.push({ auth: "getSession" }); return { data: { session: SB.session || null }, error: null }; },
    async verifyOtp() { SB.calls.push({ auth: "verifyOtp" }); return SB.verifyOtpError ? { data: {}, error: { message: SB.verifyOtpError } } : { data: { session: SB.session }, error: null }; },
    async signInWithPassword() { SB.session = SB.loginSession || SB.session; return { data: { user: SB.session.user, session: SB.session }, error: null }; },
    async signOut() { SB.calls.push({ auth: "signOut" }); SB.session = null; listeners.forEach((cb) => cb("SIGNED_OUT", null)); return { error: null }; },
    async updateUser() { return { data: { user: SB.session && SB.session.user }, error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
  };
  const storage = {
    from(bucket) {
      return {
        async upload(path) { SB.calls.push({ storage: "upload", bucket, path }); return { data: { path }, error: null }; },
        async remove(paths) { SB.calls.push({ storage: "remove", bucket, paths }); return { data: paths, error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: `/fake-signed/${path}` }, error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `/fake-public/${path}` } }; },
      };
    },
  };
  window.supabase = { createClient: () => ({ auth, storage, from: builder, rpc: async () => ({ data: null, error: null }) }) };
})();
