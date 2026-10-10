// "Listen / watch together" from a file on the host's own device. The host
// plays the file locally and streams it to a friend over a dedicated WebRTC
// connection (signaling = encrypted ephemeral wraps, media = DTLS-SRTP), so no
// file ever touches the relays. Works standalone or next to a voice/video call.
import { ICE_SERVERS } from './rtc.js';

const OFFER_TIMEOUT = 45000;
// createMediaElementSource may only be called once per element: remember it.
const SRC = new WeakMap();

export class ShareManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.reset();
    app.shareHandler = (from, msg) => this.onSignal(from, msg);
  }
  reset() {
    this.state = 'idle';      // idle | offering | incoming | connecting | active
    this.role = null;         // host | guest
    this.peer = null; this.id = null; this.title = ''; this.hasVideo = false;
    this.pc = null; this.stream = null; this.remote = null; this.el = null; this.ctx = null;
    this.pendingIce = []; this.iceQueue = []; this.iceTimer = null; this.pendingOffer = null;
    this.raf = 0; this.canvas = null; this.srcNode = null; this.dest = null;
    clearTimeout(this.timer);
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setState(s) { this.state = s; this.emit('state', this.info()); }
  info() { return { state: this.state, role: this.role, peer: this.peer, title: this.title, hasVideo: this.hasVideo, remote: this.remote, el: this.el }; }
  signal(obj) { return this.app.sendControl(this.peer, Object.assign({ t: 'share', id: this.id }, obj), true); }

  createPc() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (!e.candidate) { this.flushIce(); return; }
      this.iceQueue.push(e.candidate.toJSON());
      clearTimeout(this.iceTimer); this.iceTimer = setTimeout(() => this.flushIce(), 400);
    };
    pc.ontrack = (e) => {
      if (!this.remote) this.remote = new MediaStream();
      this.remote.addTrack(e.track);
      this.emit('remote', this.remote);
      this.emit('state', this.info());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.setState('active');
        // Host playback is held until here so the guest hears the file from the start.
        if (this.role === 'host' && this.el) { try { this.el.currentTime = 0; } catch {} this.el.play().catch(() => {}); }
      }
      else if (pc.connectionState === 'failed') this.end('failed');
      else if (pc.connectionState === 'disconnected') { clearTimeout(this.timer); this.timer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.end('lost'); }, 8000); }
    };
    this.pc = pc; return pc;
  }
  flushIce() { if (!this.iceQueue.length || !this.peer) return; this.signal({ a: 'ice', cands: this.iceQueue.splice(0) }); }
  async drainIce() {
    if (!this.pc || !this.pc.remoteDescription) return;
    for (const c of this.pendingIce.splice(0)) { try { await this.pc.addIceCandidate(c); } catch (e) { console.warn('ice', e); } }
  }

  // Build a MediaStream from a playing <video>/<audio>: audio through WebAudio
  // (works on Safari too), video by painting frames to a captured canvas.
  capture(el) {
    const AC = window.AudioContext || window.webkitAudioContext;
    let rec = SRC.get(el);
    if (!rec) { const ctx = new AC(); rec = { ctx, src: ctx.createMediaElementSource(el) }; rec.src.connect(ctx.destination); SRC.set(el, rec); }
    this.ctx = rec.ctx;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const dest = this.ctx.createMediaStreamDestination();
    this.srcNode = rec.src; this.dest = dest;
    this.srcNode.connect(dest);
    const stream = new MediaStream(dest.stream.getAudioTracks());
    if (this.hasVideo && el.tagName === 'VIDEO') {
      const canvas = document.createElement('canvas');
      const paint = () => {
        if (!this.canvas) return;
        if (el.videoWidth) {
          const w = Math.min(640, el.videoWidth), h = Math.round(w * el.videoHeight / el.videoWidth);
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          canvas.getContext('2d').drawImage(el, 0, 0, w, h);
        }
        this.raf = requestAnimationFrame(paint);
      };
      this.canvas = canvas; paint();
      for (const t of canvas.captureStream(20).getVideoTracks()) stream.addTrack(t);
    }
    return stream;
  }

  // Host: share `file` (audio or video) with `peer`. `el` is the local player.
  async start(peer, file, el) {
    if (this.state !== 'idle') throw new Error('Already sharing');
    this.peer = peer; this.role = 'host'; this.id = Math.random().toString(36).slice(2, 10);
    this.title = (file.name || 'Media').replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
    this.hasVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name || '');
    this.el = el;
    el.src = URL.createObjectURL(file);
    this.setState('offering');
    try {
      await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error('This file cannot be played here')); });
      this.stream = this.capture(el);
      const pc = this.createPc();
      for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signal({ a: 'offer', sdp: offer.sdp, title: this.title, video: this.hasVideo, dur: Math.round(el.duration || 0) });
      this.timer = setTimeout(() => { if (this.state === 'offering') this.end('no-answer'); }, OFFER_TIMEOUT);
    } catch (e) {
      this.emit('error', e.message || String(e));
      this.end('error', false);
    }
  }

  async onSignal(from, msg) {
    if (msg.a === 'offer') {
      if (this.state !== 'idle') { if (!(this.peer === from && this.id === msg.id)) this.app.sendControl(from, { t: 'share', id: msg.id, a: 'busy' }, true); return; }
      this.peer = from; this.id = msg.id; this.role = 'guest';
      this.title = String(msg.title || 'Media').slice(0, 60); this.hasVideo = !!msg.video; this.pendingOffer = msg.sdp;
      this.setState('incoming');
      this.emit('invite', { from, title: this.title, video: this.hasVideo, dur: Number(msg.dur) || 0 });
      this.timer = setTimeout(() => { if (this.state === 'incoming') { this.reset(); this.setState('idle'); } }, OFFER_TIMEOUT);
      return;
    }
    if (from !== this.peer || msg.id !== this.id) return;
    switch (msg.a) {
      case 'answer':
        if (this.pc && this.state === 'offering') {
          clearTimeout(this.timer); this.setState('connecting');
          await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }); await this.drainIce();
        }
        break;
      case 'ice': this.pendingIce.push(...(msg.cands || [])); await this.drainIce(); break;
      case 'sync': this.emit('sync', msg); break;    // host's play/pause/seek position for the guest UI
      case 'reject': this.end('declined', false); break;
      case 'busy': this.end('busy', false); break;
      case 'end': this.end('ended', false); break;
    }
  }

  async accept() {
    if (this.state !== 'incoming') return;
    clearTimeout(this.timer); this.setState('connecting');
    try {
      const pc = this.createPc();
      pc.addTransceiver('audio', { direction: 'recvonly' });
      if (this.hasVideo) pc.addTransceiver('video', { direction: 'recvonly' });
      await pc.setRemoteDescription({ type: 'offer', sdp: this.pendingOffer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.signal({ a: 'answer', sdp: answer.sdp });
      await this.drainIce();
      this.timer = setTimeout(() => { if (this.state === 'connecting') this.end('failed'); }, 30000);
    } catch (e) { this.emit('error', e.message || String(e)); this.end('error'); }
  }
  decline() { if (this.state !== 'incoming') return; this.signal({ a: 'reject' }); this.cleanup(); }
  // Host tells the guest where playback is (shown as a progress bar there).
  sync(playing, pos, dur) { if (this.role === 'host' && this.state === 'active') this.signal({ a: 'sync', p: playing ? 1 : 0, pos: Math.round(pos), dur: Math.round(dur || 0) }).catch(() => {}); }
  stop() { this.end('ended'); }
  end(reason, notify = true) {
    if (this.state === 'idle') return;
    if (notify && this.peer && this.state !== 'incoming') this.signal({ a: 'end', reason });
    this.cleanup();
    this.emit('ended', reason);
  }
  cleanup() {
    cancelAnimationFrame(this.raf); this.canvas = null;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.el) { try { this.el.pause(); if (this.el.src.startsWith('blob:')) URL.revokeObjectURL(this.el.src); this.el.removeAttribute('src'); this.el.load(); } catch {} }
    if (this.srcNode && this.dest) { try { this.srcNode.disconnect(this.dest); } catch {} }
    if (this.pc) { try { this.pc.close(); } catch {} }
    this.reset();
    this.setState('idle');
  }
}
