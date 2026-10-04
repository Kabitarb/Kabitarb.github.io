// Encrypted on-device cache. Everything is serialized, AES-GCM encrypted with a
// key derived from the account secret, and written to IndexedDB.
const DB = 'closechat';

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv').objectStore('kv').get(key);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
}
async function kvSet(key, val) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function kvDel(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

export function emptyState() {
  return {
    version: 1,
    profile: { name: '', avatar: '' },
    friends: {},        // pk -> { name, avatar, status: 'friend'|'request'|'blocked', since }
    chats: {},          // pk -> { messages: [], unread: 0, lastTs: 0, draft: '' }
    calls: [],          // { id, peer, dir: 'in'|'out', video, ts, dur, missed }
    lastSync: 0,        // newest wrap created_at we have processed
    seenRumors: [],
  };
}

export class Store {
  constructor(pubkey, cipher) {
    this.key = 'state:' + pubkey;
    this.cipher = cipher;
    this.state = emptyState();
    this._timer = null;
    this.listeners = new Set();
  }
  async load() {
    try {
      const buf = await kvGet(this.key);
      if (buf) this.state = Object.assign(emptyState(), await this.cipher.decrypt(buf));
    } catch (e) { console.warn('store load failed, starting fresh', e); }
    return this.state;
  }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
    for (const l of this.listeners) l(this.state);
  }
  async flush() {
    clearTimeout(this._timer);
    try { await kvSet(this.key, await this.cipher.encrypt(this.state)); } catch (e) { console.error('store save failed', e); }
  }
  async wipe() { await kvDel(this.key); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  chat(pk) {
    if (!this.state.chats[pk]) this.state.chats[pk] = { messages: [], unread: 0, lastTs: 0, draft: '' };
    return this.state.chats[pk];
  }
  hasRumor(id) { return this.state.seenRumors.includes(id); }
  markRumor(id) {
    this.state.seenRumors.push(id);
    if (this.state.seenRumors.length > 4000) this.state.seenRumors.splice(0, 1000);
  }
}

// Device-level settings (theme etc.) are not secret and live in localStorage.
export const settings = {
  get() {
    try { return Object.assign({ theme: 'dark', accent: 'blue', relays: null, notifications: true, sounds: true }, JSON.parse(localStorage.getItem('closechat:settings') || '{}')); }
    catch { return { theme: 'dark', accent: 'blue', relays: null, notifications: true, sounds: true }; }
  },
  set(patch) { localStorage.setItem('closechat:settings', JSON.stringify(Object.assign(this.get(), patch))); },
};

export const session = {
  get() { return localStorage.getItem('closechat:session'); },
  set(skHex) { localStorage.setItem('closechat:session', skHex); },
  clear() { localStorage.removeItem('closechat:session'); },
};
