import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { deriveSecretKey, pubkeyOf, bytesToHex, hexToBytes, friendCode, parseFriendCode, localCipher, normalizeUsername } from './crypto.js';
import { Transport, DEFAULT_RELAYS } from './relay.js';
import { Store, settings, session } from './store.js';
import { App } from './app.js';
import { CallManager, Tones } from './rtc.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let app = null, calls = null, transport = null, store = null;
const tones = new Tones();
let currentTab = 'chats';
let typingTimers = {};
let typingState = {};

/* ---------------- theme ---------------- */
function applyTheme() {
  const s = settings.get();
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.accent = s.accent;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1016';
}

/* ---------------- helpers ---------------- */
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
const COLORS = ['#2d8cff', '#8b5cf6', '#22c55e', '#ec4899', '#f97316', '#14b8a6', '#ef4444', '#eab308'];
function colorOf(pk) { let h = 0; for (let i = 0; i < 16; i++) h = (h * 31 + pk.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
function initials(name) { const p = (name || '?').trim().split(/\s+/); return ((p[0][0] || '') + (p[1] ? p[1][0] : '')).toUpperCase(); }
function setAvatar(el, pk, name) { el.textContent = initials(name); el.style.background = colorOf(pk); }
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
function fmtDur(s) { const m = Math.floor(s / 60), r = s % 60; return m ? `${m}m ${r}s` : `${r}s`; }
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function showModal(html) { $('modal-body').innerHTML = html; $('modal').classList.remove('hidden'); }
function hideModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; stopScanner(); }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) hideModal(); });
$('viewer').addEventListener('click', () => $('viewer').classList.add('hidden'));

function confirmSheet(title, text, okLabel, danger = true) {
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" id="c-no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="c-ok">${esc(okLabel)}</button></div>`);
    $('c-no').onclick = () => { hideModal(); res(false); };
    $('c-ok').onclick = () => { hideModal(); res(true); };
  });
}
function promptSheet(title, value, placeholder) {
  return new Promise((res) => {
    showModal(`<h3>${esc(title)}</h3><div class="row"><input type="text" id="p-in" maxlength="40" placeholder="${esc(placeholder || '')}"></div><div class="row" style="justify-content:flex-end"><button class="btn ghost" id="p-no">Cancel</button><button class="btn primary" id="p-ok">Save</button></div>`);
    const i = $('p-in'); i.value = value || ''; i.focus();
    $('p-no').onclick = () => { hideModal(); res(null); };
    $('p-ok').onclick = () => { const v = i.value.trim(); hideModal(); res(v); };
    i.onkeydown = (e) => { if (e.key === 'Enter') $('p-ok').click(); };
  });
}

/* ---------------- auth ---------------- */
$('show-signup').onclick = (e) => { e.preventDefault(); $('login-form').classList.add('hidden'); $('signup-form').classList.remove('hidden'); };
$('show-login').onclick = (e) => { e.preventDefault(); $('signup-form').classList.add('hidden'); $('login-form').classList.remove('hidden'); };

async function derive(username, password, progressEl) {
  progressEl.classList.remove('hidden');
  const bar = progressEl.firstElementChild; bar.style.width = '0%';
  const sk = await deriveSecretKey(username, password, (p) => { bar.style.width = Math.round(p * 100) + '%'; });
  bar.style.width = '100%';
  return sk;
}

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const u = $('login-user').value, p = $('login-pass').value; const err = $('login-error'); err.textContent = '';
  if (normalizeUsername(u).length < 3) { err.textContent = 'Enter your username.'; return; }
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Unlocking…';
  try {
    const sk = await derive(u, p, $('login-progress'));
    await startApp(sk, null);
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
    await startApp(sk, name);
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Create Account'; $('signup-progress').classList.add('hidden');
};

/* ---------------- app start ---------------- */
async function startApp(sk, newName) {
  const pk = pubkeyOf(sk);
  const cipher = await localCipher(sk);
  store = new Store(pk, cipher);
  await store.load();
  if (newName) { store.state.profile.name = newName; }
  if (!store.state.profile.name) store.state.profile.name = 'Me';
  await store.flush();
  session.set(bytesToHex(sk));

  const s = settings.get();
  transport = new Transport(s.relays || DEFAULT_RELAYS, (n, total) => {
    const c = $('conn'); c.className = 'conn ' + (n === 0 ? '' : n === total ? 'ok' : 'partial');
    c.title = `${n}/${total} relays connected`;
  });
  app = new App(sk, store, transport);
  calls = new CallManager(app);
  wireApp();
  wireCalls();
  $('auth').classList.add('hidden'); $('main').classList.remove('hidden');
  $('login-form').reset(); $('signup-form').reset();
  renderAll();
  app.start().then(() => { if (newName) app.syncToSelf({ t: 'profile', name: newName }); }).catch((e) => toast('Relay connection failed: ' + e.message, 'error'));
  if (s.notifications && 'Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 1500);
  }
}

function logout() {
  session.clear();
  if (transport) transport.close();
  if (store) store.flush();
  location.reload();
}

/* ---------------- events from protocol ---------------- */
function wireApp() {
  store.onChange(() => scheduleRender());
  app.addEventListener('message', (e) => {
    const { pk, message, fresh } = e.detail;
    if (!fresh) return;
    const s = settings.get();
    const onScreen = app.openChat === pk && !document.hidden;
    if (!onScreen) {
      if (s.sounds) tones.notify();
      if (s.notifications && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(app.nameOf(pk), { body: message.kind === 'image' ? 'Photo' : message.text.slice(0, 100), tag: pk, icon: 'icons/icon-192.png' });
        n.onclick = () => { window.focus(); openChat(pk); n.close(); };
      }
    }
  });
  app.addEventListener('request', (e) => { if (e.detail.fresh) toast(`New request from ${app.nameOf(e.detail.pk)}`); });
  app.addEventListener('friend', (e) => { if (e.detail.accepted) toast(`${app.nameOf(e.detail.pk)} accepted your request`); });
  app.addEventListener('typing', (e) => {
    const { pk, on } = e.detail;
    clearTimeout(typingTimers[pk]);
    typingState[pk] = on;
    if (on) typingTimers[pk] = setTimeout(() => { typingState[pk] = false; updateTyping(); scheduleRender(); }, 6000);
    updateTyping(); renderChatList();
  });
  document.addEventListener('visibilitychange', () => {
    app.visible = !document.hidden;
    if (!document.hidden && app.openChat) app.markRead(app.openChat);
  });
}

/* ---------------- rendering ---------------- */
let renderTimer = null;
function scheduleRender() { if (renderTimer) return; renderTimer = requestAnimationFrame(() => { renderTimer = null; renderAll(); }); }

function renderAll() {
  if (!app) return;
  setAvatar($('me-avatar'), app.pk, app.state.profile.name);
  renderChatList(); renderCalls(); renderRequests(); renderSettings();
  if (app.openChat) renderChat();
  const pending = Object.values(app.state.friends).filter((f) => f.status === 'request').length;
  const b = $('req-badge'); b.textContent = pending; b.classList.toggle('hidden', !pending);
  const totalUnread = Object.entries(app.state.chats).filter(([pk]) => app.isFriend(pk)).reduce((a, [, c]) => a + c.unread, 0);
  document.title = (totalUnread ? `(${totalUnread}) ` : '') + 'CloseChat';
}

function renderChatList() {
  const q = ($('chat-search').value || '').toLowerCase();
  const friends = Object.entries(app.state.friends).filter(([, f]) => f.status === 'friend');
  const items = friends.map(([pk, f]) => ({ pk, f, chat: app.store.chat(pk) }))
    .filter((x) => !q || app.nameOf(x.pk).toLowerCase().includes(q))
    .sort((a, b) => (b.chat.lastTs || b.f.since || 0) - (a.chat.lastTs || a.f.since || 0));
  const el = $('chat-list');
  if (!items.length) {
    el.innerHTML = `<div class="empty-list"><p>No close friends yet.</p><p class="tiny">Share your friend code or scan a friend's code to start.</p><button class="btn primary" id="empty-add">Add a friend</button></div>`;
    $('empty-add').onclick = openAddFriend; return;
  }
  el.innerHTML = items.map(({ pk, chat }) => {
    const last = chat.messages[chat.messages.length - 1];
    let preview = last ? (last.kind === 'image' ? '📷 Photo' : (last.from === app.pk ? 'You: ' : '') + last.text) : 'Say hi 👋';
    if (typingState[pk]) preview = '<i>typing…</i>'; else preview = esc(preview);
    return `<div class="item ${chat.unread ? 'unread-item' : ''} ${app.openChat === pk ? 'active' : ''}" data-pk="${pk}">
      <div class="avatar" style="background:${colorOf(pk)}">${esc(initials(app.nameOf(pk)))}</div>
      <div class="body"><div class="top"><span class="name">${esc(app.nameOf(pk))}</span><span class="time">${fmtListTime(chat.lastTs)}</span></div>
      <div class="preview"><span>${preview}</span>${chat.unread ? `<span class="unread">${chat.unread}</span>` : ''}</div></div></div>`;
  }).join('');
  el.querySelectorAll('.item').forEach((i) => { i.onclick = () => openChat(i.dataset.pk); });
}
$('chat-search').oninput = renderChatList;

function renderCalls() {
  const el = $('call-list');
  const log = app.state.calls;
  if (!log.length) { el.innerHTML = `<div class="empty-list"><p>No calls yet.</p><p class="tiny">Open a chat and tap the phone or camera icon to call. Calls are peer-to-peer and encrypted.</p></div>`; return; }
  el.innerHTML = log.map((c, i) => `<div class="item" data-i="${i}">
    <div class="avatar" style="background:${colorOf(c.peer)}">${esc(initials(app.nameOf(c.peer)))}</div>
    <div class="body"><div class="top"><span class="name" style="${c.missed ? 'color:var(--danger)' : ''}">${esc(app.nameOf(c.peer))}</span><span class="time">${fmtListTime(c.ts)}</span></div>
    <div class="preview"><span>${c.dir === 'in' ? (c.reason === 'declined' ? 'Declined' : c.missed ? 'Missed' : 'Incoming') : c.reason === 'declined' ? 'Outgoing (declined)' : c.reason === 'no-answer' ? 'Outgoing (no answer)' : 'Outgoing'} ${c.video ? 'video' : 'voice'} call${c.dur ? ' · ' + fmtDur(c.dur) : ''}</span></div></div>
    <button class="icon-btn call-icon ${c.missed ? 'missed' : ''}" title="Call back">${c.video ? '<svg viewBox="0 0 24 24"><path d="M3 6h12a2 2 0 0 1 2 2v2.5l4-2.5v8l-4-2.5V16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02Z"/></svg>'}</button></div>`).join('');
  el.querySelectorAll('.item').forEach((i) => {
    const c = log[Number(i.dataset.i)];
    i.querySelector('.call-icon').onclick = (e) => { e.stopPropagation(); startCall(c.peer, c.video); };
    i.onclick = () => openChat(c.peer);
  });
}

function renderRequests() {
  const el = $('request-list');
  const reqs = Object.entries(app.state.friends).filter(([, f]) => f.status === 'request');
  const blocked = Object.entries(app.state.friends).filter(([, f]) => f.status === 'blocked');
  let html = '';
  if (!reqs.length) html += `<div class="empty-list"><p>No pending requests.</p><p class="tiny">When someone who isn't a close friend messages you, it shows up here first.</p></div>`;
  html += reqs.map(([pk, f]) => {
    const chat = app.store.chat(pk); const last = chat.messages[chat.messages.length - 1];
    return `<div class="item" data-pk="${pk}"><div class="avatar" style="background:${colorOf(pk)}">${esc(initials(app.nameOf(pk)))}</div>
      <div class="body"><div class="name">${esc(app.nameOf(pk))}</div><div class="preview"><span>${last ? esc(last.kind === 'image' ? '📷 Photo' : last.text) : 'Wants to be your close friend'}</span></div></div>
      <div class="actions"><button class="btn primary small" data-act="accept">Accept</button><button class="btn ghost small" data-act="block">Block</button></div></div>`;
  }).join('');
  if (blocked.length) {
    html += `<h4 class="muted" style="padding:14px 14px 4px;font-size:13px;text-transform:uppercase">Blocked</h4>` + blocked.map(([pk]) => `<div class="item" data-pk="${pk}"><div class="avatar" style="background:${colorOf(pk)}">${esc(initials(app.nameOf(pk)))}</div><div class="body"><div class="name">${esc(app.nameOf(pk))}</div></div><div class="actions"><button class="btn ghost small" data-act="unblock">Unblock</button></div></div>`).join('');
  }
  el.innerHTML = html;
  el.querySelectorAll('.item').forEach((i) => {
    const pk = i.dataset.pk;
    i.onclick = (e) => {
      const act = e.target.dataset.act;
      if (act === 'accept') { app.acceptRequest(pk); toast('Added to close friends'); }
      else if (act === 'block') app.block(pk);
      else if (act === 'unblock') app.unblock(pk);
      else openChat(pk);
    };
  });
}

function renderSettings() {
  const s = settings.get();
  const el = $('settings');
  const relays = (s.relays || DEFAULT_RELAYS).join('\n');
  el.innerHTML = `
    <div class="profile"><div class="avatar" style="background:${colorOf(app.pk)}">${esc(initials(app.state.profile.name))}</div>
      <div><div class="name">${esc(app.state.profile.name)}</div><div class="sub">Tap to change your name</div></div></div>
    <h4>Friend code</h4>
    <div class="card"><div class="srow clickable" id="s-code"><span>Show my code & QR</span><span class="muted">›</span></div></div>
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
    </div>
    <h4>Network</h4>
    <div class="card"><div class="srow" style="flex-direction:column;align-items:stretch;gap:8px"><span>Relays (one per line). Relays only ever see encrypted blobs.</span><textarea id="relay-text">${esc(relays)}</textarea><div class="row" style="justify-content:flex-end;gap:8px;display:flex"><button class="btn ghost small" id="relay-reset">Reset</button><button class="btn primary small" id="relay-save">Save & reconnect</button></div></div></div>
    <h4>Security</h4>
    <div class="card">
      <div class="srow"><span>End-to-end encryption</span><span class="muted">Always on</span></div>
      <div class="srow"><span>Local history</span><span class="muted">Encrypted on this device</span></div>
      <div class="srow clickable" id="s-logout"><span>Log out</span><span class="muted">Keeps encrypted history</span></div>
      <div class="srow clickable" id="s-wipe"><span class="danger">Delete all data on this device</span></div>
    </div>
    <p class="tiny muted" style="margin-top:16px">CloseChat v1.0 · No servers, no phone number. Your password is your key — there is no way to reset it.</p>`;
  el.querySelector('.profile').onclick = async () => { const v = await promptSheet('Your name', app.state.profile.name, 'Name shown to friends'); if (v) app.setName(v); };
  $('s-code').onclick = openAddFriend;
  el.querySelectorAll('.theme-opt').forEach((b) => { b.onclick = () => { settings.set({ theme: b.dataset.theme }); applyTheme(); renderSettings(); }; });
  el.querySelectorAll('.swatch').forEach((b) => { b.onclick = () => { settings.set({ accent: b.dataset.accent }); applyTheme(); renderSettings(); }; });
  el.querySelectorAll('.switch').forEach((b) => { b.onclick = () => { const k = b.dataset.set; const v = !settings.get()[k]; settings.set({ [k]: v }); if (k === 'notifications' && v && 'Notification' in window) Notification.requestPermission().catch(() => {}); renderSettings(); }; });
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

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tabbar button').forEach((b) => {
  b.onclick = () => {
    currentTab = b.dataset.tab;
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== currentTab));
    $('side-title').textContent = { chats: 'Chats', calls: 'Calls', requests: 'Requests', settings: 'Settings' }[currentTab];
  };
});
$('me-avatar').onclick = () => document.querySelector('.tabbar button[data-tab=settings]').click();
$('add-friend-btn').onclick = () => openAddFriend();

/* ---------------- chat view ---------------- */
let renderedFor = null;
function openChat(pk) {
  if (!pk) return;
  app.setOpenChat(pk);
  renderedFor = null;
  document.body.classList.add('chat-open');
  $('chat-empty').classList.add('hidden'); $('chat-inner').classList.remove('hidden');
  $('input').value = app.store.chat(pk).draft || '';
  autosize();
  $('emoji-picker').classList.add('hidden');
  renderChat(true);
  renderChatList();
  if (window.innerWidth >= 860) $('input').focus();
}
function closeChat() {
  if (app.openChat) { app.store.chat(app.openChat).draft = $('input').value; app.store.save(); }
  app.setOpenChat(null);
  document.body.classList.remove('chat-open');
  $('chat-empty').classList.remove('hidden'); $('chat-inner').classList.add('hidden');
  renderChatList();
}
$('back-btn').onclick = closeChat;

let scrollNext = false;
function renderChat(scrollToEnd = false) {
  const pk = app.openChat; if (!pk) return;
  const f = app.state.friends[pk] || {};
  setAvatar($('chat-avatar'), pk, app.nameOf(pk));
  $('chat-name').textContent = app.nameOf(pk);
  const isFriend = app.isFriend(pk);
  $('request-banner').classList.toggle('hidden', isFriend || f.status === 'blocked');
  $('request-banner-name').textContent = app.nameOf(pk);
  $('composer').classList.toggle('hidden', !isFriend);
  $('audio-call-btn').classList.toggle('hidden', !isFriend);
  $('video-call-btn').classList.toggle('hidden', !isFriend);
  $('chat-sub').textContent = f.status === 'blocked' ? 'Blocked' : typingState[pk] ? 'typing…' : 'End-to-end encrypted';
  updateTyping();

  const box = $('messages');
  const chat = app.store.chat(pk);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const key = pk + ':' + chat.messages.length + ':' + chat.messages.map((m) => m.status).join('');
  if (renderedFor !== key) {
    renderedFor = key;
    let html = `<div class="lock-note">🔒 Messages and calls are end-to-end encrypted. Only you and ${esc(app.nameOf(pk))} can read them — not even the relays.</div>`;
    let lastDay = '';
    for (const m of chat.messages) {
      const day = fmtDay(m.ts);
      if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
      const out = m.from === app.pk;
      const emojiOnly = m.kind === 'text' && m.text.length <= 8 && EMOJI_RE.test(m.text);
      let body = m.kind === 'image' ? `<img src="${m.img}" alt="Photo" data-full="1">` : linkify(m.text);
      let tick = '';
      if (out) {
        if (m.status === 'pending') tick = '<span class="tick">🕓</span>';
        else if (m.status === 'failed') tick = `<span class="failed" data-resend="${m.id}">Failed · tap to retry</span>`;
        else tick = `<span class="tick ${m.status === 'read' ? 'read' : ''}">${m.status === 'sent' ? '✓' : '✓✓'}</span>`;
      }
      html += `<div class="msg ${out ? 'out' : 'in'} ${emojiOnly ? 'emoji-only' : ''}" data-id="${m.id}"><div class="bubble">${body}</div><div class="meta">${fmtTime(m.ts)} ${tick}</div></div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('img[data-full]').forEach((img) => { img.onclick = () => { $('viewer').querySelector('img').src = img.src; $('viewer').classList.remove('hidden'); }; });
    box.querySelectorAll('[data-resend]').forEach((el) => { el.onclick = () => app.resend(pk, el.dataset.resend); });
    if (scrollToEnd || atBottom || scrollNext) { box.scrollTop = box.scrollHeight; scrollNext = false; }
  }
}
function updateTyping() {
  const pk = app.openChat; if (!pk) return;
  const on = !!typingState[pk];
  $('typing').classList.toggle('hidden', !on);
  $('chat-sub').textContent = app.isBlocked(pk) ? 'Blocked' : on ? 'typing…' : 'End-to-end encrypted';
  if (on) { const box = $('messages'); box.scrollTop = box.scrollHeight; }
}

$('banner-accept').onclick = () => { app.acceptRequest(app.openChat); toast('Added to close friends'); };
$('banner-block').onclick = () => { app.block(app.openChat); closeChat(); };

/* composer */
const input = $('input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
input.addEventListener('input', () => { autosize(); if (input.value.trim() && app.openChat) app.typing(app.openChat); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 860) { e.preventDefault(); send(); } });
$('send-btn').onclick = send;
async function send() {
  const pk = app.openChat; const text = input.value.trim();
  if (!pk || !text) return;
  if (text.length > 20000) { toast('Message too long (max 20,000 characters)', 'error'); return; }
  input.value = ''; autosize(); app.store.chat(pk).draft = '';
  $('emoji-picker').classList.add('hidden');
  scrollNext = true; renderChat(true);
  const m = await app.sendMessage(pk, { text });
  if (m.status === 'failed') toast('Could not send: ' + (m.error || 'no relay reachable'), 'error');
}
$('attach-btn').onclick = () => $('file-input').click();
$('file-input').onchange = async () => {
  const file = $('file-input').files[0]; $('file-input').value = '';
  if (!file || !app.openChat) return;
  try {
    const dataUrl = await compressImage(file);
    scrollNext = true; renderChat(true);
    const m = await app.sendMessage(app.openChat, { img: dataUrl });
    if (m.status === 'failed') toast('Could not send photo: ' + (m.error || 'no relay reachable'), 'error');
  } catch (e) { toast('Could not read that image', 'error'); }
};
// Photos are shrunk to fit the ~48 KB encrypted-payload limit of a single relay event.
async function compressImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
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

const EMOJIS = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😅 😉 🙃 😇 🤔 🤨 😏 😴 🤤 😭 😤 😡 🤯 🥺 😬 🙄 😳 🤗 🤭 🤫 👍 👎 👌 ✌️ 🤞 🤙 👏 🙌 🙏 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 🔥 ✨ 🎉 🎂 🍕 ☕ 🍻 ⚽ 🎮 🎵 🚀 🌙 ☀️ 🌈 🐶 🐱 🦄 👀 💀 🫶 🤝 👋'.split(' ');
$('emoji-picker').innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join('');
$('emoji-picker').querySelectorAll('button').forEach((b) => { b.onclick = () => { input.value += b.textContent; autosize(); input.focus(); }; });
$('emoji-btn').onclick = () => $('emoji-picker').classList.toggle('hidden');

$('chat-menu-btn').onclick = () => {
  const pk = app.openChat; const f = app.state.friends[pk] || {};
  showModal(`<div class="menu">
    <button id="m-code">Friend's code</button>
    <button id="m-rename">Rename friend</button>
    <button id="m-clear">Clear chat on this device</button>
    ${f.status === 'blocked' ? '<button id="m-unblock">Unblock</button>' : '<button id="m-block" class="danger">Block</button>'}
    <button id="m-remove" class="danger">Remove friend</button>
    <button id="m-cancel">Cancel</button></div>`);
  $('m-code').onclick = () => { showModal(`<h3>${esc(app.nameOf(pk))}</h3><div class="code">${friendCode(pk)}</div><div class="row" style="justify-content:flex-end"><button class="btn primary small" id="m-ok">Close</button></div>`); $('m-ok').onclick = hideModal; };
  $('m-rename').onclick = async () => { hideModal(); const v = await promptSheet('Rename friend', f.name, 'Nickname'); if (v) { f.name = v; store.save(); } };
  $('m-clear').onclick = async () => { hideModal(); if (await confirmSheet('Clear chat?', 'Removes this conversation from this device only.', 'Clear')) { app.clearChat(pk); renderedFor = null; renderChat(); } };
  if ($('m-block')) $('m-block').onclick = async () => { hideModal(); if (await confirmSheet('Block?', `${app.nameOf(pk)} will no longer be able to message or call you.`, 'Block')) { app.block(pk); closeChat(); } };
  if ($('m-unblock')) $('m-unblock').onclick = () => { hideModal(); app.unblock(pk); };
  $('m-remove').onclick = async () => { hideModal(); if (await confirmSheet('Remove friend?', 'Deletes the chat on this device and removes them from your close friends.', 'Remove')) { app.removeFriend(pk); closeChat(); } };
  $('m-cancel').onclick = hideModal;
};

/* ---------------- add friend ---------------- */
let scanStream = null, scanRaf = null;
function stopScanner() { if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; } cancelAnimationFrame(scanRaf); }
function openAddFriend() {
  const code = friendCode(app.pk);
  const qr = qrcode(0, 'M'); qr.addData('closechat:' + code); qr.make();
  showModal(`<h3>Add a close friend</h3>
    <p class="muted tiny">Friends are added by code only — nobody can find you otherwise.</p>
    <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div>
    <div class="code" id="my-code">${code}</div>
    <div class="row"><button class="btn ghost small" id="copy-code">Copy my code</button>${navigator.share ? '<button class="btn ghost small" id="share-code">Share</button>' : ''}</div>
    <h3 style="margin-top:18px">Friend's code</h3>
    <div class="row"><input type="text" id="friend-code" placeholder="Paste npub… code" autocapitalize="none" autocomplete="off"><button class="btn primary" id="add-code">Add</button></div>
    <div class="row"><button class="btn ghost small" id="scan-btn">Scan QR code</button></div>
    <div id="scan-wrap" class="hidden"><video id="scan-video" autoplay playsinline muted></video><canvas id="scan-canvas" hidden></canvas></div>`);
  $('copy-code').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch { toast('Select and copy the code above'); } };
  if ($('share-code')) $('share-code').onclick = () => navigator.share({ title: 'Add me on CloseChat', text: `Add me on CloseChat with my friend code: ${code}\n${location.href.split('#')[0]}` }).catch(() => {});
  const doAdd = (raw) => {
    const pk = parseFriendCode(raw.replace(/^closechat:/, ''));
    if (!pk) { toast('That is not a valid friend code', 'error'); return; }
    try { app.addFriend(pk); } catch (e) { toast(e.message, 'error'); return; }
    hideModal(); toast('Friend request sent'); openChat(pk);
  };
  $('add-code').onclick = () => doAdd($('friend-code').value);
  $('friend-code').onkeydown = (e) => { if (e.key === 'Enter') doAdd($('friend-code').value); };
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

/* ---------------- calls ---------------- */
let callTimer = null;
function startCall(pk, video) {
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
    ov.classList.add('hidden'); tones.stop(); clearInterval(callTimer);
    $('remote-video').srcObject = null; $('local-video').srcObject = null;
    renderCalls();
    return;
  }
  ov.classList.remove('hidden');
  setAvatar($('call-avatar'), info.peer, app.nameOf(info.peer));
  $('call-name').textContent = app.nameOf(info.peer);
  const incoming = info.state === 'incoming';
  $('incoming-controls').classList.toggle('hidden', !incoming);
  $('call-controls').classList.toggle('hidden', incoming);
  $('local-video').classList.toggle('hidden', !info.video || !info.local);
  $('cam-btn').classList.toggle('hidden', !info.video);
  $('flip-btn').classList.toggle('hidden', !info.video);
  $('mute-btn').classList.toggle('on', info.muted);
  $('cam-btn').classList.toggle('on', info.camOff);
  ov.classList.toggle('has-video', info.video && info.state === 'active' && !!info.remote);
  const status = $('call-status');
  clearInterval(callTimer);
  if (incoming) {
    status.textContent = `Incoming ${info.video ? 'video' : 'voice'} call…`;
    if (settings.get().sounds) tones.startRing(true);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(app.nameOf(info.peer), { body: `Incoming ${info.video ? 'video' : 'voice'} call`, tag: 'call' });
  } else if (info.state === 'outgoing') status.textContent = 'Calling…';
  else if (info.state === 'connecting') { tones.stop(); status.textContent = 'Connecting…'; }
  else if (info.state === 'active') {
    tones.stop();
    const upd = () => { const s = Math.floor((Date.now() - info.startedAt) / 1000); status.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} · encrypted`; };
    upd(); callTimer = setInterval(upd, 1000);
  }
}

/* ---------------- boot ---------------- */
applyTheme();
window.addEventListener('beforeunload', () => { if (store) store.flush(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  const saved = session.get();
  if (saved) {
    try { await startApp(hexToBytes(saved), null); return; } catch (e) { console.error(e); session.clear(); }
  }
  $('auth').classList.remove('hidden');
})();
