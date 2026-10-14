// Trim screen for video clips: filmstrip, draggable window, clip length 1/2/3s.
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
  let clipLen = media.dur || maxWin;
  let start = media.start || 0;
  if (start + clipLen > srcDur) start = Math.max(0, srcDur - clipLen);

  // filmstrip of ~10 thumbnails
  const strip = el('div', { class: 'filmstrip' });
  root.append(strip);
  const thumbs = [];
  const N = 10;
  const tc = document.createElement('canvas');
  const tctx = tc.getContext('2d');
  tc.width = 96; tc.height = 96 * (video.videoHeight / Math.max(1, video.videoWidth)) || 128;
  const seekTo = t => new Promise(r => { const to = setTimeout(r, 1500); video.onseeked = () => { clearTimeout(to); r(); }; video.currentTime = t; });
  for (let i = 0; i < N; i++) {
    const c = el('canvas'); c.width = 64; c.height = Math.round(64 * tc.height / tc.width);
    strip.append(c); thumbs.push(c);
    await seekTo((srcDur - 0.05) * i / (N - 1));
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  }

  // range sliders: start + length
  const rw = el('div', { class: 'trim-range-wrap' });
  const rs = el('input', { type: 'range', min: 0, max: Math.max(0.01, srcDur - clipLen), step: 0.05, value: start });
  rw.append(rs); root.append(rw);
  const info = el('div', { class: 'trim-info' });
  root.append(info);

  const lenRow = el('div', { class: 'booth-row' }, el('label', {}, 'Length:'));
  const lenBtns = [1, 2, 3].filter(l => l <= srcDur + 0.01).map(l =>
    el('button', { class: 'opt-chip' + (clipLen === l ? ' on' : ''), onclick: () => { clipLen = Math.min(l, srcDur); update(); syncChips(); } }, `${l}s`));
  const fullBtn = el('button', { class: 'opt-chip', onclick: () => { clipLen = srcDur; start = 0; update(); syncChips(); } }, 'Use full clip');
  lenRow.append(...lenBtns, fullBtn);
  root.append(lenRow);
  function syncChips() { lenBtns.forEach((b, i) => b.classList.toggle('on', [1, 2, 3].filter(l => l <= srcDur + 0.01)[i] === clipLen)); fullBtn.classList.toggle('on', clipLen === srcDur); }

  let playTimer = null;
  function loop() {
    clearTimeout(playTimer);
    if (video.currentTime < start || video.currentTime >= start + clipLen) video.currentTime = start;
    playTimer = setTimeout(loop, 80);
  }
  function update() {
    start = Math.min(start, Math.max(0, srcDur - clipLen));
    rs.max = Math.max(0.01, srcDur - clipLen);
    rs.value = start;
    media.start = start; media.dur = Math.min(clipLen, srcDur);
    info.textContent = `${media.dur.toFixed(1)}s clip — starts ${start.toFixed(1)}s`;
    loop();
  }
  rs.oninput = () => { start = parseFloat(rs.value); update(); };
  video.play().catch(() => {});
  update(); syncChips();

  const btns = el('div', { class: 'btn-row' });
  const useBtn = el('button', { class: 'pill' }, 'Use this clip ✂️');
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
