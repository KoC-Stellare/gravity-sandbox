import { supa, account } from './supa.js';
import { Emitter } from '../util.js';

/** Who is online (presence) + room invites between friends. */
class Social extends Emitter {
  constructor() {
    super();
    this.online = new Map(); // userId -> { name, room }
    this.room = null;
    this.presence = null;
    this.inbox = null;
  }

  async start() {
    this.stop();
    if (!account.loggedIn) return;
    const me = account.id;
    this.presence = supa.channel('online', { config: { presence: { key: me } } });
    this.presence.on('presence', { event: 'sync' }, () => {
      const state = this.presence.presenceState();
      this.online.clear();
      for (const [id, metas] of Object.entries(state)) {
        const m = metas[metas.length - 1];
        this.online.set(id, { name: m.name, room: m.room || null });
      }
      this.emit('change');
    });
    this.presence.subscribe((s) => { if (s === 'SUBSCRIBED') this.track(); });
    this.inbox = supa.channel(`inbox-${me}`);
    this.inbox.on('broadcast', { event: 'invite' }, ({ payload }) => this.emit('invite', payload));
    this.inbox.subscribe();
  }

  stop() {
    if (this.presence) supa.removeChannel(this.presence);
    if (this.inbox) supa.removeChannel(this.inbox);
    this.presence = this.inbox = null;
    this.online.clear();
  }

  setRoom(code) { this.room = code; this.track(); }
  track() { this.presence?.track({ name: account.name, room: this.room }); }

  async invite(userId, code) {
    const ch = supa.channel(`inbox-${userId}`);
    await new Promise((res) => {
      const t = setTimeout(res, 4000);
      ch.subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(t); res(); } });
    });
    await ch.send({ type: 'broadcast', event: 'invite', payload: { from: account.name, fromId: account.id, code } });
    setTimeout(() => supa.removeChannel(ch), 1500);
  }
}

export const social = new Social();
