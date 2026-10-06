import {
  pubkeyOf, createRumor, wrapFor, unwrap, directoryEvent, backupEvent, openBackup, backupTag,
  KIND_TEXT, KIND_IMAGE, KIND_STICKER, KIND_VIDEO, KIND_CHUNK, KIND_CONTROL, WRAP_KIND,
} from './crypto.js';

export const isGroupId = (id) => typeof id === 'string' && id.startsWith('g:');
export const gidOf = (id) => id.slice(2);
const MAX_GROUP = 16;
const CHUNK = 30000;            // chars of base64 per relay event (fits the ~48 KB payload limit)
const MAX_VIDEO = 1600000;      // data-URL chars, ~1.2 MB of video
const PRESENCE_EVERY = 50000;
const ONLINE_WINDOW = 125000;
const isMessageKind = (k) => k === KIND_TEXT || k === KIND_IMAGE || k === KIND_STICKER || k === KIND_VIDEO;

// Core protocol layer: turns decrypted rumors into state changes and state
// changes into encrypted gift wraps. A "chat id" is either a friend's pubkey
// or 'g:<groupId>' for a group.
export class App extends EventTarget {
  constructor(sk, store, transport) {
    super();
    this.sk = sk;
    this.pk = pubkeyOf(sk);
    this.store = store;
    this.transport = transport;
    this.openChat = null;
    this.visible = true;
    this.typingSent = {};
    this.callHandler = null;
    this.gameHandler = null;
    this.watchHandler = null;
    this.pendingGroup = {};   // gid -> rumors that arrived before the group sync
    this.ready = false;
    this.presence = {};       // pk -> last heartbeat ms (not persisted)
    this.sharePresence = true;
    this.lastBackupFp = '';
    this.backupTimer = null;
    this.sending = {};        // vid -> chunks published so far
  }

  get state() { return this.store.state; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async start() {
    await this.transport.connect();
    const since = this.state.lastSync ? this.state.lastSync - 3 * 24 * 3600 : Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    this.transport.listen(this.pk, since, (w) => this.handleWrap(w), () => {
      if (this.ready) return;
      this.ready = true; this.emit('ready');
      this.restoreBackup().catch((e) => console.warn('restore failed', e.message));
      this.startPresence();
    });
    this.store.onChange(() => this.checkBackup());
  }

  stop() { clearInterval(this.presenceTimer); clearTimeout(this.backupTimer); }

  /* ---------- identity helpers ---------- */
  isFriend(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'friend'; }
  isPending(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'pending'; }
  friendPks() { return Object.entries(this.state.friends).filter(([, f]) => f.status === 'friend').map(([pk]) => pk); }
  isOnline(pk) { return Date.now() - (this.presence[pk] || 0) < ONLINE_WINDOW; }
  lastSeen(pk) { const f = this.state.friends[pk]; return Math.max((f && f.lastSeen) || 0, this.presence[pk] || 0); }
  touch(pk) { if (pk === this.pk || !this.state.friends[pk]) return; this.presence[pk] = Date.now(); this.state.friends[pk].lastSeen = Date.now(); }
  isBlocked(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'blocked'; }
  group(id) { return isGroupId(id) ? this.state.groups[gidOf(id)] : null; }
  inGroup(gid, pk) { const g = this.state.groups[gid]; return !!g && g.members.includes(pk); }
  canChat(id) { return isGroupId(id) ? this.inGroup(gidOf(id), this.pk) : this.isFriend(id) || this.isPending(id); }
  members(id) { const g = this.group(id); return g ? g.members.filter((p) => p !== this.pk) : [id]; }
  nameOf(id) {
    if (id === this.pk) return this.state.profile.name || 'You';
    if (isGroupId(id)) { const g = this.state.groups[gidOf(id)]; return g ? g.name || 'Group' : 'Group'; }
    const f = this.state.friends[id];
    return (f && f.name) || 'Friend ' + id.slice(0, 6);
  }
  avatarOf(pk) {
    if (pk === this.pk) return this.state.profile.avatar || '';
    const f = this.state.friends[pk];
    return (f && f.avatar) || '';
  }
  // Someone we are willing to receive non-message control traffic from.
  knows(pk) {
    if (this.isBlocked(pk)) return false;
    if (this.isFriend(pk)) return true;
    return Object.values(this.state.groups).some((g) => g.members.includes(pk) && g.members.includes(this.pk));
  }

  /* ---------- inbound ---------- */
  handleWrap(wrap) {
    let rumor;
    try { rumor = unwrap(this.sk, wrap); } catch (e) { return; }
    if (wrap.kind === WRAP_KIND && wrap.created_at > this.state.lastSync) this.state.lastSync = wrap.created_at;
    if (this.store.hasRumor(rumor.id)) { this.store.save(); return; }
    this.store.markRumor(rumor.id);
    this.handleRumor(rumor);
    this.store.save();
  }

  handleRumor(rumor) {
    try {
      if (isMessageKind(rumor.kind)) this.handleMessage(rumor);
      else if (rumor.kind === KIND_CHUNK) this.handleChunk(rumor);
      else if (rumor.kind === KIND_CONTROL) this.handleControl(rumor);
    } catch (e) { console.error('bad rumor', e); }
  }

  tag(rumor, name) { return (rumor.tags.find((t) => t[0] === name) || [])[1]; }

  messageFromRumor(rumor) {
    const ms = this.tag(rumor, 'ms');
    const g = this.tag(rumor, 'g');
    const re = rumor.tags.find((t) => t[0] === 're');
    const kind = rumor.kind === KIND_IMAGE ? 'image' : rumor.kind === KIND_STICKER ? 'sticker' : rumor.kind === KIND_VIDEO ? 'video' : 'text';
    const m = {
      id: rumor.id, from: rumor.pubkey, to: this.tag(rumor, 'p'), kind,
      text: kind === 'text' ? rumor.content : '',
      img: kind === 'image' ? rumor.content : '',
      sticker: kind === 'sticker' ? rumor.content : '',
      ts: ms ? Number(ms) : rumor.created_at * 1000,
    };
    if (kind === 'video') {
      let v = {}; try { v = JSON.parse(rumor.content) || {}; } catch {}
      m.video = { n: Math.min(200, Number(v.n) || 0), mime: String(v.mime || 'video/mp4').slice(0, 40), dur: Number(v.dur) || 0, w: Number(v.w) || 0, h: Number(v.h) || 0, size: Number(v.size) || 0, poster: typeof v.poster === 'string' && v.poster.length < 12000 ? v.poster : '' };
      m.text = '';
    }
    if (g) m.g = g;
    if (re) m.re = { id: re[1], from: re[2] || '', text: re[3] || '' };
    return m;
  }

  handleMessage(rumor) {
    const m = this.messageFromRumor(rumor);
    if (m.g) return this.handleGroupMessage(rumor, m);
    if (m.from === this.pk) {
      if (!m.to || m.to === this.pk) return;
      const chat = this.store.chat(m.to);
      if (chat.messages.some((x) => x.id === m.id)) return;
      m.status = 'sent';
      this.insertMessage(chat, m);
      return;
    }
    if (this.isBlocked(m.from)) return;
    if (!this.state.friends[m.from]) {
      this.state.friends[m.from] = { name: '', status: 'request', since: Date.now() };
      this.emit('request', { pk: m.from });
    }
    if (this.isFriend(m.from) && this.ready) this.touch(m.from);
    const chat = this.store.chat(m.from);
    if (chat.messages.some((x) => x.id === m.id)) return;
    m.status = 'received';
    this.insertMessage(chat, m);
    if (m.kind === 'video') this.assembleVideo(m.id);
    const onScreen = this.openChat === m.from && this.visible;
    if (onScreen && this.isFriend(m.from)) {
      m.acked = 'read';
      this.sendControl(m.from, { t: 'receipt', ids: [m.id], s: 'read' });
    } else {
      chat.unread++;
      if (this.isFriend(m.from)) { m.acked = 'delivered'; this.sendControl(m.from, { t: 'receipt', ids: [m.id], s: 'delivered' }); }
    }
    this.emit('typing', { pk: m.from, chatId: m.from, on: false });
    this.emit('message', { pk: m.from, chatId: m.from, message: m, fresh: this.ready });
  }

  handleGroupMessage(rumor, m) {
    const gid = m.g, g = this.state.groups[gid];
    if (!g) {
      // Sync not seen yet (relays deliver out of order); keep for later.
      const q = this.pendingGroup[gid] || (this.pendingGroup[gid] = []);
      if (q.length < 100) q.push(rumor);
      return;
    }
    if (m.from !== this.pk && this.isBlocked(m.from)) return;
    if (m.from !== this.pk && !g.members.includes(m.from)) {
      const q = this.pendingGroup[gid] || (this.pendingGroup[gid] = []);
      if (q.length < 100 && !q.includes(rumor)) q.push(rumor);
      return;
    }
    if (!g.members.includes(this.pk)) return;
    const chatId = 'g:' + gid;
    const chat = this.store.chat(chatId);
    if (chat.messages.some((x) => x.id === m.id)) return;
    m.status = m.from === this.pk ? 'sent' : 'received';
    this.insertMessage(chat, m);
    if (m.kind === 'video') this.assembleVideo(m.id);
    if (m.from === this.pk) return;
    this.touch(m.from);
    const onScreen = this.openChat === chatId && this.visible;
    if (!onScreen) chat.unread++;
    this.emit('typing', { pk: m.from, chatId, on: false });
    this.emit('message', { pk: m.from, chatId, message: m, fresh: this.ready });
  }

  insertMessage(chat, m) {
    chat.messages.push(m);
    chat.messages.sort((a, b) => a.ts - b.ts);
    if (m.ts > chat.lastTs) chat.lastTs = m.ts;
    if (chat.messages.length > 2000) chat.messages.splice(0, chat.messages.length - 2000);
  }

  // Copies of our own control messages are also wrapped to ourselves so a
  // second device of the same account can rebuild its state from the relays.
  handleOwnControl(rumor, c) {
    const to = this.tag(rumor, 'p');
    if (c.t === 'friend' && to && to !== this.pk) {
      const f = this.state.friends[to] || (this.state.friends[to] = { name: '', since: Date.now() });
      if (f.status === 'blocked') return;
      if (c.a === 'accept') f.status = 'friend';
      else if (f.status !== 'friend') f.status = f.status === 'request' ? 'friend' : 'pending';
      this.store.chat(to);
    } else if (c.t === 'profile') {
      if (c.name) this.state.profile.name = String(c.name).slice(0, 40);
      if (c.av !== undefined) this.state.profile.avatar = c.av || '';
      if (c.u) this.state.profile.username = c.u;
    } else if (c.t === 'block' && c.pk) {
      const f = this.state.friends[c.pk] || (this.state.friends[c.pk] = { name: '', since: Date.now() });
      f.status = c.on ? 'blocked' : 'friend';
    } else if (c.t === 'unfriend' && c.pk) {
      delete this.state.friends[c.pk]; delete this.state.chats[c.pk];
    } else if (c.t === 'group') {
      this.handleGroupControl(this.pk, c, rumor);
    } else if (c.t === 'game') {
      if (this.gameHandler) this.gameHandler(this.chatIdFor(this.pk, c), this.pk, c, rumor);
    } else if (c.t === 'calllog' && c.e && typeof c.e === 'object' && /^[0-9a-f]{64}$/.test(c.e.peer || '')) {
      const e = c.e;
      this.logCall({ id: String(e.id || rumor.id).slice(0, 64), peer: e.peer, dir: e.dir === 'out' ? 'out' : 'in', video: !!e.video, ts: Number(e.ts) || rumor.created_at * 1000, dur: Number(e.dur) || 0, missed: !!e.missed, reason: String(e.reason || '').slice(0, 20) }, true);
      this.emit('calls');
    }
  }

  chatIdFor(from, c) { return c.g ? 'g:' + c.g : from; }

  handleControl(rumor) {
    const from = rumor.pubkey;
    let c; try { c = JSON.parse(rumor.content); } catch { return; }
    if (from === this.pk) { this.handleOwnControl(rumor, c); return; }
    if (this.isBlocked(from)) return;
    const ageSec = Math.floor(Date.now() / 1000) - rumor.created_at;
    switch (c.t) {
      case 'receipt': {
        if (!this.isFriend(from)) return;
        const chat = this.store.chat(from);
        const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
        for (const m of chat.messages) {
          if (m.from === this.pk && c.ids.includes(m.id) && (rank[c.s] || 0) > (rank[m.status] || 0)) m.status = c.s;
        }
        this.emit('receipt', { pk: from });
        break;
      }
      case 'typing': {
        if (ageSec > 15) return;
        const chatId = this.chatIdFor(from, c);
        if (c.g ? !this.inGroup(c.g, from) : !this.isFriend(from)) return;
        this.touch(from);
        this.emit('typing', { pk: from, chatId, on: !!c.on });
        break;
      }
      case 'friend': {
        const f = this.state.friends[from] || (this.state.friends[from] = { name: '', status: 'request', since: Date.now() });
        if (c.name) f.name = String(c.name).slice(0, 40);
        if (typeof c.av === 'string' && c.av.length < 20000) f.avatar = c.av;
        if (c.a === 'accept') {
          if (f.status === 'request' || f.status === 'pending' || f.status === 'contact') { f.status = 'friend'; f.since = Date.now(); }
          this.touch(from);
          this.emit('friend', { pk: from, accepted: true });
        } else if (c.a === 'request') {
          if (f.status === 'friend' || f.status === 'pending') {
            // Mutual request (or they re-sent): we already want them, so this completes the handshake.
            f.status = 'friend';
            this.sendControl(from, { t: 'friend', a: 'accept', name: this.state.profile.name, av: this.state.profile.avatar });
            this.emit('friend', { pk: from, accepted: true });
          } else { if (f.status === 'contact') f.status = 'request'; this.emit('request', { pk: from, fresh: this.ready }); }
        }
        break;
      }
      case 'profile': {
        const f = this.state.friends[from];
        if (!f) return;
        if (c.name) f.name = String(c.name).slice(0, 40);
        if (typeof c.av === 'string' && c.av.length < 20000) f.avatar = c.av;
        if (c.req && this.knows(from)) this.sendControl(from, { t: 'profile', name: this.state.profile.name, av: this.state.profile.avatar });
        this.emit('friend', { pk: from });
        break;
      }
      case 'vreq': {
        if (!Array.isArray(c.miss) || !/^[0-9a-f]{64}$/.test(String(c.v || ''))) return;
        const hit = this.findMessage(c.v);
        if (!hit || hit.m.from !== this.pk) return;
        const ok = isGroupId(hit.chatId) ? this.inGroup(gidOf(hit.chatId), from) : hit.chatId === from;
        if (ok) this.resendChunks(from, c.v, c.miss.map(Number).filter((i) => Number.isInteger(i)).slice(0, 60));
        break;
      }
      case 'presence': {
        if (!this.isFriend(from) || ageSec > 120) return;
        const f = this.state.friends[from];
        if (c.on) { this.presence[from] = Date.now(); f.lastSeen = Date.now(); if (c.q) this.sendPresence([from], false); }
        else { this.presence[from] = 0; f.lastSeen = Date.now(); }
        this.emit('presence', { pk: from });
        break;
      }
      case 'group':
        this.handleGroupControl(from, c, rumor);
        break;
      case 'call':
        if (!this.isFriend(from) || ageSec > 90) return;
        if (this.callHandler) this.callHandler(from, c, rumor);
        break;
      case 'game': {
        const chatId = this.chatIdFor(from, c);
        if (c.g ? !this.inGroup(c.g, from) : !this.isFriend(from)) return;
        if (this.gameHandler) this.gameHandler(chatId, from, c, rumor);
        break;
      }
      case 'watch': {
        if (ageSec > 120) return;
        const chatId = this.chatIdFor(from, c);
        if (c.g ? !this.inGroup(c.g, from) : !this.isFriend(from)) return;
        if (this.watchHandler) this.watchHandler(chatId, from, c);
        break;
      }
    }
  }

  /* ---------- groups ---------- */
  handleGroupControl(from, c, rumor) {
    const gid = String(c.g || ''); if (!/^[0-9a-f]{16}$/.test(gid)) return;
    const existing = this.state.groups[gid];
    if (c.op === 'sync') {
      if (!Array.isArray(c.m) || c.m.length > MAX_GROUP || !c.m.every((p) => /^[0-9a-f]{64}$/.test(p))) return;
      if (!c.m.includes(this.pk)) { if (existing && from !== this.pk) this.systemMessage('g:' + gid, `${this.nameOf(from)} removed you`); return; }
      const allowed = from === this.pk || this.isFriend(from) || (existing && existing.members.includes(from));
      if (!allowed) return;
      const newer = !existing || !c.ts || c.ts >= (existing.ts || 0);
      const g = existing || (this.state.groups[gid] = { name: '', members: [], admin: from, since: Date.now(), ts: 0, left: {} });
      g.left ||= {};
      const before = new Set(g.members);
      // Snapshots can arrive in any order (relays, second device): name/admin are
      // last-writer-wins by ts, members are a union minus anyone who left later.
      if (newer) { g.name = String(c.n || g.name || 'Group').slice(0, 40); g.ts = c.ts || Date.now(); if (c.admin && /^[0-9a-f]{64}$/.test(c.admin)) g.admin = c.admin; }
      else if (!g.name) g.name = String(c.n || 'Group').slice(0, 40);
      const snapTs = c.ts || 0;
      for (const p of c.m) if (!g.members.includes(p) && !((g.left[p] || 0) > snapTs)) g.members.push(p);
      for (const p of c.m) if (!this.state.friends[p] && p !== this.pk) this.state.friends[p] = { name: '', status: 'contact', since: Date.now() };
      if (c.names) for (const [p, n] of Object.entries(c.names)) { const f = this.state.friends[p]; if (f && !f.name && p !== this.pk) f.name = String(n).slice(0, 40); }
      this.store.chat('g:' + gid);
      if (!existing) this.systemMessage('g:' + gid, from === this.pk ? 'You created the group' : `${this.nameOf(from)} added you to the group`, rumor.created_at * 1000);
      else {
        const added = c.m.filter((p) => !before.has(p) && p !== this.pk);
        if (added.length) this.systemMessage('g:' + gid, `${this.nameOf(from)} added ${added.map((p) => this.nameOf(p)).join(', ')}`, rumor.created_at * 1000);
        if (newer && c.n && existing.name && c.n !== existing.name && from !== this.pk) this.systemMessage('g:' + gid, `${this.nameOf(from)} renamed the group to “${g.name}”`, rumor.created_at * 1000);
      }
      const q = this.pendingGroup[gid]; delete this.pendingGroup[gid];
      if (q) for (const r of q) this.handleRumor(r);
      this.emit('group', { gid });
    } else if (c.op === 'leave') {
      if (!existing || !existing.members.includes(from)) return;
      existing.members = existing.members.filter((p) => p !== from);
      (existing.left ||= {})[from] = rumor.created_at * 1000;
      if (from === this.pk) { delete this.state.groups[gid]; delete this.state.chats['g:' + gid]; }
      else {
        if (existing.admin === from && existing.members.length) existing.admin = existing.members[0];
        this.systemMessage('g:' + gid, `${this.nameOf(from)} left`, rumor.created_at * 1000);
      }
      this.emit('group', { gid });
    }
  }

  systemMessage(chatId, text, ts = Date.now()) {
    const chat = this.store.chat(chatId);
    const id = 'sys:' + ts.toString(36) + ':' + Math.random().toString(36).slice(2, 7);
    this.insertMessage(chat, { id, kind: 'system', text, ts, from: '' });
  }

  groupSnapshot(gid) {
    const g = this.state.groups[gid];
    const names = {}; for (const p of g.members) names[p] = p === this.pk ? this.state.profile.name : this.nameOf(p);
    return { t: 'group', op: 'sync', g: gid, n: g.name, m: g.members, admin: g.admin, ts: g.ts, names };
  }

  async broadcastGroupSync(gid) {
    const snap = this.groupSnapshot(gid);
    const members = this.state.groups[gid].members.filter((p) => p !== this.pk);
    await this.sendToMany(members, snap, false, true);
  }

  createGroup(name, memberPks) {
    const gid = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const members = [this.pk, ...memberPks.filter((p) => p !== this.pk && this.isFriend(p))].slice(0, MAX_GROUP);
    this.state.groups[gid] = { name: name.trim().slice(0, 40) || 'Group', members, admin: this.pk, since: Date.now(), ts: Date.now() };
    this.store.chat('g:' + gid);
    this.systemMessage('g:' + gid, 'You created the group');
    this.store.save();
    this.broadcastGroupSync(gid);
    return 'g:' + gid;
  }
  addMembers(gid, pks) {
    const g = this.state.groups[gid]; if (!g) return;
    const added = pks.filter((p) => !g.members.includes(p) && this.isFriend(p));
    if (!added.length) return;
    g.members = [...g.members, ...added].slice(0, MAX_GROUP); g.ts = Date.now();
    this.systemMessage('g:' + gid, `You added ${added.map((p) => this.nameOf(p)).join(', ')}`);
    this.store.save();
    this.broadcastGroupSync(gid);
  }
  renameGroup(gid, name) {
    const g = this.state.groups[gid]; if (!g) return;
    g.name = name.trim().slice(0, 40) || g.name; g.ts = Date.now();
    this.systemMessage('g:' + gid, `You renamed the group to “${g.name}”`);
    this.store.save();
    this.broadcastGroupSync(gid);
  }
  leaveGroup(gid) {
    const g = this.state.groups[gid]; if (!g) return;
    const others = g.members.filter((p) => p !== this.pk);
    this.sendToMany(others, { t: 'group', op: 'leave', g: gid }, false, true);
    delete this.state.groups[gid]; delete this.state.chats['g:' + gid];
    this.store.save();
  }

  /* ---------- outbound ---------- */
  async publishRumor(toPk, rumor, ephemeral = false, copyToSelf = false) {
    const wraps = [wrapFor(this.sk, toPk, rumor, { ephemeral })];
    if (copyToSelf && toPk !== this.pk) wraps.push(wrapFor(this.sk, this.pk, rumor, { ephemeral }));
    const res = await Promise.allSettled(wraps.map((w) => this.transport.publish(w)));
    if (res[0].status === 'rejected') throw res[0].reason;
  }

  // One rumor, wrapped separately for each recipient (and once for ourselves).
  async publishToMany(pks, rumor, ephemeral = false, copyToSelf = false) {
    const targets = [...new Set(pks.filter((p) => p !== this.pk))];
    if (copyToSelf || !targets.length) targets.push(this.pk);
    const res = await Promise.allSettled(targets.map((p) => this.transport.publish(wrapFor(this.sk, p, rumor, { ephemeral }))));
    if (!res.some((r) => r.status === 'fulfilled')) throw (res[0] && res[0].reason) || new Error('no relay accepted the message');
  }

  async sendToMany(pks, obj, ephemeral = false, copyToSelf = false) {
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), []);
    this.store.markRumor(rumor.id);
    try { await this.publishToMany(pks, rumor, ephemeral, copyToSelf); } catch (e) { console.warn('send failed', obj.t, e.message); }
  }

  async sendControl(pk, obj, ephemeral = false) {
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), [['p', pk]]);
    const copyToSelf = !ephemeral && (obj.t === 'friend' || obj.t === 'profile');
    try { await this.publishRumor(pk, rumor, ephemeral, copyToSelf); } catch (e) { console.warn('control send failed', obj.t, e.message); }
  }

  // Control message to everyone in a chat (friend or all group members).
  sendChatControl(chatId, obj, ephemeral = false, copyToSelf = false) {
    if (isGroupId(chatId)) return this.sendToMany(this.members(chatId), Object.assign({ g: gidOf(chatId) }, obj), ephemeral, copyToSelf);
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), [['p', chatId]]);
    this.store.markRumor(rumor.id);
    return this.publishRumor(chatId, rumor, ephemeral, copyToSelf).catch((e) => console.warn('control send failed', obj.t, e.message));
  }

  // Private note-to-self so other devices of this account learn about it.
  syncToSelf(obj) {
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), [['p', this.pk]]);
    this.store.markRumor(rumor.id);
    this.publishRumor(this.pk, rumor).catch((e) => console.warn('self sync failed', e.message));
  }

  async sendMessage(chatId, { text, img, sticker, video, replyTo }) {
    const kind = video ? KIND_VIDEO : img ? KIND_IMAGE : sticker ? KIND_STICKER : KIND_TEXT;
    const ts = Date.now();
    const tags = [['ms', String(ts)]];
    const group = isGroupId(chatId);
    if (group) tags.push(['g', gidOf(chatId)]); else tags.push(['p', chatId]);
    if (replyTo) tags.push(['re', replyTo.id, replyTo.from || '', String(replyTo.text || '').slice(0, 120)]);
    let meta = null, parts = [];
    if (video) {
      if (video.data.length > MAX_VIDEO) throw new Error('Video is too large after compression');
      for (let i = 0; i < video.data.length; i += CHUNK) parts.push(video.data.slice(i, i + CHUNK));
      meta = { n: parts.length, mime: video.mime, dur: video.dur, w: video.w, h: video.h, size: video.data.length, poster: video.poster || '' };
    }
    const rumor = createRumor(this.sk, kind, video ? JSON.stringify(meta) : img || sticker || text, tags);
    const m = { id: rumor.id, from: this.pk, to: group ? '' : chatId, kind: video ? 'video' : img ? 'image' : sticker ? 'sticker' : 'text', text: text || '', img: img || '', sticker: sticker || '', ts, status: 'pending' };
    if (video) { m.video = Object.assign({ ready: true }, meta); await this.store.putBlob(rumor.id, video.data); }
    if (group) m.g = gidOf(chatId);
    if (replyTo) m.re = { id: replyTo.id, from: replyTo.from || '', text: String(replyTo.text || '').slice(0, 120) };
    const chat = this.store.chat(chatId);
    this.store.markRumor(rumor.id);
    this.insertMessage(chat, m);
    this.store.save();
    try {
      if (group) await this.publishToMany(this.members(chatId), rumor, false, true);
      else await this.publishRumor(chatId, rumor, false, true);
      if (video) await this.sendChunks(chatId, rumor.id, parts);
      if (m.status === 'pending') m.status = 'sent';
    } catch (e) {
      m.status = 'failed'; m.error = e.message;
    }
    this.store.save();
    return m;
  }

  // Video bodies travel as a series of small encrypted events referencing the
  // header message; sent two at a time so public relays don't rate-limit us.
  async sendChunks(chatId, vid, parts) {
    const group = isGroupId(chatId);
    this.sending[vid] = 0;
    for (let i = 0; i < parts.length; i++) {
      await this.sendChunk(chatId, vid, i, parts[i]);
      this.sending[vid] = i + 1;
      this.emit('media', { vid, sent: i + 1, n: parts.length });
      if (i + 1 < parts.length) await new Promise((r) => setTimeout(r, 200));
    }
    delete this.sending[vid];
  }
  sendChunk(chatId, vid, idx, chunk, toPk = null) {
    const group = isGroupId(chatId);
    const tags = [['v', vid, String(idx)]];
    if (group) tags.push(['g', gidOf(chatId)]); else tags.push(['p', chatId]);
    const r = createRumor(this.sk, KIND_CHUNK, chunk, tags);
    this.store.markRumor(r.id);
    return toPk ? this.publishRumor(toPk, r, false, false) : group ? this.publishToMany(this.members(chatId), r, false, false) : this.publishRumor(chatId, r, false, false);
  }
  // Public relays drop or rate-limit some events; a receiver that is still
  // missing pieces 15 s after the last one asks the sender to resend just those.
  scheduleChunkCheck(vid) {
    this.chunkTimers ||= {};
    clearTimeout(this.chunkTimers[vid]);
    this.chunkTimers[vid] = setTimeout(() => this.requestMissing(vid), 15000);
  }
  requestMissing(vid) {
    const hit = this.findMessage(vid); if (!hit || hit.m.kind !== 'video' || hit.m.video.ready || hit.m.from === this.pk) return;
    const e = this.state.mediaParts[vid]; const n = hit.m.video.n; if (!n) return;
    const miss = []; for (let i = 0; i < n; i++) if (!e || !e.parts[i]) miss.push(i);
    if (!miss.length) return;
    hit.m.video.tries = (hit.m.video.tries || 0) + 1;
    if (hit.m.video.tries > 6) return;
    this.sendControl(hit.m.from, { t: 'vreq', v: vid, miss: miss.slice(0, 60) });
    this.scheduleChunkCheck(vid);
  }
  async resendChunks(toPk, vid, miss) {
    const hit = this.findMessage(vid); if (!hit || hit.m.from !== this.pk) return;
    const data = await this.getVideo(vid); if (!data) return;
    const n = Math.ceil(data.length / CHUNK);
    for (const i of miss) {
      if (!(i >= 0 && i < n)) continue;
      try { await this.sendChunk(hit.chatId, vid, i, data.slice(i * CHUNK, (i + 1) * CHUNK), toPk); } catch (e) { console.warn('resend chunk failed', e.message); }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  handleChunk(rumor) {
    const t = rumor.tags.find((x) => x[0] === 'v'); if (!t) return;
    const vid = String(t[1] || ''), idx = Number(t[2]);
    if (!/^[0-9a-f]{64}$/.test(vid) || !(idx >= 0 && idx < 200) || rumor.content.length > CHUNK + 100) return;
    if (rumor.pubkey !== this.pk && !this.knows(rumor.pubkey) && !this.isPending(rumor.pubkey) && !this.state.friends[rumor.pubkey]) return;
    const mp = this.state.mediaParts;
    const e = mp[vid] || (mp[vid] = { from: rumor.pubkey, parts: {}, ts: Date.now() });
    if (e.from !== rumor.pubkey) return;
    e.parts[idx] = rumor.content;
    // keep at most a few in-flight videos in state
    const ids = Object.keys(mp); if (ids.length > 6) { ids.sort((a, b) => mp[a].ts - mp[b].ts); delete mp[ids[0]]; }
    this.assembleVideo(vid);
  }

  findMessage(id) {
    for (const [chatId, chat] of Object.entries(this.state.chats)) { const m = chat.messages.find((x) => x.id === id); if (m) return { chatId, m }; }
    return null;
  }

  assembleVideo(vid) {
    const hit = this.findMessage(vid); if (!hit || hit.m.kind !== 'video' || hit.m.video.ready) return;
    const e = this.state.mediaParts[vid]; const n = hit.m.video.n;
    const got = e ? Object.keys(e.parts).length : 0;
    hit.m.video.got = got;
    if (!e || !n || got < n || e.from !== hit.m.from) { this.emit('media', { vid, got, n }); if (this.ready) this.scheduleChunkCheck(vid); return; }
    clearTimeout((this.chunkTimers || {})[vid]);
    let data = ''; for (let i = 0; i < n; i++) data += e.parts[i];
    delete this.state.mediaParts[vid];
    hit.m.video.ready = true;
    this.store.putBlob(vid, data).then(() => this.emit('media', { vid, ready: true }));
  }

  getVideo(vid) { return this.store.getBlob(vid); }

  async resend(chatId, id) {
    const chat = this.store.chat(chatId);
    const m = chat.messages.find((x) => x.id === id);
    if (!m) return;
    chat.messages.splice(chat.messages.indexOf(m), 1);
    this.store.save();
    if (m.kind === 'video') {
      const data = await this.getVideo(id); if (!data) throw new Error('Video is no longer on this device');
      return this.sendMessage(chatId, { video: { data, mime: m.video.mime, dur: m.video.dur, w: m.video.w, h: m.video.h, poster: m.video.poster }, replyTo: m.re });
    }
    return this.sendMessage(chatId, { text: m.text, img: m.img, sticker: m.sticker, replyTo: m.re });
  }

  deleteLocal(chatId, id) {
    const chat = this.store.chat(chatId);
    chat.messages = chat.messages.filter((m) => m.id !== id);
    this.store.save();
  }

  typing(chatId) {
    const last = this.typingSent[chatId] || 0;
    if (Date.now() - last < 4000) return;
    this.typingSent[chatId] = Date.now();
    this.sendChatControl(chatId, { t: 'typing', on: true }, true);
  }

  setOpenChat(id) {
    this.openChat = id;
    if (id) this.markRead(id);
  }

  markRead(chatId) {
    const chat = this.store.chat(chatId);
    chat.unread = 0;
    if (!isGroupId(chatId) && this.isFriend(chatId)) {
      const ids = chat.messages.filter((m) => m.from === chatId && m.acked !== 'read').map((m) => { m.acked = 'read'; return m.id; });
      if (ids.length) this.sendControl(chatId, { t: 'receipt', ids: ids.slice(-50), s: 'read' });
    }
    this.store.save();
  }

  /* ---------- friends ---------- */
  addFriend(pk) {
    if (pk === this.pk) throw new Error("That's your own code");
    const f = this.state.friends[pk] || (this.state.friends[pk] = { name: '', since: Date.now() });
    if (f.status === 'request') { this.acceptRequest(pk); return 'accepted'; }
    if (f.status === 'friend') return 'friend';
    f.status = 'pending'; f.since = Date.now();
    this.store.chat(pk);
    this.store.save();
    this.sendControl(pk, { t: 'friend', a: 'request', name: this.state.profile.name, av: this.state.profile.avatar });
    return 'pending';
  }
  cancelRequest(pk) {
    const f = this.state.friends[pk]; if (!f || f.status !== 'pending') return;
    delete this.state.friends[pk]; delete this.state.chats[pk];
    this.store.save();
    this.syncToSelf({ t: 'unfriend', pk });
  }

  acceptRequest(pk) {
    const f = this.state.friends[pk]; if (!f) return;
    f.status = 'friend'; f.since = Date.now(); this.touch(pk);
    const chat = this.store.chat(pk);
    const ids = chat.messages.filter((m) => m.from === pk).map((m) => { m.acked = 'delivered'; return m.id; });
    if (ids.length) this.sendControl(pk, { t: 'receipt', ids: ids.slice(-50), s: 'delivered' });
    this.sendControl(pk, { t: 'friend', a: 'accept', name: this.state.profile.name, av: this.state.profile.avatar });
    this.store.save();
  }

  block(pk) {
    const f = this.state.friends[pk] || (this.state.friends[pk] = { name: '', since: Date.now() });
    f.status = 'blocked';
    this.store.save();
    this.syncToSelf({ t: 'block', pk, on: true });
  }
  unblock(pk) { const f = this.state.friends[pk]; if (f) f.status = 'friend'; this.store.save(); this.syncToSelf({ t: 'block', pk, on: false }); }
  removeFriend(pk) { delete this.state.friends[pk]; delete this.state.chats[pk]; this.store.save(); this.syncToSelf({ t: 'unfriend', pk }); }
  clearChat(chatId) { const c = this.store.chat(chatId); c.messages = []; c.unread = 0; this.store.save(); }

  /* ---------- profile ---------- */
  broadcastProfile() {
    const p = this.state.profile;
    const friends = Object.entries(this.state.friends).filter(([, f]) => f.status === 'friend');
    for (const [pk] of friends) this.sendControl(pk, { t: 'profile', name: p.name, av: p.avatar });
    if (!friends.length) this.syncToSelf({ t: 'profile', name: p.name, av: p.avatar });
    if (p.username && this.discoverable !== false) this.publishDirectory(true);
  }
  setName(name) {
    this.state.profile.name = name.trim().slice(0, 40);
    this.store.save();
    this.broadcastProfile();
  }
  setAvatar(dataUrl) {
    this.state.profile.avatar = dataUrl || '';
    this.store.save();
    this.broadcastProfile();
  }
  setUsername(u) { this.state.profile.username = u; this.store.save(); this.syncToSelf({ t: 'profile', u }); }

  // Optional public pointer username -> identity so friends can add you by username.
  publishDirectory(on) {
    this.discoverable = !!on;
    const u = this.state.profile.username; if (!u) return;
    const ev = directoryEvent(this.sk, u, on ? this.state.profile.name : '', !on);
    this.transport.publish(ev).catch((e) => console.warn('directory publish failed', e.message));
  }
  lookupUsername(u) { return this.transport.lookup(u); }

  /* ---------- presence ---------- */
  startPresence() {
    clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => { if (this.visible) this.sendPresence(null, false); }, PRESENCE_EVERY);
    this.sendPresence(null, true);
  }
  // Ephemeral "I'm here" heartbeat to every friend; `query` asks them to answer
  // so both sides learn each other's state right away.
  sendPresence(pks, query, off = false) {
    if (!this.sharePresence && !off) return;
    const targets = pks || this.friendPks();
    if (!targets.length) return;
    const obj = { t: 'presence', on: off ? 0 : 1 };
    if (query && !off) obj.q = 1;
    this.sendToMany(targets, obj, true, false);
  }
  setVisible(v) {
    const was = this.visible; this.visible = v;
    if (!this.ready) return;
    if (v && !was) this.sendPresence(null, true);
    else if (!v && was) this.sendPresence(null, false, true);
  }
  setSharePresence(on) { this.sharePresence = !!on; if (!on) this.sendPresence(null, false, true); else this.sendPresence(null, true); }

  /* ---------- encrypted account backup ---------- */
  backupSnapshot() {
    const friends = {}, groups = {};
    for (const [pk, f] of Object.entries(this.state.friends)) if (['friend', 'pending', 'blocked', 'request'].includes(f.status)) friends[pk] = { n: f.name || '', s: f.status, t: f.since || 0 };
    for (const [gid, g] of Object.entries(this.state.groups)) if (g.members.includes(this.pk)) groups[gid] = { n: g.name, m: g.members, a: g.admin, t: g.since || 0, ts: g.ts || 0 };
    const p = this.state.profile;
    return { v: 1, profile: { name: p.name || '', username: p.username || '' }, friends, groups };
  }
  checkBackup() {
    if (!this.ready) return;
    const fp = JSON.stringify(this.backupSnapshot());
    if (fp === this.lastBackupFp) return;
    clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => this.publishBackup(), 4000);
  }
  async publishBackup() {
    const snap = this.backupSnapshot();
    const fp = JSON.stringify(snap);
    if (!Object.keys(snap.friends).length && !Object.keys(snap.groups).length) { this.lastBackupFp = fp; return; }
    snap.ts = Date.now();
    try { await this.transport.publish(backupEvent(this.sk, snap)); this.lastBackupFp = fp; }
    catch (e) { console.warn('backup publish failed', e.message); }
  }
  async restoreBackup() {
    let ev = null;
    try { ev = await this.transport.fetchBackup(this.pk, backupTag(this.pk)); } catch (e) { console.warn('backup fetch failed', e.message); }
    if (!ev) { this.checkBackup(); return; }
    let b; try { b = openBackup(this.sk, ev); } catch (e) { console.warn('backup unreadable', e.message); return; }
    const added = [];
    for (const [pk, r] of Object.entries(b.friends || {})) {
      if (!/^[0-9a-f]{64}$/.test(pk) || pk === this.pk) continue;
      const f = this.state.friends[pk];
      if (!f || f.status === 'contact') {
        this.state.friends[pk] = Object.assign(f || {}, { name: (f && f.name) || String(r.n || '').slice(0, 40), status: ['friend', 'pending', 'blocked', 'request'].includes(r.s) ? r.s : 'friend', since: Number(r.t) || Date.now() });
        if (r.s === 'friend' || r.s === 'pending') { this.store.chat(pk); added.push(pk); }
      }
    }
    for (const [gid, r] of Object.entries(b.groups || {})) {
      if (!/^[0-9a-f]{16}$/.test(gid) || this.state.groups[gid]) continue;
      if (!Array.isArray(r.m) || !r.m.includes(this.pk)) continue;
      const members = r.m.filter((p) => /^[0-9a-f]{64}$/.test(p)).slice(0, MAX_GROUP);
      this.state.groups[gid] = { name: String(r.n || 'Group').slice(0, 40), members, admin: r.a, since: Number(r.t) || Date.now(), ts: Number(r.ts) || 0, left: {} };
      this.store.chat('g:' + gid);
      for (const p of members) if (p !== this.pk && !this.state.friends[p]) { this.state.friends[p] = { name: '', status: 'contact', since: Date.now() }; added.push(p); }
      const q = this.pendingGroup[gid]; delete this.pendingGroup[gid];
      if (q) for (const rr of q) this.handleRumor(rr);
    }
    const p = this.state.profile;
    if (b.profile) { if ((!p.name || p.name === 'Me') && b.profile.name) p.name = String(b.profile.name).slice(0, 40); if (!p.username && b.profile.username) p.username = b.profile.username; }
    this.lastBackupFp = JSON.stringify(this.backupSnapshot());
    if (added.length) {
      this.store.save();
      // Ask restored contacts for their current name/photo (not kept in the backup).
      this.sendToMany(added, { t: 'profile', name: p.name, av: p.avatar, req: 1 }, false, false);
      this.sendPresence(added.filter((pk) => this.isFriend(pk)), true);
      this.emit('restored', { n: added.length });
    }
  }

  /* ---------- calls ---------- */
  logCall(entry, fromSync = false) {
    if (this.state.calls.some((c) => c.id === entry.id)) return;
    this.state.calls.unshift(entry);
    this.state.calls.sort((a, b) => b.ts - a.ts);
    if (this.state.calls.length > 200) this.state.calls.length = 200;
    const chat = this.store.chat(entry.peer);
    const id = 'call:' + entry.id;
    if (!chat.messages.some((m) => m.id === id)) {
      this.insertMessage(chat, { id, kind: 'call', from: entry.dir === 'out' ? this.pk : entry.peer, ts: entry.ts, video: entry.video, dur: entry.dur, missed: entry.missed, reason: entry.reason, dir: entry.dir });
    }
    this.store.save();
    if (!fromSync) this.syncToSelf({ t: 'calllog', e: entry });
  }
}
