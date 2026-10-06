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
export const KIND_VIDEO = 17;        // video message header (JSON meta, poster)
export const KIND_CHUNK = 18;        // one piece of a chunked media payload
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

// Encrypted account backup (friends, groups, profile) as a replaceable event
// only this identity can decrypt. Lets a fresh device or a re-login rebuild the
// friend list even after the relays have expired the original handshakes.
export function backupTag(pk) { return 'closechat:backup:' + pk.slice(0, 16); }
export function backupEvent(sk, obj) {
  const pk = pubkeyOf(sk);
  return finalizeEvent({ kind: DIRECTORY_KIND, content: encryptTo(sk, pk, JSON.stringify(obj)), tags: [['d', backupTag(pk)]], created_at: now() }, sk);
}
export function openBackup(sk, ev) {
  const pk = pubkeyOf(sk);
  if (ev.pubkey !== pk || !verifyEvent(ev)) throw new Error('bad backup');
  return JSON.parse(decryptFrom(sk, pk, ev.content));
}

/* ---------------- keystore (change password) ----------------
 * The identity key stays fixed for the life of the account. A keystore is the
 * identity key wrapped with a key derived from the *current* password, stored
 * as a replaceable event signed by the identity, plus a local copy. Changing
 * the password only re-wraps; friends, history and username are untouched.
 * Only a key derived from the right password can open it. */
export function keystoreTag(username) {
  return 'closechat:ks:' + bytesToHex(sha256(utf8ToBytes('closechat:ks:' + normalizeUsername(username)))).slice(0, 32);
}
export function wrapSecret(kek, sk) { return encryptTo(kek, pubkeyOf(kek), bytesToHex(sk)); }
export function unwrapSecret(kek, wrapped) {
  const hex = decryptFrom(kek, pubkeyOf(kek), wrapped);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('bad keystore');
  return hexToBytes(hex);
}
export function keystoreEvent(sk, kek, username) {
  return finalizeEvent({
    kind: DIRECTORY_KIND,
    content: JSON.stringify({ v: 1, w: wrapSecret(kek, sk) }),
    tags: [['d', keystoreTag(username)]],
    created_at: now(),
  }, sk);
}
// Returns the identity key if this keystore event was locked with `kek`.
export function openKeystore(kek, ev) {
  if (!verifyEvent(ev)) return null;
  try {
    const c = JSON.parse(ev.content);
    const sk = unwrapSecret(kek, c.w);
    return pubkeyOf(sk) === ev.pubkey ? sk : null;
  } catch { return null; }
}

/* ---------------- recovery key ----------------
 * 56-character human-typable encoding of the identity key (base32, with a
 * checksum byte), shown once in Settings. Works with no server at all. */
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
export function encodeRecoveryKey(sk) {
  const bytes = new Uint8Array(35);
  bytes.set(sk);
  const chk = sha256(sk);
  bytes[32] = chk[0]; bytes[33] = chk[1]; bytes[34] = chk[2];
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{1,4}/g).join('-');
}
export function decodeRecoveryKey(str) {
  const s = String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (s.length !== 56) throw new Error('A recovery key has 56 characters');
  let bits = 0, val = 0; const bytes = [];
  for (const ch of s) {
    const v = B32.indexOf(ch); if (v < 0) throw new Error('Invalid character in recovery key');
    val = (val << 5) | v; bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  const sk = new Uint8Array(bytes.slice(0, 32));
  const chk = sha256(sk);
  if (bytes[32] !== chk[0] || bytes[33] !== chk[1] || bytes[34] !== chk[2]) throw new Error('Recovery key has a typo — check it and try again');
  return sk;
}

/* ---------------- email recovery escrow ----------------
 * For users who opt in to email recovery: the identity key is wrapped with a
 * fresh random key R; the recovery server keeps the wrapped blob and R and only
 * hands them back after an emailed code is entered. */
export function makeEscrow(sk) {
  const r = generateSecretKey();
  return { blob: wrapSecret(r, sk), r: bytesToHex(r) };
}
export function openEscrow(escrow) { return unwrapSecret(hexToBytes(escrow.r), escrow.blob); }
export function accountTag(username) { return bytesToHex(sha256(utf8ToBytes('closechat:acct:' + normalizeUsername(username)))); }
// Signed request envelope for the recovery server (NIP-98 style): proves the
// caller holds the identity key without sending it.
export function signedRequest(sk, path, body) {
  return finalizeEvent({
    kind: 27235,
    content: '',
    tags: [['u', path], ['method', 'POST'], ['payload', bytesToHex(sha256(utf8ToBytes(JSON.stringify(body))))]],
    created_at: now(),
  }, sk);
}
