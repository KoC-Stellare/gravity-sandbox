// Test double for @supabase/supabase-js: fake auth + tables, Realtime over BroadcastChannel.
const user = (() => { try { return JSON.parse(localStorage.getItem('__stubUser') || 'null'); } catch { return null; } })();
window.__stubCalls = [];
const tables = { profiles: user ? [{ id: user.id, username: user.name, color: user.color || '#4fc3d9', settings: {} }] : [] };

function query(table) {
  const st = { table, op: 'select', single: false, payload: null };
  const run = () => {
    window.__stubCalls.push({ table, op: st.op, payload: st.payload });
    if (window.__stubFail?.[table]) return { data: null, error: window.__stubFail[table] };
    if (st.op !== 'select' && !(st.op === 'update' && table === 'profiles')) return { data: st.single ? { id: 'row-1', token: 'tok' } : null, error: null };
    const rows = tables[table] || [];
    if (st.op === 'update') Object.assign(rows[0] || {}, st.payload);
    return { data: st.single ? (rows[0] || null) : rows, error: null };
  };
  const b = new Proxy({}, {
    get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve(run()).then(res, rej);
      if (k === 'insert' || k === 'update' || k === 'delete') return (p) => { st.op = k; st.payload = p; return b; };
      if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return b; };
      return () => b;
    },
  });
  return b;
}

class Channel {
  constructor(name, opts) {
    this.name = name;
    this.key = opts?.config?.presence?.key || Math.random().toString(36).slice(2);
    this.handlers = [];
    this.state = {};
    this.meta = null;
    this.bc = new BroadcastChannel('rt-' + name);
    this.bc.onmessage = (e) => this.recv(e.data);
  }
  on(type, filter, cb) { this.handlers.push({ type, event: filter.event, cb }); return this; }
  fire(type, event, arg) { for (const h of this.handlers) if (h.type === type && h.event === event) h.cb(arg); }
  recv(m) {
    if (m.k === 'b') this.fire('broadcast', m.event, { payload: m.payload });
    if (m.k === 'join') { this.state[m.key] = [m.meta]; this.fire('presence', 'sync'); this.fire('presence', 'join', { newPresences: [m.meta] }); }
    if (m.k === 'leave') { const metas = this.state[m.key] || []; delete this.state[m.key]; this.fire('presence', 'sync'); this.fire('presence', 'leave', { leftPresences: metas }); }
    if (m.k === 'who' && this.meta) this.bc.postMessage({ k: 'join', key: this.key, meta: this.meta });
  }
  subscribe(cb) { setTimeout(() => { this.bc.postMessage({ k: 'who' }); cb && cb('SUBSCRIBED'); }, 20); return this; }
  async send(m) { window.__rtSent = (window.__rtSent || 0) + 1; this.bc.postMessage({ k: 'b', event: m.event, payload: JSON.parse(JSON.stringify(m.payload)) }); return 'ok'; }
  async track(meta) { this.meta = meta; this.state[this.key] = [meta]; this.bc.postMessage({ k: 'join', key: this.key, meta }); this.fire('presence', 'sync'); }
  async untrack() { if (this.meta) this.bc.postMessage({ k: 'leave', key: this.key }); this.meta = null; delete this.state[this.key]; }
  presenceState() { return this.state; }
  close() { this.untrack(); setTimeout(() => this.bc.close(), 50); }
}

export function createClient() {
  const session = user ? { user: { id: user.id, email: user.name + '@test.local' } } : null;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signUp: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
    },
    from: (t) => query(t),
    rpc: async (fn, args) => { window.__stubCalls.push({ rpc: fn, args }); return { data: window.__stubRpc?.[fn] ?? null, error: null }; },
    channel: (name, opts) => { window.__stubChannels = (window.__stubChannels || 0) + 1; return new Channel(name, opts); },
    removeChannel: (ch) => ch.close(),
  };
}
