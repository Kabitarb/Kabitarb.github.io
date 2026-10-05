// All key material is derived and used on-device only. Nothing here ever
// sends the secret key anywhere.
import { scryptAsync } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { getPublicKey, finalizeEvent, verifyEvent, generateSecretKey, getEventHash } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';

const SECP_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

export const WRAP_KIND = 1059;        // stored by relays (messages, receipts, friend handshakes)
export const EPHEMERAL_WRAP_KIND = 21059; // not stored (typing, call signaling)
export const KIND_TEXT = 14;
export const KIND_IMAGE = 15;
export const KIND_STICKER = 16;
export const KIND_CONTROL = 30;
export const DIRECTORY_KIND = 30078; // public username -> identity pointer (opt-in)

export function normalizeUsername(u) {
  return (u || '').trim().toLowerCase().replace(/\s+/g, '');
}

// Deterministic account key: scrypt(password, "closechat:v1:" + username).
// The same username+password on another device yields the same identity, so
// there is no server-side account database at all.
export async function deriveSecretKey(username, password, onProgress) {
  const salt = utf8ToBytes('closechat:v1:' + normalizeUsername(username));
  const dk = await scryptAsync(utf8ToBytes(password.normalize('NFKC')), salt, {
    N: 2 ** 16, r: 8, p: 1, dkLen: 32, asyncTick: 20, onProgress,
  });
  let k = BigInt('0x' + bytesToHex(dk)) % (SECP_N - 1n) + 1n;
  return hexToBytes(k.toString(16).padStart(64, '0'));
}

export function pubkeyOf(sk) { return getPublicKey(sk); }
export { bytesToHex, hexToBytes, generateSecretKey, verifyEvent };

export function friendCode(pk) { return npubEncode(pk); }
export function parseFriendCode(code) {
  code = (code || '').trim();
  const m = code.match(/npub1[02-9ac-hj-np-z]{58}/);
  if (m) {
    try { const d = nip19decode(m[0]); if (d.type === 'npub') return d.data; } catch {}
  }
  if (/^[0-9a-f]{64}$/i.test(code)) return code.toLowerCase();
  return null;
}

const convKeyCache = new Map();
function convKey(sk, pk) {
  const id = bytesToHex(sk).slice(0, 16) + pk;
  let k = convKeyCache.get(id);
  if (!k) { k = nip44.v2.utils.getConversationKey(sk, pk); convKeyCache.set(id, k); }
  return k;
}

export function encryptTo(sk, pk, plaintext) { return nip44.v2.encrypt(plaintext, convKey(sk, pk)); }
export function decryptFrom(sk, pk, payload) { return nip44.v2.decrypt(payload, convKey(sk, pk)); }

function now() { return Math.floor(Date.now() / 1000); }
function randomPastTime(maxSeconds) { return now() - Math.floor(Math.random() * maxSeconds); }

// Rumor -> Seal (signed by sender, encrypted to recipient) -> Gift wrap (signed
// by a throwaway key, encrypted to recipient). Relays only ever see the random
// throwaway key and the recipient's pubkey.
export function createRumor(sk, kind, content, tags = []) {
  const rumor = { kind, content, tags, created_at: now(), pubkey: pubkeyOf(sk) };
  rumor.id = getEventHash(rumor);
  return rumor;
}

export function wrapFor(sk, recipientPk, rumor, { ephemeral = false } = {}) {
  const seal = finalizeEvent({
    kind: 13, content: encryptTo(sk, recipientPk, JSON.stringify(rumor)), tags: [],
    created_at: ephemeral ? now() : randomPastTime(2 * 24 * 3600),
  }, sk);
  const throwaway = generateSecretKey();
  return finalizeEvent({
    kind: ephemeral ? EPHEMERAL_WRAP_KIND : WRAP_KIND,
    content: encryptTo(throwaway, recipientPk, JSON.stringify(seal)),
    tags: [['p', recipientPk]],
    created_at: ephemeral ? now() : randomPastTime(2 * 24 * 3600),
  }, throwaway);
}

export function unwrap(sk, wrap) {
  const seal = JSON.parse(decryptFrom(sk, wrap.pubkey, wrap.content));
  if (seal.kind !== 13 || !verifyEvent(seal)) throw new Error('bad seal');
  const rumor = JSON.parse(decryptFrom(sk, seal.pubkey, seal.content));
  if (rumor.pubkey !== seal.pubkey) throw new Error('rumor/seal pubkey mismatch');
  if (getEventHash(rumor) !== rumor.id) throw new Error('rumor id mismatch');
  return rumor;
}

// Local-at-rest encryption for the on-device cache (AES-GCM, key derived from
// the account secret, never stored).
export async function localCipher(sk) {
  const raw = hkdf(sha256, sk, utf8ToBytes('closechat-local-store'), utf8ToBytes('v1'), 32);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async encrypt(obj) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8ToBytes(JSON.stringify(obj)));
      const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
      return out;
    },
    async decrypt(buf) {
      const u = new Uint8Array(buf);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
      return JSON.parse(new TextDecoder().decode(pt));
    },
  };
}

export function shortId(pk) { return pk.slice(0, 8); }

export function directoryTag(username) { return 'closechat:user:' + normalizeUsername(username); }
// Signed, replaceable "I am <username>" pointer so friends can find you by
// username. Contains no avatar and nothing private; publishing is optional.
export function directoryEvent(sk, username, name, remove = false) {
  return finalizeEvent({
    kind: DIRECTORY_KIND,
    content: remove ? '' : JSON.stringify({ u: normalizeUsername(username), n: String(name || '').slice(0, 40) }),
    tags: [['d', directoryTag(username)]],
    created_at: now(),
  }, sk);
}
