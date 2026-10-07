import { SimplePool } from 'nostr-tools/pool';
import { WRAP_KIND, EPHEMERAL_WRAP_KIND, DIRECTORY_KIND, directoryTag, verifyEvent } from './crypto.js';

export const DEFAULT_RELAYS = [
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nos.lol',
  'wss://relay.damus.io',
];

export class Transport {
  constructor(relays, onStatus) {
    this.relays = relays && relays.length ? relays : DEFAULT_RELAYS.slice();
    this.onStatus = onStatus || (() => {});
    this.pool = new SimplePool({
      enableReconnect: true, enablePing: true, maxWaitForConnection: 8000,
      onRelayConnectionSuccess: () => this.reportStatus(),
      onRelayConnectionFailure: () => this.reportStatus(),
    });
    this.sub = null;
    this.seen = new Set();
    this.connected = 0;
  }

  reportStatus() {
    let n = 0;
    for (const url of this.relays) {
      const r = this.pool.relays.get(url) || this.pool.relays.get(url.replace(/\/?$/, '/'));
      if (r && r.connected) n++;
    }
    this.connected = n;
    this.onStatus(n, this.relays.length);
  }

  async connect() {
    await Promise.allSettled(this.relays.map((u) => this.pool.ensureRelay(u, { connectionTimeout: 8000 })));
    this.reportStatus();
    this._statusTimer = setInterval(() => this.reportStatus(), 5000);
  }

  // Re-open every relay socket that died while the page was frozen.
  async reconnect() {
    await Promise.allSettled(this.relays.map(async (u) => {
      const r = this.pool.relays.get(u) || this.pool.relays.get(u.replace(/\/?$/, '/'));
      if (r && r.connected) return;
      if (r) { try { r.close(); } catch {} this.pool.relays.delete(u); this.pool.relays.delete(u.replace(/\/?$/, '/')); }
      try { await this.pool.ensureRelay(u, { connectionTimeout: 8000 }); } catch {}
    }));
    this.reportStatus();
  }

  // Subscribe to everything addressed to us. `since` is the newest stored
  // wrap we already have (minus slack for randomized timestamps).
  listen(pubkey, since, onWrap, onEose) {
    if (this.sub) this.sub.close();
    const filter = { kinds: [WRAP_KIND, EPHEMERAL_WRAP_KIND], '#p': [pubkey] };
    if (since) filter.since = since;
    this.sub = this.pool.subscribeMany(this.relays, filter, {
      onevent: (ev) => {
        if (this.seen.has(ev.id)) return;
        this.seen.add(ev.id);
        if (this.seen.size > 5000) { const it = this.seen.values(); for (let i = 0; i < 1000; i++) this.seen.delete(it.next().value); }
        onWrap(ev);
      },
      oneose: () => onEose && onEose(),
      onclose: () => this.reportStatus(),
    });
  }

  async publish(event) {
    const results = await Promise.allSettled(this.pool.publish(this.relays, event));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (!ok) {
      const reason = results.map((r) => r.reason && r.reason.message).filter(Boolean)[0] || 'no relay accepted the message';
      throw new Error(reason);
    }
    return ok;
  }

  // Find accounts that published a directory pointer for this username.
  async lookup(username) {
    const tag = directoryTag(username);
    const evs = await this.pool.querySync(this.relays, { kinds: [DIRECTORY_KIND], '#d': [tag] }, { maxWait: 6000 });
    const byPk = new Map();
    for (const ev of evs) {
      if (!verifyEvent(ev)) continue;
      let c = null;
      if (ev.content) { try { c = JSON.parse(ev.content); } catch { continue; } if (c.u !== tag.slice('closechat:user:'.length)) continue; }
      const prev = byPk.get(ev.pubkey);
      // keep the newest record per identity; an empty one means "removed"
      if (!prev || prev.created_at < ev.created_at) byPk.set(ev.pubkey, { pk: ev.pubkey, name: c ? c.n || '' : '', created_at: ev.created_at, removed: !c });
    }
    for (const [pk, r] of byPk) if (r.removed) byPk.delete(pk);
    return [...byPk.values()].sort((a, b) => a.created_at - b.created_at);
  }

  // Newest encrypted account backup published by this identity (or null).
  async fetchBackup(pk, tag) {
    const evs = await this.pool.querySync(this.relays, { kinds: [DIRECTORY_KIND], authors: [pk], '#d': [tag] }, { maxWait: 7000 });
    let best = null;
    for (const ev of evs) if (ev.pubkey === pk && verifyEvent(ev) && (!best || ev.created_at > best.created_at)) best = ev;
    return best;
  }

  // Every keystore published under this username tag (any author); the caller
  // tries to open each with the password-derived key.
  async fetchKeystores(tag) {
    const evs = await this.pool.querySync(this.relays, { kinds: [DIRECTORY_KIND], '#d': [tag] }, { maxWait: 7000 });
    const byPk = new Map();
    for (const ev of evs) if (verifyEvent(ev) && (!byPk.has(ev.pubkey) || byPk.get(ev.pubkey).created_at < ev.created_at)) byPk.set(ev.pubkey, ev);
    return [...byPk.values()];
  }

  close() {
    if (this.sub) this.sub.close();
    clearInterval(this._statusTimer);
    this.pool.close(this.relays);
  }
}
