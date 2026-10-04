import { SimplePool } from 'nostr-tools/pool';
import { WRAP_KIND, EPHEMERAL_WRAP_KIND } from './crypto.js';

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

  close() {
    if (this.sub) this.sub.close();
    clearInterval(this._statusTimer);
    this.pool.close(this.relays);
  }
}
