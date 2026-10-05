import {
  pubkeyOf, createRumor, wrapFor, unwrap, directoryEvent,
  KIND_TEXT, KIND_IMAGE, KIND_STICKER, KIND_CONTROL, WRAP_KIND,
} from './crypto.js';

export const isGroupId = (id) => typeof id === 'string' && id.startsWith('g:');
export const gidOf = (id) => id.slice(2);
const MAX_GROUP = 16;

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
  }

  get state() { return this.store.state; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async start() {
    await this.transport.connect();
    const since = this.state.lastSync ? this.state.lastSync - 3 * 24 * 3600 : Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    this.transport.listen(this.pk, since, (w) => this.handleWrap(w), () => { this.ready = true; this.emit('ready'); });
  }

  /* ---------- identity helpers ---------- */
  isFriend(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'friend'; }
  isBlocked(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'blocked'; }
  group(id) { return isGroupId(id) ? this.state.groups[gidOf(id)] : null; }
  inGroup(gid, pk) { const g = this.state.groups[gid]; return !!g && g.members.includes(pk); }
  canChat(id) { return isGroupId(id) ? this.inGroup(gidOf(id), this.pk) : this.isFriend(id); }
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
      if (rumor.kind === KIND_TEXT || rumor.kind === KIND_IMAGE || rumor.kind === KIND_STICKER) this.handleMessage(rumor);
      else if (rumor.kind === KIND_CONTROL) this.handleControl(rumor);
    } catch (e) { console.error('bad rumor', e); }
  }

  tag(rumor, name) { return (rumor.tags.find((t) => t[0] === name) || [])[1]; }

  messageFromRumor(rumor) {
    const ms = this.tag(rumor, 'ms');
    const g = this.tag(rumor, 'g');
    const re = rumor.tags.find((t) => t[0] === 're');
    const kind = rumor.kind === KIND_IMAGE ? 'image' : rumor.kind === KIND_STICKER ? 'sticker' : 'text';
    const m = {
      id: rumor.id, from: rumor.pubkey, to: this.tag(rumor, 'p'), kind,
      text: kind === 'text' ? rumor.content : '',
      img: kind === 'image' ? rumor.content : '',
      sticker: kind === 'sticker' ? rumor.content : '',
      ts: ms ? Number(ms) : rumor.created_at * 1000,
    };
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
    const chat = this.store.chat(m.from);
    if (chat.messages.some((x) => x.id === m.id)) return;
    m.status = 'received';
    this.insertMessage(chat, m);
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
    if (m.from !== this.pk && (!g.members.includes(m.from) || this.isBlocked(m.from))) return;
    if (!g.members.includes(this.pk)) return;
    const chatId = 'g:' + gid;
    const chat = this.store.chat(chatId);
    if (chat.messages.some((x) => x.id === m.id)) return;
    m.status = m.from === this.pk ? 'sent' : 'received';
    this.insertMessage(chat, m);
    if (m.from === this.pk) return;
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
      if (f.status !== 'blocked') f.status = 'friend';
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
        this.emit('typing', { pk: from, chatId, on: !!c.on });
        break;
      }
      case 'friend': {
        const f = this.state.friends[from] || (this.state.friends[from] = { name: '', status: 'request', since: Date.now() });
        if (c.name) f.name = String(c.name).slice(0, 40);
        if (typeof c.av === 'string' && c.av.length < 20000) f.avatar = c.av;
        if (c.a === 'accept') { if (f.status === 'request') f.status = 'friend'; this.emit('friend', { pk: from, accepted: true }); }
        else if (c.a === 'request') {
          if (f.status === 'friend') this.sendControl(from, { t: 'friend', a: 'accept', name: this.state.profile.name, av: this.state.profile.avatar });
          else this.emit('request', { pk: from, fresh: this.ready });
        }
        break;
      }
      case 'profile': {
        const f = this.state.friends[from];
        if (!f) return;
        if (c.name) f.name = String(c.name).slice(0, 40);
        if (typeof c.av === 'string' && c.av.length < 20000) f.avatar = c.av;
        this.emit('friend', { pk: from });
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
      if (existing && c.ts && c.ts < (existing.ts || 0)) return; // older snapshot
      const g = existing || (this.state.groups[gid] = { name: '', members: [], admin: from, since: Date.now(), ts: 0 });
      const before = new Set(g.members);
      g.name = String(c.n || g.name || 'Group').slice(0, 40);
      g.members = c.m.slice();
      g.ts = c.ts || Date.now();
      if (c.admin && /^[0-9a-f]{64}$/.test(c.admin)) g.admin = c.admin;
      for (const p of c.m) if (!this.state.friends[p] && p !== this.pk) this.state.friends[p] = { name: '', status: 'contact', since: Date.now() };
      if (c.names) for (const [p, n] of Object.entries(c.names)) { const f = this.state.friends[p]; if (f && !f.name && p !== this.pk) f.name = String(n).slice(0, 40); }
      this.store.chat('g:' + gid);
      if (!existing) this.systemMessage('g:' + gid, from === this.pk ? 'You created the group' : `${this.nameOf(from)} added you to the group`, rumor.created_at * 1000);
      else {
        const added = c.m.filter((p) => !before.has(p) && p !== this.pk);
        if (added.length) this.systemMessage('g:' + gid, `${this.nameOf(from)} added ${added.map((p) => this.nameOf(p)).join(', ')}`, rumor.created_at * 1000);
        if (c.n && existing.name && c.n !== existing.name) this.systemMessage('g:' + gid, `${this.nameOf(from)} renamed the group to “${g.name}”`, rumor.created_at * 1000);
      }
      const q = this.pendingGroup[gid]; delete this.pendingGroup[gid];
      if (q) for (const r of q) this.handleRumor(r);
      this.emit('group', { gid });
    } else if (c.op === 'leave') {
      if (!existing || !existing.members.includes(from)) return;
      existing.members = existing.members.filter((p) => p !== from);
      existing.ts = Date.now();
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

  async sendMessage(chatId, { text, img, sticker, replyTo }) {
    const kind = img ? KIND_IMAGE : sticker ? KIND_STICKER : KIND_TEXT;
    const ts = Date.now();
    const tags = [['ms', String(ts)]];
    const group = isGroupId(chatId);
    if (group) tags.push(['g', gidOf(chatId)]); else tags.push(['p', chatId]);
    if (replyTo) tags.push(['re', replyTo.id, replyTo.from || '', String(replyTo.text || '').slice(0, 120)]);
    const rumor = createRumor(this.sk, kind, img || sticker || text, tags);
    const m = { id: rumor.id, from: this.pk, to: group ? '' : chatId, kind: img ? 'image' : sticker ? 'sticker' : 'text', text: text || '', img: img || '', sticker: sticker || '', ts, status: 'pending' };
    if (group) m.g = gidOf(chatId);
    if (replyTo) m.re = { id: replyTo.id, from: replyTo.from || '', text: String(replyTo.text || '').slice(0, 120) };
    const chat = this.store.chat(chatId);
    this.store.markRumor(rumor.id);
    this.insertMessage(chat, m);
    this.store.save();
    try {
      if (group) await this.publishToMany(this.members(chatId), rumor, false, true);
      else await this.publishRumor(chatId, rumor, false, true);
      if (m.status === 'pending') m.status = 'sent';
    } catch (e) {
      m.status = 'failed'; m.error = e.message;
    }
    this.store.save();
    return m;
  }

  async resend(chatId, id) {
    const chat = this.store.chat(chatId);
    const m = chat.messages.find((x) => x.id === id);
    if (!m) return;
    chat.messages.splice(chat.messages.indexOf(m), 1);
    this.store.save();
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
    f.status = 'friend';
    this.store.chat(pk);
    this.store.save();
    this.sendControl(pk, { t: 'friend', a: 'request', name: this.state.profile.name, av: this.state.profile.avatar });
  }

  acceptRequest(pk) {
    const f = this.state.friends[pk]; if (!f) return;
    f.status = 'friend';
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
    if (p.username) this.publishDirectory(true);
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
    const u = this.state.profile.username; if (!u) return;
    const ev = directoryEvent(this.sk, u, on ? this.state.profile.name : '', !on);
    this.transport.publish(ev).catch((e) => console.warn('directory publish failed', e.message));
  }
  lookupUsername(u) { return this.transport.lookup(u); }

  /* ---------- calls ---------- */
  logCall(entry) {
    this.state.calls.unshift(entry);
    if (this.state.calls.length > 200) this.state.calls.length = 200;
    const chat = this.store.chat(entry.peer);
    const id = 'call:' + entry.id;
    if (!chat.messages.some((m) => m.id === id)) {
      this.insertMessage(chat, { id, kind: 'call', from: entry.dir === 'out' ? this.pk : entry.peer, ts: entry.ts, video: entry.video, dur: entry.dur, missed: entry.missed, reason: entry.reason, dir: entry.dir });
    }
    this.store.save();
  }
}
