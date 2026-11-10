// Loaded dynamically so the game still starts (singleplayer) when offline or when the CDN is unreachable.
let createClient;
export let online = true;
try {
  // The import blocks the whole game from starting, so give a slow or blocked CDN a deadline.
  ({ createClient } = await Promise.race([
    import('supabase'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out loading the online library')), 8000)),
  ]));
} catch (e) {
  console.warn('Online features unavailable:', e);
  online = false;
  const off = async () => ({ data: null, error: { message: 'You are offline — online features are unavailable' } });
  const q = () => new Proxy({}, { get: (t, k) => (k === 'then' ? (res) => res({ data: null, error: { message: 'offline' } }) : () => q()) });
  createClient = () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: off, signUp: off, signOut: off, resetPasswordForEmail: off },
    from: () => q(), rpc: off,
    channel: () => ({ on() { return this; }, subscribe(cb) { setTimeout(() => cb && cb('CHANNEL_ERROR'), 10); return this; }, send() {}, track() {}, untrack() {}, presenceState: () => ({}) }),
    removeChannel() {},
  });
}
import { SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_URL, MAX_OBJECTS } from '../config.js';
import { Emitter } from '../util.js';

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

/** Account state + data access. All access is protected by Row Level Security in the database. */
class Account extends Emitter {
  constructor() {
    super();
    this.session = null;
    this.profile = null;
  }
  get user() { return this.session?.user || null; }
  get loggedIn() { return !!this.session; }
  get id() { return this.session?.user?.id || null; }
  get name() { return this.profile?.username || 'Guest'; }
  get color() { return this.profile?.color || '#4fc3d9'; }

  async init() {
    try {
      const { data } = await supa.auth.getSession();
      this.session = data.session;
      if (this.session) await this.loadProfile();
    } catch (e) { console.warn('Supabase unavailable', e); }
    supa.auth.onAuthStateChange(async (ev, session) => {
      const changed = (session?.user?.id || null) !== (this.session?.user?.id || null);
      this.session = session;
      if (changed) {
        this.profile = null;
        if (session) await this.loadProfile();
        this.emit('change');
      }
    });
  }

  async loadProfile() {
    for (let i = 0; i < 3; i++) {
      const { data } = await supa.from('profiles').select('id, username, color, settings').eq('id', this.id).maybeSingle();
      if (data) { this.profile = data; return data; }
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  }

  async signUp(email, password, username, color) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3–20 letters, numbers or _');
    // Guests cannot read the profiles table, so the check goes through a database function.
    // Without this the account would be created with a generated name ("player_1a2b3c4d") when the name is taken.
    const { data: free } = await supa.rpc('username_available', { uname: username }).then((r) => r, () => ({ data: null }));
    if (free === false) throw new Error('That username is taken');
    const { data, error } = await supa.auth.signUp({ email, password, options: { data: { username, color }, emailRedirectTo: `${PUBLIC_URL}/play` } });
    if (error) throw error;
    if (!data.session) return { needsConfirm: true };
    this.session = data.session;
    await this.loadProfile();
    this.emit('change');
    return { needsConfirm: false };
  }
  async signIn(email, password) {
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.session = data.session;
    await this.loadProfile();
    this.emit('change');
  }
  async signOut() {
    await supa.auth.signOut();
    this.session = null; this.profile = null;
    this.emit('change');
  }
  async resetPassword(email) {
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: `${PUBLIC_URL}/play` });
    if (error) throw error;
  }

  /** silent: store it without announcing an account change (background saves such as settings). */
  async updateProfile(patch, { silent = false } = {}) {
    if (!this.loggedIn) return;
    if (patch.username && !/^[A-Za-z0-9_]{3,20}$/.test(patch.username)) throw new Error('Username: 3–20 letters, numbers or _');
    const { data, error } = await supa.from('profiles').update(patch).eq('id', this.id).select('id, username, color, settings').single();
    if (error) throw new Error(error.code === '23505' ? 'That username is taken' : error.message);
    this.profile = data;
    if (!silent) this.emit('change');
  }

  // ------------- friends
  async friendships() {
    const { data, error } = await supa.from('friendships')
      .select('id, status, requester, addressee, created_at, req:profiles!friendships_requester_fkey(id, username, color), adr:profiles!friendships_addressee_fkey(id, username, color)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((f) => {
      const outgoing = f.requester === this.id;
      const other = outgoing ? f.adr : f.req;
      return { id: f.id, status: f.status, outgoing, user: other };
    });
  }
  async friendRequest(username) {
    const { data: p } = await supa.from('profiles').select('id, username').ilike('username', likeEscape(username.trim())).maybeSingle();
    if (!p) throw new Error('No player with that username');
    if (p.id === this.id) throw new Error("That's you!");
    const { error } = await supa.from('friendships').insert({ requester: this.id, addressee: p.id });
    if (error) throw new Error(error.code === '23505' ? 'Already friends or request pending' : error.message);
    return p;
  }
  async acceptFriend(id) {
    const { error } = await supa.from('friendships').update({ status: 'accepted' }).eq('id', id);
    if (error) throw error;
  }
  async removeFriend(id) {
    const { error } = await supa.from('friendships').delete().eq('id', id);
    if (error) throw error;
  }

  // ------------- maps
  async myMaps() {
    const { data, error } = await supa.from('maps').select('id, name, object_count, updated_at, owner').eq('owner', this.id).order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async sharedMaps() {
    const { data, error } = await supa.from('map_shares').select('map_id, maps(id, name, object_count, updated_at, owner, profiles(username))').eq('user_id', this.id);
    if (error) throw error;
    return (data || []).filter((r) => r.maps).map((r) => ({ ...r.maps, ownerName: r.maps.profiles?.username }));
  }
  async getMap(id) {
    const { data, error } = await supa.from('maps').select('id, name, data, owner').eq('id', id).single();
    if (error) throw error;
    return data;
  }
  async saveMap({ id, name, data }) {
    const object_count = (data.objects || []).length;
    if (object_count > MAX_OBJECTS) throw new Error(`Max ${MAX_OBJECTS} objects`);
    if (id) {
      const { data: row, error } = await supa.from('maps').update({ name, data, object_count }).eq('id', id).select('id').single();
      if (error) throw error;
      return row.id;
    }
    const { data: row, error } = await supa.from('maps').insert({ owner: this.id, name, data, object_count }).select('id').single();
    if (error) throw error;
    return row.id;
  }
  async renameMap(id, name) {
    const { error } = await supa.from('maps').update({ name }).eq('id', id);
    if (error) throw error;
  }
  async deleteMap(id) {
    const { error } = await supa.from('maps').delete().eq('id', id);
    if (error) throw error;
  }
  async getLink(mapId) {
    const { data } = await supa.from('map_links').select('token').eq('map_id', mapId).maybeSingle();
    return data?.token || null;
  }
  async setLink(mapId, on) {
    if (on) {
      const existing = await this.getLink(mapId);
      if (existing) return existing;
      const { data, error } = await supa.from('map_links').insert({ map_id: mapId }).select('token').single();
      if (error) throw error;
      return data.token;
    }
    const { error } = await supa.from('map_links').delete().eq('map_id', mapId);
    if (error) throw error;
    return null;
  }
  async mapShares(mapId) {
    const { data, error } = await supa.from('map_shares').select('user_id').eq('map_id', mapId);
    if (error) throw error;
    return new Set((data || []).map((r) => r.user_id));
  }
  async share(mapId, userId, on) {
    const q = on ? supa.from('map_shares').insert({ map_id: mapId, user_id: userId }) : supa.from('map_shares').delete().eq('map_id', mapId).eq('user_id', userId);
    const { error } = await q;
    if (error && error.code !== '23505') throw error;
  }
  async mapByToken(token) {
    const { data, error } = await supa.rpc('get_map_by_token', { t: token });
    if (error) throw error;
    return data?.[0] || null;
  }
}

export const account = new Account();

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'altro'];

/**
 * Send a feedback message. Insert only: the database lets players add feedback but never read it back,
 * so no .select() here (it would fail for lack of read permission).
 */
export async function sendFeedback(message, category) {
  const text = String(message || '').trim();
  if (text.length < 5 || text.length > 1000) throw new Error('Write between 5 and 1000 characters.');
  if (!FEEDBACK_CATEGORIES.includes(category)) category = 'altro';
  if (!online) throw new Error('You are offline. Connect to the internet and try again.');
  const { error } = await supa.from('feedback').insert({ message: text, category });
  if (!error) return;
  if (/feedback_rate_limited/.test(error.message || '')) throw new Error('Too many messages right now. Please try again later.');
  if (error.code === '23514') throw new Error('Write between 5 and 1000 characters.');
  throw new Error('Could not send your feedback. Please try again later.');
}
