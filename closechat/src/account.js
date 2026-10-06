// Account identity resolution, password change and recovery.
//
// Identity = scrypt(username, password-at-signup). After a password change the
// identity key is wrapped in a keystore locked with the new password (relays +
// local copy); login tries the keystore first and falls back to the direct
// derivation for accounts that never changed their password.
import { deriveSecretKey, pubkeyOf, keystoreTag, keystoreEvent, openKeystore, bytesToHex, hexToBytes, accountTag, makeEscrow, openEscrow, signedRequest, normalizeUsername } from './crypto.js';
import { Transport, DEFAULT_RELAYS } from './relay.js';
import { settings } from './store.js';

const KS_PREFIX = 'closechat:ks:';
export function cachedKeystore(tag) { try { return JSON.parse(localStorage.getItem(KS_PREFIX + tag)); } catch { return null; } }
export function cacheKeystore(tag, ev) { localStorage.setItem(KS_PREFIX + tag, JSON.stringify(ev)); }

async function withTransport(fn) {
  const t = new Transport(settings.get().relays || DEFAULT_RELAYS, () => {});
  try { await t.connect(); return await fn(t); } finally { try { t.close(); } catch {} }
}

// username + password -> identity key. `onStatus(text)` reports progress.
export async function resolveLogin(username, password, onProgress, onStatus = () => {}) {
  const kek = await deriveSecretKey(username, password, onProgress);
  const kekPk = pubkeyOf(kek);
  const tag = keystoreTag(username);
  const local = cachedKeystore(tag);
  if (local) {
    const sk = openKeystore(kek, local);
    if (sk) return { sk, kek, mode: 'keystore' };
    if (local.pubkey === kekPk) throw new Error('This password was changed. Use your current password, or tap “Forgot password?”.');
  }
  onStatus('Checking account…');
  let evs = [];
  try { evs = await withTransport((t) => t.fetchKeystores(tag)); } catch {}
  for (const ev of evs) {
    // a relay copy older than what this device already has is stale (relay missed the newest password)
    if (local && local.pubkey === ev.pubkey && local.created_at >= ev.created_at) continue;
    const sk = openKeystore(kek, ev);
    if (sk) { cacheKeystore(tag, ev); return { sk, kek, mode: 'keystore' }; }
  }
  if (local && local.pubkey !== kekPk) throw new Error('This password was changed. Use your current password, or tap “Forgot password?”.');
  if (evs.some((ev) => ev.pubkey === kekPk)) throw new Error('This password was changed. Use your current password, or tap “Forgot password?”.');
  return { sk: kek, kek, mode: 'direct' };
}

// Lock the (unchanged) identity with a new password: publish + cache keystore.
export async function setPassword(sk, username, newPassword, onProgress, transport = null) {
  const kek = await deriveSecretKey(username, newPassword, onProgress);
  const ev = keystoreEvent(sk, kek, username);
  cacheKeystore(keystoreTag(username), ev);
  const publish = (t) => t.publish(ev);
  if (transport) await publish(transport); else await withTransport(publish);
  return ev;
}

// Re-announce this device's newest keystore so relays that missed it catch up.
export async function republishKeystore(transport, username) {
  const ev = cachedKeystore(keystoreTag(username));
  if (ev) { try { await transport.publish(ev); } catch {} }
}

// Verify the current password without touching anything.
export async function checkPassword(sk, username, password, onProgress) {
  const kek = await deriveSecretKey(username, password, onProgress);
  if (pubkeyOf(kek) === pubkeyOf(sk)) return true;
  const local = cachedKeystore(keystoreTag(username));
  return !!(local && openKeystore(kek, local));
}

/* ---------------- recovery server client ---------------- */
export class RecoveryClient {
  constructor(baseUrl) { this.base = String(baseUrl || '').replace(/\/+$/, ''); }
  get enabled() { return /^https?:\/\//.test(this.base); }
  async post(path, data, sk = null) {
    if (!this.enabled) throw new Error('No recovery server configured');
    const body = sk ? { data: JSON.stringify(data), auth: signedRequest(sk, path, data) } : data;
    // signedRequest hashes JSON.stringify(data); server re-hashes body.data
    let r;
    try { r = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Could not reach the recovery server'); }
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const m = j.error || 'Recovery server error (' + r.status + ')'; throw new Error(m.charAt(0).toUpperCase() + m.slice(1)); }
    return j;
  }
  startEmail(sk, username, email) { return this.post('/v1/email/start', { acct: accountTag(username), email }, sk); }
  verifyEmail(sk, username, code) { return this.post('/v1/email/verify', { acct: accountTag(username), code, escrow: makeEscrow(sk) }, sk); }
  status(sk, username) { return this.post('/v1/email/status', { acct: accountTag(username) }, sk); }
  refreshEscrow(sk, username) { return this.post('/v1/email/escrow', { acct: accountTag(username), escrow: makeEscrow(sk) }, sk); }
  removeEmail(sk, username) { return this.post('/v1/email/remove', { acct: accountTag(username) }, sk); }
  recoverStart(username, email) { return this.post('/v1/recover/start', { acct: accountTag(username), email }); }
  async recoverFinish(username, email, code) {
    const j = await this.post('/v1/recover/finish', { acct: accountTag(username), email, code });
    return openEscrow(j.escrow);
  }
}
export { normalizeUsername, bytesToHex, hexToBytes };
