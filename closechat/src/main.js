import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { deriveSecretKey, pubkeyOf, bytesToHex, hexToBytes, friendCode, parseFriendCode, localCipher, normalizeUsername } from './crypto.js';
import { Transport, DEFAULT_RELAYS } from './relay.js';
import { encodeRecoveryKey, decodeRecoveryKey } from './crypto.js';
import { resolveLogin, setPassword, checkPassword, republishKeystore, RecoveryClient } from './account.js';
import { Store, settings, session } from './store.js';
import { App, isGroupId, gidOf, profileFp } from './app.js';
import { CallManager, Tones } from './rtc.js';
import { PACKS, stickerIds, stickerSvg, animIds, animOf, animHtml } from './stickers.js';
import { GameManager, GAMES, renderTTT, renderLudo } from './games.js';
import { WatchManager, parseMedia, MEDIA_RE } from './watch.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let app = null, calls = null, games = null, watch = null, transport = null, store = null;
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
function haptic(ms = 12) {
  if (!settings.get().haptics) return;
  if (nativeHaptic) { try { nativeHaptic.postMessage(Array.isArray(ms) || ms >= 100 ? 'ring' : 'tap'); } catch {} return; }
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}
const COLORS = ['#2d8cff', '#8b5cf6', '#22c55e', '#ec4899', '#f97316', '#14b8a6', '#ef4444', '#eab308'];
function colorOf(id) { let h = 0; const s = String(id || ''); for (let i = 0; i < Math.min(16, s.length); i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0][0] || '') + (p[1] ? p[1][0] : '')).toUpperCase(); }
function avatarInner(id, name = '') {
  if (isGroupId(id)) return GROUP_SVG;
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
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating keys…';
  try {
    const sk = await derive(u, p, $('signup-progress'));
    await startApp(sk, name, u);
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Create Account'; $('signup-progress').classList.add('hidden');
};

/* ---------------- forgot password ---------------- */
let forgot = { mode: 'email', stage: 'start', sk: null };
function showAuthForm(id) { ['login-form', 'signup-form', 'forgot-form'].forEach((f) => $(f).classList.toggle('hidden', f !== id)); }
function resetForgot() {
  forgot = { mode: 'email', stage: 'start', sk: null };
  $('forgot-form').reset();
  $('forgot-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.m === 'email'));
  $('forgot-email-step').classList.remove('hidden'); $('forgot-key-step').classList.add('hidden');
  $('forgot-new').classList.add('hidden'); $('forgot-code-row').classList.add('hidden');
  $('forgot-submit').textContent = 'Continue'; $('forgot-error').textContent = '';
  $('forgot-email').placeholder = rc.enabled ? 'Recovery email' : 'Recovery email (no recovery server configured)';
}
$('show-forgot').onclick = (e) => { e.preventDefault(); resetForgot(); showAuthForm('forgot-form'); $('forgot-user').value = $('login-user').value; };
$('forgot-back').onclick = (e) => { e.preventDefault(); showAuthForm('login-form'); };
$('forgot-mode').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    if (forgot.stage === 'newpass') return;
    forgot.mode = b.dataset.m; forgot.stage = 'start';
    $('forgot-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    $('forgot-email-step').classList.toggle('hidden', forgot.mode !== 'email');
    $('forgot-key-step').classList.toggle('hidden', forgot.mode !== 'key');
    $('forgot-error').textContent = '';
  };
});
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
      forgot.sk = decodeRecoveryKey($('forgot-key').value);
    } else {
      if (forgot.stage !== 'code') { $('forgot-send').click(); return; }
      const code = $('forgot-code').value.trim(); if (code.length !== 6) { err.textContent = 'Enter the 6-digit code from the email.'; return; }
      btn.disabled = true; btn.textContent = 'Checking code…';
      forgot.sk = await rc.recoverFinish(u, $('forgot-email').value.trim(), code);
    }
    forgot.stage = 'newpass';
    $('forgot-email-step').classList.add('hidden'); $('forgot-key-step').classList.add('hidden'); $('forgot-mode').classList.add('hidden');
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
  accountSk = sk;
  app.sharePresence = s.presence !== false;
  calls = new CallManager(app);
  games = new GameManager(app);
  watch = new WatchManager(app);
  wireApp(); wireCalls(); wireGames(); wireWatch();
  $('auth').classList.add('hidden'); $('main').classList.remove('hidden');
  $('login-form').reset(); $('signup-form').reset();
  renderAll();
  app.start().then(() => {
    if (newName) app.syncToSelf({ t: 'profile', name: newName, u: store.state.profile.username });
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
    const onScreen = app.openChat === chatId && !document.hidden;
    if (!onScreen) {
      if (s.sounds) tones.notify();
      if (s.notifications && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const body = (isGroupId(chatId) ? app.nameOf(pk) + ': ' : '') + previewOf(message).slice(0, 100);
        const n = new Notification(app.nameOf(chatId), { body, tag: chatId, icon: 'icons/icon-192.png' });
        n.onclick = () => { window.focus(); openChat(chatId); n.close(); };
      }
    } else if (!atBottom()) { unseen++; updateJump(); }
  });
  app.addEventListener('request', (e) => { if (e.detail.fresh) toast(`New request from ${app.nameOf(e.detail.pk)}`); });
  app.addEventListener('friend', (e) => {
    if (e.detail.accepted) { toast(`${app.nameOf(e.detail.pk)} accepted your request`); haptic(); }
    // name/photo update: redraw lists, header and open chat so the new picture shows right away
    scheduleRender();
    if (app.openChat === e.detail.pk) { setAvatar($('chat-avatar'), e.detail.pk); $('chat-name').textContent = app.nameOf(e.detail.pk); renderedFor = null; renderChat(); }
  });
  app.addEventListener('presence', () => { scheduleRender(); });
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
  document.addEventListener('visibilitychange', () => {
    app.setVisible(!document.hidden);
    if (!document.hidden && app.openChat) app.markRead(app.openChat);
  });
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
}

function renderChatList() {
  const q = ($('chat-search').value || '').toLowerCase();
  const friends = Object.entries(app.state.friends).filter(([, f]) => f.status === 'friend' || f.status === 'pending').map(([pk, f]) => ({ id: pk, since: f.since, pending: f.status === 'pending', chat: app.store.chat(pk) }));
  const groups = Object.entries(app.state.groups).map(([gid, g]) => ({ id: 'g:' + gid, since: g.since, chat: app.store.chat('g:' + gid) }));
  renderActiveRow();
  const items = [...friends, ...groups]
    .filter((x) => !q || app.nameOf(x.id).toLowerCase().includes(q))
    .sort((a, b) => (b.chat.lastTs || b.since || 0) - (a.chat.lastTs || a.since || 0));
  const el = $('chat-list');
  if (!items.length) {
    el.innerHTML = `<div class="empty-list"><p>No close friends yet.</p><p class="tiny">Share your invite link or scan a friend's code to start.</p><button class="btn primary" id="empty-add">Add a friend</button></div>`;
    $('empty-add').onclick = openAddFriend; return;
  }
  const before = flipSnap(el);
  el.innerHTML = items.map(({ id, chat, pending }) => {
    const last = chat.messages[chat.messages.length - 1];
    const plain = last && ['system', 'call', 'game'].includes(last.kind);
    let preview = last ? ((plain ? '' : last.from === app.pk ? 'You: ' : isGroupId(id) && last.from ? app.nameOf(last.from) + ': ' : '') + previewOf(last)) : pending ? 'Waiting for them to accept' : 'Say hi 👋';
    const t = typingState[id];
    if (t) preview = `<i>${isGroupId(id) ? esc(app.nameOf(t.pk)) + ' is ' : ''}typing…</i>`; else preview = esc(preview);
    return `<div class="item ${chat.unread ? 'unread-item' : ''} ${app.openChat === id ? 'active' : ''}" data-id="${id}">
      ${avatarHtml(id)}
      <div class="body"><div class="top"><span class="name">${esc(app.nameOf(id))}</span>${pending ? '<span class="pend">Request sent</span>' : `<span class="time">${fmtListTime(chat.lastTs)}</span>`}</div>
      <div class="preview"><span>${preview}</span>${chat.unread ? `<span class="unread">${chat.unread}</span>` : ''}</div></div></div>`;
  }).join('');
  el.querySelectorAll('.item').forEach((i) => { i.onclick = () => openChat(i.dataset.id); });
  flipPlay(el, before);
}
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

function renderCalls() {
  const el = $('call-list');
  const log = app.state.calls;
  if (!log.length) { el.innerHTML = `<div class="empty-list"><p>No calls yet.</p><p class="tiny">Open a chat and tap the phone or camera icon to call. Calls are peer-to-peer and encrypted.</p></div>`; return; }
  el.innerHTML = log.map((c, i) => `<div class="item" data-i="${i}">
    ${avatarHtml(c.peer)}
    <div class="body"><div class="top"><span class="name" style="${c.missed ? 'color:var(--danger)' : ''}">${esc(app.nameOf(c.peer))}</span><span class="time">${fmtListTime(c.ts)}</span></div>
    <div class="preview"><span>${callLabel(c)}</span></div></div>
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
      <div class="srow clickable" id="s-rkey"><div><div>Recovery key</div><div class="tiny muted">Resets your password without email. Save it somewhere safe.</div></div><span class="muted">›</span></div>
    </div>
    <h4>Appearance</h4>
    <div class="card">
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:10px"><span>Theme</span><div class="theme-opts">
        ${['dark', 'light', 'amoled', 'midnight'].map((t) => `<button class="theme-opt ${s.theme === t ? 'active' : ''}" data-theme="${t}">${{ dark: 'Dark', light: 'Light', amoled: 'AMOLED Black', midnight: 'Midnight' }[t]}</button>`).join('')}</div></div>
      <div class="srow" style="flex-direction:column;align-items:stretch;gap:10px"><span>Accent color</span><div class="swatches">
        ${['blue', 'purple', 'green', 'pink', 'orange', 'teal'].map((a) => `<button class="swatch ${s.accent === a ? 'active' : ''}" data-accent="${a}" style="background:${{ blue: '#2d8cff', purple: '#8b5cf6', green: '#22c55e', pink: '#ec4899', orange: '#f97316', teal: '#14b8a6' }[a]}"></button>`).join('')}</div></div>
    </div>
    <h4>Notifications</h4>
    <div class="card">
      <div class="srow"><span>Message notifications</span><button class="switch ${s.notifications ? 'on' : ''}" data-set="notifications"></button></div>
      <div class="srow"><span>Sounds</span><button class="switch ${s.sounds ? 'on' : ''}" data-set="sounds"></button></div>
      <div class="srow"><span>Vibration</span><button class="switch ${s.haptics ? 'on' : ''}" data-set="haptics"></button></div>
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
    <p class="tiny muted" style="margin-top:16px">Chatly v5 · Your password unlocks your encryption key. Reset it with your recovery email or recovery key.</p>`;
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
      const k = b.dataset.set; const cur = k === 'presence' ? settings.get().presence !== false : settings.get()[k]; const v = !cur; settings.set({ [k]: v });
      if (k === 'presence') { app.setSharePresence(v); toast(v ? 'Friends can see when you are online' : 'Your online status is hidden'); }
      if (k === 'notifications' && v && 'Notification' in window) Notification.requestPermission().catch(() => {});
      if (k === 'discoverable') { app.publishDirectory(v); toast(v ? 'Friends can now find you by username' : 'Removed from username lookup'); }
      if (k === 'haptics' && v) haptic(20);
      renderSettings();
    };
  });
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
function openRecoveryKey() {
  const key = encodeRecoveryKey(accountSk);
  showModal(`<h3>Recovery key</h3><p class="muted tiny" style="margin:0 0 10px">Anyone with this key can log in to your account. Store it in a password manager or on paper — never send it in a chat.</p>
    <div class="rkey" id="rkey-text">${key}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="rk-close">Close</button><button class="btn primary" id="rk-copy">Copy</button></div>`);
  $('rk-close').onclick = hideModal;
  $('rk-copy').onclick = async () => { try { await navigator.clipboard.writeText(key); toast('Recovery key copied'); } catch { toast('Select the key and copy it manually'); } };
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
  if (!id) return;
  if (app.openChat && app.openChat !== id) app.store.chat(app.openChat).draft = $('input').value;
  app.setOpenChat(id);
  renderedFor = null; replyTo = null; unseen = 0; renderReplyBar();
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
  const label = { instagram: 'IG', youtube: '▶', tiktok: '♪' }[m.kind];
  const name = { instagram: 'Instagram reel', youtube: 'YouTube', tiktok: 'TikTok' }[m.kind];
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
  $('audio-call-btn').classList.toggle('hidden', group || !can || pending);
  $('video-call-btn').classList.toggle('hidden', group || !can || pending);
  $('together-btn').classList.toggle('hidden', !can || pending);
  updateTyping();

  const box = $('messages');
  const chat = app.store.chat(id);
  const wasAtBottom = atBottom();
  const key = id + ':' + chat.messages.length + ':' + chat.messages.map((m) => m.id.slice(0, 8) + (m.status || '') + (m.video ? (m.video.ready ? 'R' : m.video.got || 0) + ':' + (app.sending[m.id] ?? '') : '')).join('') + ':' + (group && g ? g.members.length : '') + ':' + [...playing].join('');
  if (renderedFor !== key) {
    renderedFor = key;
    if (renderedChat !== id) { renderedIds = new Set(chat.messages.map((m) => m.id)); renderedChat = id; }
    const isNew = (m) => !renderedIds.has(m.id);
    const byId = new Map(chat.messages.map((m) => [m.id, m]));
    let html = `<div class="lock-note">🔒 ${group ? 'Group messages are encrypted separately for each member. Only members can read them.' : 'Messages and calls are end-to-end encrypted. Nobody outside this chat — not even the relays — can read them.'}</div>`;
    let lastDay = '', prev = null;
    for (const m of chat.messages) {
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
      const out = m.from === app.pk;
      const cont = prev && prev.from === m.from && m.ts - prev.ts < 3 * 60000 && !m.re;
      const emojiOnly = m.kind === 'text' && m.text.length <= 8 && EMOJI_RE.test(m.text);
      let body;
      if (m.kind === 'image') body = `<img src="${m.img}" alt="Photo" data-full="1">`;
      else if (m.kind === 'video') body = videoHtml(m);
      else if (m.kind === 'sticker') body = animHtml(m.sticker) || stickerSvg(m.sticker) || '<span class="muted">Sticker</span>';
      else { body = linkify(m.text); const mm = m.text.match(MEDIA_RE); if (mm) body += mediaCard(mm[0], out); }
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
      html += `<div class="msg ${out ? 'out' : 'in'} ${emojiOnly ? 'emoji-only' : ''} ${m.kind === 'sticker' ? (animOf(m.sticker) ? 'aemoji-msg' : 'sticker-msg') : m.kind === 'video' ? 'video-msg' : ''} ${cont ? 'cont' : ''} ${isNew(m) ? 'anim' : ''}" data-id="${m.id}">${sender}<div class="bubble">${quote}${body}</div><div class="meta">${fmtTime(m.ts)} ${tick}</div><button class="act" data-reply="${m.id}" title="Reply">${REPLY_SVG}</button></div>`;
      prev = m;
    }
    box.innerHTML = html;
    renderedIds = new Set(chat.messages.map((m) => m.id));
    box.querySelectorAll('img[data-full]').forEach((img) => { img.onclick = () => openViewer(img.src, img); });
    box.querySelectorAll('[data-resend]').forEach((el) => { el.onclick = () => app.resend(id, el.dataset.resend).catch((e) => toast(e.message, 'error')); });
    box.querySelectorAll('[data-play]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); playVideo(el.dataset.play); }; });
    box.querySelectorAll('.vid video').forEach((el) => { el.onclick = (e) => e.stopPropagation(); });
    box.querySelectorAll('[data-reply]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); setReply(el.dataset.reply); }; });
    box.querySelectorAll('[data-jump]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); jumpTo(el.dataset.jump); }; });
    box.querySelectorAll('[data-watch]').forEach((el) => { el.onclick = (e) => { e.stopPropagation(); startWatch(id, el.dataset.watch); }; });
    box.querySelectorAll('[data-callback]').forEach((el) => { el.onclick = () => startCall(id, el.dataset.callback === 'v'); });
    box.querySelectorAll('[data-game]').forEach((el) => { el.onclick = () => openGame(el.dataset.game); });
    box.querySelectorAll('.msg .meta').forEach((el) => { el.parentElement.querySelector('.bubble').addEventListener('click', () => el.classList.toggle('show')); });
    if (scrollToEnd || wasAtBottom || scrollNext) { box.scrollTop = box.scrollHeight; scrollNext = false; }
    updateJump();
  }
}
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
  box.addEventListener('dblclick', (e) => { const m = msgOf(e.target); if (m && window.innerWidth >= 860) setReply(m.dataset.id); });
})();

async function messageMenu(mid) {
  const id = app.openChat; const chat = app.store.chat(id);
  const m = chat.messages.find((x) => x.id === mid); if (!m) return;
  const items = [{ id: 'reply', label: 'Reply' }];
  if (m.kind === 'text') items.push({ id: 'copy', label: 'Copy text' });
  if (m.kind === 'text' && MEDIA_RE.test(m.text)) items.push({ id: 'watch', label: 'Watch together' });
  if (m.kind === 'image') items.push({ id: 'view', label: 'View photo' });
  if (m.kind === 'video' && m.video && m.video.ready) items.push({ id: 'save', label: 'Save video' });
  items.push({ id: 'delete', label: 'Delete for me', danger: true });
  const act = await menuSheet(items);
  if (act === 'reply') setReply(mid);
  else if (act === 'copy') { try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { toast('Could not copy'); } }
  else if (act === 'watch') startWatch(id, m.text.match(MEDIA_RE)[0]);
  else if (act === 'view') { openViewer(m.img, document.querySelector(`.msg[data-id="${m.id}"] img`)); }
  else if (act === 'save') { const data = await app.getVideo(mid); if (!data) { toast('Video is not on this device'); return; } const a = document.createElement('a'); a.href = data; a.download = `chatly-video.${/webm/.test(m.video.mime) ? 'webm' : 'mp4'}`; a.click(); }
  else if (act === 'delete') { app.deleteLocal(id, mid); renderedFor = null; renderChat(); }
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
  const m = await app.sendMessage(id, { text, replyTo: re });
  if (m.status === 'failed') toast('Could not send: ' + (m.error || 'no relay reachable'), 'error');
}
async function sendSticker(sid) {
  const id = app.openChat; if (!id) return;
  const re = replyTo; replyTo = null; renderReplyBar();
  scrollNext = true; haptic(8);
  const m = await app.sendMessage(id, { sticker: sid, replyTo: re });
  if (m.status === 'failed') toast('Could not send sticker', 'error');
}
$('attach-btn').onclick = () => $('file-input').click();
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
  const tabs = [{ id: 'emoji', name: 'Emoji' }, { id: 'anim', name: 'Animated' }, ...PACKS.map((p) => ({ id: p.id, name: p.name }))];
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
$('chat-menu-btn').onclick = async () => {
  const id = app.openChat;
  if (isGroupId(id)) {
    const g = app.group(id);
    const act = await menuSheet([
      ...(g ? [{ id: 'members', label: `Members (${g.members.length})` }, { id: 'add', label: 'Add members' }, { id: 'rename', label: 'Rename group' }] : []),
      { id: 'clear', label: 'Clear chat on this device' },
      ...(g ? [{ id: 'leave', label: 'Leave group', danger: true }] : [{ id: 'remove', label: 'Delete this chat', danger: true }]),
    ]);
    if (act === 'members') showMembers(gidOf(id));
    else if (act === 'add') pickFriends('Add members', g.members, (pks) => { app.addMembers(gidOf(id), pks); toast('Members added'); });
    else if (act === 'rename') { const v = await promptSheet('Group name', g.name, 'Name'); if (v) app.renameGroup(gidOf(id), v); }
    else if (act === 'clear') { if (await confirmSheet('Clear chat?', 'Removes this conversation from this device only.', 'Clear')) { app.clearChat(id); renderedFor = null; renderChat(); } }
    else if (act === 'leave') { if (await confirmSheet('Leave group?', 'You will stop receiving messages from this group.', 'Leave')) { app.leaveGroup(gidOf(id)); closeChat(); } }
    else if (act === 'remove') { delete app.state.chats[id]; store.save(); closeChat(); }
    return;
  }
  const f = app.state.friends[id] || {};
  const act = await menuSheet([
    { id: 'code', label: "Friend's code" }, { id: 'rename', label: 'Rename friend' }, { id: 'clear', label: 'Clear chat on this device' },
    f.status === 'blocked' ? { id: 'unblock', label: 'Unblock' } : { id: 'block', label: 'Block', danger: true },
    { id: 'remove', label: 'Remove friend', danger: true },
  ]);
  if (act === 'code') { showModal(`<h3>${esc(app.nameOf(id))}</h3><div class="code">${friendCode(id)}</div><div class="row" style="justify-content:flex-end"><button class="btn primary small" id="m-ok">Close</button></div>`); $('m-ok').onclick = hideModal; }
  else if (act === 'rename') { const v = await promptSheet('Rename friend', f.name, 'Nickname'); if (v) { f.name = v; store.save(); } }
  else if (act === 'clear') { if (await confirmSheet('Clear chat?', 'Removes this conversation from this device only.', 'Clear')) { app.clearChat(id); renderedFor = null; renderChat(); } }
  else if (act === 'block') { if (await confirmSheet('Block?', `${app.nameOf(id)} will no longer be able to message or call you.`, 'Block')) { app.block(id); closeChat(); } }
  else if (act === 'unblock') app.unblock(id);
  else if (act === 'remove') { if (await confirmSheet('Remove friend?', 'Deletes the chat on this device and removes them from your close friends.', 'Remove')) { app.removeFriend(id); closeChat(); } }
};

/* together menu */
$('together-btn').onclick = () => openTogether(app.openChat);
async function openTogether(id, gamesOnly = false) {
  if (!id) return;
  const active = games.forChat(id);
  const items = [
    ...(gamesOnly ? [] : [{ id: 'watch', label: '📺 Watch a reel together' }]),
    ...active.map((s) => ({ id: 'g:' + s.id, label: `${GAMES[s.type].icon} ${s.status === 'lobby' ? 'Join' : 'Open'} ${GAMES[s.type].name} (${s.players.length} player${s.players.length === 1 ? '' : 's'})` })),
    { id: 'ttt', label: '⭕ New Tic-Tac-Toe' }, { id: 'ludo', label: '🎲 New Ludo' },
  ];
  const act = await menuSheet(items);
  if (!act) return;
  if (act === 'watch') { const url = await promptSheet('Watch together', '', 'Paste an Instagram reel / YouTube / TikTok link', 'Everyone in this chat gets the same clip at the same time. Both of you need internet; the clip plays in the platform’s own player.'); if (url) startWatch(id, url); }
  else if (act.startsWith('g:')) openGame(act.slice(2));
  else { try { const s = games.invite(id, act); openGame(s.id); } catch (e) { toast(e.message, 'error'); } }
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
function startWatch(chatId, url) {
  try { watch.open(chatId, url); toast('Shared with ' + app.nameOf(chatId)); } catch (e) { toast(e.message, 'error'); }
}
function wireWatch() {
  watch.addEventListener('update', renderWatch);
  watch.addEventListener('invite', (e) => {
    const { chatId, from } = e.detail;
    $('invite-text').textContent = `${app.nameOf(from)} wants to watch a reel together${isGroupId(chatId) ? ' in ' + app.nameOf(chatId) : ''}`;
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
  if (!s) { panel.classList.add('hidden'); $('watch-frame').src = 'about:blank'; watchSrc = ''; $('call').classList.remove('watching'); return; }
  panel.classList.remove('hidden');
  $('call').classList.add('watching');
  $('watch-title').textContent = `Watching with ${app.nameOf(s.chatId)}`;
  if (watchSrc !== s.media.embed) { watchSrc = s.media.embed; $('watch-frame').src = s.media.embed; }
  const who = s.by === app.pk ? 'You' : app.nameOf(s.by);
  $('watch-foot').innerHTML = `<span>${esc(who)} picked this ${{ instagram: 'reel', youtube: 'video', tiktok: 'TikTok' }[s.media.kind]}.</span><a href="${esc(s.media.url)}" target="_blank" rel="noopener" style="color:var(--accent)">Open in app</a>${s.media.kind === 'instagram' ? '<span>Tap the clip to play. Instagram may ask you to log in for some reels.</span>' : ''}`;
}
$('watch-close').onclick = () => watch.close();
$('watch-change').onclick = async () => {
  const s = watch.session; if (!s) return;
  const url = await promptSheet('Change clip', '', 'Paste a new reel / video link');
  if (url) { try { watch.open(s.chatId, url); } catch (e) { toast(e.message, 'error'); } }
};
$('call-watch-btn').onclick = async () => {
  const peer = calls.peer; if (!peer) return;
  if (watch.session) { watch.close(); return; }
  const url = await promptSheet('Watch together', '', 'Paste an Instagram reel / YouTube / TikTok link');
  if (url) startWatch(peer, url);
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
function closeGamePanel() { openGameId = null; gameMini = false; $('game').classList.add('hidden'); $('game').classList.remove('full', 'mini', 'turn'); }
function setGameMini(on) { gameMini = on; renderGame(); haptic(); }
$('game-hide').onclick = () => setGameMini(true);
$('game-mini-bar').onclick = (e) => { if (!e.target.closest('#game-mini-leave')) setGameMini(false); };
async function leaveGame() {
  const s = games.get(openGameId); if (!s) return;
  if (s.status === 'done' || await confirmSheet('Leave game?', 'The game ends for everyone.', 'Leave')) { if (s.status !== 'done') games.quit(s.id); if (openGameId === s.id) closeGamePanel(); }
}
$('game-quit').onclick = leaveGame;
$('game-mini-leave').onclick = (e) => { e.stopPropagation(); leaveGame(); };
let autoMoveTimer = null;
function renderGame() {
  const s = games.get(openGameId); if (!s) { closeGamePanel(); return; }
  const G = GAMES[s.type];
  const panel = $('game');
  $('game-title').textContent = `${G.icon} ${G.name} · ${app.nameOf(s.chatId)}`;
  $('game-quit').textContent = s.status === 'done' ? 'Close' : 'Leave';
  const body = $('game-body');
  const my = games.myIndex(s);
  const myTurn = s.status === 'playing' && s.state && s.players[s.state.turn] === app.pk;
  panel.classList.toggle('mini', gameMini);
  panel.classList.toggle('full', !gameMini && s.status !== 'lobby');
  panel.classList.toggle('turn', gameMini && myTurn);
  $('game-mini-icon').textContent = G.icon;
  $('game-mini-title').textContent = `${G.name} · ${app.nameOf(s.chatId)}`;
  $('game-mini-sub').textContent = s.status === 'lobby' ? 'Waiting in lobby · tap to return' : s.status === 'done' ? 'Game over · tap to return' : myTurn ? 'Your turn! Tap to play' : `${esc(app.nameOf(s.players[s.state.turn]))}'s turn · tap to return`;
  $('game-mini-leave').textContent = s.status === 'done' ? 'Close' : 'Leave';
  if (gameMini) return;
  if (s.status === 'lobby') {
    const host = s.host === app.pk;
    body.innerHTML = `<div class="lobby"><div class="game-status">${host ? (s.players.length < G.min ? 'Waiting for friends to join…' : 'Ready when you are') : `Waiting for ${esc(app.nameOf(s.host))} to start…`}</div>
      <div class="players">${s.players.map((p) => `<div>${avatarHtml(p, 'sm')}<span>${esc(p === app.pk ? 'You' : app.nameOf(p))}${p === s.host ? ' <span class="tiny muted">host</span>' : ''}</span></div>`).join('')}</div>
      <p class="tiny muted">${G.min === G.max ? `${G.max} players` : `${G.min}–${G.max} players`} · ${s.players.length} joined</p>
      ${host ? `<button class="btn primary" id="game-start" ${s.players.length < G.min ? 'disabled' : ''}>Start game</button>` : ''}</div>`;
    if (host) $('game-start').onclick = () => { try { games.start(s.id); } catch (e) { toast(e.message, 'error'); } };
    return;
  }
  if (s.status === 'done') {
    const w = s.state && s.state.winner;
    body.innerHTML = `<div class="game-panel-done">${s.quitBy ? `${esc(s.quitBy === app.pk ? 'You' : app.nameOf(s.quitBy))} left the game` : w !== null && w !== undefined ? `🏆 ${esc(w === my ? 'You won!' : app.nameOf(s.players[w]) + ' won')}` : 'Game over'}</div>
      <button class="btn primary" id="game-again">Play again</button>`;
    $('game-again').onclick = () => { try { const n = games.invite(s.chatId, s.type); openGame(n.id); } catch (e) { toast(e.message, 'error'); } };
    return;
  }
  const nameOf = (p) => (p === app.pk ? 'You' : app.nameOf(p));
  body.innerHTML = s.type === 'ttt' ? renderTTT(s, my, nameOf) : renderLudo(s, my, nameOf);
  body.querySelectorAll('.ttt-cell.can').forEach((b) => { b.onclick = () => { haptic(); games.move(s.id, { i: Number(b.dataset.i) }); }; });
  body.querySelectorAll('[data-game-act=again]').forEach((b) => { b.onclick = () => games.move(s.id, { a: 'again' }); });
  body.querySelectorAll('[data-game-act=roll]').forEach((b) => { b.onclick = () => { haptic(15); games.move(s.id, { a: 'roll', d: 1 + Math.floor(Math.random() * 6) }); }; });
  body.querySelectorAll('.tok.can').forEach((t) => { t.onclick = () => { haptic(); games.move(s.id, { a: 'move', i: Number(t.dataset.tok) }); }; });
  clearTimeout(autoMoveTimer);
  if (s.type === 'ludo' && my >= 0) {
    const legal = games.legal(s.id);
    if (legal.length === 1 && s.state.phase === 'move' && s.state.turn === my) autoMoveTimer = setTimeout(() => games.move(s.id, { a: 'move', i: legal[0] }), 650);
  }
}

/* ---------------- calls ---------------- */
let callTimer = null, ringVib = null, lastCallState = '', callMini = false, lastCallInfo = null;
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
  if (isGroupId(pk)) { toast('Group calls are not supported yet'); return; }
  if (!app.isFriend(pk)) { toast('Accept the friend request first'); return; }
  if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast('Calls are not supported in this browser', 'error'); return; }
  tones.ensure();
  calls.start(pk, video).catch((e) => toast(e.message, 'error'));
}
$('audio-call-btn').onclick = () => startCall(app.openChat, false);
$('video-call-btn').onclick = () => startCall(app.openChat, true);
$('hangup-btn').onclick = () => calls.hangup();
$('decline-btn').onclick = () => calls.decline();
$('accept-btn').onclick = () => { tones.ensure(); calls.accept(); };
$('mute-btn').onclick = () => calls.toggleMute();
$('cam-btn').onclick = () => calls.toggleCamera();
$('flip-btn').onclick = () => calls.switchCamera();
$('share-btn').onclick = () => calls.shareScreen();
$('call-game-btn').onclick = (e) => { e.stopPropagation(); const peer = calls.peer; if (!peer) return; setCallMini(true); openTogether(peer, true); };
let speakerOn = false;
function setSpeaker(on) {
  speakerOn = on;
  $('speaker-btn').classList.toggle('on', on);
  $('speaker-btn').title = on ? 'Switch to earpiece' : 'Switch to speaker';
  if (nativeAudio) { try { nativeAudio.postMessage(on ? 'speaker' : 'earpiece'); } catch {} }
}
$('speaker-btn').onclick = () => { haptic(); setSpeaker(!speakerOn); };
async function callNotification(info) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = app.nameOf(info.peer), body = `Incoming ${info.video ? 'video' : 'voice'} call — tap to answer`;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) { await reg.showNotification(title, { body, tag: 'call', renotify: true, requireInteraction: true, icon: 'icons/icon-192.png', vibrate: [400, 200, 400, 200, 400], data: { kind: 'call' }, actions: [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Decline' }] }); return; }
  } catch {}
  const n = new Notification(title, { body, tag: 'call', requireInteraction: true, icon: 'icons/icon-192.png' });
  n.onclick = () => { window.focus(); n.close(); };
}
async function closeCallNotification() {
  try { const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()); if (reg) (await reg.getNotifications({ tag: 'call' })).forEach((n) => n.close()); } catch {}
}
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => {
  const d = e.data || {}; if (d.type !== 'notification' || !calls) return;
  if (d.action === 'accept' && calls.state === 'incoming') { tones.ensure(); calls.accept(); }
  else if (d.action === 'decline' && calls.state === 'incoming') calls.decline();
});
document.addEventListener('pointerdown', () => tones.ensure(), { once: true });

function wireCalls() {
  calls.addEventListener('state', (e) => renderCall(e.detail));
  calls.addEventListener('local', (e) => { const v = $('local-video'); v.srcObject = e.detail; v.play().catch(() => {}); });
  calls.addEventListener('remote', (e) => { const v = $('remote-video'); v.srcObject = e.detail; v.play().catch(() => {}); });
  calls.addEventListener('ringing', () => { if (settings.get().sounds) tones.startRing(false); });
  calls.addEventListener('error', (e) => toast(e.detail, 'error'));
  calls.addEventListener('ended', (e) => {
    const r = e.detail;
    const msg = { 'no-answer': 'No answer', declined: 'Call declined', busy: 'Friend is busy', failed: 'Call failed to connect', lost: 'Connection lost', ended: 'Call ended', error: 'Call could not start', missed: 'Missed call' }[r] || 'Call ended';
    toast(msg);
  });
}

function renderCall(info) {
  const ov = $('call');
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

/* ---------------- boot ---------------- */
applyTheme();
function parseHash() {
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
  if (saved) {
    try { await startApp(hexToBytes(saved), null); return; } catch (e) { console.error(e); session.clear(); }
  }
  $('auth').classList.remove('hidden');
})();
