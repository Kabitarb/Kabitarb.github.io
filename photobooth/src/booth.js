// Booth camera flow: getUserMedia -> countdown -> capture shots -> pick screen.
import { state, el, toast } from './state.js';
import { haptic } from './bridge.js';
import { fileToMedia, seekVideo } from './media.js';
import { getLayout } from './layouts.js';

let stream = null, recorder = null;

function shutterClick() {
  if (state.booth.muted) return;
  try {
    const ac = shutterClick.ac || (shutterClick.ac = new (window.AudioContext || window.webkitAudioContext)());
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 1200; g.gain.value = 0.08;
    o.connect(g); g.connect(ac.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
    o.stop(ac.currentTime + 0.1);
  } catch (e) {}
}

export async function renderBooth(root, { onDone, goBack }) {
  const layout = getLayout(state.project.layoutId);
  const needed = layout.cells.length + (state.booth.extra ? 2 : 0);
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, '찰칵! Booth ', el('span', { class: 'en' }, `${needed} shots`)));

  const video = el('video', { id: 'booth-video', autoplay: true, playsinline: true, muted: true });
  const count = el('div', { id: 'booth-count' });
  const flash = el('div', { id: 'booth-flash' });
  const counter = el('div', { id: 'booth-counter' }, `0/${needed}`);
  const wrap = el('div', { id: 'booth-video-wrap' }, video, count, flash, counter);
  root.append(wrap);

  // settings row
  const cdRow = el('div', { class: 'booth-row' }, el('label', {}, 'Countdown:'),
    ...[3, 5, 10].map(s => el('button', {
      class: 'opt-chip' + (state.booth.countdown === s ? ' on' : ''),
      onclick: (e) => { state.booth.countdown = s; [...e.target.parentNode.children].slice(1).forEach(c => c.classList.remove('on')); e.target.classList.add('on'); },
    }, `${s}s`)));
  const modeRow = el('div', { class: 'booth-row' }, el('label', {}, 'Mode:'),
    ...[['Photo', false], ['Live 3s', true]].map(([lbl, live]) => el('button', {
      class: 'opt-chip' + (state.booth.live === live ? ' on' : ''),
      onclick: (e) => { state.booth.live = live; [...e.target.parentNode.children].slice(1).forEach(c => c.classList.remove('on')); e.target.classList.add('on'); },
    }, lbl)));
  const tglRow = el('div', { class: 'booth-row' });
  const mkToggle = (label, key) => {
    const b = el('button', { class: 'toggle' + (state.booth[key] ? ' on' : '') });
    b.onclick = () => { state.booth[key] = !state.booth[key]; b.classList.toggle('on', state.booth[key]); };
    tglRow.append(el('span', { style: 'font-weight:700;font-family:Jua' }, label), b, el('span', { style: 'width:10px' }));
  };
  mkToggle('Extra shots', 'extra'); mkToggle('Mirror', 'mirror'); mkToggle('Mute', 'muted');
  root.append(cdRow, modeRow, tglRow);

  const startBtn = el('button', { class: 'pill', style: 'margin-top:18px;width:100%' }, '찰칵! Start Booth');
  const flipBtn = el('button', { class: 'pill secondary small' }, '🔁 Flip camera');
  const backBtn = el('button', { class: 'pill secondary small' }, 'Back');
  const ctr = el('div', { class: 'booth-controls' }, flipBtn, backBtn);
  root.append(startBtn, ctr);

  const applyMirror = () => video.classList.toggle('nomirror', !state.booth.mirror);

  async function startCam() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.booth.facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: state.booth.live,
    });
    video.srcObject = stream;
    applyMirror();
  }
  flipBtn.onclick = async () => {
    state.booth.facing = state.booth.facing === 'user' ? 'environment' : 'user';
    await startCam();
  };
  backBtn.onclick = () => { stopCam(); goBack(); };

  function stopCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }

  async function snapPhoto() {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const x = c.getContext('2d');
    if (state.booth.mirror && state.booth.facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    return fileToMedia(blob);
  }
  function snapLive() {
    return new Promise((res, rej) => {
      const mimes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
      const mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
        res(await fileToMedia(blob));
      };
      rec.onerror = rej;
      rec.start();
      setTimeout(() => rec.stop(), 3000);
    });
  }

  let running = false;
  startBtn.onclick = async () => {
    if (running) return;
    running = true; startBtn.disabled = true;
    state.booth.shots = [];
    try {
      for (let i = 0; i < needed; i++) {
        counter.textContent = `${i}/${needed}`;
        // countdown
        for (let s = state.booth.countdown; s >= 1; s--) {
          const label = s === 3 ? '하나 3' : s === 2 ? '둘 2' : s === 1 ? '셋 1' : String(s);
          count.textContent = label;
          count.classList.remove('on'); void count.offsetWidth; count.classList.add('on');
          await new Promise(r => setTimeout(r, 1000));
        }
        count.classList.remove('on');
        flash.style.opacity = 1; setTimeout(() => flash.style.opacity = 0, 80);
        shutterClick(); haptic('light');
        const media = state.booth.live ? await snapLive() : await snapPhoto();
        state.booth.shots.push(media);
        counter.textContent = `${i + 1}/${needed}`;
      }
      haptic('success');
      toast('예쁘다 ✨ Cute!');
      stopCam();
      onDone();
    } catch (e) {
      toast('Camera error: ' + e.message);
      running = false; startBtn.disabled = false;
    }
  };

  try { await startCam(); } catch (e) {
    toast('Camera unavailable: ' + e.message);
    startBtn.disabled = true;
  }
  return { stopCam };
}
