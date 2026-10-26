import { supa } from './supa.js';
import { Emitter, uid, randomCode } from '../util.js';
import { ICE_SERVERS, MAX_PLAYERS } from '../config.js';

/**
 * A multiplayer room. Supabase Realtime is used only for the handshake ("signaling");
 * all gameplay data then flows directly between browsers over WebRTC data channels.
 */
export class Room extends Emitter {
  constructor(code, isHost, me) {
    super();
    this.code = code;
    this.isHost = isHost;
    this.me = me;            // { name, color, userId }
    this.peerId = uid();
    this.peers = new Map();  // host: peerId -> peer
    this.host = null;        // client: the host peer
    this.channel = null;
    this.closed = false;
    this.usedSlots = new Set([0]);
  }

  static async create(me) {
    for (let i = 0; i < 4; i++) {
      const code = randomCode(6);
      const r = new Room(code, true, me);
      const free = await r.openChannel(true);
      if (free) return r;
      r.close('retry');
    }
    throw new Error('Could not create a room, try again');
  }

  static async join(code, me) {
    const r = new Room(code.toUpperCase(), false, me);
    await r.openChannel(false);
    await r.connectToHost();
    return r;
  }

  async openChannel(asHost) {
    this.channel = supa.channel(`room-${this.code}`, { config: { broadcast: { self: false, ack: false }, presence: { key: this.peerId } } });
    this.channel.on('broadcast', { event: 'hello' }, ({ payload }) => this.isHost && this.onHello(payload));
    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => payload.to === this.peerId && this.onSignal(payload));
    this.channel.on('broadcast', { event: 'deny' }, ({ payload }) => payload.to === this.peerId && this.emit('deny', payload.reason));
    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (!this.isHost && leftPresences.some((p) => p.role === 'host')) this.close('The host left the room');
    });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Could not reach the server')), 10000);
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); res(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); rej(new Error('Realtime connection failed')); }
      });
    });
    if (asHost) {
      await new Promise((r) => setTimeout(r, 700));
      const state = this.channel.presenceState();
      const hostExists = Object.values(state).flat().some((p) => p.role === 'host');
      if (hostExists) return false;
      await this.channel.track({ role: 'host', name: this.me.name });
    } else {
      await this.channel.track({ role: 'guest', name: this.me.name });
    }
    return true;
  }

  // ---------------- host side
  onHello(p) {
    if (this.peers.has(p.from)) return;
    if (this.peers.size + 1 >= MAX_PLAYERS) { this.signal('deny', { to: p.from, reason: 'Room is full (max ' + MAX_PLAYERS + ' players)' }); return; }
    let slot = 1; while (this.usedSlots.has(slot)) slot++;
    this.usedSlots.add(slot);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { id: p.from, slot, name: String(p.name || 'Player').slice(0, 20), color: p.color, userId: p.userId, pc, rel: null, unrel: null, open: false };
    this.peers.set(p.from, peer);
    peer.rel = pc.createDataChannel('rel', { ordered: true });
    peer.unrel = pc.createDataChannel('unrel', { ordered: false, maxRetransmits: 0 });
    this.wireChannels(peer);
    pc.onicecandidate = (e) => e.candidate && this.signal('signal', { to: peer.id, from: this.peerId, candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        setTimeout(() => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.dropPeer(peer); }, pc.connectionState === 'disconnected' ? 4000 : 0);
      }
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() =>
      this.signal('signal', { to: peer.id, from: this.peerId, sdp: pc.localDescription.toJSON() }));
    setTimeout(() => { if (!peer.open && this.peers.get(peer.id) === peer) this.dropPeer(peer); }, 20000);
  }

  dropPeer(peer) {
    if (!this.peers.has(peer.id)) return;
    this.peers.delete(peer.id);
    this.usedSlots.delete(peer.slot);
    try { peer.pc.close(); } catch { /* ignore */ }
    if (peer.open && !this.closed) this.emit('peer-leave', peer);
  }

  wireChannels(peer) {
    const onOpen = () => {
      if (peer.rel?.readyState === 'open' && peer.unrel?.readyState === 'open' && !peer.open) {
        peer.open = true;
        if (this.isHost) this.emit('peer-join', peer); else this.emit('connected');
      }
    };
    for (const ch of [peer.rel, peer.unrel]) {
      if (!ch) continue;
      ch.binaryType = 'arraybuffer';
      ch.onopen = onOpen;
      ch.onmessage = (e) => {
        let msg = e.data;
        if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
        this.emit('message', peer, msg);
      };
      ch.onclose = () => {
        if (this.isHost) this.dropPeer(peer);
        else if (!this.closed) this.close('Connection to the host was lost');
      };
      if (ch.readyState === 'open') onOpen();
    }
  }

  // ---------------- client side
  async connectToHost() {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearInterval(iv); clearTimeout(to); off1(); off2(); err ? reject(err) : resolve(); };
      const off1 = this.on('connected', () => finish());
      const off2 = this.on('deny', (reason) => finish(new Error(reason)));
      const hello = () => this.signal('hello', { from: this.peerId, name: this.me.name, color: this.me.color, userId: this.me.userId });
      hello();
      const iv = setInterval(() => { if (!this.host) hello(); }, 1500);
      const to = setTimeout(() => finish(new Error(this.host ? 'Could not connect directly to the host (network blocked?)' : 'Room not found')), 20000);
    }).catch((e) => { this.close('failed'); throw e; });
  }

  async onSignal(p) {
    if (this.isHost) {
      const peer = this.peers.get(p.from);
      if (!peer) return;
      if (p.sdp) await peer.pc.setRemoteDescription(p.sdp);
      if (p.candidate) await peer.pc.addIceCandidate(p.candidate).catch(() => {});
      return;
    }
    if (!this.host) {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.host = { id: p.from, pc, rel: null, unrel: null, open: false, slot: 0 };
      pc.ondatachannel = (e) => {
        if (e.channel.label === 'rel') this.host.rel = e.channel; else this.host.unrel = e.channel;
        this.wireChannels(this.host);
      };
      pc.onicecandidate = (e) => e.candidate && this.signal('signal', { to: this.host.id, from: this.peerId, candidate: e.candidate.toJSON() });
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.close('Connection failed'); };
    }
    const pc = this.host.pc;
    if (p.from !== this.host.id) return;
    if (p.sdp) {
      await pc.setRemoteDescription(p.sdp);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      this.signal('signal', { to: this.host.id, from: this.peerId, sdp: pc.localDescription.toJSON() });
    }
    if (p.candidate) await pc.addIceCandidate(p.candidate).catch(() => {});
  }

  signal(event, payload) { this.channel?.send({ type: 'broadcast', event, payload }); }

  // ---------------- send
  sendTo(peer, msg, reliable = true) {
    const ch = reliable ? peer.rel : peer.unrel;
    if (!ch || ch.readyState !== 'open') return;
    if (!reliable && ch.bufferedAmount > 64 * 1024) return; // drop when congested
    try { ch.send(typeof msg === 'string' || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg)); } catch { /* ignore */ }
  }
  broadcast(msg, reliable = true, except = null) {
    const data = typeof msg === 'string' || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.open && p !== except) this.sendTo(p, data, reliable);
  }
  toHost(msg, reliable = true) { if (this.host) this.sendTo(this.host, msg, reliable); }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.peers.values()) { try { p.pc.close(); } catch { /* ignore */ } }
    try { this.host?.pc.close(); } catch { /* ignore */ }
    if (this.channel) { this.channel.untrack?.(); supa.removeChannel(this.channel); }
    this.emit('closed', reason);
  }
}
