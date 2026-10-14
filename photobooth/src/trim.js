// Trim screen for video clips: looping preview, 10-thumb filmstrip,
// highlighted draggable window (start/end handles, time labels), length pills.
import { state, el, toast } from './state.js';
import { videoFrameToMedia } from './media.js';

export async function renderTrim(root, { media, onDone }) {
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'Trim clip ', el('span', { class: 'en' }, '자르기')));

  const video = el('video', { id: 'trim-video', muted: true, playsinline: true, loop: true });
  video.src = URL.createObjectURL(media.blob);
  root.append(video);
  await new Promise(res => { video.onloadeddata = res; video.onerror = res; });
  const srcDur = video.duration || media.srcDur || 3;
  media.srcDur = srcDur;
  const maxWin = Math.min(3, srcDur);
  let clipLen = Math.min(media.dur || maxWin, maxWin);
  let start = media.start || 0;
  if (start + clipLen > srcDur) start = Math.max(0, srcDur - clipLen);

  // filmstrip: 10 thumbs spanning full width + selection window overlay
  const strip = el('div', { class: 'filmstrip', style: 'position:relative' });
  const N = 10;
  const thumbs = [];
  for (let i = 0; i < N; i++) {
    const c = el('canvas'); c.width = 64; c.height = 96;
    c.style.flex = '1'; c.style.width = '10%';
    strip.append(c); thumbs.push(c);
  }
  const dimL = el('div', { class: 'trim-dim' });
  const dimR = el('div', { class: 'trim-dim' });
  const win = el('div', { class: 'trim-window' }, el('div', { class: 'th l' }), el('div', { class: 'th r' }));
  strip.append(dimL, dimR, win);
  const times = el('div', { class: 'trim-times' }, el('span', { id: 'trim-t0' }), el('span', { id: 'trim-t1' }));
  const info = el('div', { class: 'trim-info' });
  root.append(strip, times, info);

  function layoutWin() {
    const l = (start / srcDur) * 100, r = ((start + clipLen) / srcDur) * 100;
    win.style.left = l + '%'; win.style.width = (r - l) + '%';
    dimL.style.left = '0'; dimL.style.width = l + '%';
    dimR.style.left = r + '%'; dimR.style.width = (100 - r) + '%';
    times.children[0].textContent = `${start.toFixed(1)}s –`;
    times.children[1].textContent = `– ${(start + clipLen).toFixed(1)}s`;
    info.textContent = `${clipLen.toFixed(1)}s clip of ${srcDur.toFixed(1)}s`;
  }

  // drag window / handles
  let drag = null;
  win.addEventListener('pointerdown', e => {
    win.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect();
    const mode = e.clientX < r.left + 18 ? 'l' : e.clientX > r.right - 18 ? 'r' : 'm';
    drag = { mode, x0: e.clientX, s0: start, l0: clipLen, stripW: strip.getBoundingClientRect().width };
    e.preventDefault();
  });
  win.addEventListener('pointermove', e => {
    if (!drag) return;
    const dt = (e.clientX - drag.x0) / drag.stripW * srcDur;
    if (drag.mode === 'm') start = Math.max(0, Math.min(srcDur - clipLen, drag.s0 + dt));
    else if (drag.mode === 'l') {
      const ns = Math.max(0, Math.min(drag.s0 + dt, drag.s0 + drag.l0 - 0.2));
      clipLen = drag.l0 + (drag.s0 - ns); start = ns;
    } else clipLen = Math.max(0.2, Math.min(maxWin, Math.min(srcDur - start, drag.l0 + dt)));
    sync(true);
  });
  win.addEventListener('pointerup', () => drag = null);
  win.addEventListener('pointercancel', () => drag = null);

  // length pills
  const lenRow = el('div', { class: 'booth-row', style: 'justify-content:center' }, el('label', {}, 'Length:'));
  const lens = [1, 2, 3].filter(l => l <= srcDur + 0.01);
  const lenBtns = lens.map(l =>
    el('button', { class: 'opt-chip', onclick: () => { clipLen = Math.min(l, srcDur - start); sync(); } }, `${l}s`));
  const fullBtn = el('button', { class: 'opt-chip', onclick: () => { start = 0; clipLen = srcDur; sync(); } }, 'Use full clip');
  lenRow.append(...lenBtns, fullBtn);
  root.append(lenRow);

  function syncChips() {
    lenBtns.forEach((b, i) => b.classList.toggle('on', lens[i] === clipLen));
    fullBtn.classList.toggle('on', clipLen === srcDur);
  }

  let playTimer = null;
  function loop() {
    clearTimeout(playTimer);
    if (video.currentTime < start || video.currentTime >= start + clipLen) video.currentTime = start;
    playTimer = setTimeout(loop, 80);
  }
  function sync(fromDrag) {
    start = Math.max(0, Math.min(start, srcDur - clipLen));
    clipLen = Math.max(0.2, Math.min(clipLen, srcDur - start, maxWin));
    media.start = start; media.dur = clipLen;
    layoutWin(); syncChips(); loop();
  }
  video.play().catch(() => {});
  sync();

  // thumbnails fill in async
  (async () => {
    const h = video.videoHeight || 360, w = video.videoWidth || 480;
    const ch = Math.round(96 * h / w);
    const seekTo = t => new Promise(r => { const to = setTimeout(r, 1500); video.onseeked = () => { clearTimeout(to); r(); }; video.currentTime = t; });
    for (let i = 0; i < N; i++) {
      thumbs[i].height = ch;
      await seekTo(Math.max(0, (srcDur - 0.05) * i / (N - 1)));
      thumbs[i].getContext('2d').drawImage(video, 0, 0, 64, ch);
      thumbs[i].style.height = ch * (thumbs[i].clientWidth || 34) / 64 + 'px';
    }
    thumbs.forEach(c => c.style.height = 'auto');
  })();

  const btns = el('div', { class: 'btn-row', style: 'margin-top:12px;justify-content:center' });
  const useBtn = el('button', { class: 'pill', style: 'min-width:180px' }, 'Use this clip ✓');
  const stillBtn = el('button', { class: 'pill secondary' }, 'Use as photo 📷');
  useBtn.onclick = () => { video.pause(); onDone(media); };
  stillBtn.onclick = async () => {
    video.pause();
    const still = await videoFrameToMedia(media);
    onDone(still);
  };
  btns.append(useBtn, stillBtn);
  root.append(btns);
}
