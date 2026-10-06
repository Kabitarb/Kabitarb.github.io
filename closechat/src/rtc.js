// Peer-to-peer voice/video over WebRTC. Signaling (offer/answer/ICE) travels as
// encrypted ephemeral gift wraps through the relays, media goes directly
// between the two devices (DTLS-SRTP encrypted), with a TURN fallback.
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const RING_TIMEOUT = 45000;

export class CallManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.reset();
    app.callHandler = (from, msg) => this.onSignal(from, msg);
  }

  reset() {
    this.state = 'idle';   // idle | outgoing | incoming | connecting | active
    this.peer = null; this.callId = null; this.video = false; this.dir = null;
    this.pc = null; this.local = null; this.remote = null;
    this.pendingIce = []; this.iceQueue = []; this.iceTimer = null;
    this.startedAt = 0; this.pendingOffer = null; this.muted = false; this.camOff = false;
    this.facing = 'user';
    clearTimeout(this.ringTimer); clearTimeout(this.connectTimer);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setState(s) { this.state = s; this.emit('state', this.info()); }
  info() {
    return { state: this.state, peer: this.peer, video: this.video, dir: this.dir, startedAt: this.startedAt, muted: this.muted, camOff: this.camOff, local: this.local, remote: this.remote };
  }

  signal(obj) { return this.app.sendControl(this.peer, Object.assign({ t: 'call', id: this.callId }, obj), true); }

  async getMedia(video) {
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 } } : false };
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (e) {
      if (video) { try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {} }
      throw e;
    }
  }

  createPc() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (!e.candidate) { this.flushIce(); return; }
      this.iceQueue.push(e.candidate.toJSON());
      clearTimeout(this.iceTimer);
      this.iceTimer = setTimeout(() => this.flushIce(), 400);
    };
    pc.ontrack = (e) => {
      if (!this.remote) this.remote = new MediaStream();
      this.remote.addTrack(e.track);
      this.emit('remote', this.remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(this.connectTimer);
        if (!this.startedAt) this.startedAt = Date.now();
        this.setState('active');
      } else if (pc.connectionState === 'failed') this.end('failed');
      else if (pc.connectionState === 'disconnected') { clearTimeout(this.connectTimer); this.connectTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.end('lost'); }, 8000); }
    };
    this.pc = pc;
    return pc;
  }

  flushIce() {
    if (!this.iceQueue.length || !this.peer) return;
    const cands = this.iceQueue.splice(0);
    this.signal({ a: 'ice', cands });
  }

  async start(peer, video) {
    if (this.state !== 'idle') throw new Error('Already in a call');
    this.peer = peer; this.video = !!video; this.dir = 'out';
    this.callId = Math.random().toString(36).slice(2, 10);
    this.setState('outgoing');
    try {
      this.local = await this.getMedia(this.video);
      this.video = this.local.getVideoTracks().length > 0;
      this.emit('local', this.local);
      const pc = this.createPc();
      for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signal({ a: 'offer', sdp: offer.sdp, video: this.video, name: this.app.state.profile.name });
      this.emit('ringing');
      this.ringTimer = setTimeout(() => { if (this.state === 'outgoing') this.end('no-answer'); }, RING_TIMEOUT);
    } catch (e) {
      this.emit('error', e.message || String(e));
      this.end('error', false);
    }
  }

  async onSignal(from, msg) {
    if (msg.a === 'offer') {
      if (this.state !== 'idle') {
        if (!(this.peer === from && this.callId === msg.id)) this.app.sendControl(from, { t: 'call', id: msg.id, a: 'busy' }, true);
        return;
      }
      this.peer = from; this.callId = msg.id; this.video = !!msg.video; this.dir = 'in';
      this.pendingOffer = msg.sdp;
      this.setState('incoming');
      this.ringTimer = setTimeout(() => { if (this.state === 'incoming') { this.logEnd('missed'); this.reset(); this.setState('idle'); } }, RING_TIMEOUT);
      return;
    }
    if (from !== this.peer || msg.id !== this.callId) return;
    switch (msg.a) {
      case 'answer':
        if (this.pc && this.state === 'outgoing') {
          clearTimeout(this.ringTimer);
          this.setState('connecting');
          await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          await this.drainIce();
        }
        break;
      case 'ice':
        this.pendingIce.push(...(msg.cands || []));
        await this.drainIce();
        break;
      case 'reject': this.end('declined', false); break;
      case 'busy': this.end('busy', false); break;
      case 'end': this.end('ended', false); break;
    }
  }

  async drainIce() {
    if (!this.pc || !this.pc.remoteDescription) return;
    const cands = this.pendingIce.splice(0);
    for (const c of cands) { try { await this.pc.addIceCandidate(c); } catch (e) { console.warn('ice', e); } }
  }

  async accept() {
    if (this.state !== 'incoming') return;
    clearTimeout(this.ringTimer);
    this.setState('connecting');
    try {
      this.local = await this.getMedia(this.video);
      this.emit('local', this.local);
      const pc = this.createPc();
      for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
      await pc.setRemoteDescription({ type: 'offer', sdp: this.pendingOffer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.signal({ a: 'answer', sdp: answer.sdp });
      await this.drainIce();
      this.connectTimer = setTimeout(() => { if (this.state === 'connecting') this.end('failed'); }, 30000);
    } catch (e) {
      this.emit('error', e.message || String(e));
      this.end('error');
    }
  }

  decline() {
    if (this.state !== 'incoming') return;
    this.signal({ a: 'reject' });
    this.logEnd('declined');
    this.cleanup();
  }

  hangup() { this.end('ended'); }

  end(reason, notify = true) {
    if (this.state === 'idle') return;
    if (notify && this.peer && this.state !== 'incoming') this.signal({ a: 'end', reason });
    this.logEnd(reason);
    this.cleanup();
    this.emit('ended', reason);
  }

  logEnd(reason) {
    if (!this.peer) return;
    const dur = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    const missed = this.dir === 'in' && !this.startedAt;
    this.app.logCall({ id: this.callId, peer: this.peer, dir: this.dir, video: this.video, ts: Date.now(), dur, missed, reason });
  }

  cleanup() {
    if (this.local) for (const t of this.local.getTracks()) t.stop();
    if (this.pc) { try { this.pc.close(); } catch {} }
    this.reset();
    this.setState('idle');
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !this.muted;
    this.emit('state', this.info());
  }
  toggleCamera() {
    this.camOff = !this.camOff;
    if (this.local) for (const t of this.local.getVideoTracks()) t.enabled = !this.camOff;
    this.emit('state', this.info());
  }
  async switchCamera() {
    if (!this.local || !this.pc) return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing } });
      const newTrack = s.getVideoTracks()[0];
      const sender = this.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      for (const t of this.local.getVideoTracks()) { t.stop(); this.local.removeTrack(t); }
      this.local.addTrack(newTrack);
      newTrack.enabled = !this.camOff;
      this.emit('local', this.local);
    } catch (e) { this.emit('error', 'Could not switch camera'); }
  }
}

// Simple synthesized ring / ringback tones so we need no audio assets.
export class Tones {
  constructor() { this.ctx = null; this.timer = null; }
  ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return this.ctx; }
  beep(freq, dur, gain = 0.08, when = 0) {
    const ctx = this.ensure();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur);
  }
  startRing(incoming) {
    this.stop();
    const pattern = () => {
      if (incoming) {
        // classic two-tone trill: ~1 s ringing, ~1.5 s pause
        for (let i = 0; i < 8; i++) this.beep(i % 2 ? 988 : 784, 0.11, 0.22, i * 0.125);
      } else { this.beep(440, 1.0, 0.07); this.beep(480, 1.0, 0.07); }
    };
    try { pattern(); } catch {}
    this.timer = setInterval(() => { try { pattern(); } catch {} }, incoming ? 2500 : 3000);
  }
  notify() { try { this.beep(1200, 0.08, 0.05); this.beep(1600, 0.08, 0.05, 0.1); } catch {} }
  stop() { clearInterval(this.timer); this.timer = null; }
}
