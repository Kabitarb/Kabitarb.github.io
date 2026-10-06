// Chatly recovery server.
//
// What it stores per account (keyed by a hash of the username):
//   - the verified recovery email
//   - the account's public key (so only that identity can change the record)
//   - an "escrow": the identity key wrapped with a random key R, plus R
// It never sees passwords, messages, friends or usernames in clear. Anyone who
// controls this server AND the user's mailbox could recover the account — the
// same trade-off as Telegram's recovery email. Users who never add an email
// are not stored here at all.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { verifyEvent } from 'nostr-tools/pure';

const env = (k, d = '') => process.env[k] ?? d;
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const PORT = +env('PORT', 8787);
const DATA_DIR = env('DATA_DIR', './data');
const APP_NAME = env('APP_NAME', 'Chatly');
const ALLOW_ORIGIN = env('ALLOW_ORIGIN', '*');
const DEV_OUTBOX = env('DEV_OUTBOX') === '1';
const CODE_TTL = 15 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'accounts.json');
let accounts = {};
try { accounts = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
function persist() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts));
  fs.renameSync(tmp, FILE);
}

const pending = new Map();   // acct -> { kind: 'email'|'recover', email, code, exp, tries, pk }
const hits = new Map();      // ip -> [timestamps]
function limited(ip, max = 40) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

let mailer = null;
if (!DEV_OUTBOX && env('SMTP_HOST')) {
  mailer = nodemailer.createTransport({
    host: env('SMTP_HOST'), port: +env('SMTP_PORT', 465), secure: +env('SMTP_PORT', 465) === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
  });
}
async function sendCode(email, code, purpose) {
  const subject = `${APP_NAME}: your ${purpose === 'recover' ? 'password reset' : 'verification'} code is ${code}`;
  const text = purpose === 'recover'
    ? `Someone (hopefully you) asked to reset a ${APP_NAME} password.\n\nYour code: ${code}\n\nIt expires in 15 minutes. If this wasn't you, ignore this email — nothing changes without the code.`
    : `Confirm this address as your ${APP_NAME} recovery email.\n\nYour code: ${code}\n\nIt expires in 15 minutes.`;
  if (DEV_OUTBOX || !mailer) {
    const out = path.join(DATA_DIR, 'outbox.json');
    let box = []; try { box = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
    box.push({ to: email, subject, text, code, purpose, at: Date.now() });
    fs.writeFileSync(out, JSON.stringify(box, null, 1));
    if (!DEV_OUTBOX) console.warn('SMTP not configured — code written to', out);
    return;
  }
  await mailer.sendMail({ from: env('MAIL_FROM', env('SMTP_USER')), to: email, subject, text });
}

const code6 = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const mask = (e) => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(6, Math.max(2, b.length))) + c);
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validAcct = (a) => typeof a === 'string' && /^[0-9a-f]{64}$/.test(a);
const validEscrow = (x) => x && typeof x.blob === 'string' && x.blob.length < 2000 && /^[0-9a-f]{64}$/.test(x.r || '');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Signed requests: { data: '<json string>', auth: <nostr event kind 27235> }
function authed(body, route) {
  const ev = body.auth;
  if (!ev || !verifyEvent(ev) || ev.kind !== 27235) throw httpErr(401, 'bad signature');
  if (Math.abs(Date.now() / 1000 - ev.created_at) > 300) throw httpErr(401, 'request expired');
  const tag = (n) => (ev.tags.find((t) => t[0] === n) || [])[1];
  if (tag('u') !== route || tag('payload') !== sha256(body.data)) throw httpErr(401, 'signature mismatch');
  return { pk: ev.pubkey, data: JSON.parse(body.data) };
}
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function ownerOk(acct, pk) { const rec = accounts[acct]; return !rec || rec.pk === pk; }

const routes = {
  // --- adding a recovery email (logged in, signed) ---
  '/v1/email/start': async (body) => {
    const { pk, data } = authed(body, '/v1/email/start');
    if (!validAcct(data.acct) || !validEmail(data.email)) throw httpErr(400, 'invalid request');
    if (!ownerOk(data.acct, pk)) throw httpErr(403, 'this account belongs to another identity');
    const code = code6();
    pending.set(data.acct, { kind: 'email', email: data.email.trim(), code, exp: Date.now() + CODE_TTL, tries: 0, pk });
    await sendCode(data.email.trim(), code, 'verify');
    return { ok: true };
  },
  '/v1/email/verify': async (body) => {
    const { pk, data } = authed(body, '/v1/email/verify');
    const p = pending.get(data.acct);
    if (!p || p.kind !== 'email' || p.pk !== pk || p.exp < Date.now()) throw httpErr(400, 'code expired — request a new one');
    if (++p.tries > 5) { pending.delete(data.acct); throw httpErr(400, 'too many attempts'); }
    if (String(data.code).trim() !== p.code) throw httpErr(400, 'wrong code');
    if (!validEscrow(data.escrow)) throw httpErr(400, 'missing escrow');
    pending.delete(data.acct);
    accounts[data.acct] = { pk, email: p.email, escrow: data.escrow, verifiedAt: Date.now() };
    persist();
    return { ok: true, email: p.email };
  },
  '/v1/email/status': async (body) => {
    const { pk, data } = authed(body, '/v1/email/status');
    const rec = accounts[data.acct];
    if (!rec || rec.pk !== pk) return { registered: false };
    return { registered: true, email: rec.email, masked: mask(rec.email), hasEscrow: !!rec.escrow };
  },
  // re-upload a fresh escrow (after a password reset, or if the server was redeployed)
  '/v1/email/escrow': async (body) => {
    const { pk, data } = authed(body, '/v1/email/escrow');
    const rec = accounts[data.acct];
    if (!rec || rec.pk !== pk) throw httpErr(404, 'no recovery email on file');
    if (!validEscrow(data.escrow)) throw httpErr(400, 'bad escrow');
    rec.escrow = data.escrow; persist();
    return { ok: true };
  },
  '/v1/email/remove': async (body) => {
    const { pk, data } = authed(body, '/v1/email/remove');
    const rec = accounts[data.acct];
    if (rec && rec.pk === pk) { delete accounts[data.acct]; persist(); }
    return { ok: true };
  },
  // --- forgot password (logged out, unsigned) ---
  '/v1/recover/start': async (body) => {
    const { acct, email } = body;
    if (!validAcct(acct) || !validEmail(email)) throw httpErr(400, 'invalid request');
    const rec = accounts[acct];
    // Always answer ok so nobody can probe which usernames have an email.
    if (rec && rec.escrow && rec.email.toLowerCase() === email.trim().toLowerCase()) {
      const code = code6();
      pending.set(acct, { kind: 'recover', email: rec.email, code, exp: Date.now() + CODE_TTL, tries: 0 });
      await sendCode(rec.email, code, 'recover');
    }
    return { ok: true };
  },
  '/v1/recover/finish': async (body) => {
    const { acct, code } = body;
    const p = pending.get(acct);
    if (!p || p.kind !== 'recover' || p.exp < Date.now()) throw httpErr(400, 'code expired — request a new one');
    if (++p.tries > 5) { pending.delete(acct); throw httpErr(400, 'too many attempts'); }
    if (String(code).trim() !== p.code) throw httpErr(400, 'wrong code');
    pending.delete(acct);
    const rec = accounts[acct];
    if (!rec || !rec.escrow) throw httpErr(400, 'nothing to recover');
    return { escrow: rec.escrow };
  },
};

http.createServer(async (req, res) => {
  const headers = { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, headers); return res.end(JSON.stringify({ service: APP_NAME + ' recovery', ok: true, mail: !!mailer || DEV_OUTBOX })); }
  const handler = routes[url.pathname];
  if (!handler || req.method !== 'POST') { res.writeHead(404, headers); return res.end('{"error":"not found"}'); }
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (limited(ip)) { res.writeHead(429, headers); return res.end('{"error":"too many requests, try later"}'); }
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 20000) req.destroy(); });
  req.on('end', async () => {
    try {
      const out = await handler(JSON.parse(raw || '{}'));
      res.writeHead(200, headers); res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.status || 500, headers); res.end(JSON.stringify({ error: e.status ? e.message : 'server error' }));
      if (!e.status) console.error(e);
    }
  });
}).listen(PORT, () => console.log(`${APP_NAME} recovery server on :${PORT} (${mailer ? 'SMTP ' + env('SMTP_HOST') : DEV_OUTBOX ? 'DEV outbox' : 'NO MAIL CONFIGURED'})`));
