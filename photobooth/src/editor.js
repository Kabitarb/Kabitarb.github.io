// Editor: preview canvas + toolbar + sheets (layout/frame/filter/photos/text/stickers/adjust/save).
import { state, el, toast, openSheet, closeSheet, sheetOpen, emptyCell, fileStamp } from './state.js';
import { LAYOUTS, SIZES, getLayout, layoutSize, exportSize, printSheetSize } from './layouts.js';
import { THEMES, getTheme } from './themes.js';
import { FILTERS } from './filters.js';
import { render, ensureFonts, FONT_FAMILIES, DATE_FORMATS } from './render.js';
import { EMOJI_STICKERS, ART_STICKERS, STICKER_ART } from './stickers.js';
import { fileToMedia, seekVideo } from './media.js';
import { exportLive } from './video-export.js';
import { albumAdd } from './album.js';
import { hasSaveToPhotos, saveToPhotos, b64encode, haptic } from './bridge.js';

let previewCanvas, pctx, raf = 0, needsDraw = true;
let openAdjustFn = null;

export function dirty() { needsDraw = true; }

function previewLoop() {
  raf = requestAnimationFrame(previewLoop);
  if (!state.project || state.screen !== 'editor') return;
  const layout = getLayout(state.project.layoutId);
  const size = layoutSize(layout);
  const area = previewCanvas.parentElement;
  const availW = area.clientWidth - 8, availH = area.clientHeight - 8;
  const sc = Math.min(availW / size.w, availH / size.h);
  const w = Math.max(60, Math.round(size.w * sc)), h = Math.max(60, Math.round(size.h * sc));
  if (previewCanvas.width !== w || previewCanvas.height !== h) {
    previewCanvas.width = w; previewCanvas.height = h; needsDraw = true;
  }
  const hasVideo = state.project.cells.some(c => c && c.media && c.media.type === 'video');
  if (!needsDraw && !hasVideo && !state.project._dirty) return;
  needsDraw = false; state.project._dirty = false;
  ensureFonts(state.project, getTheme(state.project.themeId));
  render(pctx, state.project, { scale: w / size.w, time: performance.now() / 1000, preview: true });
}

// clamp pan so image covers the cell (scale>=1)
export function clampCell(cell, rect, m) {
  if (!m || cell.scale < 1) return;
  const coverW = rect.w / m.w, coverH = rect.h / m.h;
  const cover = Math.max(coverW, coverH);
  const drawW = m.w * cover * cell.scale, drawH = m.h * cover * cell.scale;
  const maxOx = Math.max(0, (drawW - rect.w) / 2 / rect.w);
  const maxOy = Math.max(0, (drawH - rect.h) / 2 / rect.h);
  cell.ox = Math.max(-maxOx, Math.min(maxOx, cell.ox));
  cell.oy = Math.max(-maxOy, Math.min(maxOy, cell.oy));
}

export function renderEditor(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'editor-wrap' });
  const area = el('div', { class: 'preview-area' });
  previewCanvas = el('canvas', { id: 'preview-canvas' });
  pctx = previewCanvas.getContext('2d');
  area.append(previewCanvas);
  wrap.append(area);

  const TABS = [
    ['Layout', '🖼️', openLayoutSheet], ['Frame', '🎀', openThemeSheet],
    ['Filter', '✨', openFilterSheet], ['Photos', '📷', openPhotosSheet],
    ['Text', '✏️', openTextSheet], ['Stickers', '💖', openStickerSheet],
    ['Save', '💾', openSaveSheet],
  ];
  const bar = el('div', { class: 'toolbar' },
    TABS.map(([label, icon, fn]) =>
      el('button', { onclick: fn }, el('span', { class: 'ti' }, icon), el('span', {}, label))));
  wrap.append(bar);
  root.append(wrap);

  // tap preview cell -> adjust; drag -> pan; pinch -> zoom
  attachPreviewGestures();
  needsDraw = true;
  cancelAnimationFrame(raf); previewLoop();
}

function previewToDU(e) {
  const layout = getLayout(state.project.layoutId);
  const size = layoutSize(layout);
  const r = previewCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * size.w, y: (e.clientY - r.top) / r.height * size.h, scale: r.width / size.w };
}
function cellAt(pt) {
  const layout = getLayout(state.project.layoutId);
  for (let i = layout.cells.length - 1; i >= 0; i--) {
    const c = layout.cells[i];
    if (pt.x >= c.x && pt.x <= c.x + c.w && pt.y >= c.y && pt.y <= c.y + c.h) return i;
  }
  return -1;
}

function attachPreviewGestures() {
  const cvs = previewCanvas;
  const ptrs = new Map();
  let cellIdx = -1, startOx = 0, startOy = 0, startScale = 1, pinchD0 = 0;
  let stickerIdx = -1, st0 = null;
  let moved = false;

  function stickerAt(pt) {
    const size = layoutSize(getLayout(state.project.layoutId));
    const sts = state.project.stickers;
    for (let i = sts.length - 1; i >= 0; i--) {
      const s = sts[i];
      const dx = pt.x - s.x * size.w, dy = pt.y - s.y * size.h;
      const rad = s.s * size.w * 0.75;
      if (dx * dx + dy * dy < rad * rad) return i;
    }
    return -1;
  }

  cvs.addEventListener('pointerdown', e => {
    cvs.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, e);
    moved = false;
    const pt = previewToDU(e);
    stickerIdx = stickerAt(pt);
    if (stickerIdx >= 0) { st0 = { ...state.project.stickers[stickerIdx], pt }; pinchD0 = 0; return; }
    cellIdx = cellAt(pt);
    if (cellIdx >= 0) {
      const cell = state.project.cells[cellIdx] || emptyCell();
      startOx = cell.ox; startOy = cell.oy; startScale = cell.scale;
    }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinchD0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  });
  cvs.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);
    moved = true;
    const pt = previewToDU(e);
    if (stickerIdx >= 0 && st0) {
      const size = layoutSize(getLayout(state.project.layoutId));
      const s = state.project.stickers[stickerIdx];
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!pinchD0) { pinchD0 = d; st0.pinchS = s.s; st0.pinchR = s.r; st0.a0 = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX); }
        s.s = Math.max(0.03, st0.pinchS * d / pinchD0);
        s.r = st0.pinchR + Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) - st0.a0;
      } else {
        s.x = Math.max(0, Math.min(1, pt.x / size.w));
        s.y = Math.max(0, Math.min(1, pt.y / size.h));
      }
      needsDraw = true;
      return;
    }
    if (cellIdx < 0) return;
    const cell = state.project.cells[cellIdx] || (state.project.cells[cellIdx] = emptyCell());
    if (!cell.media) return;
    const rect = getLayout(state.project.layoutId).cells[cellIdx];
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      cell.scale = Math.max(0.3, Math.min(4, startScale * d / pinchD0));
    } else {
      cell.ox = (cell.ox || 0) + (e.movementX || 0) / (rect.w * pt.scale);
      cell.oy = (cell.oy || 0) + (e.movementY || 0) / (rect.h * pt.scale);
    }
    clampCell(cell, rect, cell.media);
    needsDraw = true;
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (!moved && cellIdx >= 0) openAdjust(cellIdx);
    if (ptrs.size < 2) pinchD0 = 0;
    if (ptrs.size === 0) { cellIdx = -1; stickerIdx = -1; st0 = null; }
  };
  cvs.addEventListener('pointerup', up);
  cvs.addEventListener('pointercancel', up);
  cvs.addEventListener('wheel', e => {
    const pt = previewToDU(e);
    const i = cellAt(pt);
    if (i < 0) return;
    const cell = state.project.cells[i];
    if (!cell || !cell.media) return;
    e.preventDefault();
    cell.scale = Math.max(0.3, Math.min(4, cell.scale * (e.deltaY < 0 ? 1.08 : 0.93)));
    clampCell(cell, getLayout(state.project.layoutId).cells[i], cell.media);
    needsDraw = true;
  }, { passive: false });
}

function switchLayout(id) {
  state.project.layoutId = id;
  const layout = getLayout(id);
  // keep cells array; ensure slots exist
  while (state.project.cells.length < layout.cells.length) state.project.cells.push(emptyCell());
  needsDraw = true;
}

function openLayoutSheet() {
  const grid = el('div', { class: 'layout-grid' });
  for (const l of LAYOUTS) {
    const card = el('div', { class: 'layout-card' });
    const c = el('canvas'); const s = layoutSize(l);
    c.width = Math.round(s.w * 0.16); c.height = Math.round(s.h * 0.16);
    card.append(c, el('div', { class: 'lname' }, `${l.id} · ${l.name}`), el('div', { class: 'lmeta' }, `${l.cells.length} cuts`));
    card.onclick = () => { switchLayout(l.id); closeSheet(); toast(`Layout ${l.id} ✨`); };
    grid.append(card);
    renderMini(c, l);
  }
  openSheet(el('div', {}, el('h3', {}, 'Layout 레이아웃'), grid));
}

function renderMini(canvas, layout, project) {
  const s = layoutSize(layout);
  const proj = project || state.project || {
    layoutId: layout.id, themeId: 'white', filter: { id: 'original', intensity: 100 },
    text: { title: 'dalkom booth', subtitle: 'Our Special Day', date: new Date().toISOString(), dateFormat: 'ymd', show: true, showDate: true },
    cells: [], stickers: [], getMediaSource: () => null,
  };
  const old = proj.layoutId; proj.layoutId = layout.id;
  render(canvas.getContext('2d'), proj, { scale: canvas.width / s.w });
  proj.layoutId = old;
}

function openThemeSheet() {
  const grid = el('div', { class: 'theme-grid' });
  for (const t of THEMES) {
    const sw = el('div', { class: 'theme-swatch' + (state.project.themeId === t.id ? ' on' : '') });
    const c = el('canvas'); c.width = c.height = 140;
    t.bg(c.getContext('2d'), 140, 140);
    sw.append(c, el('div', { class: 'tname' }, t.name));
    sw.onclick = () => {
      state.project.themeId = t.id; needsDraw = true;
      grid.querySelectorAll('.theme-swatch').forEach(x => x.classList.remove('on'));
      sw.classList.add('on'); toast(t.name + ' 🎀');
    };
    grid.append(sw);
  }
  openSheet(el('div', {}, el('h3', {}, 'Frame theme 프레임'), grid));
}

function openFilterSheet() {
  const grid = el('div', { class: 'filter-grid' });
  // thumbnail source: first filled cell, else placeholder
  const srcCell = (state.project.cells || []).find(c => c && c.media);
  const thumb = document.createElement('canvas'); thumb.width = thumb.height = 160;
  const tctx = thumb.getContext('2d');
  if (srcCell) {
    const src = state.project.getMediaSource(srcCell.media, 0);
    if (src) tctx.drawImage(src, 0, 0, 160, 160);
  } else {
    const g = tctx.createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, '#FFC9D8'); g.addColorStop(1, '#A8D8FF');
    tctx.fillStyle = g; tctx.fillRect(0, 0, 160, 160);
    tctx.fillStyle = '#fff'; tctx.font = '40px Jua'; tctx.textAlign = 'center'; tctx.fillText('📷', 80, 100);
  }
  const slider = el('input', { type: 'range', min: 0, max: 100, value: state.project.filter.intensity });
  slider.oninput = () => { state.project.filter.intensity = +slider.value; needsDraw = true; };
  import('./filters.js').then(({ applyFilter, getFilter }) => {
    for (const f of FILTERS) {
      const sw = el('div', { class: 'filter-swatch' + (state.project.filter.id === f.id ? ' on' : '') });
      const c = el('canvas'); c.width = c.height = 160;
      const out = applyFilter(thumb, 160, 160, f, 1);
      c.getContext('2d').drawImage(out, 0, 0);
      sw.append(c, el('div', { class: 'tname' }, f.name));
      sw.onclick = () => {
        state.project.filter.id = f.id; needsDraw = true;
        grid.querySelectorAll('.filter-swatch').forEach(x => x.classList.remove('on'));
        sw.classList.add('on');
      };
      grid.append(sw);
    }
  });
  openSheet(el('div', {}, el('h3', {}, 'Filter 필터'), grid,
    el('div', { class: 'field', style: 'margin-top:12px' }, el('label', {}, 'Intensity'), slider)));
}

function cellThumbCanvas(i) {
  const layout = getLayout(state.project.layoutId);
  const rect = layout.cells[Math.min(i, layout.cells.length - 1)];
  const c = document.createElement('canvas');
  const s = layoutSize(layout);
  c.width = 120; c.height = Math.round(120 * rect.h / rect.w);
  const proj = { ...state.project, layoutId: 'D', cells: [state.project.cells[i] || emptyCell()], text: { ...state.project.text, show: false }, stickers: [] };
  // render single cell by faking a 1-cell layout? simpler: draw media cover directly
  const cell = state.project.cells[i];
  const x = c.getContext('2d');
  x.fillStyle = '#f6f0f2'; x.fillRect(0, 0, c.width, c.height);
  if (cell && cell.media) {
    const src = state.project.getMediaSource(cell.media, cell.media.start || 0);
    if (src) {
      const k = Math.max(c.width / cell.media.w, c.height / cell.media.h);
      x.save(); x.translate(c.width / 2, c.height / 2); x.scale(k, k);
      x.drawImage(src, -cell.media.w / 2, -cell.media.h / 2); x.restore();
    }
  } else {
    x.fillStyle = '#cbb8c2'; x.font = '30px Jua'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('+', c.width / 2, c.height / 2);
  }
  return c;
}

function openPhotosSheet() {
  const layout = getLayout(state.project.layoutId);
  const grid = el('div', { class: 'cell-grid' });
  layout.cells.forEach((_, i) => {
    const th = el('div', { class: 'cell-thumb' + (state.swapFirst === i ? ' swappick' : '') });
    th.append(cellThumbCanvas(i), el('span', { class: 'cnum' }, String(i + 1)));
    th.onclick = () => {
      if (state.swapFirst >= 0 && state.swapFirst !== i) {
        const a = state.project.cells[state.swapFirst], b = state.project.cells[i];
        state.project.cells[i] = a; state.project.cells[state.swapFirst] = b;
        state.swapFirst = -1; needsDraw = true; closeSheet(); openPhotosSheet();
        toast('Swapped! 🔀');
      } else openAdjust(i);
    };
    grid.append(th);
  });
  const file = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: 'display:none' });
  file.onchange = () => fillCells(file.files);
  const row = el('div', { class: 'btn-row' },
    el('button', { class: 'pill secondary small', onclick: () => file.click() }, '＋ Add photos'),
    el('button', {
      class: 'pill secondary small', onclick: () => {
        state.swapFirst = state.swapFirst >= 0 ? -1 : 0;
        closeSheet(); openPhotosSheet();
        toast('Tap two cells to swap 🔀');
      }
    }, '🔀 Swap'),
    el('button', {
      class: 'pill secondary small', onclick: () => {
        state.project.cells = state.project.cells.map(() => emptyCell());
        state.swapFirst = -1; needsDraw = true; closeSheet(); toast('Cleared 🧹');
      }
    }, '🧹 Clear all'));
  openSheet(el('div', {}, el('h3', {}, 'Photos 사진'), grid, row, file));
}

async function fillCells(fileList) {
  const files = [...fileList];
  for (const f of files) {
    try {
      const media = await fileToMedia(f);
      if (media.type === 'video') {
        state.trimTarget = media;
        closeSheet();
        // route to trim, then into first empty cell
        window.dispatchEvent(new CustomEvent('booth:trim', { detail: { media, autoFill: true } }));
        return;
      }
      const layout = getLayout(state.project.layoutId);
      let idx = state.project.cells.findIndex((c, i) => i < layout.cells.length && (!c || !c.media));
      if (idx < 0) idx = layout.cells.length - 1;
      const cell = state.project.cells[idx] || (state.project.cells[idx] = emptyCell());
      cell.media = media; clampCell(cell, layout.cells[idx], media);
    } catch (e) { toast('Could not load ' + f.name); }
  }
  needsDraw = true;
  closeSheet(); openPhotosSheet();
}
export { fillCells };

function openTextSheet() {
  const t = state.project.text;
  const theme = getTheme(state.project.themeId);
  const wrap = el('div', {}, el('h3', {}, 'Text 글자'));
  const mkField = (label, key) => {
    const inp = el('input', { type: 'text', value: t[key] || '' });
    inp.oninput = () => { t[key] = inp.value; needsDraw = true; };
    return el('div', { class: 'field' }, el('label', {}, label), inp);
  };
  wrap.append(mkField('Title', 'title'), mkField('Subtitle', 'subtitle'));

  const showT = el('button', { class: 'toggle' + (t.show !== false ? ' on' : '') });
  showT.onclick = () => { t.show = !t.show; showT.classList.toggle('on', t.show); needsDraw = true; };
  const showD = el('button', { class: 'toggle' + (t.showDate !== false ? ' on' : '') });
  showD.onclick = () => { t.showDate = !t.showDate; showD.classList.toggle('on', t.showDate); needsDraw = true; };
  wrap.append(
    el('div', { class: 'toggle-row' }, 'Show text', showT),
    el('div', { class: 'toggle-row' }, 'Show date', showD),
  );

  const dfRow = el('div', { class: 'opt-grid' },
    DATE_FORMATS.map(f => el('button', {
      class: 'opt-chip' + ((t.dateFormat || 'dmy') === f.id ? ' on' : ''),
      onclick: e => { t.dateFormat = f.id; dfRow.querySelectorAll('.opt-chip').forEach(x => x.classList.remove('on')); e.target.classList.add('on'); needsDraw = true; },
    }, f.label)));
  wrap.append(el('div', { class: 'field' }, el('label', {}, 'Date format'), dfRow));

  const fontRow = el('div', { class: 'opt-grid' },
    FONT_FAMILIES.map(f => el('button', {
      class: 'opt-chip' + ((t.font || theme.font) === f.id ? ' on' : ''),
      onclick: e => { t.font = f.id; fontRow.querySelectorAll('.opt-chip').forEach(x => x.classList.remove('on')); e.target.classList.add('on'); ensureFonts(t, theme); needsDraw = true; },
    }, f.label)));
  wrap.append(el('div', { class: 'field' }, el('label', {}, 'Font'), fontRow));

  const colors = ['auto', '#4a4a4a', '#FF8FB1', '#E35A8B', '#4A7FB5', '#7A5FA8', '#C96F4A', '#5F7A4E', '#FFFFFF', '#141414'];
  const swRow = el('div', { class: 'swatches' },
    colors.map(col => {
      const s = el('button', {
        class: 'swatch' + ((t.color || 'auto') === col ? ' on' : ''),
        style: `background:${col === 'auto' ? 'linear-gradient(135deg,#FF8FB1,#A8D8FF,#FFE89A)' : col}`,
        title: col,
      });
      s.onclick = () => { t.color = col; swRow.querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); s.classList.add('on'); needsDraw = true; };
      return s;
    }));
  wrap.append(el('div', { class: 'field' }, el('label', {}, 'Text color'), swRow));
  openSheet(wrap);
}

function openStickerSheet() {
  const grid = el('div', { class: 'sticker-grid' });
  const addSticker = (kind, value) => {
    state.project.stickers.push({ kind, value, x: 0.5, y: 0.5, s: 0.12, r: 0 });
    needsDraw = true; closeSheet();
    toast('Drag it on the preview 💖');
  };
  for (const ch of EMOJI_STICKERS)
    grid.append(el('button', { class: 'sticker-btn', onclick: () => addSticker('emoji', ch) }, ch));
  for (const k of ART_STICKERS) {
    const b = el('button', { class: 'sticker-btn', onclick: () => addSticker('art', k) });
    const c = el('canvas'); c.width = c.height = 72;
    const x = c.getContext('2d'); x.translate(36, 36); STICKER_ART[k](x, 60);
    b.append(c); grid.append(b);
  }
  const delRow = el('div', { class: 'btn-row' },
    el('button', {
      class: 'pill secondary small', onclick: () => {
        state.project.stickers.pop(); needsDraw = true;
      }
    }, '↩︎ Remove last sticker'),
    el('button', {
      class: 'pill secondary small', onclick: () => {
        state.project.stickers = []; needsDraw = true; closeSheet(); toast('Stickers cleared');
      }
    }, '✕ Clear stickers'));
  openSheet(el('div', {}, el('h3', {}, 'Stickers 스티커'), grid,
    el('div', { class: 'hint' }, 'Tip: drag to move · pinch to resize/rotate · tap ✕ below to remove the last one.'), delRow));
}

// ---- Adjust sheet ----
function openAdjust(i) {
  const layout = getLayout(state.project.layoutId);
  const rect = layout.cells[Math.min(i, layout.cells.length - 1)];
  const cell = state.project.cells[i] || (state.project.cells[i] = emptyCell());
  if (!cell.media) {
    const file = el('input', { type: 'file', accept: 'image/*,video/*', style: 'display:none' });
    file.onchange = async () => {
      if (!file.files[0]) return;
      const media = await fileToMedia(file.files[0]);
      if (media.type === 'video') {
        window.dispatchEvent(new CustomEvent('booth:trim', { detail: { media, cellIndex: i } }));
        return;
      }
      cell.media = media; needsDraw = true; openAdjust(i);
    };
    openSheet(el('div', {}, el('h3', {}, `Photo ${i + 1}`),
      el('button', { class: 'pill', onclick: () => file.click() }, '＋ Pick a photo or video'), file));
    return;
  }
  const m = cell.media;
  const cvs = el('canvas', { id: 'adjust-canvas' });
  const ratio = Math.min(1, rect.h / rect.w);
  cvs.width = 480; cvs.height = Math.round(480 * rect.h / rect.w);
  const drawAdj = () => {
    const proj = { ...state.project, stickers: [], text: { ...state.project.text, show: false } };
    // render only this cell into the canvas
    const x = cvs.getContext('2d');
    const theme = getTheme(state.project.themeId);
    x.clearRect(0, 0, cvs.width, cvs.height);
    theme.bg(x, cvs.width, cvs.height);
    const sc = cvs.width / rect.w;
    x.save(); x.translate(-rect.x * sc, -rect.y * sc);
    const fakeLayout = { ...layout, cells: [rect], text: [] };
    const fakeProj = { ...proj, layoutId: state.project.layoutId, cells: [cell] };
    // draw via the shared cell math by rendering the whole layout then cropping:
    x.restore();
    const tmp = document.createElement('canvas');
    const s = layoutSize(layout);
    const f = 0.4;
    tmp.width = s.w * f; tmp.height = s.h * f;
    render(tmp.getContext('2d'), { ...state.project, stickers: [], text: { ...state.project.text, show: false } }, { scale: f });
    x.drawImage(tmp, rect.x * f, rect.y * f, rect.w * f, rect.h * f, 0, 0, cvs.width, cvs.height);
  };
  drawAdj();

  const wrap = el('div', {}, el('h3', {}, `Adjust photo ${i + 1} 보정`), cvs);
  // gestures on adjust canvas
  let last = null;
  cvs.addEventListener('pointerdown', e => { cvs.setPointerCapture(e.pointerId); last = e; });
  cvs.addEventListener('pointermove', e => {
    if (!last) return;
    const sc = cvs.width / rect.w;
    cell.ox += (e.clientX - last.clientX) / (rect.w * sc);
    cell.oy += (e.clientY - last.clientY) / (rect.h * sc);
    last = e;
    clampCell(cell, rect, m); needsDraw = true; drawAdj();
  });
  cvs.addEventListener('pointerup', () => last = null);
  cvs.addEventListener('wheel', e => {
    e.preventDefault();
    cell.scale = Math.max(0.3, Math.min(4, cell.scale * (e.deltaY < 0 ? 1.08 : 0.93)));
    clampCell(cell, rect, m); needsDraw = true; drawAdj();
  }, { passive: false });

  const zl = el('input', { type: 'range', min: 30, max: 400, value: Math.round(cell.scale * 100) });
  zl.oninput = () => { cell.scale = zl.value / 100; clampCell(cell, rect, m); needsDraw = true; drawAdj(); };
  wrap.append(el('div', { class: 'field' }, el('label', {}, `Zoom ${(cell.scale).toFixed(2)}×`), zl));
  zl.addEventListener('input', () => zl.previousElementSibling ? null : 0);

  const file = el('input', { type: 'file', accept: 'image/*,video/*', style: 'display:none' });
  file.onchange = async () => {
    if (!file.files[0]) return;
    const media = await fileToMedia(file.files[0]);
    if (media.type === 'video') { window.dispatchEvent(new CustomEvent('booth:trim', { detail: { media, cellIndex: i } })); return; }
    cell.media = media; cell.scale = 1; cell.ox = cell.oy = 0; cell.rot = 0; cell.flip = false;
    needsDraw = true; closeSheet(); openAdjust(i);
  };
  const row = el('div', { class: 'btn-row' },
    el('button', { class: 'pill secondary small', onclick: () => { cell.rot += Math.PI / 2; needsDraw = true; drawAdj(); } }, '↻ Rotate 90°'),
    el('button', { class: 'pill secondary small', onclick: () => { cell.flip = !cell.flip; needsDraw = true; drawAdj(); } }, '⇋ Flip'),
    el('button', { class: 'pill secondary small', onclick: () => { Object.assign(cell, emptyCell(), { media: m }); needsDraw = true; drawAdj(); } }, '⟲ Reset'),
    el('button', { class: 'pill secondary small', onclick: () => file.click() }, '＋ Replace'),
    el('button', {
      class: 'pill secondary small', onclick: () => {
        state.project.cells[i] = emptyCell(); needsDraw = true; closeSheet(); toast('Cleared cell');
      }
    }, '✕ Clear'));
  if (m.type === 'video')
    row.append(el('button', {
      class: 'pill small', onclick: () => {
        window.dispatchEvent(new CustomEvent('booth:trim', { detail: { media: m, cellIndex: i } }));
      }
    }, '✂️ Trim'));
  wrap.append(row, file);
  openSheet(wrap);
}
openAdjustFn = openAdjust;
export { openAdjust };

// ---- Save ----
async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    const k = Math.min(1, 300 / bmp.width);
    c.width = bmp.width * k; c.height = bmp.height * k;
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
  } catch (e) { return null; }
}

export async function exportPNG(project, quality, printSheet) {
  const layout = getLayout(project.layoutId);
  const theme = getTheme(project.themeId);
  await ensureFonts(project, theme);
  // warm media
  for (const cell of project.cells) {
    if (cell && cell.media) {
      const src = project.getMediaSource(cell.media, cell.media.start || 0);
      if (cell.media.type === 'video' && src && src.seekVideo !== false) await seekVideo(src, cell.media.start || 0);
      if (cell.media.type === 'image') await new Promise(r => { const t = setTimeout(r, 1500); if (src && src.complete) return r(); if (src) src.onload = () => { clearTimeout(t); r(); }; });
    }
  }
  let canvas = document.createElement('canvas'), ctx, w, h;
  if (printSheet) {
    const ps = printSheetSize(quality);
    w = ps.w; h = ps.h; canvas.width = w; canvas.height = h; ctx = canvas.getContext('2d');
    const strip = layoutSize(layout);
    const sc = (h / strip.h) * 0.5 / ps.scale; // each strip rendered at du scale
    const duScale = (h / ps.scale) / strip.h / 2; // wait — compute below
    // two strips side by side: each half of sheet
    const halfW = w / 2;
    ctx.save(); ctx.scale(ps.scale, ps.scale);
    theme.bg(ctx, w / ps.scale, h / ps.scale);
    ctx.restore();
    const inner = document.createElement('canvas');
    const innerScale = (h / 2 / strip.h) * ps.scale / ps.scale; // pixels per du for half sheet
    const scaleDu = (h / ps.scale) / strip.h / 1; // strip occupies full height? keep margin
    const stripScale = (h / strip.h) / ps.scale * 0.94; // 94% height, centered
    // simpler: render strip at scale s such that strip fits half: s = min(halfW/strip.w, h/strip.h) in px / du
    const sPx = Math.min(halfW / strip.w, h / strip.h);
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = Math.round(strip.w * sPx); stripCanvas.height = Math.round(strip.h * sPx);
    render(stripCanvas.getContext('2d'), project, { scale: sPx });
    for (const sx of [0, halfW]) {
      ctx.drawImage(stripCanvas, sx + (halfW - stripCanvas.width) / 2, (h - stripCanvas.height) / 2);
    }
  } else {
    const es = exportSize(layout, quality);
    w = es.w; h = es.h;
    if (w * h > 16_700_000) { const k = Math.sqrt(16_700_000 / (w * h)); w = Math.floor(w * k / 2) * 2; h = Math.floor(h * k / 2) * 2; }
    canvas.width = w; canvas.height = h; ctx = canvas.getContext('2d');
    render(ctx, project, { scale: w / layoutSize(layout).w });
  }
  return { canvas, w, h, blob: await new Promise(r => canvas.toBlob(r, 'image/png')) };
}

async function deliver(blob, name, kind) {
  const mime = blob.type;
  const file = new File([blob], name, { type: mime });
  // 1) native bridge
  if (hasSaveToPhotos()) {
    try {
      const b64 = b64encode(await blob.arrayBuffer());
      await saveToPhotos({ kind, mime, name, b64 });
      toast('저장! Saved to Photos 💾'); haptic('success');
      return 'bridge';
    } catch (e) { toast('Photos save failed: ' + e); }
  }
  // 2) share sheet
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      toast('공유! Shared ✨');
      return 'share';
    }
  } catch (e) { if (e.name === 'AbortError') return 'abort'; }
  // 3) download
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast('다운로드! Downloaded 💾');
  return 'download';
}

function openSaveSheet() {
  const layout = getLayout(state.project.layoutId);
  const is2x6 = layout.size === '2x6';
  const hasVideo = state.project.cells.some(c => c && c.media && c.media.type === 'video');
  let quality = 'hd', print = false;

  const pvw = el('canvas'); const s = layoutSize(layout);
  pvw.width = Math.round(s.w * 0.14); pvw.height = Math.round(s.h * 0.14);
  pvw.style.maxWidth = '160px'; pvw.style.display = 'block'; pvw.style.margin = '0 auto 10px';
  render(pvw.getContext('2d'), state.project, { scale: 0.14 });

  const qRow = el('div', { class: 'opt-grid' },
    ...[['std', 'Standard 300dpi'], ['hd', 'HD 600dpi']].map(([q, lbl]) =>
      el('button', {
        class: 'opt-chip' + (q === quality ? ' on' : ''),
        onclick: e => { quality = q; qRow.querySelectorAll('.opt-chip').forEach(x => x.classList.remove('on')); e.target.classList.add('on'); },
      }, lbl)));

  const prT = el('button', { class: 'toggle' });
  prT.onclick = () => { print = !print; prT.classList.toggle('on', print); };

  const prog = el('div', { class: 'progress-wrap hidden' },
    el('div', { class: 'progress-bar' }), el('div', { class: 'progress-label' }, '🐰 making magic…'));
  const bar = prog.querySelector('.progress-bar');
  const setP = f => { prog.classList.remove('hidden'); bar.style.width = `${Math.round(f * 100)}%`; };

  const saveBtn = el('button', { class: 'pill', style: 'width:100%' }, '💾 Save to Photos');
  const shareBtn = el('button', { class: 'pill secondary', style: 'width:100%;margin-top:8px' }, '📤 Share');
  const liveBtn = hasVideo ? el('button', { class: 'pill lilac', style: 'width:100%;margin-top:8px' }, '🎬 Save Live strip (video)') : null;

  async function savePNG(viaShare) {
    saveBtn.disabled = shareBtn.disabled = true;
    try {
      const { blob, w, h } = await exportPNG(state.project, quality, print);
      const name = `dalkom-booth-${fileStamp()}.png`;
      await albumAdd({ type: 'image', blob, thumb: await makeThumb(blob), layout: state.project.layoutId, name });
      if (viaShare) await deliver(blob, name, 'image');
      else await deliver(blob, name, 'image');
      toast(`예쁘다 ✨ ${w}×${h}`);
    } catch (e) { toast('Export failed: ' + e.message); }
    saveBtn.disabled = shareBtn.disabled = false;
  }
  saveBtn.onclick = () => savePNG(false);
  shareBtn.onclick = () => savePNG(true);
  if (liveBtn) liveBtn.onclick = async () => {
    liveBtn.disabled = true;
    try {
      const { blob, ext } = await exportLive(state.project, setP);
      setP(1);
      const name = `dalkom-booth-${fileStamp()}.${ext}`;
      await albumAdd({ type: 'video', blob, thumb: await makeThumb(pvwToBlob()), layout: state.project.layoutId, name });
      await deliver(blob, name, 'video');
      toast('Live strip saved! 🎬');
    } catch (e) { toast('Video export failed: ' + e.message); }
    liveBtn.disabled = false;
  };
  const pvwToBlob = () => new Promise(r => pvw.toBlob(r, 'image/png'));

  const kids = [
    el('h3', {}, 'Save 저장'), pvw,
    el('div', { class: 'field' }, el('label', {}, 'PNG quality'), qRow),
  ];
  if (is2x6) kids.push(el('div', { class: 'toggle-row' }, 'Print sheet 4x6 (2 strips)', prT));
  kids.push(saveBtn, shareBtn);
  if (liveBtn) kids.push(liveBtn);
  kids.push(prog);
  openSheet(el('div', {}, ...kids));
}
export { openSaveSheet, deliver };
