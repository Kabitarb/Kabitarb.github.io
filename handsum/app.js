import { DigitNet } from './cnn.js';
import { toGray, analyzeFrame } from './vision.js';
import { NumberTracker, groupColumns } from './tracking.js';
import { recognizeGemini, GEMINI_MODELS } from './cloud.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const startBtn = $('start'), freezeBtn = $('freeze'), debugBtn = $('debug'), torchBtn = $('torch'), settingsBtn = $('settings');
const chip = $('chip'), status = $('status'), intro = $('intro'), panel = $('panel');
const modeSel = $('mode'), keyInput = $('apikey'), modelSel = $('model'), saveBtn = $('save'), closeBtn = $('close'), panelMsg = $('panelmsg');

const PALETTE = ['#39d353', '#2ec4ff', '#ff9f1c', '#ff5fa2', '#ffe14d'];
const PROC_LONG_SIDE = 800;
const AI_LONG_SIDE = 1024;
const AI_INTERVAL = 1500;

const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const mockEndpoint = params.get('mock'); // test hook: alternative endpoint for the AI call
let src = video, srcW = () => video.videoWidth, srcH = () => video.videoHeight;

const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
const tiny = document.createElement('canvas'); tiny.width = 32; tiny.height = 40;
const tctx = tiny.getContext('2d', { willReadFrequently: true });

const settings = loadSettings();
let net = null, tracker = new NumberTracker();
let frozen = false, debug = false, running = false, track = null, torchOn = false;
let lastResult = { numbers: [], columns: [], circles: [] };
let fps = 0, lastTime = performance.now();
let lastMask = null;
let ai = { inflight: false, lastSent: 0, backoffUntil: 0, error: '', count: 0, lastLatency: 0 };
let prevTiny = null;

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('handsum.settings') || '{}'); } catch (_) {}
  return { mode: s.mode || 'ai', apiKey: s.apiKey || '', model: s.model || GEMINI_MODELS[0].id };
}
function saveSettings() { localStorage.setItem('handsum.settings', JSON.stringify(settings)); }
function useAI() { return settings.mode === 'ai' && (settings.apiKey || mockEndpoint); }

function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
}

function configureTracker() {
  if (useAI()) { tracker.minHits = 1; tracker.keepAlive = 6000; tracker.maxVotes = 3; tracker.smoothing = 0.6; }
  else { tracker.minHits = 2; tracker.keepAlive = 900; tracker.maxVotes = 7; tracker.smoothing = 0.45; }
  tracker.reset();
}

async function start() {
  if (settings.mode === 'ai' && !settings.apiKey && !mockEndpoint) { openPanel('Paste your Gemini API key to use AI mode, or switch to On-device.'); return; }
  startBtn.disabled = true;
  if (!useAI()) {
    status.textContent = 'Loading recognizer…';
    try { net = net || await DigitNet.load('./digits.json'); }
    catch (e) { status.textContent = 'Could not load the digit model: ' + e.message; startBtn.disabled = false; return; }
  }
  if (demo) {
    const img = new Image();
    img.src = demo === '1' ? './demo.jpg' : demo;
    try { await img.decode(); } catch (e) { status.textContent = 'Could not load demo image'; startBtn.disabled = false; return; }
    src = img; srcW = () => img.naturalWidth; srcH = () => img.naturalHeight;
    video.hidden = true;
    const bg = $('demoimg'); bg.src = img.src; bg.hidden = false;
  } else {
    status.textContent = 'Starting camera…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      video.srcObject = stream;
      track = stream.getVideoTracks()[0];
      await video.play();
    } catch (e) {
      status.textContent = 'Camera unavailable: ' + e.message + '. Open this page over HTTPS and allow camera access.';
      startBtn.disabled = false; return;
    }
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) torchBtn.hidden = false;
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  }
  intro.hidden = true;
  document.body.classList.add('live');
  status.textContent = '';
  configureTracker();
  running = true;
  resize();
  requestAnimationFrame(loop);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.round(window.innerWidth * dpr);
  overlay.height = Math.round(window.innerHeight * dpr);
  overlay.style.width = window.innerWidth + 'px';
  overlay.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

function loop() {
  if (!running) return;
  const ready = srcW() && (demo || video.readyState >= 2);
  if (!frozen && ready) {
    if (useAI()) aiTick(); else processFrame();
  }
  draw();
  requestAnimationFrame(loop);
}

// ---------- On-device pipeline ----------
function processFrame() {
  const vw = srcW(), vh = srcH();
  const scale = Math.min(1, PROC_LONG_SIDE / Math.max(vw, vh));
  const W = Math.round(vw * scale), H = Math.round(vh * scale);
  if (proc.width !== W || proc.height !== H) { proc.width = W; proc.height = H; }
  pctx.drawImage(src, 0, 0, W, H);
  const rgba = pctx.getImageData(0, 0, W, H).data;
  const gray = toGray(rgba, W * H);
  const frame = analyzeFrame(gray, W, H, (input) => net.predict(input));
  const now = performance.now();
  const stable = tracker.update(frame.numbers, now);
  const columns = groupColumns(stable);
  lastResult = { numbers: stable, columns, circles: frame.circles || [], raw: frame.numbers, digitH: frame.digitH, W, H };
  lastMask = debug ? frame.mask : null;
  const dt = now - lastTime; lastTime = now;
  fps = fps * 0.8 + (1000 / Math.max(dt, 1)) * 0.2;
  updateChip(columns);
}

// ---------- AI (Gemini) pipeline ----------
function aiTick() {
  const now = performance.now();
  if (motionReset()) { lastResult = { numbers: [], columns: [], circles: [] }; updateChip([]); }
  if (ai.inflight || now < ai.backoffUntil || now - ai.lastSent < AI_INTERVAL) return;
  ai.inflight = true; ai.lastSent = now;
  const vw = srcW(), vh = srcH();
  const scale = Math.min(1, AI_LONG_SIDE / Math.max(vw, vh));
  const W = Math.round(vw * scale), H = Math.round(vh * scale);
  if (proc.width !== W || proc.height !== H) { proc.width = W; proc.height = H; }
  pctx.drawImage(src, 0, 0, W, H);
  const jpegBase64 = proc.toDataURL('image/jpeg', 0.75).split(',')[1];
  updateChip(lastResult.columns);
  recognizeGemini({ apiKey: settings.apiKey, model: settings.model, jpegBase64, endpoint: mockEndpoint })
    .then((res) => {
      if (frozen || !useAI()) return;
      const t = performance.now();
      ai.lastLatency = t - now; ai.count++; ai.error = '';
      const stable = tracker.update(res.numbers, t);
      const columns = groupColumns(stable);
      lastResult = { numbers: stable, columns, circles: [], raw: res.numbers, W, H };
      updateChip(columns);
    })
    .catch((e) => {
      ai.error = e.message || String(e);
      ai.backoffUntil = performance.now() + (e.retryAfterMs || (e.status === 400 || e.status === 403 ? 15000 : 4000));
      updateChip(lastResult.columns);
    })
    .finally(() => { ai.inflight = false; });
}

// Large camera movement makes old boxes meaningless: drop them.
function motionReset() {
  tctx.drawImage(src, 0, 0, tiny.width, tiny.height);
  const d = tctx.getImageData(0, 0, tiny.width, tiny.height).data;
  const cur = new Uint8Array(tiny.width * tiny.height);
  for (let i = 0, j = 0; i < cur.length; i++, j += 4) cur[i] = (d[j] + d[j + 1] + d[j + 2]) / 3;
  let moved = false;
  if (prevTiny) {
    let diff = 0;
    for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - prevTiny[i]);
    diff /= cur.length;
    if (diff > 18) { tracker.reset(); moved = true; }
  }
  prevTiny = cur;
  return moved;
}

function updateChip(columns) {
  let tail = '';
  if (useAI()) {
    if (ai.error) tail = `<span class="warn">${escapeHtml(ai.error)}</span>`;
    else tail = `<span class="fps">${ai.inflight ? 'scanning…' : (ai.count ? `AI ${(ai.lastLatency / 1000).toFixed(1)}s` : 'AI')}</span>`;
  } else tail = `<span class="fps">${fps.toFixed(0)} fps</span>`;
  if (!columns.length) { chip.innerHTML = (ai.error && useAI() ? '' : 'Point at handwritten numbers ') + tail; return; }
  const parts = columns.map((c, i) => `<b style="color:${PALETTE[i % PALETTE.length]}">${fmt(c.total)}</b>`);
  chip.innerHTML = `${columns.length} column${columns.length === 1 ? '' : 's'} · ${parts.join(' &nbsp; ')}` + tail;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Map normalized source coords to screen coords, matching object-fit: cover.
function mapper() {
  const vw = srcW() || 9, vh = srcH() || 16;
  const sw = window.innerWidth, sh = window.innerHeight;
  const s = Math.max(sw / vw, sh / vh);
  const rw = vw * s, rh = vh * s;
  const ox = (sw - rw) / 2, oy = (sh - rh) / 2;
  return (b) => ({ x: ox + b.x * rw, y: oy + b.y * rh, w: b.w * rw, h: b.h * rh });
}

function draw() {
  const sw = window.innerWidth, sh = window.innerHeight;
  ctx.clearRect(0, 0, sw, sh);
  const map = mapper();
  if (debug && lastMask && lastResult.W) drawMask(map);

  for (const col of lastResult.columns) {
    const color = PALETTE[col.id % PALETTE.length];
    for (const n of col.numbers) {
      const r = map(n.box);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = n.circled ? '#ff3b30' : color;
      if (n.circled) {
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 10, r.h / 2 + 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        badge(`−${fmt(n.value)}`, r.x + r.w + 4, r.y - 6, '#ff3b30', Math.max(11, Math.min(18, r.h * 0.5)));
      } else {
        roundRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10, 5);
        ctx.stroke();
      }
      if (debug || useAI()) badge(n.text, r.x, r.y - 6, 'rgba(0,0,0,0.65)', Math.max(11, Math.min(16, r.h * 0.45)));
      if (debug && lastResult.W) {
        for (const d of n.digits || []) {
          const db = map({ x: d.box.x0 / lastResult.W, y: d.box.y0 / lastResult.H, w: d.box.w / lastResult.W, h: d.box.h / lastResult.H });
          ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.strokeRect(db.x, db.y, db.w, db.h);
          ctx.fillStyle = '#fff'; ctx.font = '10px -apple-system, sans-serif';
          ctx.fillText(`${d.label > 9 ? '?' : d.label} ${(d.conf * 100) | 0}`, db.x, db.y + db.h + 10);
        }
      }
    }
    const frame = map({ x: col.minX, y: col.bottomY, w: col.maxX - col.minX, h: col.rowH });
    const fontSize = Math.max(18, Math.min(44, frame.h * 0.9));
    const lineW = Math.max(frame.w + 16, 56);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(frame.x + frame.w / 2 - lineW / 2, frame.y + 6); ctx.lineTo(frame.x + frame.w / 2 + lineW / 2, frame.y + 6); ctx.stroke();
    ctx.font = `700 ${fontSize}px -apple-system, "SF Pro Rounded", system-ui, sans-serif`;
    const text = fmt(col.total);
    const tw = ctx.measureText(text).width;
    const bx = frame.x + frame.w / 2 - tw / 2 - 8, by = frame.y + 10, bw = tw + 16, bh = fontSize + 8;
    ctx.fillStyle = hexToRgba(color, 0.88);
    roundRect(bx, by, bw, bh, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 8, by + bh / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }
  if (debug) {
    for (const c of lastResult.circles || []) {
      const r = map(c); ctx.strokeStyle = 'rgba(255,59,48,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
}

let maskCanvas = null;
function drawMask(map) {
  const { W, H } = lastResult;
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== W || maskCanvas.height !== H) { maskCanvas.width = W; maskCanvas.height = H; }
  const mctx = maskCanvas.getContext('2d');
  const img = mctx.createImageData(W, H);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    if (lastMask[i]) { img.data[j] = 0; img.data[j + 1] = 255; img.data[j + 2] = 255; img.data[j + 3] = 190; }
  }
  mctx.putImageData(img, 0, 0);
  const r = map({ x: 0, y: 0, w: 1, h: 1 });
  ctx.drawImage(maskCanvas, r.x, r.y, r.w, r.h);
}

function badge(text, x, y, bg, size) {
  ctx.font = `700 ${size}px -apple-system, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = bg; roundRect(x - 4, y - size, tw + 8, size + 6, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- Settings panel ----------
for (const m of GEMINI_MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; modelSel.appendChild(o); }
function openPanel(msg = '') {
  modeSel.value = settings.mode; keyInput.value = settings.apiKey; modelSel.value = settings.model;
  panelMsg.textContent = msg; panel.hidden = false; syncPanel();
}
function syncPanel() { $('aifields').hidden = modeSel.value !== 'ai'; }
modeSel.addEventListener('change', syncPanel);
saveBtn.addEventListener('click', async () => {
  settings.mode = modeSel.value; settings.apiKey = keyInput.value.trim(); settings.model = modelSel.value;
  saveSettings(); panel.hidden = true;
  ai = { inflight: false, lastSent: 0, backoffUntil: 0, error: '', count: 0, lastLatency: 0 };
  if (running) {
    if (!useAI() && !net) {
      try { net = await DigitNet.load('./digits.json'); } catch (e) { ai.error = 'Could not load on-device model'; }
    }
    configureTracker();
    lastResult = { numbers: [], columns: [], circles: [] };
    updateChip([]);
  }
  updateIntro();
});
closeBtn.addEventListener('click', () => { panel.hidden = true; });
settingsBtn.addEventListener('click', () => openPanel());
$('introsettings').addEventListener('click', () => openPanel());
function updateIntro() {
  $('modeinfo').textContent = settings.mode === 'ai'
    ? (settings.apiKey ? `AI mode · ${settings.model}` : 'AI mode · API key needed (tap Settings)')
    : 'On-device mode (offline, less accurate)';
}
updateIntro();

startBtn.addEventListener('click', start);
freezeBtn.addEventListener('click', () => {
  frozen = !frozen;
  freezeBtn.textContent = frozen ? '▶ Resume' : '❚❚ Freeze';
  freezeBtn.classList.toggle('active', frozen);
  if (!frozen) { tracker.reset(); prevTiny = null; }
});
debugBtn.addEventListener('click', () => { debug = !debug; debugBtn.classList.toggle('active', debug); });
torchBtn.addEventListener('click', async () => {
  if (!track) return;
  torchOn = !torchOn;
  try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; }
  torchBtn.classList.toggle('active', torchOn);
});

if (!demo && (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) {
  status.textContent = 'This browser cannot access the camera. Use Safari on iPhone over HTTPS.';
  startBtn.disabled = true;
}
