import {
  pubkeyOf, createRumor, wrapFor, unwrap, KIND_TEXT, KIND_IMAGE, KIND_CONTROL, WRAP_KIND,
} from './crypto.js';

// Core protocol layer: turns decrypted rumors into state changes and state
// changes into encrypted gift wraps.
export class App extends EventTarget {
  constructor(sk, store, transport) {
    super();
    this.sk = sk;
    this.pk = pubkeyOf(sk);
    this.store = store;
    this.transport = transport;
    this.openChat = null;      // pk of chat currently on screen
    this.visible = true;
    this.typingSent = {};
    this.callHandler = null;
    this.ready = false;
  }

  get state() { return this.store.state; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async start() {
    await this.transport.connect();
    const since = this.state.lastSync ? this.state.lastSync - 3 * 24 * 3600 : Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    this.transport.listen(this.pk, since, (w) => this.handleWrap(w), () => { this.ready = true; this.emit('ready'); });
  }

  isFriend(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'friend'; }
  isBlocked(pk) { const f = this.state.friends[pk]; return !!f && f.status === 'blocked'; }
  nameOf(pk) {
    if (pk === this.pk) return this.state.profile.name || 'You';
    const f = this.state.friends[pk];
    return (f && f.name) || 'Friend ' + pk.slice(0, 6);
  }

  handleWrap(wrap) {
    let rumor;
    try { rumor = unwrap(this.sk, wrap); } catch (e) { return; }
    if (wrap.kind === WRAP_KIND && wrap.created_at > this.state.lastSync) this.state.lastSync = wrap.created_at;
    if (this.store.hasRumor(rumor.id)) { this.store.save(); return; }
    this.store.markRumor(rumor.id);
    try {
      if (rumor.kind === KIND_TEXT || rumor.kind === KIND_IMAGE) this.handleMessage(rumor);
      else if (rumor.kind === KIND_CONTROL) this.handleControl(rumor);
    } catch (e) { console.error('bad rumor', e); }
    this.store.save();
  }

  messageFromRumor(rumor) {
    const msTag = rumor.tags.find((t) => t[0] === 'ms');
    const to = (rumor.tags.find((t) => t[0] === 'p') || [])[1];
    return {
      id: rumor.id, from: rumor.pubkey, to,
      kind: rumor.kind === KIND_IMAGE ? 'image' : 'text',
      text: rumor.kind === KIND_TEXT ? rumor.content : '',
      img: rumor.kind === KIND_IMAGE ? rumor.content : '',
      ts: msTag ? Number(msTag[1]) : rumor.created_at * 1000,
    };
  }

  handleMessage(rumor) {
    const m = this.messageFromRumor(rumor);
    if (m.from === this.pk) {
      // Copy of something we sent (possibly from another device of ours).
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
    this.emit('typing', { pk: m.from, on: false });
    this.emit('message', { pk: m.from, message: m, fresh: this.ready });
  }

  insertMessage(chat, m) {
    chat.messages.push(m);
    chat.messages.sort((a, b) => a.ts - b.ts);
    if (m.ts > chat.lastTs) chat.lastTs = m.ts;
    if (chat.messages.length > 2000) chat.messages.splice(0, chat.messages.length - 2000);
  }

  // Copies of our own control messages (friend adds, name changes, blocks) are
  // also wrapped to ourselves so a second device of the same account can
  // rebuild the friend list from the relays.
  handleOwnControl(rumor, c) {
    const to = (rumor.tags.find((t) => t[0] === 'p') || [])[1];
    if (c.t === 'friend' && to && to !== this.pk) {
      const f = this.state.friends[to] || (this.state.friends[to] = { name: '', since: Date.now() });
      if (f.status !== 'blocked') f.status = 'friend';
      this.store.chat(to);
    } else if (c.t === 'profile' && c.name) {
      this.state.profile.name = String(c.name).slice(0, 40);
    } else if (c.t === 'block' && c.pk) {
      const f = this.state.friends[c.pk] || (this.state.friends[c.pk] = { name: '', since: Date.now() });
      f.status = c.on ? 'blocked' : 'friend';
    } else if (c.t === 'unfriend' && c.pk) {
      delete this.state.friends[c.pk]; delete this.state.chats[c.pk];
    }
  }

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
      case 'typing':
        if (!this.isFriend(from) || ageSec > 15) return;
        this.emit('typing', { pk: from, on: !!c.on });
        break;
      case 'friend': {
        const f = this.state.friends[from] || (this.state.friends[from] = { name: '', status: 'request', since: Date.now() });
        if (c.name) f.name = String(c.name).slice(0, 40);
        if (c.a === 'accept') { if (f.status === 'request') f.status = 'friend'; this.emit('friend', { pk: from, accepted: true }); }
        else if (c.a === 'request') {
          if (f.status === 'friend') this.sendControl(from, { t: 'friend', a: 'accept', name: this.state.profile.name });
          else this.emit('request', { pk: from, fresh: this.ready });
        }
        break;
      }
      case 'profile': {
        const f = this.state.friends[from];
        if (f && c.name) { f.name = String(c.name).slice(0, 40); this.emit('friend', { pk: from }); }
        break;
      }
      case 'call':
        if (!this.isFriend(from) || ageSec > 90) return;
        if (this.callHandler) this.callHandler(from, c, rumor);
        break;
    }
  }

  async publishRumor(toPk, rumor, ephemeral = false, copyToSelf = false) {
    const wraps = [wrapFor(this.sk, toPk, rumor, { ephemeral })];
    if (copyToSelf && toPk !== this.pk) wraps.push(wrapFor(this.sk, this.pk, rumor, { ephemeral }));
    const res = await Promise.allSettled(wraps.map((w) => this.transport.publish(w)));
    if (res[0].status === 'rejected') throw res[0].reason;
  }

  async sendControl(pk, obj, ephemeral = false) {
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), [['p', pk]]);
    const copyToSelf = !ephemeral && (obj.t === 'friend' || obj.t === 'profile');
    try { await this.publishRumor(pk, rumor, ephemeral, copyToSelf); } catch (e) { console.warn('control send failed', obj.t, e.message); }
  }

  // Private note-to-self so other devices of this account learn about it.
  syncToSelf(obj) {
    const rumor = createRumor(this.sk, KIND_CONTROL, JSON.stringify(obj), [['p', this.pk]]);
    this.store.markRumor(rumor.id);
    this.publishRumor(this.pk, rumor).catch((e) => console.warn('self sync failed', e.message));
  }

  async sendMessage(pk, { text, img }) {
    const kind = img ? KIND_IMAGE : KIND_TEXT;
    const ts = Date.now();
    const rumor = createRumor(this.sk, kind, img || text, [['p', pk], ['ms', String(ts)]]);
    const m = { id: rumor.id, from: this.pk, to: pk, kind: img ? 'image' : 'text', text: text || '', img: img || '', ts, status: 'pending' };
    const chat = this.store.chat(pk);
    this.store.markRumor(rumor.id);
    this.insertMessage(chat, m);
    this.store.save();
    try {
      await this.publishRumor(pk, rumor, false, true);
      if (m.status === 'pending') m.status = 'sent';
    } catch (e) {
      m.status = 'failed'; m.error = e.message;
    }
    this.store.save();
    return m;
  }

  async resend(pk, id) {
    const chat = this.store.chat(pk);
    const m = chat.messages.find((x) => x.id === id);
    if (!m) return;
    chat.messages.splice(chat.messages.indexOf(m), 1);
    this.store.save();
    return this.sendMessage(pk, { text: m.text, img: m.img });
  }

  typing(pk) {
    const last = this.typingSent[pk] || 0;
    if (Date.now() - last < 4000) return;
    this.typingSent[pk] = Date.now();
    this.sendControl(pk, { t: 'typing', on: true }, true);
  }

  setOpenChat(pk) {
    this.openChat = pk;
    if (pk) this.markRead(pk);
  }

  markRead(pk) {
    const chat = this.store.chat(pk);
    chat.unread = 0;
    if (this.isFriend(pk)) {
      const ids = chat.messages.filter((m) => m.from === pk && m.acked !== 'read').map((m) => { m.acked = 'read'; return m.id; });
      if (ids.length) this.sendControl(pk, { t: 'receipt', ids: ids.slice(-50), s: 'read' });
    }
    this.store.save();
  }

  addFriend(pk) {
    if (pk === this.pk) throw new Error("That's your own code");
    const f = this.state.friends[pk] || (this.state.friends[pk] = { name: '', since: Date.now() });
    f.status = 'friend';
    this.store.chat(pk);
    this.store.save();
    this.sendControl(pk, { t: 'friend', a: 'request', name: this.state.profile.name });
  }

  acceptRequest(pk) {
    const f = this.state.friends[pk]; if (!f) return;
    f.status = 'friend';
    const chat = this.store.chat(pk);
    const ids = chat.messages.filter((m) => m.from === pk).map((m) => { m.acked = 'delivered'; return m.id; });
    if (ids.length) this.sendControl(pk, { t: 'receipt', ids: ids.slice(-50), s: 'delivered' });
    this.sendControl(pk, { t: 'friend', a: 'accept', name: this.state.profile.name });
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
  clearChat(pk) { const c = this.store.chat(pk); c.messages = []; c.unread = 0; this.store.save(); }

  setName(name) {
    this.state.profile.name = name.trim().slice(0, 40);
    this.store.save();
    const friends = Object.entries(this.state.friends).filter(([, f]) => f.status === 'friend');
    for (const [pk] of friends) this.sendControl(pk, { t: 'profile', name: this.state.profile.name });
    if (!friends.length) this.syncToSelf({ t: 'profile', name: this.state.profile.name });
  }

  logCall(entry) {
    this.state.calls.unshift(entry);
    if (this.state.calls.length > 200) this.state.calls.length = 200;
    this.store.save();
  }
}
