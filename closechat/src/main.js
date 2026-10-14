import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { deriveSecretKey, pubkeyOf, bytesToHex, hexToBytes, friendCode, parseFriendCode, localCipher, normalizeUsername } from './crypto.js';
import { Transport, DEFAULT_RELAYS } from './relay.js';
import { encodeRecoveryKey, decodeRecoveryKey } from './crypto.js';
import { resolveLogin, usernameTaken, setPassword, checkPassword, republishKeystore, RecoveryClient } from './account.js';
import { Store, settings, session } from './store.js';
import { App, isGroupId, gidOf, profileFp, EXPIRE_OPTIONS } from './app.js';
import { CallManager, Tones } from './rtc.js';
import { GroupCallManager } from './groupcall.js';
import { PACKS, stickerIds, stickerSvg, animIds, animOf, animHtml } from './stickers.js';
import { GameManager, GAMES, VIEWS, GAME_ORDER } from './games.js';
import { ShareManager } from './share.js';
import { WatchManager, parseMedia, MEDIA_RE } from './watch.js';
import { TV_CHANNELS, TV_CATS, tvUrl, tvHue } from './tv.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let app = null, calls = null, games = null, watch = null, share = null, transport = null, store = null;
// Owner: set this to your deployed recovery server (see server/README.md) so
// every user gets "Forgot password by email"; users can override in Settings.
const DEFAULT_RECOVERY_SERVER = '';
let rc = new RecoveryClient(settings.get().recoveryServer || DEFAULT_RECOVERY_SERVER);
let accountSk = null;      // identity key of the logged-in account (for signed recovery-server requests)
const tones = new Tones();
let currentTab = 'chats';
let typingTimers = {};
let typingState = {};   // chatId -> { pk, on }
let replyTo = null;
let pendingAdd = null;  // from #add= invite link
const GROUP_SVG = '<svg viewBox="0 0 24 24"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 1c-3.9 0-7 2-7 4.5V20h14v-2.5C16 15 12.9 13 9 13Zm7 1c-.6 0-1.2.1-1.8.2 1.7 1 2.8 2.4 2.8 4.3V20h6v-2c0-2.2-3.1-4-7-4Z"/></svg>';
const REPLY_SVG = '<svg viewBox="0 0 24 24"><path d="M10 7V4L3 10l7 6v-3.2c4.5 0 7.6 1.4 10 4.7-1-4.7-4-9.4-10-10.5Z"/></svg>';

/* ---------------- theme ---------------- */
function applyTheme() {
  const s = settings.get();
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.accent = s.accent;
  document.documentElement.dataset.font = s.font || 'normal';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1016';
}

/* ---------------- helpers ---------------- */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => window.innerWidth < 860;
// Run a UI change inside a View Transition (smooth crossfade) when available.
function withTransition(fn) { if (document.startViewTransition && !reducedMotion()) document.startViewTransition(fn); else fn(); }
// FLIP: remember where list rows were, then slide them to their new place after a re-render.
function flipSnap(el) { const m = new Map(); el.querySelectorAll('.item[data-id]').forEach((i) => m.set(i.dataset.id, i.getBoundingClientRect().top)); return m; }
function flipPlay(el, before) {
  if (!before.size || reducedMotion()) return;
  el.querySelectorAll('.item[data-id]').forEach((i) => {
    const b = before.get(i.dataset.id);
    if (b === undefined) { i.classList.add('enter'); return; }
    const d = b - i.getBoundingClientRect().top;
    if (Math.abs(d) < 2) return;
    // the row moving up (newest message) floats above the ones it crosses
    i.style.transition = 'none'; i.style.transform = `translateY(${d}px)`;
    if (d > 0) { i.style.position = 'relative'; i.style.zIndex = '2'; i.style.background = 'var(--bg)'; }
    i.getBoundingClientRect();
    i.style.transition = 'transform .45s var(--ios)'; i.style.transform = '';
    i.addEventListener('transitionend', () => { i.style.transition = ''; i.style.position = ''; i.style.zIndex = ''; i.style.background = ''; }, { once: true });
  });
}
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
const native = (window.webkit && window.webkit.messageHandlers) || {};
const nativeAudio = native.audioRoute || null;   // iOS shell: earpiece/speaker routing
const nativeHaptic = native.haptic || null;      // iOS shell: vibration (no navigator.vibrate in WebKit)
const nativeNotify = native.notify || null;      // iOS shell: local notifications with Reply / Answer / Decline
const nativeKeep = native.keepAlive || null;     // iOS shell: stay connected while minimized
const shellVersion = (navigator.userAgent.match(/CloseChatiOS\/(\d+(?:\.\d+)*)/) || [])[1] || '';
let shellBg = false;                              // iOS shell told us it is minimized
function nativePost(h, msg) { try { h.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {} }
// iPhone shell: compare the shell's version (from the user agent) with app/source.json and
// offer the in-place update (Feather / ESign source) when a newer .ipa exists.
async function checkShellUpdate() {
  if (!shellVersion) return;
  try {
    const r = await fetch('app/source.json', { cache: 'no-store' });
    const a = (await r.json()).apps[0];
    const newer = (x, y) => { const p = x.split('.').map(Number), q = y.split('.').map(Number); for (let i = 0; i < Math.max(p.length, q.length); i++) { if ((p[i] || 0) !== (q[i] || 0)) return (p[i] || 0) > (q[i] || 0); } return false; };
    if (!newer(a.version, shellVersion) || settings.get().skipShell === a.version) return;
    let el = $('update-banner');
    if (!el) { el = document.createElement('div'); el.id = 'update-banner'; document.body.appendChild(el); }
    el.className = '';
    el.innerHTML = `<div class="grow"><div>Chatly ${esc(a.version)} for iPhone is ready</div><div class="tiny">${esc((a.versionDescription || '').slice(0, 90))}</div></div><button class="later">Later</button><button class="go">Update</button>`;
    el.querySelector('.go').onclick = () => { haptic(); location.href = 'app/'; };
    el.querySelector('.later').onclick = () => { settings.set({ skipShell: a.version }); el.classList.add('hidden'); };
    setTimeout(() => el.classList.add('hidden'), 20000);
  } catch {}
}
function applyKeepAlive() { if (nativeKeep) nativePost(nativeKeep, settings.get().bgKeepAlive !== false ? 'on' : 'off'); }
function haptic(ms = 12) {
  if (!settings.get().haptics) return;
  if (nativeHaptic) { try { nativeHaptic.postMessage(Array.isArray(ms) || ms >= 100 ? 'ring' : 'tap'); } catch {} return; }
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}
const COLORS = ['#2d8cff', '#8b5cf6', '#22c55e', '#ec4899', '#f97316', '#14b8a6', '#ef4444', '#eab308'];
function colorOf(id) { let h = 0; const s = String(id || ''); for (let i = 0; i < Math.min(16, s.length); i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0][0] || '') + (p[1] ? p[1][0] : '')).toUpperCase(); }
function avatarInner(id, name = '') {
  if (isGroupId(id)) { const g = app && app.group(id); return g && g.av && /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(g.av) ? `<img src="${g.av}" alt="">` : GROUP_SVG; }
  const av = app ? app.avatarOf(id) : '';
  const known = app && (app.isFriend(id) || id === app.pk);
  return av ? `<img src="${av}" alt="">` : esc(initials(name && !known ? name : app ? app.nameOf(id) : '?'));
}
function isOnline(id) { return !!app && !isGroupId(id) && id !== app.pk && app.isOnline(id); }
function avatarHtml(id, cls = '', name = '') {
  const group = isGroupId(id);
  return `<div class="avatar ${cls} ${group ? 'group' : ''} ${isOnline(id) ? 'online' : ''}" style="${group ? '' : 'background:' + colorOf(id)}">${avatarInner(id, name)}</div>`;
}
function setAvatar(el, id) {
  const group = isGroupId(id);
  el.classList.toggle('group', group);
  el.classList.toggle('online', isOnline(id));
  el.style.background = group ? '' : colorOf(id);
  el.innerHTML = avatarInner(id);
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ts);
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtClock(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function fmtAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDur(s) { const m = Math.floor(s / 60), r = s % 60; return m ? `${m}m ${r}s` : `${r}s`; }
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function previewOf(m) {
  if (!m) return '';
  if (m.kind === 'image') return '📷 Photo';
  if (m.kind === 'video') return '🎬 Video';
  if (m.kind === 'sticker') { const a = animOf(m.sticker); return a ? a.e + ' Animated emoji' : '💟 Sticker'; }
  if (m.kind === 'call') return `${m.video ? '📹' : '📞'} ${m.reason === 'declined' ? 'Declined ' : m.missed ? 'Missed ' : ''}${m.video ? 'Video' : 'Voice'} call${m.dur ? ' · ' + fmtDur(m.dur) : ''}`;
  if (m.kind === 'game') return `🎮 ${m.text}`;
  if (m.kind === 'system') return m.text;
  return m.text;
}
function inviteLink() {
  const n = app.state.profile.name ? '&n=' + encodeURIComponent(app.state.profile.name) : '';
  return location.origin + location.pathname + '#add=' + friendCode(app.pk) + n;
}

let modalTimer = null;
function showModal(html) {
  clearTimeout(modalTimer);
  const m = $('modal'), body = $('modal-body');
  m.classList.remove('closing'); body.classList.remove('dragging', 'settle'); body.style.transform = '';
  body.innerHTML = html; m.classList.remove('hidden');
}
function hideModal() {
  const m = $('modal'), body = $('modal-body');
  stopScanner();
  if (m.classList.contains('hidden')) return;
  if (reducedMotion()) { m.classList.add('hidden'); body.innerHTML = ''; body.style.transform = ''; return; }
  m.classList.add('closing');
  clearTimeout(modalTimer);
  modalTimer = setTimeout(() => { m.classList.add('hidden'); m.classList.remove('closing'); body.innerHTML = ''; body.style.transform = ''; body.classList.remove('dragging', 'settle'); }, 320);
}
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) hideModal(); });
// iOS-style sheet: drag down from the top of the sheet to dismiss, spring back otherwise.
(() => {
  const body = $('modal-body');
  let start = null, lastY = 0, lastT = 0, vel = 0, drag = false;
  body.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('canvas, input, textarea, select, video, [data-nodrag]')) return;
    if (body.scrollTop > 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }; lastY = e.clientY; lastT = performance.now(); vel = 0; drag = false;
  });
  body.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!drag) { if (dy > 10 && dy > Math.abs(dx) * 1.3) { drag = true; body.classList.add('dragging'); body.classList.remove('settle'); try { body.setPointerCapture(e.pointerId); } catch {} } else return; }
    const now = performance.now(); vel = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
    const y = dy > 0 ? dy : -Math.pow(-dy, .6);   // rubber-band when pulled up
    body.style.transform = `translateY(${y}px)`;
    e.preventDefault();
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y; start = null;
    if (!drag) return;
    drag = false; body.classList.remove('dragging');
    if (dy > 110 || (vel > .6 && dy > 50)) { haptic(8); hideModal(); }
    else { body.classList.add('settle'); body.style.transform = ''; }
  };
  body.addEventListener('pointerup', end); body.addEventListener('pointercancel', end);
  // Decide on the first finger move: pulling down is ours (no browser scroll -> no pointercancel),
  // pushing up at the top hands the touch to the browser so the sheet content scrolls.
  body.addEventListener('touchmove', (e) => {
    if (!start || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - start.y, dx = e.touches[0].clientX - start.x;
    if (!drag && dy < 0 && -dy > Math.abs(dx)) { start = null; return; }
    if (drag || dy > 0) e.preventDefault();
  }, { passive: false });
})();
// Photo viewer: zooms out of the tapped thumbnail and back (shared-element style).
let viewerTimer = null;
function openViewer(src, fromEl) {
  clearTimeout(viewerTimer);
  const v = $('viewer'), im = v.querySelector('img');
  v.classList.remove('closing'); im.style.transition = 'none'; im.style.transform = ''; im.style.borderRadius = '';
  im.src = src; v.classList.remove('hidden');
  if (!fromEl || reducedMotion()) return;
  const r = fromEl.getBoundingClientRect();
  const run = () => {
    const t = im.getBoundingClientRect(); if (!t.width || !t.height) return;
    im.style.transformOrigin = 'top left';
    im.style.transform = `translate(${r.left - t.left}px, ${r.top - t.top}px) scale(${r.width / t.width}, ${r.height / t.height})`;
    im.style.borderRadius = '18px';
    im.getBoundingClientRect();
    im.style.transition = 'transform .5s var(--ios), border-radius .5s var(--ios)';
    im.style.transform = ''; im.style.borderRadius = '0';
  };
  if (im.complete && im.naturalWidth) requestAnimationFrame(run); else im.onload = () => requestAnimationFrame(run);
}
function closeViewer() {
  const v = $('viewer'); if (v.classList.contains('hidden')) return;
  if (reducedMotion()) { v.classList.add('hidden'); return; }
  v.classList.add('closing');
  viewerTimer = setTimeout(() => { v.classList.add('hidden'); v.classList.remove('closing'); }, 280);
}
$('viewer').addEventListener('click', closeViewer);

function confirmSheet(title, text, okLabel, danger = true) {
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" id="c-no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="c-ok">${esc(okLabel)}</button></div>`);
    $('c-no').onclick = () => { hideModal(); res(false); };
    $('c-ok').onclick = () => { hideModal(); res(true); };
  });
}
function promptSheet(title, value, placeholder, hint = '') {
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3>${hint ? `<p class="muted tiny">${esc(hint)}</p>` : ''}<div class="row"><input type="text" id="p-in" maxlength="300" placeholder="${esc(placeholder || '')}"></div><div class="row" style="justify-content:flex-end"><button class="btn ghost" id="p-no">Cancel</button><button class="btn primary" id="p-ok">OK</button></div>`);
    const i = $('p-in'); i.value = value || ''; i.focus();
    $('p-no').onclick = () => { hideModal(); res(null); };
    $('p-ok').onclick = () => { const v = i.value.trim(); hideModal(); res(v); };
    i.onkeydown = (e) => { if (e.key === 'Enter') $('p-ok').click(); };
  });
}
const RX_MORE = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🔥', '🎉', '👏', '🙏', '💯', '😍', '🥰', '😘', '😎', '🤔', '🙄', '😴', '🤣', '😅', '😭', '🥺', '😤', '🤯', '🥳', '🤩', '😇', '💀', '👀', '💪', '🫶', '💔', '✨', '⭐', '🌟', '🍕', '☕', '🎮', '🎲'];
function reactionMenu(items, mine, onReact) {
  return new Promise((res) => {
    showModal(`<div class="rx-bar">${QUICK_RX.map((e) => `<button type="button" data-rx="${e}" class="${mine === e ? 'on' : ''}">${e}</button>`).join('')}<button type="button" data-rx="+" class="more">+</button></div>
      <div class="menu">${items.map((it) => `<button data-mi="${it.id}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')}<button data-mi="">Cancel</button></div>`);
    const body = $('modal-body');
    const bind = () => {
      body.querySelectorAll('[data-rx]').forEach((b) => {
        b.onclick = () => {
          const e = b.dataset.rx;
          if (e === '+') { body.querySelector('.rx-bar').outerHTML = `<div class="rx-grid">${RX_MORE.map((x) => `<button type="button" data-rx="${x}" class="${mine === x ? 'on' : ''}">${x}</button>`).join('')}</div>`; bind(); return; }
          haptic(); hideModal(); onReact(e); res(null);
        };
      });
      body.querySelectorAll('[data-mi]').forEach((b) => { b.onclick = () => { hideModal(); res(b.dataset.mi || null); }; });
    };
    bind();
  });
}
function menuSheet(items) {
  // items: [{ id, label, danger }]
  return new Promise((res) => {
    showModal(`<div class="menu">${items.map((it) => `<button data-mi="${it.id}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')}<button data-mi="">Cancel</button></div>`);
    $('modal-body').querySelectorAll('[data-mi]').forEach((b) => { b.onclick = () => { hideModal(); res(b.dataset.mi || null); }; });
  });
}

/* ---------------- auth ---------------- */
$('show-signup').onclick = (e) => { e.preventDefault(); $('login-form').classList.add('hidden'); $('signup-form').classList.remove('hidden'); };
$('show-login').onclick = (e) => { e.preventDefault(); $('signup-form').classList.add('hidden'); $('login-form').classList.remove('hidden'); };

function progressOf(progressEl) {
  progressEl.classList.remove('hidden');
  const bar = progressEl.firstElementChild; bar.style.width = '0%';
  return (p) => { bar.style.width = Math.round(p * 100) + '%'; };
}
async function derive(username, password, progressEl) {
  const sk = await deriveSecretKey(username, password, progressOf(progressEl));
  progressEl.firstElementChild.style.width = '100%';
  return sk;
}

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const u = $('login-user').value, p = $('login-pass').value; const err = $('login-error'); err.textContent = '';
  if (normalizeUsername(u).length < 3) { err.textContent = 'Enter your username.'; return; }
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Unlocking…';
  try {
    const { sk } = await resolveLogin(u, p, progressOf($('login-progress')), (t) => { btn.textContent = t; });
    await startApp(sk, null, u);
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Log In'; $('login-progress').classList.add('hidden');
};

$('signup-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('signup-name').value.trim(), u = $('signup-user').value, p = $('signup-pass').value, p2 = $('signup-pass2').value;
  const err = $('signup-error'); err.textContent = '';
  if (!name) { err.textContent = 'Enter your name.'; return; }
  if (normalizeUsername(u).length < 3) { err.textContent = 'Username must be at least 3 characters.'; return; }
  if (p.length < 12) { err.textContent = 'Use at least 12 characters for your password.'; return; }
  if (p !== p2) { err.textContent = 'Passwords do not match.'; return; }
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking username…';
  try {
    let taken = false; try { taken = await usernameTaken(u); } catch {}
    if (taken) throw new Error('That username is already taken. Pick another, or log in if it is yours.');
    btn.textContent = 'Creating keys…';
    const sk = await derive(u, p, $('signup-progress'));
    await startApp(sk, name, u);
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Create Account'; $('signup-progress').classList.add('hidden');
};

/* ---------------- forgot password ---------------- */
let forgot = { mode: 'key', stage: 'start', sk: null };
function showAuthForm(id) { ['login-form', 'signup-form', 'forgot-form'].forEach((f) => $(f).classList.toggle('hidden', f !== id)); }
function setForgotMode(mode) {
  forgot.mode = mode; forgot.stage = 'start'; forgot.sk = null;
  $('forgot-key-step').classList.toggle('hidden', mode !== 'key');
  $('forgot-email-step').classList.toggle('hidden', mode !== 'email');
  $('forgot-new').classList.add('hidden'); $('forgot-code-row').classList.add('hidden');
  $('forgot-hint').textContent = mode === 'key' ? 'Paste the recovery link (or key) you saved from Settings. No email needed.' : 'We email a 6-digit code to the recovery email you verified in Settings.';
  $('forgot-use-email').textContent = mode === 'key' ? 'Use recovery email instead' : 'Use recovery link instead';
  $('forgot-use-email').classList.toggle('hidden', !rc.enabled);
  $('forgot-send').textContent = 'Send code';
  $('forgot-submit').textContent = 'Continue'; $('forgot-error').textContent = '';
}
function resetForgot() { $('forgot-form').reset(); setForgotMode('key'); }
// Recovery link = this app's address + the recovery key, so one tap/paste resets the password.
function recoveryLink(key, u) { return `${location.origin}${location.pathname}#recover=${encodeURIComponent(key)}&u=${encodeURIComponent(u || '')}`; }
function parseRecoveryInput(str) {
  const t = String(str || '').trim();
  const m = t.match(/#recover=([^&\s]+)(?:&u=([^&\s]+))?/);
  if (!m) return { key: t, u: '' };
  let key = m[1], u = ''; try { key = decodeURIComponent(m[1]); u = decodeURIComponent(m[2] || ''); } catch {}
  return { key, u };
}
$('show-forgot').onclick = (e) => { e.preventDefault(); resetForgot(); showAuthForm('forgot-form'); $('forgot-user').value = $('login-user').value; };
$('forgot-back').onclick = (e) => { e.preventDefault(); showAuthForm('login-form'); };
$('forgot-use-email').onclick = (e) => { e.preventDefault(); if (forgot.stage === 'newpass') return; setForgotMode(forgot.mode === 'key' ? 'email' : 'key'); };
$('forgot-send').onclick = async () => {
  const u = $('forgot-user').value, email = $('forgot-email').value.trim(); const err = $('forgot-error'); err.textContent = '';
  if (normalizeUsername(u).length < 3) { err.textContent = 'Enter your username.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter the recovery email you verified in Settings.'; return; }
  if (!rc.enabled) { err.textContent = 'Email reset needs the recovery server (ask whoever hosts this app). You can still use your recovery key.'; return; }
  const b = $('forgot-send'); b.disabled = true; b.textContent = 'Sending…';
  try { await rc.recoverStart(u, email); $('forgot-code-row').classList.remove('hidden'); forgot.stage = 'code'; $('forgot-code').focus(); b.textContent = 'Resend code'; }
  catch (ex) { err.textContent = ex.message; b.textContent = 'Send code'; }
  b.disabled = false;
};
$('forgot-form').onsubmit = async (e) => {
  e.preventDefault();
  const u = $('forgot-user').value; const err = $('forgot-error'); err.textContent = '';
  if (normalizeUsername(u).length < 3) { err.textContent = 'Enter your username.'; return; }
  const btn = $('forgot-submit');
  try {
    if (forgot.stage === 'newpass') {
      const p = $('forgot-pass').value, p2 = $('forgot-pass2').value;
      if (p.length < 12) { err.textContent = 'Use at least 12 characters for your new password.'; return; }
      if (p !== p2) { err.textContent = 'Passwords do not match.'; return; }
      btn.disabled = true; btn.textContent = 'Saving new password…';
      await setPassword(forgot.sk, u, p, progressOf($('forgot-progress')));
      if (forgot.mode === 'email') { try { await rc.refreshEscrow(forgot.sk, u); } catch {} }
      const sk = forgot.sk; resetForgot(); showAuthForm('login-form');
      toast('Password changed. You are logged in.');
      await startApp(sk, null, u);
      return;
    }
    if (forgot.mode === 'key') {
      const { key, u: lu } = parseRecoveryInput($('forgot-key').value);
      if (!key) { err.textContent = 'Paste your recovery link or key.'; return; }
      if (lu && !u) { $('forgot-user').value = lu; }
      forgot.sk = decodeRecoveryKey(key);
    } else {
      if (forgot.stage !== 'code') { $('forgot-send').click(); return; }
      const code = $('forgot-code').value.trim(); if (code.length !== 6) { err.textContent = 'Enter the 6-digit code from the email.'; return; }
      btn.disabled = true; btn.textContent = 'Checking code…';
      forgot.sk = await rc.recoverFinish(u, $('forgot-email').value.trim(), code);
    }
    forgot.stage = 'newpass';
    $('forgot-email-step').classList.add('hidden'); $('forgot-key-step').classList.add('hidden'); $('forgot-use-email').classList.add('hidden');
    $('forgot-hint').textContent = 'Recovery accepted — choose a new password.';
    $('forgot-new').classList.remove('hidden'); $('forgot-pass').focus();
    btn.textContent = 'Set new password';
  } catch (ex) { err.textContent = ex.message; if (forgot.stage !== 'newpass') btn.textContent = 'Continue'; }
  btn.disabled = false; $('forgot-progress').classList.add('hidden');
};

/* ---------------- app start ---------------- */
async function startApp(sk, newName, username) {
  const pk = pubkeyOf(sk);
  const cipher = await localCipher(sk);
  store = new Store(pk, cipher);
  await store.load();
  if (newName) { store.state.profile.name = newName; }
  if (!store.state.profile.name) store.state.profile.name = 'Me';
  if (username) store.state.profile.username = normalizeUsername(username);
  await store.flush();
  session.set(bytesToHex(sk));

  const s = settings.get();
  transport = new Transport(s.relays || DEFAULT_RELAYS, (n, total) => {
    const c = $('conn'); c.className = 'conn ' + (n === 0 ? '' : n === total ? 'ok' : 'partial');
    c.title = `${n}/${total} relays connected`;
  });
  app = new App(sk, store, transport);
  window.__chatly = app; window.__games = () => games; window.__gcalls = () => gcalls; // diagnostics / tests
  applyKeepAlive();
  checkShellUpdate();
  accountSk = sk;
  app.sharePresence = s.presence !== false;
  calls = new CallManager(app); gcalls = new GroupCallManager(app); app.calls = calls;
  games = new GameManager(app);
  watch = new WatchManager(app);
  share = new ShareManager(app);
  wireApp(); wireCalls(); wireGroupCalls(); wireGames(); wireWatch(); wireShare();
  $('auth').classList.add('hidden'); $('main').classList.remove('hidden');
  window.dispatchEvent(new Event('chatly:ready'));
  $('login-form').reset(); $('signup-form').reset();
  renderAll();
  app.start().then(() => {
    if (newName) { app.syncToSelf({ t: 'profile', name: newName, u: store.state.profile.username }); setTimeout(() => { if (app && $('modal').classList.contains('hidden')) openRecoveryKey(true); }, 1800); }
    app.discoverable = !!settings.get().discoverable;
    if (store.state.profile.username) { app.publishDirectory(app.discoverable); republishKeystore(transport, store.state.profile.username); }
    checkRecoveryEmail();
  }).catch((e) => toast('Relay connection failed: ' + e.message, 'error'));
  if (s.notifications && 'Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 1500);
  }
  if (pendingAdd) { const p = pendingAdd; pendingAdd = null; setTimeout(() => offerAdd(p.pk, p.name), 400); }
}

function logout() {
  session.clear();
  if (app) app.stop();
  if (transport) transport.close();
  if (store) store.flush();
  location.reload();
}

function offerAdd(pk, name) {
  if (pk === app.pk) { toast("That's your own invite link"); return; }
  if (app.isFriend(pk) || app.isPending(pk)) { openChat(pk); return; }
  showModal(`<h3>Add a close friend?</h3><div class="row">${avatarHtml(pk, '', name)}<div><div style="font-weight:700">${esc(name || 'Friend ' + pk.slice(0, 6))}</div><div class="tiny muted">${esc(friendCode(pk).slice(0, 20))}…</div></div></div>
    <p class="muted tiny">They sent you an invite link. Adding them lets you chat and call each other, end-to-end encrypted.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="a-no">Not now</button><button class="btn primary" id="a-ok">Add friend</button></div>`);
  $('a-no').onclick = hideModal;
  $('a-ok').onclick = () => { hideModal(); try { const r = app.addFriend(pk); if (name && !app.state.friends[pk].name) { app.state.friends[pk].name = name; store.save(); } toast(r === 'accepted' ? 'You are now close friends' : 'Friend request sent'); openChat(pk); } catch (e) { toast(e.message, 'error'); } };
}

/* ---------------- events from protocol ---------------- */
function wireApp() {
  store.onChange(() => scheduleRender());
  app.addEventListener('message', (e) => {
    const { pk, chatId, message, fresh } = e.detail;
    if (!fresh) return;
    const s = settings.get();
    const onScreen = app.openChat === chatId && !document.hidden && !shellBg;
    const muted = !!app.store.chat(chatId).mute;
    if (muted && !onScreen) { updateBadge(); return; }
    if (!onScreen) {
      if (s.sounds) tones.notify();
      if (s.notifications && (document.hidden || shellBg)) {
        const body = (isGroupId(chatId) ? app.nameOf(pk) + ': ' : '') + previewOf(message).slice(0, 100);
        messageNotification(app.nameOf(chatId), body, chatId);
      }
    } else if (!atBottom()) { unseen++; updateJump(); }
    updateBadge();
  });

  app.addEventListener('request', (e) => { if (e.detail.fresh) toast(`New request from ${app.nameOf(e.detail.pk)}`); });
  app.addEventListener('friend', (e) => {
    if (e.detail.accepted) { toast(`${app.nameOf(e.detail.pk)} accepted your request`); haptic(); }
    // name/photo update: redraw lists, header and open chat so the new picture shows right away
    scheduleRender();
    if (app.openChat === e.detail.pk) { setAvatar($('chat-avatar'), e.detail.pk); $('chat-name').textContent = app.nameOf(e.detail.pk); renderedFor = null; renderChat(); }
  });
  app.addEventListener('presence', () => { scheduleRender(); });
  app.addEventListener('sent', (e) => nudge(e.detail.to, 'message'));
  if (settings.get().push && Date.now() - (settings.get().pushAt || 0) > 86400000) setTimeout(() => setPush(true, true), 4000);
  app.addEventListener('me', () => { scheduleRender(); });
  app.addEventListener('restored', (e) => toast(`Restored ${e.detail.n} friend${e.detail.n === 1 ? '' : 's'} from your encrypted backup`));
  app.addEventListener('media', () => { if (app.openChat) { renderedFor = null; renderChat(); } });
  setInterval(() => { if (app && !document.hidden) { renderChatList(); updateTyping(); } }, 30000);
  app.addEventListener('typing', (e) => {
    const { pk, chatId, on } = e.detail;
    clearTimeout(typingTimers[chatId]);
    typingState[chatId] = on ? { pk, on: true } : null;
    if (on) typingTimers[chatId] = setTimeout(() => { typingState[chatId] = null; updateTyping(); scheduleRender(); }, 6000);
    updateTyping(); renderChatList();
  });
  // Background → foreground: relays are usually dead after a while in the background (iOS freezes the page).
  // Reopen them and resync; after a long time away reload the whole app so nothing stays stale.
  let hiddenAt = 0;
  const wake = (why) => {
    if (!app) return;
    const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
    const busy = (calls && calls.state !== 'idle') || (share && share.state !== 'idle') || openGameId;
    if (away > 30 * 60 * 1000 && !busy) { try { store.flush(); } catch {} location.reload(); return; }
    if (away > 8000 || why !== 'visible') app.resume(why !== 'visible');
  };
  document.addEventListener('visibilitychange', () => {
    app.setVisible(!document.hidden);
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (app.openChat) app.markRead(app.openChat);
    wake('visible');
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) wake('pageshow'); });
  window.addEventListener('online', () => wake('online'));
  // Native iOS shell tells us when the app returns to the foreground (timers were frozen).
  window.addEventListener('chatly:foreground', () => {
  shellBg = false; app.setVisible(true); if (app.openChat) app.markRead(app.openChat); wake('foreground'); });
  window.addEventListener('chatly:background', () => {
  shellBg = true; if (!hiddenAt) hiddenAt = Date.now(); app.setVisible(false); });
  window.addEventListener('focus', () => { if (!document.hidden && hiddenAt) wake('visible'); });
  app.addEventListener('resuming', () => showSync(true));
  app.addEventListener('resumed', () => showSync(false));
  app.addEventListener('reaction', (e) => onReaction(e.detail));
  app.addEventListener('message-changed', (e) => { if (e.detail.chatId === app.openChat) { renderedFor = null; renderChat(); } scheduleRender(); });
  app.addEventListener('chatflag', () => scheduleRender());
}
let syncEl = null, syncTimer = null;
function showSync(on) {
  clearTimeout(syncTimer);
  if (on) {
    if (!syncEl) { syncEl = document.createElement('div'); syncEl.className = 'sync-bar'; syncEl.innerHTML = '<span class="spin"></span>Reconnecting…'; document.body.appendChild(syncEl); }
    syncTimer = setTimeout(() => showSync(false), 12000);
  } else if (syncEl) { syncEl.remove(); syncEl = null; }
}
/* tiny UI sounds (dice, hops, reactions) */
let fxCtx = null;
function fx(freq = 800, dur = 0.05, at = 0, gain = 0.07, type = 'triangle') {
  if (!settings.get().sounds) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; fxCtx = fxCtx || new AC();
    if (fxCtx.state === 'suspended') fxCtx.resume().catch(() => {});
    const t = fxCtx.currentTime + at; const o = fxCtx.createOscillator(), g = fxCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(fxCtx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch {}
}
/* reactions */
const QUICK_RX = ['❤️', '😂', '😮', '😢', '😡', '👍'];
function rxHtml(m) {
  if (!m.rx) return '';
  const by = {}; for (const [pk, r] of Object.entries(m.rx)) (by[r.e] = by[r.e] || []).push(pk);
  return `<div class="rx">${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([e, pks]) => `<button class="chip ${pks.includes(app.pk) ? 'mine' : ''}" data-rx-toggle="${esc(e)}" title="${esc(pks.map((p) => (p === app.pk ? 'You' : app.nameOf(p))).join(', '))}">${esc(e)}${pks.length > 1 ? `<b>${pks.length}</b>` : ''}</button>`).join('')}</div>`;
}
function onReaction({ chatId, mid, e, fresh }) {
  if (chatId !== app.openChat) return;
  renderedFor = null; renderChat();
  if (fresh && e) {
    const el = document.querySelector(`.msg[data-id="${mid}"]`);
    if (el) { const b = document.createElement('span'); b.className = 'rx-burst'; b.textContent = e; el.appendChild(b); setTimeout(() => b.remove(), 1200); }
    haptic(10); fx(1200, 0.08, 0, 0.04, 'sine');
  }
}

/* ---------------- rendering ---------------- */
let renderTimer = null;
function scheduleRender() { if (renderTimer) return; renderTimer = requestAnimationFrame(() => { renderTimer = null; renderAll(); }); }

function renderAll() {
  renderEmailBanner();
  if (!app) return;
  setAvatar($('me-avatar'), app.pk);
  renderChatList(); renderFriends(); renderCalls(); renderRequests(); renderSettings();
  if (app.openChat) renderChat();
  $('fab-new').classList.toggle('hidden', currentTab !== 'chats');
  const pending = Object.values(app.state.friends).filter((f) => f.status === 'request').length;
  const b = $('req-badge'); b.textContent = pending; b.classList.toggle('hidden', !pending);
  const totalUnread = Object.entries(app.state.chats).filter(([id]) => app.canChat(id)).reduce((a, [, c]) => a + c.unread, 0);
  document.title = (totalUnread ? `(${totalUnread}) ` : '') + 'Chatly';
  updateBadge();
}

function renderChatList() {
  const q = ($('chat-search').value || '').toLowerCase();
  const friends = Object.entries(app.state.friends).filter(([, f]) => f.status === 'friend' || f.status === 'pending').map(([pk, f]) => ({ id: pk, since: f.since, pending: f.status === 'pending', chat: app.store.chat(pk) }));
  const groups = Object.entries(app.state.groups).map(([gid, g]) => ({ id: 'g:' + gid, since: g.since, chat: app.store.chat('g:' + gid) }));
  renderActiveRow();
  const all = [...friends, ...groups].filter((x) => !q || app.nameOf(x.id).toLowerCase().includes(q));
  const archived = all.filter((x) => x.chat.arch);
  const items = (showArchived ? archived : all.filter((x) => !x.chat.arch))
    .sort((a, b) => (!!b.chat.pin - !!a.chat.pin) || (b.chat.lastTs || b.since || 0) - (a.chat.lastTs || a.since || 0));
  const el = $('chat-list');
  if (showArchived && !archived.length) showArchived = false;
  if (!items.length && !archived.length) {
    el.innerHTML = `<div class="empty-list onboard"><h3>Welcome to Chatly</h3><p class="tiny">Three steps and you're in.</p>
      <div class="steps">
        <div class="step"><span class="n">1</span><div><b>Add a close friend</b><br><span class="tiny">by username or invite link — they accept, you're connected</span></div></div>
        <div class="step"><span class="n">2</span><div><b>Chat &amp; call</b><br><span class="tiny">texts, voice notes, photos, voice &amp; video calls — all end-to-end encrypted</span></div></div>
        <div class="step"><span class="n">3</span><div><b>Play &amp; watch together</b><br><span class="tiny">8 games, Watch together, Live TV — from the “+” button in any chat</span></div></div>
      </div><button class="btn primary" id="empty-add">Add a friend</button></div>`;
    $('empty-add').onclick = openAddFriend; return;
  }
  const before = flipSnap(el);
  el.innerHTML = items.map(({ id, chat, pending }) => {
    const last = chat.messages[chat.messages.length - 1];
    const plain = last && ['system', 'call', 'game'].includes(last.kind);
    let preview = last ? ((plain ? '' : last.from === app.pk ? 'You: ' : isGroupId(id) && last.from ? app.nameOf(last.from) + ': ' : '') + previewOf(last)) : pending ? 'Waiting for them to accept' : 'Say hi 👋';
    const t = typingState[id];
    if (t) preview = `<i>${isGroupId(id) ? esc(app.nameOf(t.pk)) + ' is ' : ''}typing…</i>`; else preview = esc(preview);
    const unread = chat.unread || (chat.markUnread ? '•' : 0);
    return `<div class="item ${unread ? 'unread-item' : ''} ${chat.mute ? 'muted' : ''} ${app.openChat === id ? 'active' : ''}" data-id="${id}"><div class="inner">
      ${avatarHtml(id)}
      <div class="body"><div class="top"><span class="name">${esc(app.nameOf(id))}<span class="flags">${chat.pin ? '📌' : ''}${chat.mute ? '🔕' : ''}${chat.expire ? '⏱' : ''}</span></span>${pending ? '<span class="pend">Request sent</span>' : `<span class="time">${fmtListTime(chat.lastTs)}</span>`}</div>
      <div class="preview"><span>${preview}</span>${unread ? `<span class="unread">${unread}</span>` : ''}</div></div></div>
      <div class="acts"><button class="a-pin" data-act="pin"><span>📌</span>${chat.pin ? 'Unpin' : 'Pin'}</button><button class="a-mute" data-act="mute"><span>${chat.mute ? '🔔' : '🔕'}</span>${chat.mute ? 'Unmute' : 'Mute'}</button><button class="a-arch" data-act="arch"><span>🗄️</span>${chat.arch ? 'Unarchive' : 'Archive'}</button><button class="a-unread" data-act="unread"><span>${chat.unread || chat.markUnread ? '✉️' : '🔵'}</span>${chat.unread || chat.markUnread ? 'Read' : 'Unread'}</button></div></div>`;
  }).join('') + (showArchived ? `<div class="archived-link" id="arch-link"><span>‹ Back to chats</span></div>` : archived.length ? `<div class="archived-link" id="arch-link"><span>🗄️ Archived</span><span>${archived.length}</span></div>` : '');
  el.querySelectorAll('.item').forEach((i) => {
    i.onclick = (e) => { if (e.target.closest('.acts')) return; if (i.classList.contains('swiped')) { unswipe(); return; } openChat(i.dataset.id); };
    i.querySelectorAll('[data-act]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); chatFlag(i.dataset.id, b.dataset.act); }; });
  });
  const al = $('arch-link'); if (al) al.onclick = () => { showArchived = !showArchived; renderChatList(); };
  flipPlay(el, before);
}
let showArchived = false;
function unswipe() { document.querySelectorAll('#chat-list .item.swiped').forEach((x) => { x.classList.remove('swiped'); x.querySelector('.inner').style.transform = ''; }); }
function chatFlag(id, act) {
  const chat = app.store.chat(id); haptic();
  if (act === 'pin') { app.setChatFlag(id, { pin: !chat.pin }); toast(chat.pin ? 'Pinned' : 'Unpinned'); }
  else if (act === 'mute') { app.setChatFlag(id, { mute: !chat.mute }); toast(chat.mute ? 'Muted — no sounds or notifications' : 'Unmuted'); }
  else if (act === 'arch') { app.setChatFlag(id, { arch: !chat.arch }); toast(chat.arch ? 'Archived' : 'Unarchived'); }
  else if (act === 'unread') { if (chat.unread || chat.markUnread) { chat.unread = 0; app.setChatFlag(id, { markUnread: false }); } else app.setChatFlag(id, { markUnread: true }); }
  renderChatList();
}
async function chatListMenu(id) {
  const chat = app.store.chat(id);
  const act = await menuSheet([
    { id: 'pin', label: chat.pin ? 'Unpin chat' : 'Pin chat' },
    { id: 'mute', label: chat.mute ? 'Unmute' : 'Mute notifications' },
    { id: 'unread', label: chat.unread || chat.markUnread ? 'Mark as read' : 'Mark as unread' },
    { id: 'arch', label: chat.arch ? 'Unarchive' : 'Archive' },
  ]);
  if (act) chatFlag(id, act);
}
(function chatListGestures() {
  const el = $('chat-list');
  let item = null, sx = 0, sy = 0, dx = 0, timer = null, fired = false;
  el.addEventListener('touchstart', (e) => {
    item = e.target.closest('.item'); if (!item) return;
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; fired = false;
    timer = setTimeout(() => { fired = true; haptic(20); chatListMenu(item.dataset.id); }, 520);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!item) return; const t = e.touches[0]; dx = t.clientX - sx;
    if (Math.abs(dx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(timer);
    if (Math.abs(t.clientY - sy) > 30) return;
    const inner = item.querySelector('.inner'); const base = item.classList.contains('swiped') ? -272 : 0;
    const x = Math.max(-272, Math.min(0, base + dx)); inner.style.transform = `translateX(${x}px)`;
  }, { passive: true });
  const end = (e) => {
    clearTimeout(timer); if (!item) return;
    if (fired && e.cancelable) e.preventDefault();
    const inner = item.querySelector('.inner'); const was = item.classList.contains('swiped');
    const open = was ? dx < 60 : dx < -70;
    unswipe();
    if (open) { item.classList.add('swiped'); inner.style.transform = 'translateX(-272px)'; } else inner.style.transform = '';
    item = null;
  };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  el.addEventListener('contextmenu', (e) => { const it = e.target.closest('.item'); if (it) { e.preventDefault(); chatListMenu(it.dataset.id); } });
  el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
})();
function renderActiveRow() {
  const el = $('active-row');
  const on = app.friendPks().filter((pk) => app.isOnline(pk)).sort((a, b) => app.nameOf(a).localeCompare(app.nameOf(b)));
  el.classList.toggle('hidden', !on.length);
  // key includes name + photo so a changed profile picture redraws the row too
  const key = on.map((pk) => { const f = app.state.friends[pk] || {}; return pk + ':' + profileFp(f.name, f.avatar); }).join(',');
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = on.map((pk) => `<button data-id="${pk}" title="${esc(app.nameOf(pk))} is online">${avatarHtml(pk)}<span>${esc(app.nameOf(pk).split(' ')[0])}</span></button>`).join('');
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => openChat(b.dataset.id); });
}
function openNewMessage() {
  const friends = app.friendPks().sort((a, b) => app.nameOf(a).localeCompare(app.nameOf(b)));
  showModal(`<h3>New message</h3>
    <div class="menu" style="margin-bottom:10px"><button id="nm-group">👥 New group</button><button id="nm-add">➕ Add a friend</button></div>
    ${friends.length ? `<div class="pick-list">${friends.map((pk) => `<div class="row-item" data-pk="${pk}">${avatarHtml(pk)}<div class="name"><div>${esc(app.nameOf(pk))}</div><div class="sub">${app.isOnline(pk) ? 'Online' : app.lastSeen(pk) ? 'Last seen ' + fmtAgo(app.lastSeen(pk)) : 'Close friend'}</div></div></div>`).join('')}</div>` : '<p class="muted tiny">No close friends yet — add one to start chatting.</p>'}`);
  $('nm-group').onclick = () => { hideModal(); openNewGroup(); };
  $('nm-add').onclick = () => openAddFriend('me');
  $('modal-body').querySelectorAll('[data-pk]').forEach((r) => { r.onclick = () => { hideModal(); openChat(r.dataset.pk); }; });
}
$('fab-new').onclick = () => { haptic(); openNewMessage(); };
$('friend-search').oninput = () => renderFriends();
$('chat-search').oninput = renderChatList;

const CHAT_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.5 1.2 4.7 3.2 6.3L4.5 21l3.6-1.9c1.2.4 2.5.6 3.9.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3Z"/></svg>';
const PHONE_SVG = '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02Z"/></svg>';
const VIDEO_SVG = '<svg viewBox="0 0 24 24"><path d="M3 6h12a2 2 0 0 1 2 2v2.5l4-2.5v8l-4-2.5V16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/></svg>';
function callLabel(c) {
  return `${c.dir === 'in' ? (c.reason === 'declined' ? 'Declined' : c.missed ? 'Missed' : 'Incoming') : c.reason === 'declined' ? 'Outgoing (declined)' : c.reason === 'no-answer' ? 'Outgoing (no answer)' : 'Outgoing'} ${c.video ? 'video' : 'voice'} call${c.dur ? ' · ' + fmtDur(c.dur) : ''}`;
}
function renderFriends() {
  const el = $('friend-list');
  const q = ($('friend-search').value || '').trim().toLowerCase();
  const friends = Object.entries(app.state.friends).filter(([, f]) => f.status === 'friend')
    .map(([pk, f]) => ({ pk, since: f.since || 0, name: app.nameOf(pk) }))
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = Object.entries(app.state.groups || {}).filter(([, g]) => g.members.includes(app.pk))
    .map(([gid, g]) => ({ id: 'g:' + gid, name: g.name || 'Group', n: g.members.length }))
    .filter((g) => !q || g.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div class="friends-head"><span class="muted">${friends.length} close friend${friends.length === 1 ? '' : 's'}</span><button class="btn primary small" id="fl-add">+ Add friend</button></div>`;
  if (!friends.length) html += `<div class="empty-list"><p>${q ? 'No friends match.' : 'No close friends yet.'}</p><p class="tiny">Share your code or invite link, or add a friend by username.</p></div>`;
  html += friends.map((f) => `<div class="item" data-pk="${f.pk}">${avatarHtml(f.pk)}
    <div class="body"><div class="name">${esc(f.name)}</div><div class="preview"><span>${f.since ? 'Friends since ' + new Date(f.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Close friend'}</span></div></div>
    <div class="actions"><button class="icon-btn" data-act="msg" title="Message">${CHAT_SVG}</button><button class="icon-btn" data-act="call" title="Voice call">${PHONE_SVG}</button><button class="icon-btn" data-act="video" title="Video call">${VIDEO_SVG}</button></div></div>`).join('');
  if (groups.length) html += `<h4 class="muted list-h4">Groups</h4>` + groups.map((g) => `<div class="item" data-pk="${g.id}">${avatarHtml(g.id)}<div class="body"><div class="name">${esc(g.name)}</div><div class="preview"><span>${g.n} members</span></div></div></div>`).join('');
  el.innerHTML = html;
  $('fl-add').onclick = () => openAddFriend('me');
  el.querySelectorAll('.item').forEach((i) => {
    const pk = i.dataset.pk;
    i.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'call') startCall(pk, false);
      else if (act === 'video') startCall(pk, true);
      else openChat(pk);
    };
    i.oncontextmenu = (e) => { if (isGroupId(pk)) return; e.preventDefault(); openChat(pk); setTimeout(() => $('chat-menu-btn')?.click(), 50); };
  });
}

function groupCallLabel(c) {
  return `Group ${c.video ? 'video' : 'voice'} call${c.missed ? ' · missed' : c.reason === 'declined' ? ' · declined' : c.dir === 'out' ? ' · you started it' : c.by ? ' · by ' + app.nameOf(c.by) : ''}${c.dur ? ' · ' + (c.dur < 60 ? c.dur + ' s' : Math.round(c.dur / 60) + ' min') : ''}`;
}
function renderCalls() {
  const el = $('call-list');
  const log = app.state.calls;
  if (!log.length) { el.innerHTML = `<div class="empty-list"><p>No calls yet.</p><p class="tiny">Open a chat and tap the phone or camera icon to call. Calls are peer-to-peer and encrypted.</p></div>`; return; }
  el.innerHTML = log.map((c, i) => `<div class="item" data-i="${i}">
    ${avatarHtml(c.peer)}
    <div class="body"><div class="top"><span class="name" style="${c.missed ? 'color:var(--danger)' : ''}">${esc(app.nameOf(c.peer))}</span><span class="time">${fmtListTime(c.ts)}</span></div>
    <div class="preview"><span>${c.group ? groupCallLabel(c) : callLabel(c)}</span></div></div>
    <button class="icon-btn call-icon ${c.missed ? 'missed' : ''}" title="Call back">${c.video ? VIDEO_SVG : PHONE_SVG}</button></div>`).join('');
  el.querySelectorAll('.item').forEach((i) => {
    const c = log[Number(i.dataset.i)];
    i.querySelector('.call-icon').onclick = (e) => { e.stopPropagation(); startCall(c.peer, c.video); };
    i.onclick = () => openChat(c.peer);
  });
}

function renderRequests() {
  const el = $('request-list');
  const reqs = Object.entries(app.state.friends).filter(([, f]) => f.status === 'request');
  const sent = Object.entries(app.state.friends).filter(([, f]) => f.status === 'pending');
  const blocked = Object.entries(app.state.friends).filter(([, f]) => f.status === 'blocked');
  let html = '';
  if (!reqs.length && !sent.length) html += `<div class="empty-list"><p>No pending requests.</p><p class="tiny">When someone who isn't a close friend messages you, it shows up here first.</p></div>`;
  html += reqs.map(([pk]) => {
    const chat = app.store.chat(pk); const last = chat.messages[chat.messages.length - 1];
    return `<div class="item" data-pk="${pk}">${avatarHtml(pk)}
      <div class="body"><div class="name">${esc(app.nameOf(pk))}</div><div class="preview"><span>${last ? esc(previewOf(last)) : 'Wants to be your close friend'}</span></div></div>
      <div class="actions"><button class="btn primary small" data-act="accept">Accept</button><button class="btn ghost small" data-act="block">Block</button></div></div>`;
  }).join('');
  if (sent.length) {
    html += `<h4 class="muted list-h4">Sent requests</h4>` + sent.map(([pk, f]) => `<div class="item" data-pk="${pk}">${avatarHtml(pk)}<div class="body"><div class="name">${esc(app.nameOf(pk))}</div><div class="preview"><span>Sent ${fmtAgo(f.since || Date.now())} · waiting for them to accept</span></div></div><div class="actions"><button class="btn ghost small" data-act="cancel">Cancel</button></div></div>`).join('');
  }
  if (blocked.length) {
    html += `<h4 class="muted list-h4">Blocked</h4>` + blocked.map(([pk]) => `<div class="item" data-pk="${pk}">${avatarHtml(pk)}<div class="body"><div class="name">${esc(app.nameOf(pk))}</div></div><div class="actions"><button class="btn ghost small" data-act="unblock">Unblock</button></div></div>`).join('');
  }
  el.innerHTML = html;
  el.querySelectorAll('.item').forEach((i) => {
    const pk = i.dataset.pk;
    i.onclick = (e) => {
      const act = e.target.dataset.act;
      if (act === 'accept') { app.acceptRequest(pk); toast('Added to close friends'); haptic(); }
      else if (act === 'block') app.block(pk);
      else if (act === 'unblock') app.unblock(pk);
      else if (act === 'cancel') { if (app.openChat === pk) closeChat(); app.cancelRequest(pk); toast('Request cancelled'); }
      else openChat(pk);
    };
  });
}

function renderSettings() {
  const s = settings.get();
  const el = $('settings');
  const relays = (s.relays || DEFAULT_RELAYS).join('\n');
  const p = app.state.profile;
  el.innerHTML = `
    <div class="profile">${avatarHtml(app.pk)}
      <div style="flex:1;min-width:0"><div class="name" id="s-name">${esc(p.name)}</div><div class="sub">${p.username ? '@' + esc(p.username) : 'Tap name to change'}</div>
        <div class="photo-actions"><button class="btn primary" id="s-photo">${p.avatar ? 'Change photo' : 'Add photo'}</button><button class="btn ghost" id="s-avatar">Choose avatar</button></div></div></div>
    <h4>Friends</h4>
    <div class="card"><div class="srow clickable" id="s-code"><span>My code, QR &amp; invite link</span><span class="muted">›</span></div>
      <div class="srow"><div><div>Show when I'm online</div><div class="tiny muted">Close friends see “Online” and your last seen. Nobody else can.</div></div><button class="switch ${s.presence !== false ? 'on' : ''}" data-set="presence"></button></div>
      <div class="srow"><div><div>Findable by username</div><div class="tiny muted">Lets friends add you by typing @${esc(p.username || 'username')}. Publishes only your username and name.</div></div><button class="switch ${s.discoverable ? 'on' : ''}" data-set="discoverable"></button></div></div>
    <h4>Account &amp; security</h4>
    <div class="card">
      <div class="srow clickable" id="s-email"><div><div>Recovery email</div><div class="tiny muted">${p.recoveryEmail ? esc(p.recoveryEmail) + ' · verified' : rc.enabled ? 'Not set — add one so you can reset a forgotten password' : 'Needs a recovery server (Network ↓)'}</div></div><span class="muted">${p.recoveryEmail ? '✓' : '›'}</span></div>
      <div class="srow clickable" id="s-pass"><div><div>Change password</div><div class="tiny muted">Friends, history and username stay the same.</div></div><span class="muted">›</span></div>
      <div class="srow clickable" id="s-rkey"><div><div>Recovery link</div><div class="tiny muted">The one way back in if you forget your password. Save it somewhere safe.</div></div><span class="muted">›</span></div>
    </div>
    <h4>Appearance</h4>
    <div class="card">
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:10px"><span>Theme</span><div class="theme-opts">
        ${['dark', 'light', 'amoled', 'midnight'].map((t) => `<button class="theme-opt ${s.theme === t ? 'active' : ''}" data-theme="${t}">${{ dark: 'Dark', light: 'Light', amoled: 'AMOLED Black', midnight: 'Midnight' }[t]}</button>`).join('')}</div></div>
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:10px"><span>Accent color</span><div class="swatches">
        ${['blue', 'purple', 'green', 'pink', 'orange', 'teal'].map((a) => `<button class="swatch ${s.accent === a ? 'active' : ''}" data-accent="${a}" style="background:${{ blue: '#2d8cff', purple: '#8b5cf6', green: '#22c55e', pink: '#ec4899', orange: '#f97316', teal: '#14b8a6' }[a]}"></button>`).join('')}</div></div>
    </div>
    <h4>Text size</h4>
    <div class="card"><div class="srow" style="flex-direction:column;align-items:stretch;gap:10px"><div class="theme-opts">
      ${['small', 'normal', 'large', 'xl'].map((t) => `<button class="theme-opt ${(s.font || 'normal') === t ? 'active' : ''}" data-font="${t}">${{ small: 'Small', normal: 'Default', large: 'Large', xl: 'Extra large' }[t]}</button>`).join('')}</div></div></div>
    <h4>Privacy</h4>
    <div class="card">
      <div class="srow clickable" id="s-lock"><div><div>App lock</div><div class="tiny muted">${lock.enabled() ? `PIN${lock.bio() ? ' + Face ID / Touch ID' : ''} · locks after ${lock.afterLabel()}` : 'Ask for a PIN (or Face ID / Touch ID) when Chatly opens'}. Screen lock only — stops casual snooping on an unlocked device; log out for full protection.</div></div><span class="muted">${lock.enabled() ? 'On' : 'Off'} ›</span></div>
      <div class="srow clickable" id="s-starred"><div><div>Starred messages</div><div class="tiny muted">${app.starred().length} starred</div></div><span class="muted">›</span></div>
      <div class="srow clickable" id="s-export"><div><div>Export chats</div><div class="tiny muted">Encrypted file (needs a passphrase) you can import on another device.</div></div><span class="muted">›</span></div>
      <div class="srow clickable" id="s-import"><div><div>Import chats</div><div class="tiny muted">Restore from a Chatly export file.</div></div><span class="muted">›</span></div>
    </div>
    <h4>Notifications</h4>
    <div class="card">
      <div class="srow"><span>Message notifications</span><button class="switch ${s.notifications ? 'on' : ''}" data-set="notifications"></button></div>
      <div class="srow"><span>Sounds</span><button class="switch ${s.sounds ? 'on' : ''}" data-set="sounds"></button></div>
      <div class="srow"><span>Vibration</span><button class="switch ${s.haptics ? 'on' : ''}" data-set="haptics"></button></div>
      ${nativeKeep ? `<div class="srow"><div><div>Stay connected in background</div><div class="tiny muted">Keeps Chatly online while minimized, so messages arrive as banners you can reply to and calls show Answer / Decline. Uses some battery.</div></div><button class="switch ${s.bgKeepAlive !== false ? 'on' : ''}" data-set="bgKeepAlive"></button></div>` : ''}
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:4px"><div class="row" style="justify-content:space-between;align-items:center"><span>When the app is closed</span><button class="switch ${s.push ? 'on' : ''}" data-set="push"></button></div><span class="tiny muted">${pushHint()}</span></div>
    </div>
    <h4>Network</h4>
    <div class="card"><div class="srow" style="flex-direction:column;align-items:stretch;gap:8px"><span>Relays (one per line). Relays only ever see encrypted blobs.</span><textarea id="relay-text">${esc(relays)}</textarea><div class="row" style="justify-content:flex-end;gap:8px;display:flex"><button class="btn ghost small" id="relay-reset">Reset</button><button class="btn primary small" id="relay-save">Save & reconnect</button></div></div>
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:8px"><span>Recovery server URL <span class="tiny muted">(optional, for email password reset — see server/README)</span></span><div class="row" style="display:flex;gap:8px"><input id="s-server" type="text" placeholder="https://…" value="${esc(s.recoveryServer || '')}" style="flex:1;min-width:0"><button class="btn primary small" id="s-server-save">Save</button></div></div></div>
    <h4>Security</h4>
    <div class="card">
      <div class="srow"><span>End-to-end encryption</span><span class="muted">Always on</span></div>
      <div class="srow"><span>Local history</span><span class="muted">Encrypted on this device</span></div>
      <div class="srow clickable" id="s-logout"><span>Log out</span><span class="muted">Keeps encrypted history</span></div>
      <div class="srow clickable" id="s-wipe"><span class="danger">Delete all data on this device</span></div>
    </div>
    <p class="tiny muted" style="margin-top:16px">Chatly v7 · Your password unlocks your encryption key. Forgot it? Use your recovery link.</p>`;
  el.querySelector('.profile .avatar').onclick = () => openAvatarPicker();
  $('s-photo').onclick = () => openAvatarPicker();
  $('s-avatar').onclick = () => openAvatarPicker(true);
  $('s-name').onclick = async () => { const v = await promptSheet('Your name', p.name, 'Name shown to friends'); if (v) app.setName(v); };
  $('s-code').onclick = () => openAddFriend('me');
  $('s-email').onclick = () => openRecoveryEmail();
  $('s-pass').onclick = () => openChangePassword();
  $('s-rkey').onclick = () => openRecoveryKey();
  $('s-server-save').onclick = () => {
    const v = $('s-server').value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//.test(v)) { toast('Enter a full URL starting with https://', 'error'); return; }
    settings.set({ recoveryServer: v || null }); rc = new RecoveryClient(v || DEFAULT_RECOVERY_SERVER);
    toast(v ? 'Recovery server saved' : 'Recovery server cleared'); renderSettings(); renderEmailBanner(); if (v) checkRecoveryEmail();
  };
  el.querySelectorAll('.theme-opt').forEach((b) => { b.onclick = () => withTransition(() => { settings.set({ theme: b.dataset.theme }); applyTheme(); renderSettings(); }); });
  el.querySelectorAll('.swatch').forEach((b) => { b.onclick = () => withTransition(() => { settings.set({ accent: b.dataset.accent }); applyTheme(); renderSettings(); }); });
  el.querySelectorAll('.switch').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.set; const cur = k === 'presence' ? settings.get().presence !== false : k === 'bgKeepAlive' ? settings.get().bgKeepAlive !== false : settings.get()[k]; const v = !cur; settings.set({ [k]: v });
      if (k === 'bgKeepAlive') { applyKeepAlive(); toast(v ? 'Chatly stays connected while minimized' : 'Chatly will pause while minimized'); }
      if (k === 'presence') { app.setSharePresence(v); toast(v ? 'Friends can see when you are online' : 'Your online status is hidden'); }
      if (k === 'notifications' && v && 'Notification' in window) Notification.requestPermission().catch(() => {});
      if (k === 'discoverable') { app.publishDirectory(v); toast(v ? 'Friends can now find you by username' : 'Removed from username lookup'); }
      if (k === 'haptics' && v) haptic(20);
      if (k === 'push') setPush(v);
      renderSettings();
    };
  });
  el.querySelectorAll('[data-font]').forEach((b) => { b.onclick = () => { settings.set({ font: b.dataset.font }); applyTheme(); renderSettings(); haptic(); }; });
  $('s-lock').onclick = lockSettings;
  $('s-starred').onclick = showStarred;
  $('s-export').onclick = exportChats;
  $('s-import').onclick = importChats;
  $('relay-save').onclick = () => {
    const list = $('relay-text').value.split(/\s+/).map((x) => x.trim()).filter((x) => /^wss?:\/\//.test(x));
    if (!list.length) { toast('Enter at least one wss:// relay', 'error'); return; }
    settings.set({ relays: list }); toast('Relays saved, reconnecting…'); setTimeout(() => location.reload(), 500);
  };
  $('relay-reset').onclick = () => { settings.set({ relays: null }); toast('Relays reset'); setTimeout(() => location.reload(), 500); };
  $('s-logout').onclick = async () => { if (await confirmSheet('Log out?', 'Your encrypted history stays on this device and unlocks again with your password.', 'Log out', false)) logout(); };
  $('s-wipe').onclick = async () => {
    if (await confirmSheet('Delete all local data?', 'Chats cached on this device will be erased. Messages still on relays (last ~days) can be re-downloaded by logging in.', 'Delete')) { await store.wipe(); session.clear(); location.reload(); }
  };
}
/* ---------------- account & recovery ---------------- */
function passwordSheet(title, fields, submitLabel) {
  // fields: [{ id, placeholder }] -> resolves to values or null
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3><form id="pw-form" class="stack">${fields.map((f) => `<input type="password" id="${f.id}" placeholder="${esc(f.placeholder)}" autocomplete="${f.auto || 'new-password'}" required>`).join('')}
      <div class="auth-error" id="pw-err"></div><div class="progress hidden" id="pw-progress"><div></div></div>
      <div class="row" style="justify-content:flex-end;margin:0"><button type="button" class="btn ghost" id="pw-cancel">Cancel</button><button type="submit" class="btn primary" id="pw-ok">${esc(submitLabel)}</button></div></form>`);
    $('pw-cancel').onclick = () => { hideModal(); res(null); };
    $('pw-form').onsubmit = (e) => { e.preventDefault(); res(fields.map((f) => $(f.id).value)); };
    setTimeout(() => $(fields[0].id).focus(), 50);
  });
}
async function openChangePassword() {
  const u = app.state.profile.username;
  if (!u) { toast('Set your username first (log out and in again)', 'error'); return; }
  const fields = [{ id: 'pw-cur', placeholder: 'Current password', auto: 'current-password' }, { id: 'pw-new', placeholder: 'New password (12+ characters)' }, { id: 'pw-new2', placeholder: 'Confirm new password' }];
  const vals = await passwordSheet('Change password', fields, 'Change');
  if (!vals) return;
  // the sheet stays open on errors; each submit re-reads the fields
  const attempt = async (cur, nw, nw2) => {
    const err = $('pw-err'); const ok = $('pw-ok'); if (!err || !ok) return;
    err.textContent = '';
    if (nw.length < 12) { err.textContent = 'Use at least 12 characters.'; return; }
    if (nw !== nw2) { err.textContent = 'New passwords do not match.'; return; }
    ok.disabled = true; ok.textContent = 'Checking…';
    try {
      if (!(await checkPassword(accountSk, u, cur, progressOf($('pw-progress'))))) throw new Error('Current password is wrong.');
      ok.textContent = 'Saving…';
      await setPassword(accountSk, u, nw, progressOf($('pw-progress')), transport);
      hideModal(); toast('Password changed');
    } catch (e) {
      err.textContent = e.message; ok.disabled = false; ok.textContent = 'Change'; $('pw-progress').classList.add('hidden');
      $('pw-cur').value = ''; $('pw-cur').focus();
    }
  };
  $('pw-form').onsubmit = (e) => { e.preventDefault(); attempt(...fields.map((f) => $(f.id).value)); };
  await attempt(...vals);
}
function openRecoveryKey(firstRun = false) {
  const key = encodeRecoveryKey(accountSk);
  const link = recoveryLink(key, app.state.profile.username);
  showModal(`<h3>${firstRun ? 'Save your recovery link' : 'Recovery link'}</h3>
    <p class="muted tiny" style="margin:0 0 10px">${firstRun ? 'Forgot your password one day? Open this link and set a new one. There is no other way back in, so keep it somewhere safe (notes app, password manager).' : 'Open this link to reset your password without email.'} <b>It contains your account key: anyone who has it can log in as you. Never send it in a chat, email or message.</b></p>
    <div class="rk-box" id="rkey-text">${esc(link)}</div>
    <div class="rk-actions"><button class="btn primary" id="rk-copy">Copy link</button></div>
    <details class="tiny muted" style="margin-top:10px"><summary>Show the key only</summary><div class="rk-box" style="margin-top:6px">${key}</div></details>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="rk-close">${firstRun ? 'Later' : 'Close'}</button></div>`);
  $('rk-close').onclick = hideModal;
  $('rk-copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Recovery link copied'); } catch { toast('Select the link and copy it manually'); } };
}
async function openRecoveryEmail() {
  const p = app.state.profile; const u = p.username;
  if (!rc.enabled) {
    showModal(`<h3>Recovery email</h3><p class="muted">Password reset by email needs the small Chatly recovery server. Whoever hosts this app sets it up once (closechat/server/README.md); the address goes into Settings → Network → Recovery server URL.</p><p class="muted">Until then, save your <b>recovery key</b> — it resets your password without any server.</p><div class="row" style="justify-content:flex-end"><button class="btn primary" id="re-ok">OK</button></div>`);
    $('re-ok').onclick = hideModal; return;
  }
  if (p.recoveryEmail) {
    const m = await menuSheet([{ id: 'change', label: 'Change recovery email' }, { id: 'remove', label: 'Remove recovery email', danger: true }]);
    if (m === 'remove') {
      if (await confirmSheet('Remove recovery email?', 'You will not be able to reset a forgotten password by email anymore.', 'Remove')) {
        try { await rc.removeEmail(accountSk, u); p.recoveryEmail = ''; store.save(); toast('Recovery email removed'); renderSettings(); renderEmailBanner(); } catch (e) { toast(e.message, 'error'); }
      }
      return;
    }
    if (m !== 'change') return;
  }
  const email = (await promptSheet('Recovery email', p.recoveryEmail || '', 'you@example.com') || '').trim();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('That does not look like an email address', 'error'); return; }
  try { await rc.startEmail(accountSk, u, email); } catch (e) { toast(e.message, 'error'); return; }
  for (let tries = 0; tries < 3; tries++) {
    const code = (await promptSheet('Enter the 6-digit code', '', `Sent to ${email} — check spam too`) || '').trim();
    if (!code) return;
    try {
      await rc.verifyEmail(accountSk, u, code);
      p.recoveryEmail = email; store.save(); app.publishBackup().catch(() => {});
      toast('Recovery email verified'); renderSettings(); renderEmailBanner(); return;
    } catch (e) { toast(e.message, 'error'); if (/expired|attempts/.test(e.message)) return; }
  }
}
function renderEmailBanner() {
  const el = $('email-banner'); if (!el || !app) return;
  const snooze = settings.get().emailSnooze || 0;
  el.classList.toggle('hidden', !(rc.enabled && !app.state.profile.recoveryEmail && snooze < Date.now()));
}
$('eb-add').onclick = () => openRecoveryEmail();
$('eb-later').onclick = () => { settings.set({ emailSnooze: Date.now() + 7 * 864e5 }); renderEmailBanner(); toast('We’ll remind you in a week'); };
// On login: learn about an email verified on another device, and heal the
// server's escrow copy if it was lost (e.g. redeploy without a disk).
async function checkRecoveryEmail() {
  renderEmailBanner();
  if (!rc.enabled || !app.state.profile.username) return;
  try {
    const st = await rc.status(accountSk, app.state.profile.username);
    const p = app.state.profile;
    if (st.registered) {
      if (p.recoveryEmail !== st.email) { p.recoveryEmail = st.email; store.save(); }
      if (!st.hasEscrow) await rc.refreshEscrow(accountSk, p.username);
    } else if (p.recoveryEmail) {
      p.recoveryEmail = ''; store.save(); toast('Your recovery email needs to be verified again', 'error');
    }
  } catch {}
  renderEmailBanner(); if (currentTab === 'settings') renderSettings();
}

$('avatar-input').onchange = async () => {
  const file = $('avatar-input').files[0]; $('avatar-input').value = '';
  if (!file) return;
  let img; try { img = await loadImage(file); } catch { toast('Could not read that image', 'error'); return; }
  const out = await cropSheet(img);
  URL.revokeObjectURL(img.src);
  if (out) { app.setAvatar(out); hideModal(); toast('Profile photo updated'); }
};
// Preloaded avatars: an emoji on a gradient disc, rasterised locally so they
// travel like any other profile photo (small JPEG data URL).
const PRESET_AVATARS = [['🦊', '#f97316'], ['🐼', '#64748b'], ['🐨', '#8b5cf6'], ['🦁', '#f59e0b'], ['🐸', '#22c55e'], ['🐙', '#ec4899'],
  ['🦄', '#a855f7'], ['🐯', '#ea580c'], ['🐵', '#92400e'], ['🐧', '#0ea5e9'], ['🦋', '#06b6d4'], ['🐶', '#d97706'],
  ['🐱', '#6366f1'], ['🌸', '#f472b6'], ['🌙', '#1e3a8a'], ['⚡', '#eab308'], ['🔥', '#dc2626'], ['🍀', '#16a34a'],
  ['🎧', '#334155'], ['🎮', '#7c3aed'], ['⚽', '#059669'], ['🚀', '#2563eb'], ['🍩', '#db2777'], ['🤖', '#475569']];
const presetCache = new Map();
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt)))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
function presetAvatar(i, size = 128) {
  const key = i + ':' + size;
  if (presetCache.has(key)) return presetCache.get(key);
  const [emoji, color] = PRESET_AVATARS[i];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  // full-bleed disc: light tint top-left to a deeper shade of the same colour
  const g = ctx.createLinearGradient(0, 0, size, size); g.addColorStop(0, color); g.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const hl = ctx.createRadialGradient(size * .3, size * .25, 0, size * .3, size * .25, size * .8); hl.addColorStop(0, 'rgba(255,255,255,.28)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(0, 0, size, size);
  ctx.font = `${Math.round(size * .58)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * .04);
  let out = c.toDataURL('image/jpeg', .9);
  if (out.length > 9000) out = c.toDataURL('image/jpeg', .7);
  presetCache.set(key, out);
  return out;
}
function openAvatarPicker(presetsFirst = false) {
  const p = app.state.profile;
  showModal(`<h3>Profile photo</h3>
    <div class="row"><label for="avatar-input" class="btn primary" style="flex:1">${p.avatar ? 'Upload a new photo' : 'Upload photo'}</label>${p.avatar ? '<button class="btn ghost" id="av-remove">Remove</button>' : ''}</div>
    <p class="muted tiny" style="margin:12px 0 0">Or pick a ready-made avatar</p>
    <div class="avatar-grid" id="av-grid">${PRESET_AVATARS.map((_, i) => `<button type="button" data-i="${i}"><img src="${presetAvatar(i, 96)}" alt=""></button>`).join('')}</div>`);
  if (presetsFirst) setTimeout(() => $('av-grid').scrollIntoView({ block: 'nearest' }), 0);
  $('av-grid').querySelectorAll('button').forEach((b) => { b.onclick = () => { app.setAvatar(presetAvatar(+b.dataset.i)); hideModal(); toast('Profile photo updated'); }; });
  const rm = $('av-remove'); if (rm) rm.onclick = () => { app.setAvatar(''); hideModal(); toast('Photo removed'); };
}
// Drag/zoom crop before saving; resolves to a small square JPEG (<= 9 KB) or null.
function pickGroupPhoto(gid) {
  const g = app.state.groups[gid]; if (!g) return;
  showModal(`<h3>Group photo</h3><div class="row"><label for="gp-input" class="btn primary" style="flex:1">${g.av ? 'Upload a new photo' : 'Upload photo'}</label>${g.av ? '<button class="btn ghost" id="gp-remove">Remove</button>' : ''}</div><input type="file" id="gp-input" accept="image/*" hidden>`);
  const rm = $('gp-remove'); if (rm) rm.onclick = () => { app.setGroupPhoto(gid, ''); hideModal(); toast('Group photo removed'); renderedFor = null; renderChat(); scheduleRender(); };
  $('gp-input').onchange = async () => {
    const f = $('gp-input').files[0]; if (!f) return;
    const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }).catch(() => null);
    if (!img.width) { toast('Could not read that image', 'error'); return; }
    const out = await cropSheet(img); if (!out) return;
    app.setGroupPhoto(gid, out); hideModal(); toast('Group photo updated'); renderedFor = null; renderChat(); scheduleRender();
  };
}
function cropSheet(img) {
  return new Promise((res) => {
    const S = 280;
    showModal(`<h3>Crop photo</h3><div class="crop-wrap"><canvas id="crop-cv" width="${S}" height="${S}"></canvas></div>
      <div class="row"><span class="tiny muted">Zoom</span><input type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1"></div>
      <p class="tiny muted" style="margin:0 0 10px;text-align:center">Drag to reposition · pinch or scroll to zoom</p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="crop-cancel">Cancel</button><button class="btn primary" id="crop-ok">Use photo</button></div>`);
    const cv = $('crop-cv'), ctx = cv.getContext('2d');
    const base = S / Math.min(img.width, img.height);
    let zoom = 1, ox = 0, oy = 0;
    const dims = () => ({ w: img.width * base * zoom, h: img.height * base * zoom });
    const clamp = () => { const { w, h } = dims(); const mx = (w - S) / 2, my = (h - S) / 2; ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy)); };
    const draw = (c = ctx, size = S) => { const k = size / S; const { w, h } = dims(); c.clearRect(0, 0, size, size); c.drawImage(img, (S / 2 - w / 2 + ox) * k, (S / 2 - h / 2 + oy) * k, w * k, h * k); };
    const setZoom = (z, cx = 0, cy = 0) => { const old = zoom; zoom = Math.max(1, Math.min(3, z)); const r = zoom / old; ox = cx + (ox - cx) * r; oy = cy + (oy - cy) * r; clamp(); $('crop-zoom').value = zoom; draw(); };
    draw();
    const ptrs = new Map(); let drag = null, pinch = null;
    const local = (e) => { const r = cv.getBoundingClientRect(); const k = S / r.width; return { x: (e.clientX - r.left) * k - S / 2, y: (e.clientY - r.top) * k - S / 2 }; };
    cv.onpointerdown = (e) => {
      cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e));
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, ox, oy };
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; drag = null; }
    };
    cv.onpointermove = (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, local(e));
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; setZoom(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); return; }
      if (!drag) return;
      const r = cv.getBoundingClientRect(); const k = S / r.width;
      ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; clamp(); draw();
    };
    cv.onpointerup = cv.onpointercancel = (e) => { ptrs.delete(e.pointerId); drag = null; pinch = null; if (ptrs.size === 1) { const [p] = [...ptrs.values()]; drag = { x: p.x, y: p.y, ox, oy }; drag = null; } };
    cv.onwheel = (e) => { e.preventDefault(); const p = local(e); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y); };
    $('crop-zoom').oninput = (e) => setZoom(+e.target.value);
    $('crop-cancel').onclick = () => { hideModal(); res(null); };
    $('crop-ok').onclick = () => {
      let q = 0.85, out = '';
      for (let size = 160; size >= 64; size -= 32) {
        const c = document.createElement('canvas'); c.width = c.height = size;
        draw(c.getContext('2d'), size);
        out = c.toDataURL('image/jpeg', q);
        if (out.length <= 9000) break;
        q = 0.72;
      }
      res(out);
    };
  });
}
// Centre-crop to a small square JPEG so it fits in friend-request/profile messages.
async function squareAvatar(file) {
  const img = await loadImage(file);
  const side = Math.min(img.width, img.height);
  let q = 0.85, out = '';
  for (let size = 160; size >= 64; size -= 32) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    out = c.toDataURL('image/jpeg', q);
    if (out.length <= 9000) break;
    q = 0.72;
  }
  URL.revokeObjectURL(img.src);
  return out;
}
function loadImage(file) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tabbar button').forEach((b) => {
  b.onclick = () => {
    if (currentTab !== b.dataset.tab) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); haptic(6); }
    currentTab = b.dataset.tab;
    document.querySelector('.side-body').scrollTop = 0; $('side').classList.remove('compact');
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== currentTab));
    $('side-title').textContent = { chats: 'Chats', friends: 'Friends', calls: 'Calls', requests: 'Requests', settings: 'Settings' }[currentTab];
    $('fab-new').classList.toggle('hidden', currentTab !== 'chats');
  };
});
$('me-avatar').onclick = () => document.querySelector('.tabbar button[data-tab=settings]').click();
// Large title shrinks into the bar once the list scrolls (iOS navigation bar).
document.querySelector('.side-body').addEventListener('scroll', (e) => { $('side').classList.toggle('compact', e.target.scrollTop > 14); }, { passive: true });
$('add-friend-btn').onclick = () => openAddFriend();
$('new-group-btn').onclick = () => openNewGroup();

/* ---------------- chat view ---------------- */
let renderedFor = null;
let unseen = 0;
let renderedIds = new Set();
let renderedChat = null;
let chatAnimTimer = null;
function openChat(id) {
  setTimeout(renderGcallBanner, 0);
  if (!id) return;
  if (app.openChat && app.openChat !== id) app.store.chat(app.openChat).draft = $('input').value;
  app.setOpenChat(id);
  if (app.store.chat(id).markUnread) app.setChatFlag(id, { markUnread: false });
  renderLimit = 80; closeSearch(false);
  renderedFor = null; replyTo = null; unseen = 0; renderReplyBar();
  $('composer').classList.toggle('has-text', !!(app.store.chat(id).draft || '').trim());
  clearTimeout(chatAnimTimer); document.body.classList.remove('chat-closing');
  $('chat').style.transform = ''; $('side').style.transform = '';
  if (isPhone() && !document.body.classList.contains('chat-open') && !reducedMotion()) {
    document.body.classList.add('chat-anim');
    chatAnimTimer = setTimeout(() => document.body.classList.remove('chat-anim'), 450);
  }
  document.body.classList.add('chat-open');
  $('chat-empty').classList.add('hidden'); $('chat-inner').classList.remove('hidden');
  $('input').value = app.store.chat(id).draft || '';
  autosize();
  $('picker').classList.add('hidden');
  renderChat(true);
  renderChatList();
  if (window.innerWidth >= 860) $('input').focus();
}
function finishCloseChat() {
  if (app.openChat) { app.store.chat(app.openChat).draft = $('input').value; app.store.save(); }
  app.setOpenChat(null);
  document.body.classList.remove('chat-open', 'chat-closing', 'chat-anim', 'chat-dragging');
  $('chat').style.transform = ''; $('side').style.transform = '';
  $('chat-empty').classList.remove('hidden'); $('chat-inner').classList.add('hidden');
  renderChatList();
}
// Phone: the chat slides off to the right (iOS pop) while the list slides back in.
function closeChat() {
  if (!app.openChat || !isPhone() || reducedMotion() || !document.body.classList.contains('chat-open')) return finishCloseChat();
  clearTimeout(chatAnimTimer);
  document.body.classList.remove('chat-anim', 'chat-dragging');
  document.body.classList.add('chat-closing'); document.body.classList.remove('chat-open');
  chatAnimTimer = setTimeout(finishCloseChat, 380);
}
$('back-btn').onclick = closeChat;
// Interactive swipe-back from the left edge, following the finger (iOS navigation).
(() => {
  const chat = $('chat'), side = $('side');
  let start = null, lastX = 0, lastT = 0, vel = 0, active = false;
  chat.addEventListener('pointerdown', (e) => {
    if (!isPhone() || !app || !app.openChat || e.clientX > 28 || e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }; lastX = e.clientX; lastT = performance.now(); vel = 0; active = false;
  });
  chat.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!active) {
      if (dx > 10 && dx > Math.abs(dy) * 1.5) { active = true; document.body.classList.add('chat-dragging'); try { chat.setPointerCapture(e.pointerId); } catch {} }
      else if (Math.abs(dy) > 10) { start = null; return; }
      else return;
    }
    const now = performance.now(); vel = (e.clientX - lastX) / Math.max(1, now - lastT); lastX = e.clientX; lastT = now;
    const x = Math.max(0, dx);
    chat.style.transform = `translateX(${x}px)`;
    side.style.transform = `translateX(${-30 + 30 * Math.min(1, x / window.innerWidth)}%)`;
    e.preventDefault();
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x; start = null;
    if (!active) return;
    active = false;
    const w = window.innerWidth;
    const go = dx > w / 3 || (vel > .45 && dx > 60);
    chat.style.transition = 'transform .32s var(--ios)'; side.style.transition = 'transform .32s var(--ios)';
    chat.style.transform = go ? `translateX(${w}px)` : ''; side.style.transform = go ? '' : 'translateX(-30%)';
    setTimeout(() => {
      chat.style.transition = ''; side.style.transition = '';
      if (go) { haptic(8); finishCloseChat(); } else { document.body.classList.remove('chat-dragging'); chat.style.transform = ''; side.style.transform = ''; }
    }, 330);
  };
  chat.addEventListener('pointerup', end); chat.addEventListener('pointercancel', end);
  // Edge touches are ours unless they turn vertical: stops #messages scrolling from cancelling the gesture.
  chat.addEventListener('touchmove', (e) => {
    if (!start || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (active || dx > Math.abs(dy)) e.preventDefault();      // horizontal: ours
    else if (Math.abs(dy) > dx) start = null;                   // vertical: let the list scroll
  }, { passive: false });
})();

function atBottom() { const box = $('messages'); return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }
function updateJump() {
  const show = !atBottom() && app && app.openChat;
  $('jump-btn').classList.toggle('hidden', !show);
  const c = $('jump-count'); c.textContent = unseen; c.classList.toggle('hidden', !unseen || !show);
}
$('messages').addEventListener('scroll', () => { if (atBottom()) unseen = 0; updateJump(); });
$('jump-btn').onclick = () => { const box = $('messages'); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); unseen = 0; updateJump(); };

function mediaCard(url, out) {
  const m = parseMedia(url); if (!m) return '';
  const label = { instagram: 'IG', youtube: '▶', tiktok: '♪', tv: '📺', hls: '📺' }[m.kind];
  const name = { instagram: 'Instagram reel', youtube: 'YouTube', tiktok: 'TikTok', tv: m.name ? `Live TV · ${m.name}` : 'Live TV channel', hls: 'Live stream' }[m.kind];
  return `<div class="media-card"><span class="thumb ${m.kind}">${label}</span><span>${name}</span><button class="btn primary small" data-watch="${esc(m.url)}">Watch together</button></div>`;
}

let scrollNext = false;
function renderChat(scrollToEnd = false) {
  const id = app.openChat; if (!id) return;
  const group = isGroupId(id);
  const f = group ? null : (app.state.friends[id] || {});
  const g = group ? app.group(id) : null;
  setAvatar($('chat-avatar'), id);
  $('chat-name').textContent = app.nameOf(id);
  const can = app.canChat(id);
  const pending = !group && app.isPending(id);
  $('request-banner').classList.toggle('hidden', group || can || f.status === 'blocked');
  $('request-banner-name').textContent = app.nameOf(id);
  $('pending-banner').classList.toggle('hidden', !pending);
  $('pending-name').textContent = app.nameOf(id);
  $('composer').classList.toggle('hidden', !can);
  $('left-note').classList.toggle('hidden', !(group && !g));
  const noCall = group ? !(app.group(app.openChat)?.members.length > 1) : (!can || pending);
  $('audio-call-btn').classList.toggle('hidden', noCall);
  $('video-call-btn').classList.toggle('hidden', noCall);
  $('plus-btn').classList.toggle('hidden', !can || pending);
  updateTyping();

  const box = $('messages');
  const chat = app.store.chat(id);
  if (chat.wall) box.dataset.wall = chat.wall; else delete box.dataset.wall;
  if (chat.bubble) box.dataset.bubble = chat.bubble; else delete box.dataset.bubble;
  renderPinBar(chat);
  const wasAtBottom = atBottom();
  const key = id + ':' + chat.messages.length + ':' + renderLimit + ':' + (chat.pinned || []).join('') + ':' + chat.messages.map((m) => m.id.slice(0, 8) + (m.status || '') + (m.edited ? 'E' : '') + (m.deleted ? 'D' : '') + (m.star ? 'S' : '') + (m.votes ? JSON.stringify(m.votes) : '') + (m.audio ? (m.audio.ready ? 'R' : m.audio.got || 0) + ':' + (app.sending[m.id] ?? '') + (audioEls[m.id] ? (audioEls[m.id].paused ? 'p' : 'P') + (audioRate[m.id] || 1) : '') : '') + (m.rx ? Object.values(m.rx).map((r) => r.e).join('') : '') + (m.video ? (m.video.ready ? 'R' : m.video.got || 0) + ':' + (app.sending[m.id] ?? '') : '')).join('') + ':' + (group && g ? g.members.length : '') + ':' + [...playing].join('');
  if (renderedFor !== key) {
    renderedFor = key;
    if (renderedChat !== id) { renderedIds = new Set(chat.messages.map((m) => m.id)); renderedChat = id; }
    const isNew = (m) => !renderedIds.has(m.id);
    const byId = new Map(chat.messages.map((m) => [m.id, m]));
    let html = `<div class="lock-note">🔒 ${group ? 'Group messages are encrypted separately for each member. Only members can read them.' : 'Messages and calls are end-to-end encrypted. Nobody outside this chat — not even the relays — can read them.'}</div>`;
    let lastDay = '', prev = null;
    const win = chat.messages.length > renderLimit ? chat.messages.slice(chat.messages.length - renderLimit) : chat.messages;
    if (win.length < chat.messages.length) html += `<button class="load-earlier" id="load-earlier">Load earlier messages (${chat.messages.length - win.length})</button>`;
    for (const m of win) {
      const day = fmtDay(m.ts);
      if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; prev = null; }
      if (m.kind === 'system') { html += `<div class="sys">${esc(m.text)}</div>`; prev = null; continue; }
      if (m.kind === 'call') {
        html += `<div class="card-msg ${isNew(m) ? 'anim' : ''}" data-id="${m.id}"><span class="ic ${m.missed ? 'missed' : ''}">${m.video ? VIDEO_SVG : PHONE_SVG}</span><div class="body"><div>${callLabel(m)}</div><div class="sub">${fmtTime(m.ts)}</div></div><button class="btn ghost small" data-callback="${m.video ? 'v' : 'a'}">Call back</button></div>`;
        prev = null; continue;
      }
      if (m.kind === 'game') {
        const s = games.get(m.gameId);
        const active = s && s.status !== 'done';
        const label = !s ? '' : s.status === 'lobby' ? (s.players.includes(app.pk) ? (s.host === app.pk ? 'Open' : 'Open') : 'Join') : s.status === 'playing' ? (s.players.includes(app.pk) ? 'Open' : 'Watch') : '';
        html += `<div class="card-msg ${isNew(m) ? 'anim' : ''}" data-id="${m.id}"><span class="ic">${GAMES[m.type] ? GAMES[m.type].icon : '🎮'}</span><div class="body"><div>${esc(m.text)}</div><div class="sub">${fmtTime(m.ts)}${s && s.status === 'lobby' ? ` · ${s.players.length}/${GAMES[s.type].max} players` : ''}</div></div>${active && label ? `<button class="btn primary small" data-game="${m.gameId}">${label}</button>` : ''}</div>`;
        prev = null; continue;
      }
      if (m.kind === 'poll') { html += pollHtml(m, isNew(m)); prev = null; continue; }
      const out = m.from === app.pk;
      const cont = prev && prev.from === m.from && m.ts - prev.ts < 3 * 60000 && !m.re;
      const emojiOnly = m.kind === 'text' && m.text.length <= 8 && EMOJI_RE.test(m.text);
      let body;
      if (m.deleted) body = `<span class="deleted">🚫 ${out ? 'You deleted this message' : 'This message was deleted'}</span>`;
      else if (m.kind === 'image') body = `<img src="${m.img}" alt="Photo" data-full="1" loading="lazy">`;
      else if (m.kind === 'audio') body = audioHtml(m);
      else if (m.kind === 'video') body = videoHtml(m);
      else if (m.kind === 'sticker') body = animHtml(m.sticker) || stickerSvg(m.sticker) || '<span class="muted">Sticker</span>';
      else { body = mentionify(linkify(m.text), m); const mm = m.text.match(MEDIA_RE); if (mm) body += mediaCard(mm[0], out); const geo = m.text.match(GEO_RE); if (geo) body = geoCard(geo, m.text); }
      if (m.fwd && !m.deleted) body = `<div class="fwd">↪ Forwarded</div>` + body;
      let quote = '';
      if (m.re) {
        const orig = byId.get(m.re.id);
        const qname = (m.re.from || (orig && orig.from)) === app.pk ? 'You' : app.nameOf(m.re.from || (orig && orig.from) || '');
        const qtext = orig ? previewOf(orig) : m.re.text || 'Message';
        quote = `<div class="quote" data-jump="${esc(m.re.id)}"><b>${esc(qname)}</b><span>${esc(qtext)}</span></div>`;
      }
      let tick = '';
      if (out) {
        if (m.status === 'pending') tick = '<span class="tick">🕓</span>';
        else if (m.status === 'failed') tick = `<span class="failed" data-resend="${m.id}">Failed · tap to retry</span>`;
        else tick = `<span class="tick ${m.status === 'read' ? 'read' : ''}">${m.status === 'sent' || group ? '✓' : '✓✓'}</span>`;
      }
      const sender = group && !out && !cont ? `<div class="sender" style="color:${colorOf(m.from)}">${esc(app.nameOf(m.from))}</div>` : '';
      html += `<div class="msg ${out ? 'out' : 'in'} ${emojiOnly ? 'emoji-only' : ''} ${m.kind === 'sticker' ? (animOf(m.sticker) ? 'aemoji-msg' : 'sticker-msg') : m.kind === 'video' ? 'video-msg' : ''} ${cont ? 'cont' : ''} ${isNew(m) ? 'anim' : ''} ${m.mt && m.mt.includes(app.pk) ? 'mentioned' : ''} ${m.rx ? 'has-rx' : ''}" data-id="${m.id}">${sender}<div class="bubble">${quote}${body}</div><div class="meta">${fmtTime(m.ts)}${m.edited ? ' · edited' : ''}${m.exp ? ' · ⏱' : ''}${m.star ? ' · ★' : ''}${''} ${tick}</div><button class="act" data-reply="${m.id}" title="Reply">${REPLY_SVG}</button>${rxHtml(m)}</div>`;
      prev = m;
    }
    box.innerHTML = html;
    renderedIds = new Set(chat.messages.map((m) => m.id));
    box.querySelectorAll('img[data-full]').forEach((img) => { img.onclick = () => openViewer(img.src, img); });
    box.querySelectorAll('[data-resend]').forEach((el) => { el.onclick = () => app.resend(id, el.dataset.resend).catch((e) => toast(e.message, 'error')); });
    box.querySelectorAll('[data-play]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); playVideo(el.dataset.play); }; });
    box.querySelectorAll('[data-aplay]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); playAudio(el.dataset.aplay); }; });
    box.querySelectorAll('[data-arate]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); cycleRate(el.dataset.arate); }; });
    box.querySelectorAll('.voice .wave').forEach((w) => { w.onclick = (e) => { e.stopPropagation(); const r = w.getBoundingClientRect(); seekAudio(w.closest('.voice').dataset.aid, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }; });
    box.querySelectorAll('[data-vote]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); const mid = el.closest('.poll').dataset.id; haptic(); app.vote(id, mid, Number(el.dataset.vote)); renderedFor = null; renderChat(); }; });
    box.querySelectorAll('.msg.anim[data-id]').forEach((el) => { const m = byId.get(el.dataset.id); if (m && m.fx && m.from !== app.pk && !playedFx.has(m.id)) { playedFx.add(m.id); playEffect(m.fx); } });
    box.querySelectorAll('.vid video').forEach((el) => { el.onclick = (e) => e.stopPropagation(); });
    box.querySelectorAll('[data-reply]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); setReply(el.dataset.reply); }; });
    box.querySelectorAll('[data-rx-toggle]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); const mid = el.closest('.msg').dataset.id; haptic(); app.react(id, mid, el.dataset.rxToggle); }; });
    box.querySelectorAll('[data-jump]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); jumpTo(el.dataset.jump); }; });
    box.querySelectorAll('[data-watch]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); startWatch(id, el.dataset.watch); }; });
    box.querySelectorAll('[data-callback]').forEach((el) => { el.onclick = () => startCall(id, el.dataset.callback === 'v'); });
    box.querySelectorAll('[data-game]').forEach((el) => { el.onclick = () => openGame(el.dataset.game); });
    box.querySelectorAll('.msg .meta').forEach((el) => { el.parentElement.querySelector('.bubble').addEventListener('click', () => el.classList.toggle('show')); });
    const le = $('load-earlier'); if (le) le.onclick = () => { const h = box.scrollHeight; renderLimit += 120; renderedFor = null; renderChat(); box.scrollTop = box.scrollHeight - h; };
    if (searchHits.length) markHits();
    if (scrollToEnd || wasAtBottom || scrollNext) { box.scrollTop = box.scrollHeight; scrollNext = false; }
    updateJump();
  }
}
let renderLimit = 80;
function renderPinBar(chat) {
  const bar = $('pin-bar'); const ids = chat.pinned || [];
  const m = ids.length ? chat.messages.find((x) => x.id === ids[ids.length - 1]) : null;
  bar.classList.toggle('hidden', !m);
  if (!m) return;
  $('pin-text').innerHTML = `<b>Pinned message${ids.length > 1 ? ` (${ids.length})` : ''}</b>${esc(previewOf(m))}`;
  $('pin-text').onclick = () => { ensureVisible(m.id); jumpTo(m.id); };
  $('pin-close').onclick = async () => { if (await confirmSheet('Unpin message?', '', 'Unpin', false)) { app.pinMessage(app.openChat, m.id, false); renderedFor = null; renderChat(); } };
}
function ensureVisible(mid) {
  const chat = app.store.chat(app.openChat); const idx = chat.messages.findIndex((x) => x.id === mid);
  if (idx < 0) return;
  const need = chat.messages.length - idx;
  if (need > renderLimit) { renderLimit = need + 20; renderedFor = null; renderChat(); }
}
/* ---- in-chat search ---- */
let searchHits = [], searchIdx = -1;
function openSearch() { $('search-bar').classList.remove('hidden'); $('msg-search').value = ''; $('search-count').textContent = ''; searchHits = []; searchIdx = -1; setTimeout(() => $('msg-search').focus(), 50); }
function closeSearch(render = true) { $('search-bar').classList.add('hidden'); searchHits = []; searchIdx = -1; document.querySelectorAll('.msg.hit').forEach((x) => x.classList.remove('hit')); if (render) { renderedFor = null; renderChat(); } }
function markHits() { document.querySelectorAll('.msg.hit').forEach((x) => x.classList.remove('hit')); for (const h of searchHits) { const el = $('messages').querySelector(`.msg[data-id="${h}"]`); if (el) el.classList.add('hit'); } }
function runSearch() {
  const q = $('msg-search').value;
  searchHits = app.search(app.openChat, q); searchIdx = searchHits.length ? searchHits.length - 1 : -1;
  $('search-count').textContent = q ? (searchHits.length ? `${searchIdx + 1}/${searchHits.length}` : 'No results') : '';
  markHits();
  if (searchIdx >= 0) { ensureVisible(searchHits[searchIdx]); markHits(); jumpTo(searchHits[searchIdx]); }
}
function stepSearch(d) {
  if (!searchHits.length) return;
  searchIdx = (searchIdx + d + searchHits.length) % searchHits.length;
  $('search-count').textContent = `${searchIdx + 1}/${searchHits.length}`;
  ensureVisible(searchHits[searchIdx]); markHits(); jumpTo(searchHits[searchIdx]);
}
let searchTimer = null;
$('msg-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); });
$('msg-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? 1 : -1); } if (e.key === 'Escape') closeSearch(); });
$('search-prev').onclick = () => stepSearch(-1); $('search-next').onclick = () => stepSearch(1); $('search-close').onclick = () => closeSearch();
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const playing = new Set();
function videoHtml(m) {
  const v = m.video || {};
  const ar = v.w && v.h ? `${v.w}/${v.h}` : '3/4';
  const data = playing.has(m.id) && app.store.blobs[m.id];
  if (data) return `<div class="vid" style="--ar:${ar}" data-vid="${m.id}"><video src="${data}" controls autoplay playsinline></video></div>`;
  const poster = v.poster ? `<img class="poster" src="${v.poster}" alt="">` : '';
  const sending = app.sending[m.id];
  let overlay;
  if (sending !== undefined && m.status === 'pending') overlay = `<div class="prog"><div class="ring" style="--p:${Math.round(sending / (v.n || 1) * 100)}%"></div>Sending ${sending}/${v.n}</div>`;
  else if (!v.ready) overlay = m.from === app.pk ? `<div class="prog">Only on the device it was sent from</div>` : `<div class="prog"><div class="ring" style="--p:${v.n ? Math.round((v.got || 0) / v.n * 100) : 0}%"></div>Receiving ${v.got || 0}/${v.n}</div>`;
  else overlay = `<button class="play" data-play="${m.id}" title="Play">${PLAY_SVG}</button>`;
  return `<div class="vid" style="--ar:${ar}" data-vid="${m.id}">${poster}${overlay}${v.dur ? `<span class="dur">${fmtClock(v.dur)}</span>` : ''}</div>`;
}
const GEO_RE = /https:\/\/www\.openstreetmap\.org\/\?mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)[^\s]*/;
function geoCard(geo, text) {
  const lat = Number(geo[1]).toFixed(5), lon = Number(geo[2]).toFixed(5);
  const d = 0.004;
  const bbox = `${(+lon - d).toFixed(5)},${(+lat - d).toFixed(5)},${(+lon + d).toFixed(5)},${(+lat + d).toFixed(5)}`;
  const label = text.replace(geo[0], '').replace('📍', '').trim();
  return `<div class="geo"><iframe loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}"></iframe>
    <div class="geo-foot"><span>📍 ${esc(label || 'Shared location')}<br><span class="tiny muted">${lat}, ${lon}</span></span><a class="btn ghost small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}">Open in Maps</a></div></div>`;
}
function mentionify(html, m) {
  if (!m.mt || !m.mt.length) return html;
  for (const pk of m.mt) {
    const n = app.nameOf(pk); if (!n) continue;
    html = html.split('@' + esc(n)).join(`<span class="mention ${pk === app.pk ? 'me' : ''}">@${esc(n)}</span>`);
  }
  return html;
}
function pollHtml(m, anim) {
  const votes = m.votes || {}; const total = Object.keys(votes).length;
  const mine = votes[app.pk];
  const out = m.from === app.pk;
  if (m.deleted) return `<div class="msg ${out ? 'out' : 'in'}" data-id="${m.id}"><div class="bubble"><span class="deleted">🚫 This poll was deleted</span></div></div>`;
  const rows = m.opts.map((o, i) => { const n = Object.values(votes).filter((v) => v === i).length; const pct = total ? Math.round(n / total * 100) : 0;
    return `<button class="popt ${mine === i ? 'on' : ''}" data-vote="${i}"><i style="width:${pct}%"></i><span class="t">${esc(o)}</span><span class="n">${total ? pct + '%' : ''}</span></button>`; }).join('');
  return `<div class="msg ${out ? 'out' : 'in'} ${anim ? 'anim' : ''} poll-msg" data-id="${m.id}"><div class="bubble poll" data-id="${m.id}">
    ${!out && isGroupId(app.openChat) ? `<div class="sender" style="color:${colorOf(m.from)}">${esc(app.nameOf(m.from))}</div>` : ''}
    <div class="pq">📊 ${esc(m.text)}</div>${rows}<div class="tiny muted">${total} vote${total === 1 ? '' : 's'} · ${fmtTime(m.ts)}</div></div></div>`;
}
const audioEls = {}; const audioRate = {};
function audioHtml(m) {
  const a = m.audio || {};
  const w = (a.wave && a.wave.length ? a.wave : Array.from({ length: 32 }, () => 0.3)).map((v) => `<i style="height:${Math.max(12, Math.round(v * 100))}%"></i>`).join('');
  const sending = app.sending[m.id];
  let btn;
  if (sending !== undefined && m.status === 'pending') btn = `<span class="aprog">${Math.round(sending / (a.n || 1) * 100)}%</span>`;
  else if (!a.ready) btn = m.from === app.pk ? `<span class="aprog" title="Only on the device it was sent from">…</span>` : `<span class="aprog">${a.n ? Math.round((a.got || 0) / a.n * 100) : 0}%</span>`;
  else btn = `<button class="aplay ${audioEls[m.id] && !audioEls[m.id].paused ? 'playing' : ''}" data-aplay="${m.id}">${audioEls[m.id] && !audioEls[m.id].paused ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>' : PLAY_SVG}</button>`;
  const el = audioEls[m.id];
  const pos = el && el.duration ? el.currentTime / el.duration : 0;
  return `<div class="voice" data-aid="${m.id}">${btn}<div class="wave" style="--pos:${Math.round(pos * 100)}%">${w}</div><span class="adur">${fmtClock(el && !el.paused ? Math.round(el.currentTime) : (a.dur || 0))}</span>${el ? `<button class="arate" data-arate="${m.id}">${audioRate[m.id] || 1}×</button>` : ''}</div>`;
}
async function seekAudio(id, frac) {
  if (!audioEls[id]) await playAudio(id);
  const el = audioEls[id]; if (!el) return;
  const hit = app.findMessage(id); const d = isFinite(el.duration) && el.duration ? el.duration : (hit && hit.m.audio && hit.m.audio.dur) || 0;
  if (!d) return;
  el.currentTime = frac * d;
  const v = document.querySelector(`.voice[data-aid="${id}"] .wave`); if (v) v.style.setProperty('--pos', Math.round(frac * 100) + '%');
  if (el.paused) el.play().catch(() => {});
}
async function playAudio(id) {
  let el = audioEls[id];
  if (!el) {
    const data = await app.getVideo(id); if (!data) { toast('Voice message is not on this device'); return; }
    el = audioEls[id] = new Audio(data); el.playbackRate = audioRate[id] || 1;
    await new Promise((res) => { let done = false; const ok = () => { if (!done) { done = true; res(); } }; el.onloadedmetadata = () => { if (isFinite(el.duration)) return ok(); el.ondurationchange = () => { if (isFinite(el.duration)) { el.ondurationchange = null; el.currentTime = 0; ok(); } }; el.currentTime = 1e101; }; el.onerror = ok; setTimeout(ok, 1500); });
    if (audioEls[id] !== el) return; el.currentTime = 0;
    el.ontimeupdate = () => { const v = document.querySelector(`.voice[data-aid="${id}"]`); if (!v) return; const w = v.querySelector('.wave'); if (w && el.duration) w.style.setProperty('--pos', Math.round(el.currentTime / el.duration * 100) + '%'); const d = v.querySelector('.adur'); if (d) d.textContent = fmtClock(Math.round(el.currentTime)); };
    el.onended = () => { renderedFor = null; renderChat(); const hit = app.findMessage(id); if (hit) { const next = app.store.chat(hit.chatId).messages.find((x) => x.kind === 'audio' && x.ts > hit.m.ts && x.from !== app.pk && x.audio && x.audio.ready && !audioEls[x.id]); if (next) playAudio(next.id); } };
    el.onpause = () => { renderedFor = null; renderChat(); };
    el.onplay = () => { for (const [k, o] of Object.entries(audioEls)) if (k !== id && !o.paused) o.pause(); renderedFor = null; renderChat(); };
  }
  if (el.paused) el.play().catch(() => toast('Could not play', 'error')); else el.pause();
}
function cycleRate(id) {
  const r = audioRate[id] || 1; const next = r === 1 ? 1.5 : r === 1.5 ? 2 : 1;
  audioRate[id] = next; if (audioEls[id]) audioEls[id].playbackRate = next;
  renderedFor = null; renderChat();
}
const playedFx = new Set();
function playEffect(name) {
  if (reducedMotion()) return;
  const host = $('messages').parentElement;
  if (name === 'confetti') { confetti(host); return; }
  const glyph = { hearts: '❤️', balloons: '🎈', fire: '🔥', stars: '✨', laugh: '😂', party: '🎉' }[name];
  if (!glyph) return;
  const layer = document.createElement('div'); layer.className = 'fx-layer'; host.appendChild(layer);
  for (let i = 0; i < 18; i++) {
    const sp = document.createElement('span'); sp.textContent = glyph; sp.style.left = Math.random() * 100 + '%'; sp.style.animationDelay = (Math.random() * 0.9) + 's'; sp.style.fontSize = (22 + Math.random() * 26) + 'px';
    layer.appendChild(sp);
  }
  haptic(30);
  setTimeout(() => layer.remove(), 3200);
}

async function playVideo(id) {
  const data = await app.getVideo(id);
  if (!data) { toast('Video is not on this device'); return; }
  playing.add(id); renderedFor = null; renderChat();
}
function jumpTo(mid) {
  const el = $('messages').querySelector(`.msg[data-id="${CSS.escape(mid)}"]`);
  if (!el) { toast('Original message is not on this device'); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function updateTyping() {
  const id = app.openChat; if (!id) return;
  const t = typingState[id];
  const on = !!t;
  $('typing').classList.toggle('hidden', !on);
  $('typing-who').textContent = on && isGroupId(id) ? app.nameOf(t.pk) + ' is typing' : '';
  const g = app.group(id);
  let sub;
  let online = false;
  if (isGroupId(id)) sub = !g ? 'You left this group' : on ? `${app.nameOf(t.pk)} is typing…` : `${g.members.length} members · encrypted`;
  else if (app.isBlocked(id)) sub = 'Blocked';
  else if (on) sub = 'typing…';
  else if (app.isPending(id)) sub = 'Request sent · not accepted yet';
  else if (!app.isFriend(id)) sub = 'Wants to be your close friend';
  else if (app.isOnline(id)) { sub = 'Online'; online = true; }
  else if (app.lastSeen(id)) sub = 'Last seen ' + fmtAgo(app.lastSeen(id));
  else sub = 'End-to-end encrypted';
  $('chat-sub').textContent = sub;
  $('chat-sub').classList.toggle('online', online);
  $('chat-avatar').classList.toggle('online', isOnline(id));
  if (on && atBottom()) { const box = $('messages'); box.scrollTop = box.scrollHeight; }
}

$('banner-accept').onclick = () => { app.acceptRequest(app.openChat); toast('Added to close friends'); haptic(); };
$('pending-cancel').onclick = async () => { const pk = app.openChat; if (await confirmSheet('Cancel request?', `${app.nameOf(pk)} will no longer see your friend request.`, 'Cancel request')) { closeChat(); app.cancelRequest(pk); toast('Request cancelled'); } };
$('banner-block').onclick = () => { app.block(app.openChat); closeChat(); };

/* reply + gestures */
function setReply(mid) {
  const chat = app.store.chat(app.openChat);
  const m = chat.messages.find((x) => x.id === mid);
  if (!m || m.kind === 'system' || m.kind === 'call' || m.kind === 'game') return;
  replyTo = { id: m.id, from: m.from, text: previewOf(m) };
  haptic();
  renderReplyBar();
  $('input').focus();
}
function renderReplyBar() {
  $('reply-bar').classList.toggle('hidden', !replyTo);
  if (replyTo) { $('reply-name').textContent = replyTo.from === app.pk ? 'You' : app.nameOf(replyTo.from); $('reply-text').textContent = replyTo.text; }
}
$('reply-cancel').onclick = () => { replyTo = null; renderReplyBar(); };

(function gestures() {
  const box = $('messages');
  let startX = 0, startY = 0, el = null, swiping = false, pressTimer = null, moved = false, pressed = false;
  const msgOf = (t) => t.closest && t.closest('.msg');
  box.addEventListener('touchstart', (e) => {
    el = msgOf(e.target); if (!el) return;
    const t = e.touches[0]; if (t.clientX <= 28) { el = null; return; }
    startX = t.clientX; startY = t.clientY; moved = false; swiping = false;
    pressed = false;
    pressTimer = setTimeout(() => { if (!moved) { pressed = true; haptic(20); messageMenu(el.dataset.id); } }, 480);
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!el) return;
    const t = e.touches[0]; const dx = t.clientX - startX, dy = t.clientY - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(pressTimer); }
    if (!swiping && dx > 14 && Math.abs(dy) < 20) swiping = true;
    if (swiping) { el.style.transform = `translateX(${Math.min(dx, 90)}px)`; el.classList.toggle('swiping', dx > 55); }
  }, { passive: true });
  const endSwipe = (e) => {
    clearTimeout(pressTimer);
    // after a long-press the menu is already under the finger: swallow the synthetic click on release
    if (pressed && e.cancelable) e.preventDefault();
    pressed = false;
    if (!el) return;
    if (swiping) {
      const dx = (e.changedTouches ? e.changedTouches[0].clientX : startX) - startX;
      el.style.transform = ''; el.classList.remove('swiping');
      if (dx > 55) setReply(el.dataset.id);
    }
    el = null; swiping = false;
  };
  box.addEventListener('touchend', endSwipe); box.addEventListener('touchcancel', endSwipe);
  box.addEventListener('contextmenu', (e) => { const m = msgOf(e.target); if (m) { e.preventDefault(); messageMenu(m.dataset.id); } });
  // mouse long-press (desktop): hold ~0.5s without moving -> same menu as touch long-press / right-click
  let mTimer = null, mEl = null, mX = 0, mY = 0, mFired = false;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    mEl = msgOf(e.target); if (!mEl) return;
    mX = e.clientX; mY = e.clientY; mFired = false;
    clearTimeout(mTimer);
    mTimer = setTimeout(() => { mFired = true; messageMenu(mEl.dataset.id); }, 480);
  });
  box.addEventListener('pointermove', (e) => { if (mTimer && e.pointerType === 'mouse' && (Math.abs(e.clientX - mX) > 6 || Math.abs(e.clientY - mY) > 6)) { clearTimeout(mTimer); mTimer = null; } });
  const mEnd = (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(mTimer); mTimer = null; };
  box.addEventListener('pointerup', mEnd); box.addEventListener('pointercancel', mEnd); box.addEventListener('pointerleave', mEnd);
  box.addEventListener('click', (e) => { if (mFired) { mFired = false; e.stopPropagation(); e.preventDefault(); } }, true);
  const heartTap = (m, x, y) => {
    if (!m || m.classList.contains('sys') || !app.openChat) return;
    const mid = m.dataset.id; const msg = app.store.chat(app.openChat).messages.find((x) => x.id === mid); if (!msg || msg.deleted || msg.kind === 'poll') return;
    const mine = (msg.rx || {})[app.pk]; if (mine && mine.e === '❤️') return;
    app.react(app.openChat, mid, '❤️'); haptic(12); fx(1000, 0.08, 0, 0.04, 'sine');
    if (!reducedMotion()) { const h = document.createElement('div'); h.className = 'heart-pop'; h.textContent = '❤️'; h.style.left = x + 'px'; h.style.top = y + 'px'; document.body.appendChild(h); setTimeout(() => h.remove(), 900); }
  };
  const isCtl = (t) => !!t.closest('button, a, input, .wave, .rx-chips, .poll, video, audio');
  box.addEventListener('dblclick', (e) => { if (isCtl(e.target)) return; const m = msgOf(e.target); if (!m) return; if (window.innerWidth >= 860 && !e.target.closest('.bubble')) setReply(m.dataset.id); else heartTap(m, e.clientX, e.clientY); });
  let lastTap = { t: 0, id: '' };
  box.addEventListener('touchend', (e) => {
    if (isCtl(e.target)) { lastTap = { t: 0, id: '' }; return; } const m = msgOf(e.target); if (!m || e.changedTouches.length !== 1) return;
    const now = Date.now(); const t = e.changedTouches[0];
    if (now - lastTap.t < 320 && lastTap.id === m.dataset.id) { e.preventDefault(); lastTap = { t: 0, id: '' }; heartTap(m, t.clientX, t.clientY); }
    else lastTap = { t: now, id: m.dataset.id };
  }, { passive: false });
})();

async function messageMenu(mid) {
  const id = app.openChat; const chat = app.store.chat(id);
  const m = chat.messages.find((x) => x.id === mid); if (!m) return;
  const items = [{ id: 'reply', label: 'Reply' }];
  if (m.kind === 'text' && !m.deleted) items.push({ id: 'copy', label: 'Copy text' });
  if (!m.deleted && ['text', 'image', 'sticker', 'video', 'audio'].includes(m.kind)) items.push({ id: 'forward', label: 'Forward' });
  if (app.canEdit(m)) items.push({ id: 'edit', label: 'Edit' });
  if (!m.deleted) items.push({ id: 'star', label: m.star ? 'Unstar' : 'Star' });
  if (!m.deleted) { const pinned = (chat.pinned || []).includes(mid); items.push({ id: 'pin', label: pinned ? 'Unpin' : 'Pin' }); }
  if (m.kind === 'text' && MEDIA_RE.test(m.text)) items.push({ id: 'watch', label: 'Watch together' });
  if (m.kind === 'image') items.push({ id: 'view', label: 'View photo' });
  if (m.kind === 'video' && m.video && m.video.ready) items.push({ id: 'save', label: 'Save video' });
  items.push({ id: 'delete', label: 'Delete for me', danger: true });
  if (m.from === app.pk && !m.deleted) items.push({ id: 'delall', label: 'Delete for everyone', danger: true });
  const mine = m.rx && m.rx[app.pk] ? m.rx[app.pk].e : '';
  const act = await reactionMenu(items, mine, (e) => { app.react(id, mid, e); fx(1000, 0.08, 0, 0.04, 'sine'); });
  if (act === 'reply') setReply(mid);
  else if (act === 'copy') { try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { toast('Could not copy'); } }
  else if (act === 'watch') startWatch(id, m.text.match(MEDIA_RE)[0]);
  else if (act === 'view') { openViewer(m.img, document.querySelector(`.msg[data-id="${m.id}"] img`)); }
  else if (act === 'save') { const data = await app.getVideo(mid); if (!data) { toast('Video is not on this device'); return; } const a = document.createElement('a'); a.href = data; a.download = `chatly-video.${/webm/.test(m.video.mime) ? 'webm' : 'mp4'}`; a.click(); }
  else if (act === 'delete') { app.deleteLocal(id, mid); renderedFor = null; renderChat(); }
  else if (act === 'delall') { if (await confirmSheet('Delete for everyone?', 'The message is removed for everyone in this chat.', 'Delete')) { app.deleteForAll(id, mid); renderedFor = null; renderChat(); } }
  else if (act === 'edit') { const v = await promptSheet('Edit message', m.text, 'Message'); if (v !== null && v !== undefined && v.trim()) { try { app.editMessage(id, mid, v); renderedFor = null; renderChat(); } catch (e) { toast(e.message, 'error'); } } }
  else if (act === 'star') { app.star(id, mid, !m.star); toast(m.star ? 'Starred' : 'Removed from starred'); renderedFor = null; renderChat(); }
  else if (act === 'pin') { const on = !(chat.pinned || []).includes(mid); app.pinMessage(id, mid, on); toast(on ? 'Pinned' : 'Unpinned'); renderedFor = null; renderChat(); }
  else if (act === 'forward') forwardMessage(m);
}
function forwardMessage(m) {
  pickFriends('Forward to', [], async (ids) => {
    for (const to of ids) {
      if (m.kind === 'video' || m.kind === 'audio') { const data = await app.getVideo(m.id); if (!data) { toast('Media is not on this device'); continue; } const md = m.video || m.audio; await app.sendMessage(to, m.kind === 'video' ? { video: { data, mime: md.mime, dur: md.dur, w: md.w, h: md.h, poster: md.poster }, fwd: true } : { audio: { data, mime: md.mime, dur: md.dur, wave: md.wave }, fwd: true }); }
      else await app.sendMessage(to, { text: m.text, img: m.img, sticker: m.sticker, fwd: true });
    }
    toast(`Forwarded to ${ids.length} chat${ids.length === 1 ? '' : 's'}`);
  });
}

/* composer */
const input = $('input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
input.addEventListener('input', () => { autosize(); if (input.value.trim() && app.openChat) app.typing(app.openChat); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 860) { e.preventDefault(); send(); } if (e.key === 'Escape' && replyTo) { replyTo = null; renderReplyBar(); } });
$('send-btn').onclick = send;
async function send() {
  const id = app.openChat; const text = input.value.trim();
  if (!id || !text) return;
  if (text.length > 20000) { toast('Message too long (max 20,000 characters)', 'error'); return; }
  input.value = ''; autosize(); app.store.chat(id).draft = '';
  $('picker').classList.add('hidden');
  const re = replyTo; replyTo = null; renderReplyBar();
  scrollNext = true; haptic(8);
  const fx = pendingFx; pendingFx = '';
  const mentions = isGroupId(id) ? (app.group(id) ? app.group(id).members : []).filter((pk) => pk !== app.pk && text.includes('@' + app.nameOf(pk))) : [];
  $('composer').classList.remove('has-text'); hideMentions();
  const m = await app.sendMessage(id, { text, replyTo: re, fx, mentions });
  if (fx) { const el = document.querySelector(`.msg[data-id="${m.id}"]`); if (fx === 'slam' && el) el.classList.add('slam'); else playEffect(fx); }
  if (m.status === 'failed') toast('Could not send: ' + (m.error || 'no relay reachable'), 'error');
}
input.addEventListener('input', () => { $('composer').classList.toggle('has-text', !!input.value.trim()); mentionCheck(); });
/* ---- voice messages: hold the mic, slide left to cancel ---- */
(function voiceRecorder() {
  const mic = $('mic-btn'); const bar = $('rec-bar'); const wave = $('rec-wave');
  let rec = null, stream = null, chunks = [], t0 = 0, timer = null, levels = [], cancel = false, sx = 0, ctx = null, an = null, raf = 0, active = false, pid = null;
  const MAX_SEC = 180; const MAX_REC_BYTES = 1000000; // base64 of this stays under the relay media cap
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', ''].find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  const draw = () => {
    if (!an) return;
    const buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
    levels.push(lvl);
    const i = document.createElement('i'); i.style.height = Math.max(3, Math.round(lvl * 26)) + 'px'; wave.appendChild(i);
    while (wave.children.length > 60) wave.firstChild.remove();
    const sec = (Date.now() - t0) / 1000; $('rec-time').textContent = fmtClock(sec);
    if (sec >= MAX_SEC) { stop(false); return; }
    raf = requestAnimationFrame(() => setTimeout(draw, 80));
  };
  async function start(e) {
    if (active || !app.openChat) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Voice messages are not supported in this browser', 'error'); return; }
    active = true; cancel = false; sx = e.clientX; pid = e.pointerId; chunks = []; levels = [];
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { active = false; toast('Microphone permission denied', 'error'); return; }
    if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
    try { mic.setPointerCapture(pid); } catch {}
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    let bytes = 0;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) { chunks.push(ev.data); bytes += ev.data.size; if (bytes > MAX_REC_BYTES && rec === r0) stop(false); } };
    const r0 = rec;
    rec.start(250); t0 = Date.now();
    ctx = new (window.AudioContext || window.webkitAudioContext)(); an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
    wave.innerHTML = ''; $('rec-time').textContent = '0:00'; bar.classList.remove('hidden', 'cancel'); $('rec-hint').textContent = '‹ Slide to cancel';
    $('composer').classList.add('recording'); haptic(15); fx(880, 0.06, 0, 0.03, 'sine');
    draw();
  }
  function cleanup() {
    cancelAnimationFrame(raf); clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null;
    if (ctx) ctx.close().catch(() => {}); ctx = null; an = null;
    bar.classList.add('hidden'); $('composer').classList.remove('recording'); active = false;
    try { if (pid !== null) mic.releasePointerCapture(pid); } catch {} pid = null;
  }
  function stop(discard) {
    if (!active) return;
    const dur = (Date.now() - t0) / 1000; const r = rec; rec = null;
    const lv = levels.slice();
    if (!r || r.state === 'inactive') { cleanup(); return; }
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' });
      cleanup();
      if (discard || dur < 0.8 || !blob.size) { if (!discard && dur < 0.8) toast('Hold the mic to record a voice message'); haptic(10); return; }
      const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      const n = 48, w = []; for (let i = 0; i < n; i++) { const a = Math.floor(i * lv.length / n), b = Math.max(a + 1, Math.floor((i + 1) * lv.length / n)); const seg = lv.slice(a, b); w.push(seg.length ? Math.round(Math.max(...seg) * 100) / 100 : 0.2); }
      const peak = Math.max(0.15, ...w); const wave48 = w.map((v) => Math.round(Math.max(0.08, v / peak) * 100) / 100);
      scrollNext = true; haptic(8);
      const re = replyTo; replyTo = null; renderReplyBar();
      try { const m = await app.sendMessage(app.openChat, { audio: { data, mime: blob.type, dur: Math.round(dur * 10) / 10, wave: wave48 }, replyTo: re }); if (m.status === 'failed') toast('Could not send: ' + (m.error || 'no relay reachable'), 'error'); }
      catch (err) { toast(err.message, 'error'); }
    };
    try { r.stop(); } catch { cleanup(); }
  }
  mic.addEventListener('pointerdown', (e) => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); start(e); });
  mic.addEventListener('pointermove', (e) => { if (!active) return; const dx = e.clientX - sx; const c = dx < -80; if (c !== cancel) { cancel = c; bar.classList.toggle('cancel', c); $('rec-hint').textContent = c ? 'Release to cancel' : '‹ Slide to cancel'; if (c) haptic(10); } });
  const up = () => { if (active) stop(cancel); };
  mic.addEventListener('pointerup', up); mic.addEventListener('pointercancel', up);
  mic.addEventListener('lostpointercapture', () => { if (active && rec) stop(cancel); });
  mic.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!active) start({ clientX: 0, pointerId: null }); else stop(false); } });
})();
/* ---- @mentions (groups) ---- */
function hideMentions() { $('mention-pop').classList.add('hidden'); }
function mentionCheck() {
  const id = app && app.openChat; if (!id || !isGroupId(id) || !app.group(id)) { hideMentions(); return; }
  const v = input.value.slice(0, input.selectionStart); const m = v.match(/(?:^|\s)@([^@\s]{0,20})$/);
  if (!m) { hideMentions(); return; }
  const q = m[1].toLowerCase();
  const list = app.group(id).members.filter((pk) => pk !== app.pk && app.nameOf(pk).toLowerCase().startsWith(q)).slice(0, 6);
  if (!list.length) { hideMentions(); return; }
  const pop = $('mention-pop'); pop.classList.remove('hidden');
  pop.innerHTML = list.map((pk) => `<button data-pk="${pk}">${avatarHtml(pk)}<span>${esc(app.nameOf(pk))}</span></button>`).join('');
  pop.querySelectorAll('button').forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => {
    const name = app.nameOf(b.dataset.pk); const before = input.value.slice(0, input.selectionStart).replace(/@[^@\s]*$/, '@' + name + ' '); const after = input.value.slice(input.selectionStart);
    input.value = before + after; input.selectionStart = input.selectionEnd = before.length; autosize(); hideMentions(); input.focus();
  }; });
}
async function sendSticker(sid) {
  const id = app.openChat; if (!id) return;
  const re = replyTo; replyTo = null; renderReplyBar();
  scrollNext = true; haptic(8);
  const m = await app.sendMessage(id, { sticker: sid, replyTo: re });
  if (m.status === 'failed') toast('Could not send sticker', 'error');
}
const attachBtn = $('attach-btn'); if (attachBtn) attachBtn.onclick = () => $('file-input').click();
$('file-input').onchange = async () => {
  const file = $('file-input').files[0]; $('file-input').value = '';
  if (!file || !app.openChat) return;
  if (file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) { sendVideoFile(file); return; }
  try {
    const dataUrl = await compressImage(file);
    const re = replyTo; replyTo = null; renderReplyBar();
    scrollNext = true;
    const m = await app.sendMessage(app.openChat, { img: dataUrl, replyTo: re });
    if (m.status === 'failed') toast('Could not send photo: ' + (m.error || 'no relay reachable'), 'error');
  } catch (e) { toast('Could not read that image', 'error'); }
};
async function sendVideoFile(file) {
  const chatId = app.openChat;
  showModal(`<h3>Preparing video</h3><div class="pbar"><i id="vp-bar" style="width:0%"></i></div><p class="muted tiny" id="vp-text">Compressing on your device — nothing leaves your phone unencrypted.</p>`);
  try {
    const video = await prepareVideo(file, (p, label) => { const b = $('vp-bar'); if (b) b.style.width = Math.round(p * 100) + '%'; const t = $('vp-text'); if (t && label) t.textContent = label; });
    hideModal();
    const re = replyTo; replyTo = null; renderReplyBar();
    scrollNext = true; haptic(8);
    const m = await app.sendMessage(chatId, { video, replyTo: re });
    if (m.status === 'failed') toast('Could not send video: ' + (m.error || 'no relay reachable'), 'error');
  } catch (e) { hideModal(); toast(e.message || 'Could not read that video', 'error'); }
}
const VIDEO_MAX_SEC = 30, VIDEO_MAX_BYTES = 1150000, VIDEO_MAX_SIDE = 480;
function seekTo(v, t) { return new Promise((res) => { v.onseeked = () => res(); v.currentTime = t; }); }
function blobToDataUrl(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
function recorderMime() {
  for (const t of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
// Videos are re-encoded on-device (canvas + MediaRecorder) to ≤30 s / 480 px at a
// bitrate that fits ~1.1 MB, then sent as ~40 encrypted relay events.
async function prepareVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This video format is not supported here')); });
  const total = v.duration || 0;
  if (!isFinite(total) || !total) throw new Error('Could not read that video');
  const dur = Math.min(total, VIDEO_MAX_SEC);
  const scale = Math.min(1, VIDEO_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(2, Math.round(v.videoWidth * scale / 2) * 2), h = Math.max(2, Math.round(v.videoHeight * scale / 2) * 2);
  await seekTo(v, Math.min(0.2, total / 2));
  const pc = document.createElement('canvas'); pc.width = Math.round(w / 2); pc.height = Math.round(h / 2);
  pc.getContext('2d').drawImage(v, 0, 0, pc.width, pc.height);
  const poster = pc.toDataURL('image/jpeg', 0.5);
  const done = (data, mime) => { URL.revokeObjectURL(url); return { data, mime, dur: Math.round(dur), w, h, poster }; };
  if (file.size <= VIDEO_MAX_BYTES && total <= VIDEO_MAX_SEC && /^video\/(mp4|webm)$/.test(file.type)) return done(await blobToDataUrl(file), file.type);
  const mime = recorderMime();
  if (!mime) throw new Error('Video compression is not supported in this browser');
  const encode = async (factor) => {
    const budget = VIDEO_MAX_BYTES * 8 * 0.82 * factor / dur;
    const audioBits = 32000, videoBits = Math.max(120000, Math.min(1200000, Math.floor(budget - audioBits)));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(30);
    let ac = null;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); const src = ac.createMediaElementSource(v); const dest = ac.createMediaStreamDestination(); src.connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); } catch {}
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBits, audioBitsPerSecond: audioBits });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise((res) => { rec.onstop = res; });
    await seekTo(v, 0);
    ctx.drawImage(v, 0, 0, w, h);
    rec.start(500);
    let raf = 0;
    const draw = () => { ctx.drawImage(v, 0, 0, w, h); onProgress(Math.min(1, v.currentTime / dur), `Compressing… ${Math.round(Math.min(1, v.currentTime / dur) * 100)}%`); if (v.currentTime >= dur || v.ended) stop(); else raf = requestAnimationFrame(draw); };
    const stop = () => { cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop(); v.pause(); };
    v.onended = stop;
    await v.play();
    raf = requestAnimationFrame(draw);
    await finished;
    if (ac) ac.close().catch(() => {});
    return new Blob(chunks, { type: mime.split(';')[0] });
  };
  let blob = await encode(1);
  if (blob.size > VIDEO_MAX_BYTES) { onProgress(0, 'Still too big, compressing more…'); v.src = url; await new Promise((res) => { v.onloadedmetadata = res; }); blob = await encode(Math.max(0.3, (VIDEO_MAX_BYTES / blob.size) * 0.9)); }
  if (blob.size > VIDEO_MAX_BYTES) throw new Error('Video is too large even after compression — try a shorter clip');
  if (blob.size < 1000) throw new Error('Could not compress that video in this browser');
  return done(await blobToDataUrl(blob), blob.type || mime.split(';')[0]);
}
// Photos are shrunk to fit the ~48 KB encrypted-payload limit of a single relay event.
async function compressImage(file) {
  const img = await loadImage(file);
  let max = 900, q = 0.8, out = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length <= 36000) break;
    if (q > 0.5) q -= 0.12; else max = Math.round(max * 0.75);
  }
  URL.revokeObjectURL(img.src);
  return out;
}

/* emoji + sticker picker */
const EMOJIS = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😅 😉 🙃 😇 🤔 🤨 😏 😴 🤤 😭 😤 😡 🤯 🥺 😬 🙄 😳 🤗 🤭 🤫 👍 👎 👌 ✌️ 🤞 🤙 👏 🙌 🙏 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 🔥 ✨ 🎉 🎂 🍕 ☕ 🍻 ⚽ 🎮 🎵 🚀 🌙 ☀️ 🌈 🐶 🐱 🦄 👀 💀 🫶 🤝 👋'.split(' ');
let pickerTab = 'emoji';
function renderPicker() {
  const tabs = [{ id: 'emoji', name: 'Emoji' }, { id: 'live', name: 'Live' }, { id: 'anim', name: 'Animated' }, ...PACKS.filter((p) => p.id !== 'live').map((p) => ({ id: p.id, name: p.name }))];
  $('picker-tabs').innerHTML = tabs.map((t) => `<button class="${pickerTab === t.id ? 'active' : ''}" data-p="${t.id}">${esc(t.name)}</button>`).join('');
  $('picker-tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => { pickerTab = b.dataset.p; renderPicker(); }; });
  const body = $('picker-body');
  if (pickerTab === 'emoji') {
    body.className = 'picker-body emoji';
    body.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join('');
    body.querySelectorAll('button').forEach((b) => { b.onclick = () => { input.value += b.textContent; autosize(); input.focus(); }; });
  } else if (pickerTab === 'anim') {
    body.className = 'picker-body anim';
    body.innerHTML = animIds().map((id) => `<button type="button" data-s="${id}" title="Send animated emoji">${animHtml(id)}</button>`).join('');
    body.querySelectorAll('button').forEach((b) => { b.onclick = () => sendSticker(b.dataset.s); });
  } else {
    body.className = 'picker-body stickers';
    body.innerHTML = stickerIds(pickerTab).map((id) => `<button type="button" data-s="${id}">${stickerSvg(id, 84)}</button>`).join('');
    body.querySelectorAll('button').forEach((b) => { b.onclick = () => sendSticker(b.dataset.s); });
  }
}
$('emoji-btn').onclick = () => { const p = $('picker'); p.classList.toggle('hidden'); if (!p.classList.contains('hidden')) renderPicker(); };

/* chat menu */
function chatCommonItems(id) {
  const chat = app.store.chat(id);
  return [
    { id: 'search', label: 'Search in chat' },
    { id: 'expire', label: `Disappearing messages · ${chat.expire ? app.expireLabel(chat.expire) : 'Off'}` },
    { id: 'wall', label: 'Wallpaper & bubble color' },
    { id: 'flags', label: `${chat.pin ? 'Unpin' : 'Pin'} · ${chat.mute ? 'Unmute' : 'Mute'} · ${chat.arch ? 'Unarchive' : 'Archive'}` },
  ];
}
async function chatCommonAction(id, act) {
  if (act === 'search') { openSearch(); return true; }
  if (act === 'expire') { await expireSheet(id); return true; }
  if (act === 'wall') { await wallSheet(id); return true; }
  if (act === 'flags') { await chatListMenu(id); return true; }
  return false;
}
async function expireSheet(id) {
  const chat = app.store.chat(id); const cur = chat.expire || 0;
  const labels = { 0: 'Off', 86400: '24 hours', [7 * 86400]: '7 days', [90 * 86400]: '90 days' };
  const act = await menuSheet(EXPIRE_OPTIONS.map((sec) => ({ id: 'x' + sec, label: (cur === sec ? '✓ ' : '') + labels[sec] })));
  if (!act) return;
  const sec = Number(act.slice(1));
  if (sec === cur) return;
  app.setExpire(id, sec); renderedFor = null; renderChat();
  toast(sec ? `New messages disappear after ${labels[sec]} on every device` : 'Disappearing messages off');
}
const WALLS = { '': 'Default', doodle: 'Doodle', sunset: 'Sunset', ocean: 'Ocean', forest: 'Forest', night: 'Night', candy: 'Candy' };
const WALL_BG = { '': 'var(--bg3)', doodle: 'radial-gradient(circle at 1px 1px, #8884 1.5px, transparent 2px) 0 0 / 12px 12px, var(--bg3)', sunset: 'linear-gradient(160deg,#fb923c,#ec4899 55%,#6366f1)', ocean: 'linear-gradient(160deg,#0ea5e9,#6366f1 60%,#1e1b4b)', forest: 'linear-gradient(160deg,#16a34a,#0f766e 60%,#082f49)', night: 'radial-gradient(60px 40px at 20% 10%, #312e81, #0b1016 70%)', candy: 'linear-gradient(160deg,#f9a8d4,#c4b5fd 60%,#a5f3fc)' };
const BUBBLES = { '': 'var(--accent)', purple: '#8b5cf6', green: '#22c55e', pink: '#ec4899', orange: '#f97316', teal: '#14b8a6', gray: '#64748b' };
async function wallSheet(id) {
  const chat = app.store.chat(id);
  showModal(`<h3>Wallpaper</h3><div class="wall-pick">${Object.entries(WALLS).map(([k, n]) => `<button data-wall="${k}" class="${(chat.wall || '') === k ? 'on' : ''}" style="background:${WALL_BG[k]}">${n}</button>`).join('')}</div>
    <h3>My bubble color</h3><div class="swatches">${Object.entries(BUBBLES).map(([k, c]) => `<button class="swatch ${(chat.bubble || '') === k ? 'active' : ''}" data-bubble="${k}" style="background:${c}"></button>`).join('')}</div>
    <p class="tiny muted">Only on this device.</p><div class="row" style="justify-content:flex-end"><button class="btn primary small" id="w-ok">Done</button></div>`);
  const body = $('modal-body');
  body.querySelectorAll('[data-wall]').forEach((b) => { b.onclick = () => { if (b.dataset.wall) chat.wall = b.dataset.wall; else delete chat.wall; store.save(); body.querySelectorAll('[data-wall]').forEach((x) => x.classList.toggle('on', x === b)); renderChat(); haptic(); }; });
  body.querySelectorAll('[data-bubble]').forEach((b) => { b.onclick = () => { if (b.dataset.bubble) chat.bubble = b.dataset.bubble; else delete chat.bubble; store.save(); body.querySelectorAll('[data-bubble]').forEach((x) => x.classList.toggle('active', x === b)); renderChat(); haptic(); }; });
  $('w-ok').onclick = hideModal;
}
function createPollSheet(id) {
  showModal(`<h3>New poll</h3><input type="text" id="poll-q" maxlength="200" placeholder="Ask a question"><div id="poll-opts">${[0, 1].map((i) => `<input type="text" class="poll-opt" maxlength="60" placeholder="Option ${i + 1}">`).join('')}</div>
    <button class="btn ghost small" id="poll-add">+ Add option</button><div class="row" style="justify-content:flex-end"><button class="btn ghost" id="poll-no">Cancel</button><button class="btn primary" id="poll-ok">Send poll</button></div>`);
  $('poll-add').onclick = () => { const n = $('poll-opts').children.length; if (n >= 8) return; const i = document.createElement('input'); i.type = 'text'; i.className = 'poll-opt'; i.maxLength = 60; i.placeholder = `Option ${n + 1}`; $('poll-opts').appendChild(i); i.focus(); };
  $('poll-no').onclick = hideModal;
  $('poll-ok').onclick = () => {
    const q = $('poll-q').value.trim(); const opts = [...document.querySelectorAll('.poll-opt')].map((x) => x.value.trim()).filter(Boolean);
    if (!q) { toast('Type a question', 'error'); return; }
    if (opts.length < 2) { toast('Add at least two options', 'error'); return; }
    hideModal(); scrollNext = true; app.createPoll(id, q, opts); renderedFor = null; renderChat(); haptic();
  };
}
function shareLocation(id) {
  if (!navigator.geolocation) { toast('Location is not available here', 'error'); return; }
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude.toFixed(5), lon = pos.coords.longitude.toFixed(5);
    if (!await confirmSheet('Share your location?', `${lat}, ${lon} — sent encrypted to this chat only.`, 'Share', false)) return;
    scrollNext = true;
    await app.sendMessage(id, { text: `📍 My location https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` });
  }, (err) => toast(err.code === 1 ? 'Location permission denied' : 'Could not get location', 'error'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
const EFFECTS = { confetti: '🎊 Confetti', hearts: '❤️ Hearts', balloons: '🎈 Balloons', fire: '🔥 Fire', stars: '✨ Stars', slam: '💥 Slam' };
let pendingFx = '';
function effectSheet() {
  showModal(`<h3>Send with effect</h3><div class="fx-pick">${Object.entries(EFFECTS).map(([k, n]) => `<button data-fx="${k}"><b>${n.split(' ')[0]}</b>${n.split(' ')[1]}</button>`).join('')}</div><p class="tiny muted">The effect plays on both screens when the message arrives.</p>`);
  $('modal-body').querySelectorAll('[data-fx]').forEach((b) => { b.onclick = () => { hideModal(); pendingFx = b.dataset.fx; haptic(); if (input.value.trim()) send(); else { toast(`Type a message — it will be sent with ${EFFECTS[pendingFx].split(' ')[1].toLowerCase()}`); input.focus(); } }; });
}

$('chat-menu-btn').onclick = async () => {
  const id = app.openChat;
  if (isGroupId(id)) {
    const g = app.group(id);
    const act = await menuSheet([
      ...(g ? [{ id: 'members', label: `Members (${g.members.length})` }, { id: 'add', label: 'Add members' }, { id: 'rename', label: 'Rename group' }] : []),
      ...(g ? [{ id: 'photo', label: 'Group photo' }, { id: 'poll', label: 'Create poll' }] : []),
      ...chatCommonItems(id),
      { id: 'clear', label: 'Clear chat on this device' },
      ...(g ? [{ id: 'leave', label: 'Leave group', danger: true }] : [{ id: 'remove', label: 'Delete this chat', danger: true }]),
    ]);
    if (await chatCommonAction(id, act)) return;
    if (act === 'members') showMembers(gidOf(id));
    else if (act === 'photo') pickGroupPhoto(gidOf(id));
    else if (act === 'poll') createPollSheet(id);
    else if (act === 'add') pickFriends('Add members', g.members, (pks) => { app.addMembers(gidOf(id), pks); toast('Members added'); });
    else if (act === 'rename') { const v = await promptSheet('Group name', g.name, 'Name'); if (v) app.renameGroup(gidOf(id), v); }
    else if (act === 'clear') { if (await confirmSheet('Clear chat?', 'Removes this conversation from this device only.', 'Clear')) { app.clearChat(id); renderedFor = null; renderChat(); } }
    else if (act === 'leave') { if (await confirmSheet('Leave group?', 'You will stop receiving messages from this group.', 'Leave')) { app.leaveGroup(gidOf(id)); closeChat(); } }
    else if (act === 'remove') { delete app.state.chats[id]; store.save(); closeChat(); }
    return;
  }
  const f = app.state.friends[id] || {};
  const act = await menuSheet([
    ...chatCommonItems(id),
    { id: 'code', label: "Friend's code" }, { id: 'rename', label: 'Rename friend' }, { id: 'clear', label: 'Clear chat on this device' },
    f.status === 'blocked' ? { id: 'unblock', label: 'Unblock' } : { id: 'block', label: 'Block', danger: true },
    { id: 'remove', label: 'Remove friend', danger: true },
  ]);
  if (await chatCommonAction(id, act)) return;
  if (act === 'code') { showModal(`<h3>${esc(app.nameOf(id))}</h3><div class="code">${friendCode(id)}</div><div class="row" style="justify-content:flex-end"><button class="btn primary small" id="m-ok">Close</button></div>`); $('m-ok').onclick = hideModal; }
  else if (act === 'rename') { const v = await promptSheet('Rename friend', f.name, 'Nickname'); if (v) { f.name = v; store.save(); } }
  else if (act === 'clear') { if (await confirmSheet('Clear chat?', 'Removes this conversation from this device only.', 'Clear')) { app.clearChat(id); renderedFor = null; renderChat(); } }
  else if (act === 'block') { if (await confirmSheet('Block?', `${app.nameOf(id)} will no longer be able to message or call you.`, 'Block')) { app.block(id); closeChat(); } }
  else if (act === 'unblock') app.unblock(id);
  else if (act === 'remove') { if (await confirmSheet('Remove friend?', 'Deletes the chat on this device and removes them from your close friends.', 'Remove')) { app.removeFriend(id); closeChat(); } }
};

/* together menu */
$('plus-btn').onclick = () => openPlus(app.openChat);
async function openPlus(id) {
  if (!id) return;
  const group = isGroupId(id);
  const active = games.forChat(id).length;
  const live = share && share.state !== 'idle';
  showModal(`<div class="plus-grid">
    <button data-p="media"><span class="ic media"><svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1 12h14l-4.5-6-3.5 4.5L8.5 13Zm3-8a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 8 9Z"/></svg></span>Photo / video</button>
    <button data-p="sticker"><span class="ic sticker"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM7.2 14h9.6c-.7 2.4-2.6 4-4.8 4s-4.1-1.6-4.8-4Z"/></svg></span>Stickers</button>
    <button data-p="games"><span class="ic games"><svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 3.5A1.5 1.5 0 1 0 8 9.5a1.5 1.5 0 0 0 0-3Zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-4 4A1.5 1.5 0 1 0 12 13.5a1.5 1.5 0 0 0 0-3Zm-4 4A1.5 1.5 0 1 0 8 17.5a1.5 1.5 0 0 0 0-3Zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg></span>Games${active ? ` · ${active}` : ''}</button>
    <button data-p="watch"><span class="ic watch"><svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 4.5v7l6-3.5-6-3.5Z"/></svg></span>Watch reel</button>
    <button data-p="tv"><span class="ic tv"><svg viewBox="0 0 24 24"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6l1.5 2h-9L9 18H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h16V8H4Zm6.2 1.4 4.6 2.6-4.6 2.6V9.4Z"/></svg></span>Live TV</button>
    <button data-p="poll"><span class="ic poll" style="background:#f59e0b"><svg viewBox="0 0 24 24"><path d="M4 19h16v2H4zM6 10h3v7H6zm5-6h3v13h-3zm5 4h3v9h-3z"/></svg></span>Poll</button>
    <button data-p="loc"><span class="ic loc" style="background:#22c55e"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg></span>Location</button>
    <button data-p="fx"><span class="ic fx" style="background:#ec4899"><svg viewBox="0 0 24 24"><path d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4Z"/></svg></span>Effects</button>
    <button data-p="music" ${group ? 'disabled' : ''} title="${group ? 'One-to-one chats only' : ''}"><span class="ic music">${live ? '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3Z"/></svg>'}</span>${live ? 'Stop sharing' : 'Listen together'}</button>
  </div>`);
  $('plus-btn').classList.add('open');
  const un = () => $('plus-btn').classList.remove('open');
  const ob = new MutationObserver(() => { if ($('modal').classList.contains('hidden')) { un(); ob.disconnect(); } });
  ob.observe($('modal'), { attributes: true, attributeFilter: ['class'] });
  $('modal-body').querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = () => {
      hideModal(); un(); haptic();
      const p = b.dataset.p;
      if (p === 'media') $('file-input').click();
      else if (p === 'sticker') $('emoji-btn').click();
      else if (p === 'games') openGames(id);
      else if (p === 'watch') openWatch(id);
      else if (p === 'tv') openTV(id);
      else if (p === 'music') { if (live) share.stop(); else startShare(id); }
      else if (p === 'poll') createPollSheet(id);
      else if (p === 'loc') shareLocation(id);
      else if (p === 'fx') effectSheet();
    };
  });
}
async function openWatch(id) {
  if (!id) return;
const url = await promptSheet('Watch together', '', 'Paste an Instagram reel / YouTube / TikTok link', 'Everyone in this chat gets the same clip at the same time. Both of you need internet; the clip plays in the platform’s own player.'); if (url) startWatch(id, url);
}
async function openGames(id) {
  if (!id) return;
  const active = games.forChat(id);
  showModal(`<h3>Games</h3><div class="menu gpick">
    ${active.map((s) => `<button class="gactive" data-mi="g:${s.id}"><span class="gicon">${GAMES[s.type].icon}</span><b>${s.status === 'lobby' ? 'Join' : 'Open'} ${esc(GAMES[s.type].name)}</b><small>${s.players.length} player${s.players.length === 1 ? '' : 's'} · ${s.status === 'lobby' ? 'in lobby' : 'playing'}</small></button>`).join('')}
    ${GAME_ORDER.map((t) => `<button class="gtile" data-mi="${t}" style="--gc:${GAMES[t].color}"><span class="gicon">${GAMES[t].icon}</span><b>${esc(GAMES[t].name)}</b><small>${esc(GAMES[t].blurb)}</small></button>`).join('')}</div>`);
  $('modal-body').querySelectorAll('[data-mi]').forEach((b) => { b.onclick = () => {
    const act = b.dataset.mi; hideModal(); haptic();
    if (act.startsWith('g:')) openGame(act.slice(2));
    else { try { const s = games.invite(id, act); openGame(s.id); } catch (e) { toast(e.message, 'error'); } }
  }; });
}

/* ---------------- groups ---------------- */
function pickFriends(title, exclude, onDone, withName = false) {
  const friends = Object.entries(app.state.friends).filter(([pk, f]) => f.status === 'friend' && !exclude.includes(pk));
  if (!friends.length) { toast('Add some close friends first'); return; }
  showModal(`<h3>${esc(title)}</h3>${withName ? '<div class="row"><input type="text" id="g-name" maxlength="40" placeholder="Group name"></div>' : ''}
    <div class="pick-list">${friends.map(([pk]) => `<label>${avatarHtml(pk)}<span class="name">${esc(app.nameOf(pk))}</span><input type="checkbox" value="${pk}"></label>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="g-no">Cancel</button><button class="btn primary" id="g-ok">${withName ? 'Create' : 'Add'}</button></div>`);
  $('g-no').onclick = hideModal;
  $('g-ok').onclick = () => {
    const pks = [...$('modal-body').querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    const name = withName ? $('g-name').value.trim() : '';
    if (withName && !name) { toast('Give the group a name', 'error'); return; }
    if (!pks.length) { toast('Pick at least one friend', 'error'); return; }
    hideModal(); onDone(pks, name);
  };
}
function openNewGroup() {
  pickFriends('New group', [], (pks, name) => { const id = app.createGroup(name, pks); toast('Group created'); openChat(id); }, true);
}
function showMembers(gid) {
  const g = app.state.groups[gid]; if (!g) return;
  showModal(`<h3>${esc(g.name)}</h3><div class="pick-list">${g.members.map((pk) => `<div class="row-item" data-pk="${pk}">${avatarHtml(pk)}<span class="name">${esc(pk === app.pk ? 'You' : app.nameOf(pk))}${g.admin === pk ? ' <span class="tiny muted">· created the group</span>' : ''}</span>${pk !== app.pk && !app.isFriend(pk) && !app.isBlocked(pk) ? `<button class="btn ghost small" data-addf="${pk}">Add friend</button>` : ''}</div>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary small" id="m-ok">Close</button></div>`);
  $('m-ok').onclick = hideModal;
  $('modal-body').querySelectorAll('[data-addf]').forEach((b) => { b.onclick = () => { const r = app.addFriend(b.dataset.addf); toast(r === 'accepted' ? 'You are now close friends' : 'Friend request sent'); hideModal(); }; });
}

/* ---------------- add friend ---------------- */
let scanStream = null, scanRaf = null;
function stopScanner() { if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; } cancelAnimationFrame(scanRaf); }
function openAddFriend(tab = 'me') {
  if (typeof tab !== 'string') tab = 'me';
  const code = friendCode(app.pk);
  const link = inviteLink();
  const qr = qrcode(0, 'M'); qr.addData('closechat:' + code); qr.make();
  showModal(`<div class="tabs"><button data-t="me" class="${tab === 'me' ? 'active' : ''}">My code</button><button data-t="code" class="${tab === 'code' ? 'active' : ''}">By code</button><button data-t="user" class="${tab === 'user' ? 'active' : ''}">By username</button></div>
    <div data-pane="me" class="${tab === 'me' ? '' : 'hidden'}">
      <p class="muted tiny">Friends are added by invitation only — nobody can find you otherwise${settings.get().discoverable && app.state.profile.username ? ' (except by your username, which you can turn off in Settings)' : ''}.</p>
      <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div>
      <div class="code" id="my-code">${code}</div>
      <div class="row" style="flex-wrap:wrap"><button class="btn primary small" id="share-link">${navigator.share ? 'Share invite link' : 'Copy invite link'}</button><button class="btn ghost small" id="copy-code">Copy code</button></div>
    </div>
    <div data-pane="code" class="${tab === 'code' ? '' : 'hidden'}">
      <div class="row"><input type="text" id="friend-code" placeholder="Paste npub… code or invite link" autocapitalize="none" autocomplete="off"><button class="btn primary" id="add-code">Add</button></div>
      <div class="row"><button class="btn ghost small" id="scan-btn">Scan QR code</button></div>
      <div id="scan-wrap" class="hidden"><video id="scan-video" autoplay playsinline muted></video><canvas id="scan-canvas" hidden></canvas></div>
    </div>
    <div data-pane="user" class="${tab === 'user' ? '' : 'hidden'}">
      <div class="row"><input type="text" id="friend-user" placeholder="@username" autocapitalize="none" autocomplete="off"><button class="btn primary" id="find-user">Find</button></div>
      <p class="muted tiny">Only works if your friend has “Findable by username” on (it is on by default). Usernames are not unique — check the name and code before adding.</p>
      <div class="pick-list result-list" id="user-results"></div>
    </div>`);
  $('modal-body').querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { stopScanner(); openAddFriend(b.dataset.t); }; });
  $('copy-code').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch { toast('Select and copy the code above'); } };
  $('share-link').onclick = async () => {
    if (navigator.share) { navigator.share({ title: 'Add me on Chatly', text: `Add me on Chatly — private chats & calls for close friends.`, url: link }).catch(() => {}); }
    else { try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { showModal(`<h3>Invite link</h3><div class="code">${esc(link)}</div>`); } }
  };
  const doAdd = (raw, name) => {
    const hash = raw.match(/#add=([^&\s]+)(?:&n=([^&\s]+))?/);
    if (hash) { raw = hash[1]; try { name = name || decodeURIComponent(hash[2] || ''); } catch {} }
    const pk = parseFriendCode(raw.replace(/^closechat:/, ''));
    if (!pk) { toast('That is not a valid friend code', 'error'); return; }
    let r;
    try { r = app.addFriend(pk); } catch (e) { toast(e.message, 'error'); return; }
    if (name && !app.state.friends[pk].name) { app.state.friends[pk].name = name; store.save(); }
    hideModal(); toast(r === 'accepted' ? 'You are now close friends' : r === 'friend' ? 'Already close friends' : 'Friend request sent'); haptic(); openChat(pk);
  };
  $('add-code').onclick = () => doAdd($('friend-code').value);
  $('friend-code').onkeydown = (e) => { if (e.key === 'Enter') doAdd($('friend-code').value); };
  const find = async () => {
    const u = normalizeUsername($('friend-user').value.replace(/^@/, ''));
    const res = $('user-results');
    if (u.length < 3) { toast('Enter a username', 'error'); return; }
    res.innerHTML = '<p class="muted tiny">Searching relays…</p>';
    try {
      const found = (await app.lookupUsername(u)).filter((r) => r.pk !== app.pk);
      if (!found.length) { res.innerHTML = `<p class="muted tiny">Nobody named @${esc(u)} has made themselves findable. Ask them for their code or invite link instead.</p>`; return; }
      res.innerHTML = found.map((r) => `<div class="row-item">${avatarHtml(r.pk, '', r.name || u)}<div class="name"><div>${esc(r.name || '@' + u)}</div><div class="sub">${friendCode(r.pk).slice(0, 16)}…</div></div><button class="btn primary small" data-pk="${r.pk}" ${app.isFriend(r.pk) || app.isPending(r.pk) ? 'disabled' : ''}>${app.isFriend(r.pk) ? 'Friends' : app.isPending(r.pk) ? 'Requested' : 'Add'}</button></div>`).join('');
      res.querySelectorAll('[data-pk]').forEach((b) => { b.onclick = () => doAdd(b.dataset.pk, found.find((r) => r.pk === b.dataset.pk).name); });
    } catch (e) { res.innerHTML = `<p class="muted tiny">Search failed: ${esc(e.message)}</p>`; }
  };
  $('find-user').onclick = find;
  $('friend-user').onkeydown = (e) => { if (e.key === 'Enter') find(); };
  if (tab === 'user') $('friend-user').focus();
  if (tab === 'code') $('friend-code').focus();
  $('scan-btn').onclick = async () => {
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      $('scan-wrap').classList.remove('hidden');
      const v = $('scan-video'); v.srcObject = scanStream; await v.play();
      const c = $('scan-canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (!scanStream) return;
        if (v.videoWidth) {
          c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height);
          const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
          if (r && parseFriendCode(r.data.replace(/^closechat:/, ''))) { stopScanner(); doAdd(r.data); return; }
        }
        scanRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { toast('Camera not available: ' + e.message, 'error'); }
  };
}

/* ---------------- watch together ---------------- */
function startWatch(chatId, url, name = '') {
  try { watch.open(chatId, url, name); toast('Shared with ' + app.nameOf(chatId)); } catch (e) { toast(e.message, 'error'); }
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
const myTvChannels = () => (settings.get().tvChannels || []).filter((c) => c && typeof c.url === 'string' && typeof c.name === 'string');
async function addTvChannel() {
  const url = await promptSheet('Add your own channel', '', 'https://…', 'Paste a channel’s live link (youtube.com/watch?v=… or youtube.com/channel/…/live) or an .m3u8 stream link from a service you have access to. Only share streams you are allowed to watch.');
  if (!url) return false;
  const m = parseMedia(url);
  if (!m || !['tv', 'hls', 'youtube'].includes(m.kind)) { toast('Use a YouTube live link or an .m3u8 stream link', 'error'); return false; }
  const name = await promptSheet('Channel name', m.name || '', hostOf(m.url) || 'My channel');
  if (name === null) return false;
  const list = myTvChannels().filter((c) => c.url !== m.url);
  list.unshift({ name: (name || m.name || hostOf(m.url) || 'My channel').slice(0, 40), url: m.url });
  settings.set({ tvChannels: list.slice(0, 50) });
  toast('Channel saved'); return true;
}
// Live TV picker: official channels + the user's saved links; picking one opens it
// for everyone in the chat through the normal Watch-together sync.
async function openTV(id) {
  if (!id) return;
  let cat = 'All', q = '';
  showModal(`<h3 style="display:flex;align-items:center;gap:8px;margin-bottom:4px">Live TV <span class="live-pill">LIVE</span></h3>
    <p class="muted tiny" style="margin:0 0 8px">Official free live channels in their own player. Everyone in this chat watches the same channel with you.</p>
    <div class="row"><input type="search" id="tv-q" placeholder="Search channels" autocomplete="off"></div>
    <div class="tv-cats">${TV_CATS.map((c) => `<button type="button" data-cat="${esc(c)}" class="${c === 'All' ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
    <div class="tv-list" id="tv-list"></div>
    <div class="row" style="justify-content:space-between;margin-top:10px"><button class="btn ghost small" id="tv-add">+ Add your own channel</button><button class="btn ghost small" id="tv-cancel">Cancel</button></div>`);
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const pick = (url, name) => { hideModal(); haptic(); startWatch(id, url, name); };
  const render = () => {
    const mine = myTvChannels().filter((c) => !q || c.name.toLowerCase().includes(q));
    const list = TV_CHANNELS.filter((c) => (cat === 'All' || c.cat === cat) && (!q || c.name.toLowerCase().includes(q) || c.cat.toLowerCase().includes(q)));
    let html = '';
    if (cat === 'All' && mine.length) {
      html += '<div class="tv-sec">My channels</div>' + mine.map((c, i) => `<button type="button" class="tv-ch" data-url="${esc(c.url)}" data-name="${esc(c.name)}"><span class="tv-logo mine">${esc(initials(c.name) || 'TV')}</span><span class="tv-meta"><b>${esc(c.name)}</b><small>${esc(hostOf(c.url))}</small></span><span class="tv-del" data-del="${i}" title="Remove">✕</span></button>`).join('') + '<div class="tv-sec">Channels</div>';
    }
    html += list.map((c) => `<button type="button" class="tv-ch" data-url="${tvUrl(c.id)}" data-name="${esc(c.name)}"><span class="tv-logo" style="--h:${tvHue(c.name)}">${esc(initials(c.name))}</span><span class="tv-meta"><b>${esc(c.name)}</b><small>${esc(c.cat)} · ${esc(c.lang)}</small></span><span class="live-dot"></span></button>`).join('');
    if (!html) html = '<p class="muted tiny" style="padding:12px 8px">No channels match. Add your own below.</p>';
    const box = $('tv-list'); if (!box) return;
    box.innerHTML = html;
    box.querySelectorAll('.tv-ch').forEach((b) => {
      b.onclick = (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); const l = myTvChannels(); l.splice(Number(del.dataset.del), 1); settings.set({ tvChannels: l }); haptic(); render(); return; }
        pick(b.dataset.url, b.dataset.name);
      };
    });
  };
  render();
  $('tv-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
  $('modal-body').querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => { cat = b.dataset.cat; $('modal-body').querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); haptic(); render(); };
  });
  $('tv-cancel').onclick = hideModal;
  $('tv-add').onclick = async () => { if (await addTvChannel()) openTV(id); };
}

function wireWatch() {
  watch.addEventListener('update', renderWatch);
  watch.addEventListener('invite', (e) => {
    const { chatId, from } = e.detail;
    const md = e.detail.media || {}; const isTv = md.kind === 'tv' || md.kind === 'hls';
    $('invite-text').textContent = `${app.nameOf(from)} wants to watch ${isTv ? (md.name ? md.name + ' (Live TV)' : 'Live TV') : 'a reel'} together${isGroupId(chatId) ? ' in ' + app.nameOf(chatId) : ''}`;
    $('invite-bar').classList.remove('hidden');
    if (settings.get().sounds) tones.notify();
    haptic(30);
  });
  watch.addEventListener('changed', (e) => toast(`${app.nameOf(e.detail.from)} changed the clip`));
  watch.addEventListener('joined', (e) => toast(`${app.nameOf(e.detail.from)} joined`));
  watch.addEventListener('left', (e) => toast(`${app.nameOf(e.detail.from)} stopped watching`));
}
$('invite-join').onclick = () => { $('invite-bar').classList.add('hidden'); watch.join(); };
$('invite-dismiss').onclick = () => { $('invite-bar').classList.add('hidden'); watch.dismiss(); };
let watchSrc = '';
function renderWatch() {
  const s = watch.session;
  const panel = $('watch');
  if (!s) { panel.classList.add('hidden'); setWatchSource(null); watchSrc = ''; $('call').classList.remove('watching'); return; }
  panel.classList.remove('hidden');
  $('call').classList.add('watching');
  const isTv = s.media.kind === 'tv' || s.media.kind === 'hls';
  const chName = s.media.name || (s.media.kind === 'hls' ? hostOf(s.media.url) : 'Live TV');
  $('watch-title').textContent = isTv ? `${chName} · with ${app.nameOf(s.chatId)}` : `Watching with ${app.nameOf(s.chatId)}`;
  $('watch-change').textContent = isTv ? 'Channels' : 'Change clip';
  panel.querySelector('.watch-frame').classList.toggle('wide', isTv || s.media.kind === 'youtube');
  if (watchSrc !== s.media.url) { watchSrc = s.media.url; setWatchSource(s.media); }
  const who = s.by === app.pk ? 'You' : app.nameOf(s.by);
  $('watch-foot').innerHTML = isTv
    ? `<span>${esc(who)} picked ${esc(chName)}.</span>${s.media.kind === 'tv' ? `<a href="${esc(s.media.url)}" target="_blank" rel="noopener" style="color:var(--accent)">Open on YouTube</a><span>Plays in the channel’s own player; if it is off air YouTube shows “unavailable”.</span>` : '<span>Live stream from your saved link.</span>'}`
    : `<span>${esc(who)} picked this ${{ instagram: 'reel', youtube: 'video', tiktok: 'TikTok' }[s.media.kind]}.</span><a href="${esc(s.media.url)}" target="_blank" rel="noopener" style="color:var(--accent)">Open in app</a>${s.media.kind === 'instagram' ? '<span>Tap the clip to play. Instagram may ask you to log in for some reels.</span>' : ''}`;
}
// Embeds go in the iframe; .m3u8 streams play in a <video> (natively on Safari, via hls.js elsewhere).
let hlsInst = null;
function setWatchSource(media) {
  const v = $('watch-video'), f = $('watch-frame');
  if (hlsInst) { try { hlsInst.destroy(); } catch {} hlsInst = null; }
  v.pause(); v.removeAttribute('src'); v.load();
  if (!media) { f.src = 'about:blank'; v.classList.add('hidden'); f.classList.remove('hidden'); return; }
  if (media.kind !== 'hls') { v.classList.add('hidden'); f.classList.remove('hidden'); f.src = media.embed; return; }
  f.src = 'about:blank'; f.classList.add('hidden'); v.classList.remove('hidden');
  if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = media.url; v.play().catch(() => {}); return; }
  loadHls().then((Hls) => {
    if (!Hls || !Hls.isSupported()) { toast('Live streams are not supported in this browser', 'error'); return; }
    if (watchSrc !== media.url) return;
    hlsInst = new Hls({ enableWorker: false });
    hlsInst.on(Hls.Events.ERROR, (_, d) => { if (d && d.fatal) toast('This stream could not be played here', 'error'); });
    hlsInst.loadSource(media.url); hlsInst.attachMedia(v);
    v.play().catch(() => {});
  });
}
// hls.js (light build, vendored) is only fetched the first time an .m3u8 stream is opened.
let hlsLoad = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoad) hlsLoad = new Promise((res) => { const sc = document.createElement('script'); sc.src = 'hls.light.min.js'; sc.onload = () => res(window.Hls); sc.onerror = () => { hlsLoad = null; res(null); }; document.head.appendChild(sc); });
  return hlsLoad;
}

$('watch-close').onclick = () => watch.close();
$('watch-change').onclick = async () => {
  const s = watch.session; if (!s) return;
  if (s.media.kind === 'tv' || s.media.kind === 'hls') { openTV(s.chatId); return; }
  const url = await promptSheet('Change clip', '', 'Paste a new reel / video link');
  if (url) { try { watch.open(s.chatId, url); } catch (e) { toast(e.message, 'error'); } }
};
$('call-watch-btn').onclick = async () => {
  const peer = calls.peer; if (!peer) return;
  if (watch.session) { watch.close(); return; }
  const what = await menuSheet([{ id: 'tv', label: '📺 Live TV' }, { id: 'link', label: '▶ Paste a reel / video link' }]);
  if (what === 'tv') openTV(peer);
  else if (what === 'link') { const url = await promptSheet('Watch together', '', 'Paste an Instagram reel / YouTube / TikTok link'); if (url) startWatch(peer, url); }
};

/* ---------------- games ---------------- */
let openGameId = null;
function wireGames() {
  games.addEventListener('update', (e) => {
    const { id, from } = e.detail; const s = games.get(id); if (!s) return;
    if (openGameId === id) renderGame();
    if (from && from !== app.pk && app.ready) {
      if (s.status === 'lobby' && !s.players.includes(app.pk) && s.host === from) { toast(`${app.nameOf(from)} invited you to ${GAMES[s.type].name}`); if (settings.get().sounds) tones.notify(); }
      else if (s.status === 'playing' && s.players.includes(app.pk) && s.state && s.players[s.state.turn] === app.pk && openGameId !== id) { toast(`Your turn in ${GAMES[s.type].name}`); haptic(20); }
    }
    scheduleRender();
  });
}
let gameMini = false;
function openGame(id) {
  const s = games.get(id); if (!s) return;
  openGameId = id; gameMini = false;
  if (s.status === 'lobby' && !s.players.includes(app.pk)) { try { games.join(id); } catch (e) { toast(e.message, 'error'); } }
  if (calls && calls.state !== 'idle' && !callMini) setCallMini(true);
  if (s.chatId !== app.openChat) openChat(s.chatId);
  $('game').classList.remove('hidden');
  renderGame();
}
function closeGamePanel() { dropGameView(); openGameId = null; gameMini = false; $('game').classList.add('hidden'); $('game').classList.remove('full', 'mini', 'turn'); }
function setGameMini(on) { gameMini = on; renderGame(); haptic(); }
$('game-hide').onclick = () => setGameMini(true);
$('game-mini-bar').onclick = (e) => { if (!e.target.closest('#game-mini-leave')) setGameMini(false); };
async function leaveGame() {
  const s = games.get(openGameId); if (!s) return;
  if (s.status === 'done' || await confirmSheet('Leave game?', 'The game ends for everyone.', 'Leave')) { if (s.status !== 'done') games.quit(s.id); if (openGameId === s.id) closeGamePanel(); }
}
$('game-quit').onclick = leaveGame;
$('game-mini-leave').onclick = (e) => { e.stopPropagation(); leaveGame(); };
let lastDone = null, gameView = null, gameViewFor = null;
function dropGameView() { if (gameView) { try { gameView.unmount(); } catch {} } gameView = null; gameViewFor = null; }
function gameCtx(s) {
  return { my: games.myIndex(s), pk: app.pk, nameOf: (p) => (p === app.pk ? 'You' : app.nameOf(p)), avatar: avatarHtml, move: (mv) => games.move(s.id, mv), haptic, fx, confetti, toast, reduced: reducedMotion() };
}
function renderGame() {
  const s = games.get(openGameId); if (!s) { closeGamePanel(); return; }
  const G = GAMES[s.type];
  const panel = $('game');
  $('game-title').textContent = `${G.icon} ${G.name} · ${app.nameOf(s.chatId)}`;
  $('game-quit').textContent = s.status === 'done' ? 'Close' : 'Leave';
  const body = $('game-body');
  const my = games.myIndex(s);
  const myTurn = games.isMyTurn(s);
  const over = games.isOver(s);
  panel.classList.toggle('mini', gameMini);
  panel.classList.toggle('full', !gameMini && s.status !== 'lobby');
  panel.classList.toggle('turn', gameMini && myTurn);
  panel.dataset.game = s.type;
  $('game-mini-icon').textContent = G.icon;
  $('game-mini-title').textContent = `${G.name} · ${app.nameOf(s.chatId)}`;
  $('game-mini-sub').textContent = s.status === 'lobby' ? 'Waiting in lobby · tap to return' : s.status === 'done' || over ? 'Game over · tap to return' : myTurn ? 'Your turn! Tap to play' : `${s.state && s.players[s.state.turn] ? esc(app.nameOf(s.players[s.state.turn])) + "'s turn" : 'Waiting'} · tap to watch`;
  $('game-mini-leave').textContent = s.status === 'done' ? 'Close' : 'Leave';
  if (gameMini) return;
  if (s.status !== 'playing') dropGameView();
  if (s.status === 'lobby') {
    const host = s.host === app.pk;
    body.innerHTML = `<div class="lobby"><div class="lobby-hero" style="--gc:${G.color}"><span>${G.icon}</span></div><h3>${esc(G.name)}</h3><p class="muted">${esc(G.blurb)}</p>
      <div class="game-status">${host ? (s.players.length < G.min ? 'Waiting for friends to join…' : 'Ready when you are') : `Waiting for ${esc(app.nameOf(s.host))} to start…`}</div>
      <div class="players">${s.players.map((p) => `<div>${avatarHtml(p, 'sm')}<span>${esc(p === app.pk ? 'You' : app.nameOf(p))}${p === s.host ? ' <span class="tiny muted">host</span>' : ''}</span></div>`).join('')}</div>
      <p class="tiny muted">${G.min === G.max ? `${G.max} players` : `${G.min}–${G.max} players`} · ${s.players.length} joined</p>
      ${host ? `<button class="btn primary" id="game-start" ${s.players.length < G.min ? 'disabled' : ''}>Start game</button>` : ''}</div>`;
    if (host) $('game-start').onclick = () => { try { games.start(s.id); } catch (e) { toast(e.message, 'error'); } };
    return;
  }
  if (s.status === 'done') {
    const w = s.state && s.state.winner;
    body.innerHTML = `<div class="game-panel-done">${s.quitBy ? `${esc(s.quitBy === app.pk ? 'You' : app.nameOf(s.quitBy))} left the game` : w !== null && w !== undefined && w >= 0 ? `🏆 ${esc(w === my ? 'You won!' : app.nameOf(s.players[w]) + ' won')}` : 'Game over'}
      ${s.state && s.state.score ? `<div class="g-series">${s.players.map((p, i) => `${esc(p === app.pk ? 'You' : app.nameOf(p))} ${s.state.score[i] || 0}`).join(' · ')}</div>` : ''}
      <button class="btn primary" id="game-again">Play again</button>`;
    $('game-again').onclick = () => { try { const n = games.invite(s.chatId, s.type); openGame(n.id); } catch (e) { toast(e.message, 'error'); } };
    return;
  }
  const key = s.id + ':' + s.players.length;
  if (!gameView || gameViewFor !== key) {
    dropGameView();
    body.innerHTML = ''; const host = document.createElement('div'); host.className = 'g-view g-' + s.type; body.appendChild(host);
    gameView = VIEWS[s.type](gameCtx(s)); gameViewFor = key; gameView.mount(host);
  }
  try { gameView.update(s); } catch (e) { console.error(e); body.innerHTML = `<div class="game-status">Could not draw the game (${esc(e.message)})</div>`; }
  let ov = body.querySelector('.g-result');
  if (over) {
    const st = s.state, w = st.winner, won = w === my, draw = w === null || w === undefined || w < 0, sw = games.seriesWinner(s), seriesOver = sw >= 0;
    if (!ov) { ov = document.createElement('div'); ov.className = 'g-result'; body.appendChild(ov); }
    ov.innerHTML = `<div class="g-result-card"><div class="g-trophy">${draw ? '🤝' : won ? '🏆' : '😮'}</div><h3>${seriesOver ? (sw === my ? 'You win the match!' : esc(app.nameOf(s.players[sw])) + ' wins the match') : draw ? "It's a draw" : won ? 'You win!' : esc(app.nameOf(s.players[w])) + ' wins'}</h3>
      ${st.score ? `<div class="g-series">${s.players.map((p, i) => `<span class="${i === my ? 'me' : ''}">${esc(p === app.pk ? 'You' : app.nameOf(p))} <b>${st.score[i] || 0}</b></span>`).join('<i>–</i>')}</div>` : ''}
      <div class="g-result-actions"><button class="btn ghost" id="g-result-look">Look at board</button><button class="btn primary" data-game-act="again">${seriesOver ? 'New match' : 'Rematch'}</button></div>
      <button class="link" id="g-result-leave">Leave game</button></div>`;
    ov.querySelector('[data-game-act=again]').onclick = () => { haptic(); if (seriesOver) { games.quit(s.id); try { openGame(games.invite(s.chatId, s.type).id); } catch (e) { toast(e.message, 'error'); } } else games.move(s.id, { a: 'again' }); };
    ov.querySelector('#g-result-look').onclick = () => { ov.classList.add('peek'); setTimeout(() => ov && ov.classList.remove('peek'), 4000); };
    ov.querySelector('#g-result-leave').onclick = leaveGame;
    const doneKey = s.id + ':' + (st.round || 1);
    if (lastDone !== doneKey) { lastDone = doneKey; if (won) { confetti(body, 60); fx(900, 0.2, 0, 0.06, 'sine'); fx(1200, 0.2, 0.15, 0.06, 'sine'); fx(1600, 0.35, 0.3, 0.06, 'sine'); haptic([30, 60, 30, 60, 60]); } else if (!draw) { fx(400, 0.3, 0, 0.05, 'triangle'); fx(300, 0.4, 0.2, 0.05, 'triangle'); } }
  } else if (ov) ov.remove();
}
function confetti(host, count = 36) {
  if (reducedMotion()) return;
  const colors = ['#f1c40f', '#2ecc71', '#2d8cff', '#ec4899', '#f97316', '#8b5cf6'];
  const w = host.clientWidth || 300;
  for (let k = 0; k < count; k++) {
    const el = document.createElement('i'); el.className = 'confetti-piece';
    el.style.left = Math.random() * w + 'px'; el.style.background = colors[k % colors.length];
    host.appendChild(el);
    const drift = (Math.random() - 0.5) * 160;
    const a = el.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${drift}px, ${(host.clientHeight || 400) + 30}px) rotate(${540 + Math.random() * 360}deg)`, opacity: 0.9 }], { duration: 1600 + Math.random() * 1200, delay: Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
    a.onfinish = () => el.remove();
  }
}

/* ---------------- listen / watch together from this device ---------------- */
let shareMini = false, shareWired = false, lastShareSync = 0;
function startShare(peer) {
  if (!peer || isGroupId(peer)) { toast('Listen together works in one-to-one chats'); return; }
  if (share.state !== 'idle') { openShare(false); return; }
  if (!(window.AudioContext || window.webkitAudioContext)) { toast('Not supported in this browser'); return; }
  const inp = $('share-input'); inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    openShare(false);
    try { await share.start(peer, f, $('share-local')); } catch (e) { toast(e.message || 'Could not share', 'error'); }
  };
  inp.click();
}
function openShare(mini) {
  shareMini = mini; $('share').classList.remove('hidden');
  if (calls && calls.state !== 'idle') { $('call').classList.add('watching'); if (!callMini) setCallMini(true); }
  renderShare();
}
function closeShare() {
  const p = $('share'); p.classList.add('hidden'); p.classList.remove('mini');
  const lv = $('share-local'); lv.pause(); lv.removeAttribute('src'); lv.load(); lv.classList.add('hidden');
  const rv = $('share-remote'); rv.srcObject = null; rv.classList.add('hidden');
  $('share-art').classList.remove('playing'); $('share-prog').style.width = '0';
  if ($('watch').classList.contains('hidden')) $('call').classList.remove('watching');
}
const fmtPos = (t) => { t = Math.max(0, Math.round(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function updateShareProg(playing, pos, dur) {
  $('share-art').classList.toggle('playing', !!playing);
  $('share-prog').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
  if (share.state === 'active') $('share-sub').innerHTML = `${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : '⏸ '}${fmtPos(pos)}${dur ? ' / ' + fmtPos(dur) : ''} · ${esc(app.nameOf(share.peer))}`;
}
function renderShare() {
  const i = share.info(); const panel = $('share');
  if (i.state === 'idle') { closeShare(); return; }
  panel.classList.remove('hidden'); panel.classList.toggle('mini', shareMini);
  const host = i.role === 'host'; const peerName = app.nameOf(i.peer);
  $('share-title').textContent = i.hasVideo ? 'Watching together' : 'Listening together';
  $('share-name').textContent = i.title || 'Shared media';
  $('share-sub').textContent = i.state === 'offering' ? `Waiting for ${peerName} to join…` : i.state === 'connecting' ? 'Connecting…' : i.state === 'incoming' ? `${peerName} wants to share` : host ? `Playing for ${peerName}` : `From ${peerName}`;
  const lv = $('share-local'), rv = $('share-remote');
  lv.classList.toggle('hidden', !host); lv.classList.toggle('audio', !i.hasVideo);
  rv.classList.toggle('hidden', host || !i.hasVideo);
  $('share-art').classList.toggle('hidden', i.hasVideo && (host || i.state === 'active'));
  if (!host && i.remote && rv.srcObject !== i.remote) { rv.srcObject = i.remote; rv.muted = false; rv.play().catch(() => {}); }
  $('share-ctl').innerHTML = !host && i.state === 'active' ? '<button class="btn ghost small" id="share-unmute">Tap if you hear nothing</button>' : '';
  const um = $('share-unmute'); if (um) um.onclick = () => { rv.muted = false; rv.play().catch(() => {}); };
}
const SHARE_END = { ended: 'Sharing ended', declined: 'They declined', busy: 'They are busy right now', 'no-answer': 'No answer', failed: 'Could not connect', error: 'Sharing failed' };
function wireShare() {
  share.addEventListener('state', renderShare);
  share.addEventListener('remote', renderShare);
  share.addEventListener('sync', (e) => { const m = e.detail; updateShareProg(!!m.p, m.pos, m.dur); });
  share.addEventListener('error', (e) => toast(e.detail || 'Sharing failed', 'error'));
  share.addEventListener('ended', (e) => { closeShare(); toast(SHARE_END[e.detail] || 'Sharing ended'); });
  share.addEventListener('invite', async (e) => {
    const d = e.detail; const name = app.nameOf(d.from);
    if (settings.get().sounds) tones.notify(); haptic(30);
    const ok = await confirmSheet(`${name} wants to ${d.video ? 'watch' : 'listen to'} “${d.title || 'something'}” with you`, 'It plays from their device over an encrypted direct connection — nothing is uploaded anywhere.', d.video ? 'Watch together' : 'Listen together', false);
    if (share.state !== 'incoming') return;
    if (ok) { openShare(false); try { await share.accept(); } catch (ex) { toast(ex.message || 'Could not join', 'error'); } } else share.decline();
  });
  if (shareWired) return; shareWired = true;
  const lv = $('share-local');
  const push = () => {
    if (share.role !== 'host') return;
    if (share.state !== 'active') { if (!lv.paused) lv.pause(); return; }   // playback starts when the friend joins
    share.sync(!lv.paused, lv.currentTime, lv.duration); updateShareProg(!lv.paused, lv.currentTime, lv.duration); lastShareSync = Date.now();
  };
  ['play', 'pause', 'seeked', 'ended'].forEach((ev) => lv.addEventListener(ev, push));
  lv.addEventListener('timeupdate', () => { if (share.role !== 'host') return; updateShareProg(!lv.paused, lv.currentTime, lv.duration); if (Date.now() - lastShareSync > 4000) push(); });
  $('share-stop').onclick = () => share.stop();
  $('share-min').onclick = (e) => { e.stopPropagation(); shareMini = !shareMini; renderShare(); haptic(); };
  $('share').querySelector('header').onclick = (e) => { if (shareMini && !e.target.closest('button')) { shareMini = false; renderShare(); } };
  $('call-share-btn').onclick = (e) => { e.stopPropagation(); const peer = calls.peer; if (!peer) return; if (share.state !== 'idle') { openShare(false); return; } startShare(peer); };
}

/* ---------------- calls ---------------- */
let callTimer = null, ringVib = null, lastCallState = '', callMini = false, lastCallInfo = null, gcalls = null;
const ac = () => (gcalls && gcalls.state !== 'idle' ? gcalls : calls);
function setCallMini(on) {
  callMini = on;
  const ov = $('call');
  ov.classList.toggle('mini', on);
  ov.classList.toggle('voice', on && !(lastCallInfo && lastCallInfo.video));
  document.body.classList.toggle('call-mini', on);
  document.body.classList.toggle('call-mini-voice', on && !(lastCallInfo && lastCallInfo.video));
  if (on) haptic(6);
}
$('call-min-btn').onclick = (e) => { e.stopPropagation(); setCallMini(true); };
$('mini-hang').onclick = (e) => { e.stopPropagation(); calls.hangup(); };
$('call').addEventListener('click', (e) => { if (callMini && !e.target.closest('#mini-hang')) setCallMini(false); });
function startCall(pk, video) {
  if (isGroupId(pk)) { if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast('Calls are not supported in this browser', 'error'); return; } if (calls.state !== 'idle' || gcalls.state !== 'idle') { toast('Already in a call'); return; } tones.ensure(); gcalls.start(pk, video).catch((e) => toast(e.message, 'error')); return; }
  if (!app.isFriend(pk)) { toast('Accept the friend request first'); return; }
  if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast('Calls are not supported in this browser', 'error'); return; }
  tones.ensure();
  calls.start(pk, video).catch((e) => toast(e.message, 'error'));
}
$('audio-call-btn').onclick = () => startCall(app.openChat, false);
$('video-call-btn').onclick = () => startCall(app.openChat, true);
$('hangup-btn').onclick = () => ac().hangup();
$('decline-btn').onclick = () => ac().decline();
$('accept-btn').onclick = () => { tones.ensure(); ac().accept(); };
$('mute-btn').onclick = () => ac().toggleMute();
$('cam-btn').onclick = () => ac().toggleCamera();
$('flip-btn').onclick = () => ac().switchCamera();
$('share-btn').onclick = () => calls.shareScreen();
$('call-game-btn').onclick = (e) => { e.stopPropagation(); const peer = calls.peer; if (!peer) return; setCallMini(true); openGames(peer); };
let speakerOn = false;
function setSpeaker(on) {
  speakerOn = on;
  $('speaker-btn').classList.toggle('on', on);
  $('speaker-btn').title = on ? 'Switch to earpiece' : 'Switch to speaker';
  if (nativeAudio) { try { nativeAudio.postMessage(on ? 'speaker' : 'earpiece'); } catch {} }
}
$('speaker-btn').onclick = () => { haptic(); setSpeaker(!speakerOn); };
// System notification for a message while the app is in the background. Goes through the
// service worker where possible (required on iOS home-screen apps), else the plain API.
async function messageNotification(title, body, chatId) {
  if (nativeNotify) { nativePost(nativeNotify, { kind: 'message', title, body, chatId }); return; }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) { await reg.showNotification(title, { body, tag: 'chat:' + chatId, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { kind: 'message', chatId }, actions: [{ action: 'reply', type: 'text', title: 'Reply', placeholder: 'Message…' }] }); return; }
  } catch {}
  try { const n = new Notification(title, { body, tag: chatId, icon: 'icons/icon-192.png' }); n.onclick = () => { window.focus(); openChat(chatId); n.close(); }; } catch {}
}
function updateBadge() {
  if (!app) return;
  const n = Object.entries(app.state.chats).filter(([id]) => app.canChat(id)).reduce((a, [, c]) => a + (c.unread || 0), 0);
  if (nativeNotify) { nativePost(nativeNotify, { kind: 'badge', n }); return; }
  if (!('setAppBadge' in navigator)) return;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
/* ---------------- Web Push (closed app) ---------------- */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushHint() {
  if (!rc.enabled) return 'Needs the Chatly push/recovery server: set its URL under Network (see server/README).';
  if (isIOS() && !standalone()) return 'On iPhone: Safari → Share → Add to Home Screen, open Chatly from there, then turn this on.';
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return 'Not supported in this browser.';
  return 'Shows “New message” / “Incoming call” even when Chatly is closed. Only your public key reaches the server.';
}
async function pushReg() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try { return (await navigator.serviceWorker.getRegistration()) || null; } catch { return null; }
}
function b64ToU8(b64) { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
async function setPush(on, quiet = false) {
  if (!on) {
    settings.set({ push: false });
    try { const reg = await pushReg(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) { try { await rc.pushUnsubscribe(accountSk, sub.endpoint); } catch {} await sub.unsubscribe(); } } catch {}
    if (!quiet) toast('Notifications when closed: off');
    return;
  }
  try {
    if (!rc.enabled) throw new Error('Set the push/recovery server URL under Network first');
    if (isIOS() && !standalone()) throw new Error('On iPhone, add Chatly to the Home Screen first (Share → Add to Home Screen) and turn this on from there');
    const reg = await pushReg();
    if (!reg) throw new Error('Push is not supported in this browser');
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Allow notifications for Chatly first');
    const info = await rc.info();
    if (!info || !info.push) throw new Error('This server has no push support — update it (see server/README)');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(info.push) });
    await rc.pushSubscribe(accountSk, sub.toJSON());
    settings.set({ push: true, pushAt: Date.now() });
    if (!quiet) toast('You will be notified even when Chatly is closed');
  } catch (e) {
    settings.set({ push: false });
    if (!quiet) { toast(e.message || 'Could not enable push', 'error'); renderSettings(); }
  }
}
// Ask the push server to wake friends' closed apps; the message/call itself goes over the relays.
const nudgedAt = new Map();
function nudge(to, kind) {
  if (!rc.enabled || !accountSk || !to || !to.length) return;
  const now = Date.now();
  const list = to.filter((p) => p && p !== app.pk && (kind === 'call' || now - (nudgedAt.get(p) || 0) > 20000));
  if (!list.length) return;
  list.forEach((p) => nudgedAt.set(p, now));
  rc.pushNudge(accountSk, list, kind).catch(() => {});
}
async function callNotification(info) {
  const title = app.nameOf(info.peer), body = `Incoming ${info.video ? 'video' : 'voice'} call — tap to answer`;
  if (nativeNotify) { nativePost(nativeNotify, { kind: 'call', title, body, chatId: info.peer }); return; }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) { await reg.showNotification(title, { body, tag: 'call', renotify: true, requireInteraction: true, icon: 'icons/icon-192.png', vibrate: [400, 200, 400, 200, 400], data: { kind: 'call' }, actions: [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Decline' }] }); return; }
  } catch {}
  const n = new Notification(title, { body, tag: 'call', requireInteraction: true, icon: 'icons/icon-192.png' });
  n.onclick = () => { window.focus(); n.close(); };
}
async function closeCallNotification() {
  if (nativeNotify) { nativePost(nativeNotify, { kind: 'clear', id: 'call' }); return; }
  try { const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()); if (reg) (await reg.getNotifications({ tag: 'call' })).forEach((n) => n.close()); } catch {}
}
// Actions taken on a notification (service worker, Web Push, or the iOS shell's banners):
// inline Reply text, open the chat, Answer / Decline an incoming call. If the app is not
// started yet (notification opened the app), the action waits until it is.
function onNotificationAction(action, data = {}, text = '') {
  if (!app || !app.ready || !calls) {
    const until = Date.now() + 90000;
    const t = setInterval(() => { if (app && app.ready && calls) { clearInterval(t); onNotificationAction(action, data, text); } else if (Date.now() > until) clearInterval(t); }, 500);
    return;
  }
  if (action === 'reply') {
    const msg = (text || '').trim().slice(0, 4000);
    if (msg && data.chatId && app.canChat(data.chatId)) app.sendMessage(data.chatId, { text: msg }).catch((e) => toast(e.message || 'Could not send', 'error'));
    return;
  }
  if (action === 'accept' && calls.state === 'incoming') { tones.ensure(); calls.accept(); return; }
  if (action === 'decline' && calls.state === 'incoming') { calls.decline(); return; }
  if (data.kind === 'message' && data.chatId) openChat(data.chatId);
}
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'pushchange') { if (settings.get().push) setPush(true, true); return; }
    if (d.type === 'notification') onNotificationAction(d.action, d.data || {}, d.reply || '');
  });
  if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'pending' });
}
window.addEventListener('chatly:notification', (e) => { const d = e.detail || {}; onNotificationAction(d.action, { kind: d.kind, chatId: d.chatId }, d.text || ''); });
document.addEventListener('pointerdown', () => tones.ensure(), { once: true });

function wireCalls() {
  calls.addEventListener('state', (e) => renderCall(e.detail));
  calls.addEventListener('local', (e) => { const v = $('local-video'); v.srcObject = e.detail; v.play().catch(() => {}); });
  calls.addEventListener('remote', (e) => { const v = $('remote-video'); v.srcObject = e.detail; v.play().catch(() => {}); });
  calls.addEventListener('ringing', () => { if (settings.get().sounds) tones.startRing(false); });
  calls.addEventListener('outgoing', (e) => nudge([e.detail.peer], 'call'));
  calls.addEventListener('error', (e) => toast(e.detail, 'error'));
  calls.addEventListener('ended', (e) => {
    const r = e.detail;
    const msg = { 'no-answer': 'No answer', declined: 'Call declined', busy: 'Friend is busy', failed: 'Call failed to connect', lost: 'Connection lost', ended: 'Call ended', error: 'Call could not start', missed: 'Missed call' }[r] || 'Call ended';
    toast(msg);
  });
}

function renderCall(info) {
  const ov = $('call');
  if (info.group) return renderGroupCall(info);
  if (gcalls && gcalls.state !== 'idle') { if (info.state === 'incoming') calls.decline(); return; }
  if (info.state === 'idle') {
    lastCallState = 'idle'; lastCallInfo = null;
    if (callMini) setCallMini(false);
    ov.classList.add('hidden'); tones.stop(); clearInterval(callTimer); clearInterval(ringVib); ringVib = null;
    closeCallNotification();
    if (nativeAudio) { try { nativeAudio.postMessage('reset'); } catch {} }
    $('remote-video').srcObject = null; $('local-video').srcObject = null;
    renderCalls();
    return;
  }
  ov.classList.remove('hidden');
  lastCallInfo = info;
  if (lastCallState === 'idle' || lastCallState === '') { if (callMini) setCallMini(false); ov.style.setProperty('--call-bg', app.avatarOf(info.peer) ? `url("${app.avatarOf(info.peer)}")` : 'none'); }
  if (callMini) ov.classList.toggle('voice', !info.video);
  setAvatar($('call-avatar'), info.peer);
  $('call-name').textContent = app.nameOf(info.peer);
  $('mini-name').textContent = app.nameOf(info.peer);
  const incoming = info.state === 'incoming';
  $('call-min-btn').classList.toggle('hidden', incoming);
  $('incoming-controls').classList.toggle('hidden', !incoming);
  $('call-controls').classList.toggle('hidden', incoming);
  $('local-video').classList.toggle('hidden', !(info.video || info.sharing) || !info.local);
  $('cam-btn').classList.toggle('hidden', !info.video);
  $('flip-btn').classList.toggle('hidden', !info.video || info.sharing);
  const canShare = info.state === 'active' && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  $('share-btn').classList.toggle('hidden', !canShare); $('share-btn').classList.toggle('on', !!info.sharing);
  $('share-btn').title = info.sharing ? 'Stop sharing screen' : 'Share screen';
  $('call-game-btn').classList.toggle('hidden', info.state !== 'active'); $('call-game-btn').classList.toggle('on', !!openGameId);
  ov.classList.toggle('sharing', !!info.sharing);
  $('call-watch-btn').classList.toggle('hidden', info.state !== 'active');
  $('call-watch-btn').classList.toggle('on', !!watch.session);
  $('mute-btn').classList.toggle('on', info.muted);
  $('cam-btn').classList.toggle('on', info.camOff);
  ov.classList.toggle('has-video', (info.video || info.remoteVideo || info.sharing) && info.state === 'active' && !!info.remote);
  const status = $('call-status');
  clearInterval(callTimer);
  $('speaker-btn').classList.toggle('hidden', !nativeAudio || info.state !== 'active');
  if (incoming) {
    status.textContent = `Incoming ${info.video ? 'video' : 'voice'} call…`;
    if (lastCallState !== 'incoming') {
      if (settings.get().sounds) tones.startRing(true);
      haptic([400, 200, 400]);
      clearInterval(ringVib); ringVib = setInterval(() => haptic([400, 200, 400]), 2500);
      callNotification(info);
    }
  } else {
    clearInterval(ringVib); ringVib = null; closeCallNotification();
  }
  if (info.state === 'outgoing') status.textContent = $('mini-time').textContent = 'Calling…';
  else if (info.state === 'connecting') { tones.stop(); status.textContent = $('mini-time').textContent = 'Connecting…'; }
  else if (info.state === 'active') {
    tones.stop();
    if (lastCallState !== 'active') setSpeaker(!!info.video);
    const upd = () => { const s = Math.floor((Date.now() - info.startedAt) / 1000); const clock = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; status.textContent = `${clock} · encrypted`; $('mini-time').textContent = clock; };
    upd(); callTimer = setInterval(upd, 1000);
  }
  lastCallState = info.state;
}

/* ---------------- group calls ---------------- */
const MUTED_SVG = '<svg viewBox="0 0 24 24"><path d="M19 11h-1.7a5.3 5.3 0 0 1-.5 2.2l1.3 1.3A7 7 0 0 0 19 11ZM4.3 3 3 4.3l6 6V11a3 3 0 0 0 4.6 2.5l1.4 1.4A5 5 0 0 1 7 11H5.3a7 7 0 0 0 6 6.9V21h1.4v-3.1a7 7 0 0 0 3.2-1.2l3.8 3.8 1.3-1.3L4.3 3Zm10.6 8V6a3 3 0 0 0-6 0v.5l6 6V11Z"/></svg>';
function renderGroupCall(info) {
  const ov = $('call'), grid = $('call-grid');
  if (info.state === 'idle') {
    ov.classList.remove('group', 'ringing'); grid.classList.add('hidden'); grid.innerHTML = '';
    if (calls.state !== 'idle') return renderCall(calls.info());
    renderGcallBanner();
    return renderCall({ state: 'idle' });
  }
  ov.classList.remove('hidden'); ov.classList.add('group');
  lastCallInfo = info;
  if (lastCallState === 'idle' || lastCallState === '') { if (callMini) setCallMini(false); ov.style.setProperty('--call-bg', 'none'); }
  if (callMini) ov.classList.toggle('voice', !info.video);
  setAvatar($('call-avatar'), info.gid);
  $('call-name').textContent = app.nameOf(info.gid); $('mini-name').textContent = app.nameOf(info.gid);
  const incoming = info.state === 'incoming';
  ov.classList.toggle('ringing', incoming || info.state === 'outgoing');
  $('call-min-btn').classList.toggle('hidden', incoming);
  $('incoming-controls').classList.toggle('hidden', !incoming);
  $('call-controls').classList.toggle('hidden', incoming);
  $('local-video').classList.add('hidden');
  $('cam-btn').classList.toggle('hidden', !info.video); $('flip-btn').classList.toggle('hidden', !info.video);
  for (const id of ['share-btn', 'call-game-btn', 'call-watch-btn', 'call-share-btn']) $(id).classList.add('hidden');
  $('speaker-btn').classList.toggle('hidden', !nativeAudio || info.state !== 'active');
  $('mute-btn').classList.toggle('on', info.muted); $('cam-btn').classList.toggle('on', info.camOff);
  ov.classList.remove('sharing');
  ov.classList.toggle('has-video', !!((info.video && !info.camOff) || info.peers.some((p) => p.video)));
  grid.classList.toggle('hidden', incoming);
  if (!incoming) renderGrid(info);
  const status = $('call-status');
  clearInterval(callTimer);
  if (incoming) {
    status.textContent = `${app.nameOf(info.ringer)} is calling the group…`;
    if (lastCallState !== 'incoming') {
      if (settings.get().sounds) tones.startRing(true);
      haptic([400, 200, 400]);
      clearInterval(ringVib); ringVib = setInterval(() => haptic([400, 200, 400]), 2500);
      callNotification(Object.assign({}, info, { peer: info.gid }));
    }
  } else { clearInterval(ringVib); ringVib = null; closeCallNotification(); }
  const n = info.peers.filter((p) => p.connected).length + 1;
  if (info.state === 'outgoing') status.textContent = $('mini-time').textContent = 'Calling the group…';
  else if (info.state === 'connecting') { tones.stop(); status.textContent = $('mini-time').textContent = 'Joining…'; }
  else if (info.state === 'active') {
    tones.stop();
    if (lastCallState !== 'active') setSpeaker(true);
    const upd = () => { const sec = Math.floor((Date.now() - info.startedAt) / 1000); const clock = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; status.textContent = `${clock} · ${n} in call`; $('mini-time').textContent = clock; };
    upd(); callTimer = setInterval(upd, 1000);
  }
  lastCallState = info.state;
}
function renderGrid(info) {
  const grid = $('call-grid');
  const tiles = [{ pk: app.pk, stream: info.local, video: info.video && !info.camOff, muted: info.muted, me: true, connected: true, speaking: false }].concat(info.peers);
  grid.dataset.n = String(tiles.length);
  const keep = new Set(tiles.map((t) => t.pk));
  grid.querySelectorAll('.ctile').forEach((el) => { if (!keep.has(el.dataset.pk)) { el.classList.add('leave'); el.remove(); } });
  for (const t of tiles) {
    let el = grid.querySelector(`.ctile[data-pk="${t.pk}"]`);
    if (!el) {
      el = document.createElement('div'); el.className = 'ctile enter' + (t.me ? ' me' : ''); el.dataset.pk = t.pk;
      el.innerHTML = `<video autoplay playsinline ${t.me ? 'muted' : ''} class="hidden"></video>${avatarHtml(t.pk)}<div class="ctag"><b></b></div>`;
      grid.appendChild(el);
    }
    const v = el.querySelector('video');
    if (t.stream && v.srcObject !== t.stream) { v.srcObject = t.stream; v.play().catch(() => {}); }
    v.classList.toggle('hidden', !(t.video && t.stream));
    el.classList.toggle('waiting', !t.connected && !t.me);
    el.classList.toggle('speaking', !!t.speaking);
    el.querySelector('.ctag').innerHTML = `${t.muted ? MUTED_SVG : ''}<b>${t.me ? 'You' : esc(app.nameOf(t.pk))}</b>`;
  }
}
function renderGcallBanner() {
  let b = document.getElementById('gcall-banner');
  const id = app && app.openChat, o = id && isGroupId(id) && gcalls && gcalls.ongoing[id];
  const on = o && gcalls.state === 'idle' && calls.state === 'idle' && Date.now() - o.ts < 2 * 3600e3 && !$('chat').classList.contains('hidden');
  if (!on) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'gcall-banner'; b.className = 'gcall-banner'; $('chat-name').closest('header').insertAdjacentElement('afterend', b); }
  b.innerHTML = `<span class="pulse"></span><b>${esc(app.nameOf(o.by))} started a ${o.video ? 'video' : 'voice'} call</b><button class="btn" id="gcall-join">Join</button>`;
  $('gcall-join').onclick = () => { tones.ensure(); gcalls.join(id).catch((e) => toast(e.message, 'error')); };
}
function wireGroupCalls() {
  gcalls.addEventListener('state', (e) => renderCall(e.detail));
  gcalls.addEventListener('local', () => { if (gcalls.state !== 'idle' && gcalls.state !== 'incoming') renderGrid(gcalls.info()); });
  gcalls.addEventListener('peer', () => renderGrid(gcalls.info()));
  gcalls.addEventListener('speaking', () => { document.querySelectorAll('#call-grid .ctile').forEach((t) => { const p = gcalls.peers.get(t.dataset.pk); t.classList.toggle('speaking', !!(p && p.speaking)); }); });
  gcalls.addEventListener('ringing', () => { if (settings.get().sounds) tones.startRing(false); });
  gcalls.addEventListener('outgoing', (e) => nudge(app.members(e.detail.gid), 'call'));
  gcalls.addEventListener('error', (e) => toast(e.detail, 'error'));
  gcalls.addEventListener('left', (e) => { if (e.detail.remote) toast(`${app.nameOf(e.detail.pk)} left the call`); });
  gcalls.addEventListener('ongoing', () => renderGcallBanner());
  gcalls.addEventListener('ended', (e) => {
    const msg = { 'no-answer': 'No one answered', failed: 'Could not connect', ended: 'Call ended', error: 'Call could not start', missed: 'Missed group call', declined: 'Declined' }[e.detail] || 'Call ended';
    toast(msg); renderGcallBanner();
  });
}

/* ---------------- boot ---------------- */
applyTheme();
const RECOVER_KEY = 'closechat:pendingRecover';
let pendingRecover = null;
try { const pr = sessionStorage.getItem(RECOVER_KEY); if (pr) { sessionStorage.removeItem(RECOVER_KEY); pendingRecover = JSON.parse(pr); } } catch {}
function applyPendingRecover() {
  if (!pendingRecover || $('auth').classList.contains('hidden')) return;
  const { key, u } = pendingRecover; pendingRecover = null;
  resetForgot(); showAuthForm('forgot-form');
  $('forgot-user').value = u; $('forgot-key').value = key;
  if (u) $('forgot-form').requestSubmit(); else $('forgot-user').focus();
}
function parseHash() {
  if (/#recover=/.test(location.hash)) {
    const r = parseRecoveryInput(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!r || !r.key) { toast('That recovery link is not valid', 'error'); return; }
    pendingRecover = r;
    if (app) {
      confirmSheet('Reset password with this link?', `You are signed in as ${app.state.profile.username || 'this account'}. Log out and continue to the password reset?`, 'Log out & continue', false).then((ok) => {
        if (!ok) { pendingRecover = null; return; }
        sessionStorage.setItem(RECOVER_KEY, JSON.stringify(r));
        logout();
      });
      return;
    }
    applyPendingRecover(); return;
  }
  const m = location.hash.match(/#add=([^&]+)(?:&n=([^&]+))?/);
  if (!m) return;
  const pk = parseFriendCode(m[1]);
  let name = ''; try { name = decodeURIComponent(m[2] || ''); } catch {}
  history.replaceState(null, '', location.pathname + location.search);
  if (!pk) return;
  if (app) offerAdd(pk, name.slice(0, 40)); else pendingAdd = { pk, name: name.slice(0, 40) };
}
parseHash();
window.addEventListener('hashchange', parseHash);
window.addEventListener('beforeunload', () => { if (store) store.flush(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  const saved = session.get();
  // A recovery link opened on a still-signed-in device goes straight to the reset form.
  if (saved && !pendingRecover) {
    try { await startApp(hexToBytes(saved), null); return; } catch (e) { console.error(e); session.clear(); }
  }
  $('auth').classList.remove('hidden');
  applyPendingRecover();
})();


/* ---------------- v8: starred, export/import, app lock ---------------- */
function showStarred() {
  const list = app.starred();
  showModal(`<h3>Starred messages</h3>${list.length ? `<div class="pick-list starred-list">${list.map(({ chatId, m }) => `<div class="item" data-chat="${chatId}" data-mid="${m.id}">${avatarHtml(m.from)}<div class="body"><div class="top"><span class="name">${esc(m.from === app.pk ? 'You' : app.nameOf(m.from))} · ${esc(app.nameOf(chatId))}</span><span class="time">${fmtListTime(m.ts)}</span></div><div class="preview"><span>${esc(previewOf(m))}</span></div></div></div>`).join('')}</div>` : '<p class="muted">Long-press a message and tap Star to keep it here.</p>'}
    <div class="row" style="justify-content:flex-end"><button class="btn primary small" id="st-ok">Close</button></div>`);
  $('st-ok').onclick = hideModal;
  $('modal-body').querySelectorAll('[data-mid]').forEach((it) => { it.onclick = () => { hideModal(); openChat(it.dataset.chat); setTimeout(() => { ensureVisible(it.dataset.mid); jumpTo(it.dataset.mid); }, 350); }; });
}
async function exportCipher(pass) {
  const sk = await deriveSecretKey('chatly-export', pass);
  return localCipher(sk);
}
async function exportChats() {
  const pass = await promptSheet('Export passphrase', '', 'Choose a passphrase (10+ characters)', 'Needed to import this file. It is not your account password; pick a long one — the file can be attacked offline.');
  if (!pass) return; if (pass.length < 10) { toast('Use at least 10 characters — anyone with the file can try to guess a short passphrase', 'error'); return; }
  toast('Preparing export…');
  try {
    const blobs = {};
    for (const chat of Object.values(app.state.chats)) for (const m of chat.messages) if ((m.video || m.audio) && (m.video || m.audio).ready) { const d = await app.getVideo(m.id); if (d) blobs[m.id] = d; }
    const payload = { v: 1, app: 'chatly', ts: Date.now(), pk: app.pk, profile: app.state.profile, friends: app.state.friends, groups: app.state.groups, chats: app.state.chats, calls: app.state.calls, blobs };
    const c = await exportCipher(pass); const enc = await c.encrypt(payload);
    const file = new Blob([new TextEncoder().encode('CHATLYX1'), enc], { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = `chatly-export-${new Date().toISOString().slice(0, 10)}.chatly`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast('Export saved');
  } catch (e) { toast('Export failed: ' + e.message, 'error'); }
}
function importChats() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.chatly,application/octet-stream';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const pass = await promptSheet('Import passphrase', '', 'Passphrase used for the export'); if (!pass) return;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (new TextDecoder().decode(buf.slice(0, 8)) !== 'CHATLYX1') throw new Error('Not a Chatly export file');
      const c = await exportCipher(pass); const data = await c.decrypt(buf.slice(8));
      if (!data || data.app !== 'chatly' || !data.chats) throw new Error('File is damaged');
      if (data.pk && data.pk !== app.pk && !await confirmSheet('Different account', 'This export is from another account. Import its chats anyway?', 'Import', false)) return;
      let added = 0;
      for (const [cid, chat] of Object.entries(data.chats)) {
        const mine = app.store.chat(cid); const have = new Map(mine.messages.map((m) => [m.id, m]));
        for (const m of chat.messages || []) {
          const cur = have.get(m.id);
          if (!cur) { mine.messages.push(m); added++; continue; }
          if (m.deleted && !cur.deleted) app.tombstone(cur);
          else if (!cur.deleted && m.edited && (m.editTs || 0) > (cur.editTs || 0)) { cur.text = m.text; cur.edited = true; cur.editTs = m.editTs; }
          if (m.star) cur.star = true;
          for (const k of ['audio', 'video']) if (m[k] && m[k].ready && !m[k].deleted && data.blobs && data.blobs[m.id] && !(cur[k] && cur[k].ready)) cur[k] = Object.assign({}, m[k]);
          for (const k of ['votes', 'rx']) if (m[k]) for (const [pk, v] of Object.entries(m[k])) { const o = cur[k] && cur[k][pk]; if (o === undefined || ((v && v.ts) || 0) > ((o && o.ts) || 0)) (cur[k] = cur[k] || {})[pk] = v; }
        }
        mine.messages.sort((a, b) => a.ts - b.ts); mine.lastTs = Math.max(mine.lastTs || 0, chat.lastTs || 0);
        for (const k of ['pin', 'mute', 'arch', 'expire', 'wall', 'bubble', 'pinned']) if (chat[k] !== undefined && mine[k] === undefined) mine[k] = chat[k];
      }
      if (data.pk === app.pk) {
        for (const [pk, fr] of Object.entries(data.friends || {})) if (!app.state.friends[pk]) app.state.friends[pk] = fr;
        for (const [gid, g] of Object.entries(data.groups || {})) if (!app.state.groups[gid]) app.state.groups[gid] = g;
      }
      for (const [id, d] of Object.entries(data.blobs || {})) await store.putBlob(id, d);
      store.save(); renderedFor = null; scheduleRender(); if (app.openChat) renderChat();
      toast(`Imported ${added} message${added === 1 ? '' : 's'}`);
    } catch (e) { toast(/decrypt|operation/i.test(e.message || '') ? 'Wrong passphrase' : 'Import failed: ' + e.message, 'error'); }
  };
  inp.click();
}

/* ---- app lock: PIN (hashed) + optional WebAuthn (Face ID / Touch ID) ---- */
const lock = {
  cfg() { try { return JSON.parse(localStorage.getItem('closechat:lock') || 'null') || null; } catch { return null; } },
  save(c) { if (c) localStorage.setItem('closechat:lock', JSON.stringify(c)); else localStorage.removeItem('closechat:lock'); },
  enabled() { return !!this.cfg(); },
  bio() { const c = this.cfg(); return !!(c && c.cred); },
  afterLabel() { const c = this.cfg() || {}; const m = c.after ?? 1; return m === 0 ? 'leaving the app' : m < 60 ? `${m} min away` : '1 hour away'; },
  async hash(pin, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)); return bytesToHex(new Uint8Array(d)); },
  locked: false, hiddenAt: 0,
};
async function lockSettings() {
  const c = lock.cfg();
  if (!c) {
    const pin = await pinEntry('Choose a 4–6 digit PIN'); if (!pin) return;
    const pin2 = await pinEntry('Repeat the PIN'); if (pin2 !== pin) { toast('PINs did not match', 'error'); return; }
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    lock.save({ salt, hash: await lock.hash(pin, salt), after: 1 });
    toast('App lock on'); renderSettings();
    if (window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)) {
      if (await confirmSheet('Use Face ID / Touch ID?', 'Unlock with your device biometrics instead of typing the PIN.', 'Enable', false)) await enrollBio();
    }
    return;
  }
  const act = await menuSheet([
    { id: 'after', label: `Auto-lock · ${lock.afterLabel()}` },
    ...(window.PublicKeyCredential ? [{ id: 'bio', label: c.cred ? 'Turn off Face ID / Touch ID' : 'Use Face ID / Touch ID' }] : []),
    { id: 'pin', label: 'Change PIN' },
    { id: 'off', label: 'Turn off app lock', danger: true },
  ]);
  if (act === 'after') {
    const a = await menuSheet([[0, 'Immediately'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [60, 'After 1 hour']].map(([m, l]) => ({ id: String(m), label: (c.after === m ? '✓ ' : '') + l })));
    if (a !== null && a !== undefined && a !== '') { c.after = Number(a); lock.save(c); }
  } else if (act === 'bio') { if (c.cred) { delete c.cred; lock.save(c); toast('Face ID / Touch ID off'); } else await enrollBio(); }
  else if (act === 'pin') { if (!await verifyPin('Current PIN')) return; const pin = await pinEntry('New PIN'); if (!pin) return; c.hash = await lock.hash(pin, c.salt); lock.save(c); toast('PIN changed'); }
  else if (act === 'off') { if (await verifyPin('Enter PIN to turn off')) { lock.save(null); toast('App lock off'); } }
  renderSettings();
}
async function enrollBio() {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Chatly', id: location.hostname },
      user: { id: new TextEncoder().encode(app.pk.slice(0, 32)), name: app.state.profile.username || 'chatly', displayName: app.state.profile.name || 'Chatly' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000,
    } });
    const c = lock.cfg(); c.cred = bytesToHex(new Uint8Array(cred.rawId)); lock.save(c); toast('Face ID / Touch ID enabled');
  } catch (e) { toast('Could not enable biometrics here', 'error'); }
  renderSettings();
}
async function bioUnlock() {
  const c = lock.cfg(); if (!c || !c.cred) return false;
  try {
    await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: hexToBytes(c.cred) }], userVerification: 'required', timeout: 60000 } });
    return true;
  } catch { return false; }
}
function pinEntry(title, verify = null) {
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3><div class="pin-dots" id="m-dots"></div><div class="pin-pad" id="m-pad"></div><div class="row" style="justify-content:flex-end"><button class="btn ghost small" id="m-cancel">Cancel</button></div>`);
    let pin = '';
    const dots = $('m-dots'); const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
    draw();
    $('m-pad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'ok', 0, '⌫'].map((k) => `<button data-k="${k}" class="${k === 'ok' ? 'ghost' : ''}">${k === 'ok' ? 'OK' : k}</button>`).join('');
    const done = async () => {
      if (pin.length < 4) { toast('PIN needs 4–6 digits', 'error'); return; }
      if (verify && !await verify(pin)) { dots.classList.add('shake'); haptic(40); setTimeout(() => dots.classList.remove('shake'), 400); pin = ''; draw(); return; }
      hideModal(); res(pin);
    };
    $('m-pad').querySelectorAll('button').forEach((b) => { b.onclick = () => { const k = b.dataset.k; haptic(6); if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'ok') { done(); return; } else if (pin.length < 6) pin += k; draw(); if (pin.length === 6) done(); }; });
    $('m-cancel').onclick = () => { hideModal(); res(null); };
  });
}
async function verifyPin(title) {
  const c = lock.cfg(); if (!c) return true;
  const pin = await pinEntry(title, async (p) => (await lock.hash(p, c.salt)) === c.hash);
  return !!pin;
}
function showLock() {
  const c = lock.cfg(); if (!c || lock.locked) return;
  lock.locked = true; document.body.classList.add('privacy');
  const el = $('lock'); el.classList.remove('hidden');
  $('lock-sub').textContent = 'Enter your PIN';
  let pin = ''; const dots = $('pin-dots');
  const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  draw();
  const unlock = () => { lock.locked = false; el.classList.add('hidden'); document.body.classList.remove('privacy'); haptic(10); };
  const tryPin = async () => { if ((await lock.hash(pin, c.salt)) === c.hash) unlock(); else { dots.classList.add('shake'); haptic(40); $('lock-sub').textContent = 'Wrong PIN'; setTimeout(() => dots.classList.remove('shake'), 400); pin = ''; draw(); } };
  $('pin-pad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'ok', 0, '⌫'].map((k) => `<button data-k="${k}" class="${k === 'ok' ? 'ghost' : ''}">${k === 'ok' ? 'OK' : k}</button>`).join('');
  $('pin-pad').querySelectorAll('button').forEach((b) => { b.onclick = () => { const k = b.dataset.k; haptic(6); if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'ok') { if (pin.length >= 4) tryPin(); return; } else if (pin.length < 6) pin += k; draw(); if (pin.length === 6) tryPin(); }; });
  const bio = $('lock-bio'); bio.classList.toggle('hidden', !c.cred);
  bio.onclick = async () => { if (await bioUnlock()) unlock(); else $('lock-sub').textContent = 'Biometrics failed — use your PIN'; };
  if (c.cred && !document.hidden) setTimeout(() => bio.click(), 300);
}
document.addEventListener('visibilitychange', () => {
  const c = lock.cfg(); if (!c || !app) return;
  if (document.hidden) { lock.hiddenAt = Date.now(); document.body.classList.add('privacy'); return; }
  const away = Date.now() - (lock.hiddenAt || 0);
  if (lock.locked) return;
  if ((c.after ?? 1) * 60000 <= away) showLock(); else document.body.classList.remove('privacy');
});
window.addEventListener('chatly:ready', () => { if (lock.cfg()) showLock(); });
