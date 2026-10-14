// Group voice/video calls: full-mesh WebRTC (2–4 people) over ephemeral `gcall` controls.
// Joiners never offer — existing participants offer to a newcomer on `join`, so there is no glare.
import { ICE_SERVERS } from './rtc.js';

const RING_TIMEOUT = 45000, CONNECT_TIMEOUT = 30000, MAX = 4;

export class GroupCallManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.ongoing = {};                      // gid -> { id, video, by, ts } calls we know about but haven't joined
    this.reset();
    app.groupCallHandler = (from, c) => this.onSignal(from, c);
  }

  reset() {
    this.state = 'idle';                    // idle | outgoing | incoming | connecting | active
    this.gid = null; this.callId = null; this.video = false; this.dir = null; this.ringer = null;
    this.local = null; this.peers = new Map(); this.muted = false; this.camOff = false; this.facing = 'user';
    this.startedAt = 0; this.hadPeers = false;
    clearTimeout(this.ringTimer); clearTimeout(this.connectTimer); clearInterval(this.reinvite); clearInterval(this.vuTimer);
    if (this.ac) { try { this.ac.close(); } catch {} this.ac = null; }
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setState(s) { this.state = s; this.emit('state', this.info()); }
  info() {
    return {
      group: true, state: this.state, gid: this.gid, callId: this.callId, video: this.video, dir: this.dir, ringer: this.ringer,
      startedAt: this.startedAt, muted: this.muted, camOff: this.camOff, local: this.local,
      peers: [...this.peers].map(([pk, p]) => ({ pk, stream: p.stream, video: p.video, muted: p.muted, speaking: p.speaking, connected: p.pc.connectionState === 'connected' }))
    };
  }

  signal(pk, obj) { return this.app.sendControl(pk, Object.assign({ t: 'gcall', id: this.callId, gid: this.gid }, obj), true); }
  broadcast(obj, except) { return Promise.all(this.app.members(this.gid).filter((p) => p !== except).map((p) => this.signal(p, obj).catch(() => {}))); }

  async getMedia(video) {
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: this.facing, width: { ideal: 480 }, height: { ideal: 360 } } : false };
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (e) { if (video) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); this.video = false; return s; } throw e; }
  }

  async start(gid, video) {
    if (this.state !== 'idle') throw new Error('Already in a call');
    if (this.app.members(gid).length < 1) throw new Error('No one else in this group');
    this.gid = gid; this.video = !!video; this.dir = 'out'; this.ringer = this.app.pk;
    this.callId = Math.random().toString(36).slice(2, 10);
    this.setState('outgoing');
    try {
      this.local = await this.getMedia(this.video);
      this.video = this.local.getVideoTracks().length > 0;
      this.emit('local', this.local);
      const ring = { a: 'ring', video: this.video, name: this.app.state.profile.name };
      await this.broadcast(ring);
      clearInterval(this.reinvite);
      this.reinvite = setInterval(() => { if (this.state === 'outgoing' && !this.peers.size) this.broadcast(ring); else clearInterval(this.reinvite); }, 4000);
      this.emit('outgoing', { gid, video: this.video });
      this.emit('ringing');
      this.ringTimer = setTimeout(() => { if (this.state === 'outgoing' && !this.peers.size) { this.broadcast({ a: 'cancel' }); this.end('no-answer', false); } }, RING_TIMEOUT);
    } catch (e) {
      this.emit('error', e.message || String(e));
      this.end('error', false);
    }
  }

  // Someone is calling the group (or re-ringing): show incoming if free, otherwise remember it for a "Join" banner.
  onRing(from, c) {
    if (this.ongoing[c.gid]?.id !== c.id) { this.ongoing[c.gid] = { id: c.id, video: !!c.video, by: from, ts: Date.now() }; this.emit('ongoing', { gid: c.gid }); }
    if (this.state !== 'idle') return;
    if (this.app.calls && this.app.calls.state !== 'idle') return;
    this.gid = c.gid; this.callId = c.id; this.video = !!c.video; this.dir = 'in'; this.ringer = from;
    this.setState('incoming');
    this.ringTimer = setTimeout(() => { if (this.state === 'incoming') { this.logEnd('missed'); this.reset(); this.setState('idle'); } }, RING_TIMEOUT);
  }

  async onSignal(from, c) {
    if (!c || !c.gid || !c.id) return;
    if (c.a === 'ring') return this.onRing(from, c);
    if (c.a === 'cancel' || c.a === 'over') {
      if (this.ongoing[c.gid]?.id === c.id) { delete this.ongoing[c.gid]; this.emit('ongoing', { gid: c.gid }); }
      if (this.state === 'incoming' && this.callId === c.id) { this.logEnd('missed'); this.reset(); this.setState('idle'); }
      return;
    }
    if (c.gid !== this.gid || c.id !== this.callId) return;
    const inCall = this.state === 'outgoing' || this.state === 'connecting' || this.state === 'active';
    if (!inCall) return;
    const p = this.peers.get(from);
    switch (c.a) {
      case 'join':
        if (!p && this.peers.size < MAX - 1) { this.ongoing[this.gid] && delete this.ongoing[this.gid]; await this.offerTo(from, !!c.video); }
        else if (p) this.signal(from, { a: 'roster', peers: [...this.peers.keys()] }).catch(() => {});
        break;
      case 'offer': {
        if (p) { try { p.pc.close(); } catch {} this.peers.delete(from); }
        const peer = this.createPeer(from, !!c.video);
        try {
          await peer.pc.setRemoteDescription({ type: 'offer', sdp: c.sdp });
          const ans = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(ans);
          await this.signal(from, { a: 'answer', sdp: ans.sdp, video: this.video && !this.camOff });
          await this.drainIce(peer);
        } catch (e) { console.warn('gcall offer', e); }
        this.emit('state', this.info());
        break;
      }
      case 'answer':
        if (p && p.pc.signalingState === 'have-local-offer') { try { await p.pc.setRemoteDescription({ type: 'answer', sdp: c.sdp }); p.video = !!c.video; await this.drainIce(p); } catch (e) { console.warn('gcall answer', e); } }
        break;
      case 'ice':
        if (p) { p.pendingIce.push(...(c.cands || [])); await this.drainIce(p); }
        break;
      case 'mute': if (p) { p.muted = !!c.on; this.emit('state', this.info()); } break;
      case 'cam': if (p) { p.video = !!c.on; this.emit('state', this.info()); } break;
      case 'leave': if (p) this.dropPeer(from, true); break;
    }
  }

  async offerTo(pk, video) {
    const peer = this.createPeer(pk, video);
    try {
      const offer = await peer.pc.createOffer(); await peer.pc.setLocalDescription(offer);
      await this.signal(pk, { a: 'offer', sdp: offer.sdp, video: this.video && !this.camOff });
    } catch (e) { console.warn('gcall offer', e); }
    this.emit('state', this.info());
  }

  createPeer(pk, video) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pk, pc, stream: new MediaStream(), video: !!video, muted: false, speaking: false, pendingIce: [], iceQueue: [], iceTimer: null, lostTimer: null, analyser: null };
    this.peers.set(pk, peer);
    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { this.flushIce(peer); return; }
      peer.iceQueue.push(e.candidate.toJSON());
      clearTimeout(peer.iceTimer); peer.iceTimer = setTimeout(() => this.flushIce(peer), 400);
    };
    pc.ontrack = (e) => {
      peer.stream.addTrack(e.track);
      if (e.track.kind === 'video') {
        peer.video = true;
        e.track.onmute = () => { peer.video = false; this.emit('state', this.info()); };
        e.track.onunmute = () => { peer.video = true; this.emit('state', this.info()); };
        e.track.onended = () => { peer.video = false; this.emit('state', this.info()); };
      } else this.watchLevel(peer);
      this.emit('peer', { pk, stream: peer.stream });
      this.emit('state', this.info());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(peer.lostTimer); clearTimeout(this.connectTimer); clearInterval(this.reinvite); clearTimeout(this.ringTimer);
        this.hadPeers = true;
        if (!this.startedAt) this.startedAt = Date.now();
        if (this.state !== 'active') this.setState('active'); else this.emit('state', this.info());
      } else if (pc.connectionState === 'failed') this.dropPeer(pk, false);
      else if (pc.connectionState === 'disconnected') { clearTimeout(peer.lostTimer); peer.lostTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.dropPeer(pk, false); }, 8000); }
    };
    return peer;
  }

  flushIce(peer) {
    if (!peer.iceQueue.length) return;
    const cands = peer.iceQueue.splice(0);
    this.signal(peer.pk, { a: 'ice', cands }).catch(() => {});
  }
  async drainIce(peer) {
    if (!peer.pc.remoteDescription) return;
    for (const c of peer.pendingIce.splice(0)) { try { await peer.pc.addIceCandidate(c); } catch (e) { console.warn('ice', e); } }
  }

  watchLevel(peer) {
    try {
      this.ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ac.createMediaStreamSource(new MediaStream(peer.stream.getAudioTracks()));
      const an = this.ac.createAnalyser(); an.fftSize = 256; src.connect(an); peer.analyser = an;
      if (!this.vuTimer) {
        const buf = new Uint8Array(128);
        this.vuTimer = setInterval(() => {
          let changed = false;
          for (const p of this.peers.values()) {
            if (!p.analyser) continue;
            p.analyser.getByteFrequencyData(buf);
            let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
            const sp = sum / buf.length > 18;
            if (sp !== p.speaking) { p.speaking = sp; changed = true; }
          }
          if (changed) this.emit('speaking', this.info().peers);
        }, 250);
      }
    } catch {}
  }

  dropPeer(pk, remote) {
    const p = this.peers.get(pk); if (!p) return;
    clearTimeout(p.lostTimer); clearTimeout(p.iceTimer);
    try { p.pc.close(); } catch {}
    this.peers.delete(pk);
    this.emit('left', { pk, remote });
    if (!this.peers.size && this.hadPeers) { this.end('ended'); return; }
    this.emit('state', this.info());
  }

  // Accept the incoming ring, or join a call that is already going on in a group.
  async accept() { if (this.state === 'incoming') return this.join(this.gid, this.callId, this.video); }
  async join(gid, callId, video) {
    if (this.state !== 'idle' && this.state !== 'incoming') throw new Error('Already in a call');
    const known = this.ongoing[gid];
    callId = callId || (known && known.id); if (!callId) throw new Error('No call to join');
    clearTimeout(this.ringTimer);
    this.gid = gid; this.callId = callId; this.video = video !== undefined ? !!video : !!(known && known.video); this.dir = this.dir || 'in';
    this.setState('connecting');
    try {
      this.local = await this.getMedia(this.video);
      this.video = this.local.getVideoTracks().length > 0;
      this.emit('local', this.local);
      await this.broadcast({ a: 'join', video: this.video });
      delete this.ongoing[gid]; this.emit('ongoing', { gid });
      this.connectTimer = setTimeout(() => { if (this.state === 'connecting') this.end('failed'); }, CONNECT_TIMEOUT);
    } catch (e) {
      this.emit('error', e.message || String(e));
      this.end('error');
    }
  }

  decline() {
    if (this.state !== 'incoming') return;
    this.logEnd('declined');
    this.cleanup();
  }

  hangup() { this.end('ended'); }

  end(reason, notify = true) {
    if (this.state === 'idle') return;
    if (notify && this.state !== 'incoming') {
      if (!this.peers.size) this.broadcast({ a: this.hadPeers ? 'over' : 'cancel' });
      else this.broadcast({ a: 'leave' });
    }
    const cont = reason === 'ended' && this.peers.size > 0 ? { gid: this.gid, id: this.callId, video: this.video, by: this.ringer || this.app.pk } : null;
    this.logEnd(reason);
    this.cleanup();
    if (cont) { this.ongoing[cont.gid] = { id: cont.id, video: cont.video, by: cont.by, ts: Date.now() }; this.emit('ongoing', { gid: cont.gid }); }
    this.emit('ended', reason);
  }

  logEnd(reason) {
    if (!this.gid) return;
    const dur = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    const missed = this.dir === 'in' && !this.startedAt;
    this.app.logCall({ id: `${this.callId}:${Date.now().toString(36)}`, callId: this.callId, peer: this.gid, group: true, by: this.ringer, dir: this.dir, video: this.video, ts: Date.now(), dur, missed, reason });
  }

  cleanup() {
    if (this.local) for (const t of this.local.getTracks()) t.stop();
    for (const p of this.peers.values()) { try { p.pc.close(); } catch {} }
    this.reset();
    this.setState('idle');
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !this.muted;
    this.broadcast({ a: 'mute', on: this.muted });
    this.emit('state', this.info());
  }
  toggleCamera() {
    if (!this.video) return;
    this.camOff = !this.camOff;
    if (this.local) for (const t of this.local.getVideoTracks()) t.enabled = !this.camOff;
    this.broadcast({ a: 'cam', on: !this.camOff });
    this.emit('state', this.info());
  }
  async switchCamera() {
    if (!this.video || !this.local) return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 480 }, height: { ideal: 360 } } });
      const nt = s.getVideoTracks()[0], ot = this.local.getVideoTracks()[0];
      for (const p of this.peers.values()) { const sender = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (sender) await sender.replaceTrack(nt); }
      if (ot) { this.local.removeTrack(ot); ot.stop(); }
      this.local.addTrack(nt); this.emit('local', this.local);
    } catch (e) { this.emit('error', 'Could not switch camera'); }
  }
}
