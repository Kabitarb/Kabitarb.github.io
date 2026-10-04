import { DigitNet } from './cnn.js';
import { toGray, analyzeFrame } from './vision.js';
import { NumberTracker, groupColumns } from './tracking.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('start');
const freezeBtn = document.getElementById('freeze');
const debugBtn = document.getElementById('debug');
const torchBtn = document.getElementById('torch');
const chip = document.getElementById('chip');
const status = document.getElementById('status');
const intro = document.getElementById('intro');

const PALETTE = ['#39d353', '#2ec4ff', '#ff9f1c', '#ff5fa2', '#ffe14d'];
const PROC_LONG_SIDE = 800;

const demo = new URLSearchParams(location.search).get('demo');
let src = video, srcW = () => video.videoWidth, srcH = () => video.videoHeight;

const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });

let net = null, tracker = new NumberTracker();
let frozen = false, debug = false, running = false, track = null, torchOn = false;
let lastResult = { numbers: [], columns: [], circles: [] };
let fps = 0, lastTime = performance.now();
let lastMask = null;

function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
}

async function start() {
  startBtn.disabled = true;
  status.textContent = 'Loading recognizer…';
  try {
    net = net || await DigitNet.load('./digits.json');
  } catch (e) {
    status.textContent = 'Could not load the digit model: ' + e.message;
    startBtn.disabled = false; return;
  }
  if (demo) {
    const img = new Image();
    img.src = demo === '1' ? './demo.jpg' : demo;
    try { await img.decode(); } catch (e) { status.textContent = 'Could not load demo image'; startBtn.disabled = false; return; }
    src = img; srcW = () => img.naturalWidth; srcH = () => img.naturalHeight;
    video.hidden = true;
    const bg = document.getElementById('demoimg'); bg.src = img.src; bg.hidden = false;
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
  if (!frozen && srcW() && (demo || video.readyState >= 2)) {
    processFrame();
  }
  draw();
  requestAnimationFrame(loop);
}

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

function updateChip(columns) {
  if (!columns.length) { chip.textContent = 'Point at handwritten numbers'; return; }
  const parts = columns.map((c, i) => `<b style="color:${PALETTE[i % PALETTE.length]}">${fmt(c.total)}</b>`);
  chip.innerHTML = `${columns.length} column${columns.length === 1 ? '' : 's'} · ${parts.join(' &nbsp; ')}` +
    `<span class="fps">${fps.toFixed(0)} fps</span>`;
}

// Map normalized video coords to screen coords, matching object-fit: cover.
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

  if (debug && lastMask && lastResult.W) {
    drawMask(map);
  }

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
      if (debug) {
        badge(n.text, r.x, r.y - 6, 'rgba(0,0,0,0.7)', 12);
        for (const d of n.digits || []) {
          // digit boxes are in processing pixels
          const db = map({ x: d.box.x0 / lastResult.W, y: d.box.y0 / lastResult.H, w: d.box.w / lastResult.W, h: d.box.h / lastResult.H });
          ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.strokeRect(db.x, db.y, db.w, db.h);
          ctx.fillStyle = '#fff'; ctx.font = '10px -apple-system, sans-serif';
          ctx.fillText(`${d.label > 9 ? '?' : d.label} ${(d.conf * 100) | 0}`, db.x, db.y + db.h + 10);
        }
      }
    }
    // Total under the last number.
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

startBtn.addEventListener('click', start);
freezeBtn.addEventListener('click', () => {
  frozen = !frozen;
  freezeBtn.textContent = frozen ? '▶ Resume' : '❚❚ Freeze';
  freezeBtn.classList.toggle('active', frozen);
  if (!frozen) tracker.reset();
});
debugBtn.addEventListener('click', () => {
  debug = !debug;
  debugBtn.classList.toggle('active', debug);
});
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
