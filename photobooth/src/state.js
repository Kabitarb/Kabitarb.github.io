// Shared app state + tiny DOM helpers.
import { attachRuntime } from './media.js';

export const state = {
  screen: 'theme',
  themeTab: 'plain',
  sizeId: '2x6',
  project: null,
  pendingFiles: [],
  booth: { shots: [], stream: null, countdown: 5, extra: true, live: false, mirror: true, facing: 'user', muted: false },
  trimTarget: null,   // {media, cellIndex | 'pick'}
  pickAssign: [],
  adjustCell: -1,
  swapFirst: -1,
};

export function newProject(layoutId, themeId = 'plain-white') {
  const p = attachRuntime({
    layoutId,
    themeId,
    beauty: 0,
    filter: { id: 'original', intensity: 100 },
    text: {
      title: 'our cute day ♡', subtitle: 'Our Special Day',
      date: new Date().toISOString(), dateFormat: 'ymd',
      font: null, color: 'auto', show: true, showDate: true,
    },
    cells: [],           // index-aligned to layout.cells; extra kept when switching
    stickers: [],
  });
  return p;
}

export function emptyCell() {
  return { media: null, scale: 1, ox: 0, oy: 0, rot: 0, flip: false };
}

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

let curToast = null;
export function toast(msg) {
  clearToasts();
  const root = document.getElementById('toast-root');
  const t = el('div', { class: 'toast' }, msg);
  root.append(t);
  curToast = t;
  setTimeout(() => { if (curToast === t) { t.style.opacity = 0; t.style.transition = 'opacity .3s'; setTimeout(() => { t.remove(); if (curToast === t) curToast = null; }, 320); } }, 1600);
}
export function clearToasts() {
  if (curToast) { curToast.remove(); curToast = null; }
  document.querySelectorAll('#toast-root .toast').forEach(t => t.remove());
}

let sheetEl = null, backdropEl = null;
export function openSheet(node, { onClose } = {}) {
  closeSheet();
  backdropEl = el('div', { class: 'backdrop', onclick: () => { closeSheet(); } });
  sheetEl = el('div', { class: 'sheet' }, el('div', { class: 'grab' }),
    el('button', { class: 'sheet-x', onclick: () => closeSheet(), 'aria-label': 'Close' }, '✕'), node);
  // drag-to-dismiss on the grabber
  let sy = 0;
  sheetEl.addEventListener('touchstart', e => { if (e.target.closest('.grab')) sy = e.touches[0].clientY; }, { passive: true });
  sheetEl.addEventListener('touchmove', e => {
    if (e.target.closest('.grab') && e.touches[0].clientY - sy > 60) closeSheet();
  }, { passive: true });
  sheetEl._onClose = onClose;
  document.getElementById('sheet-root').append(backdropEl, sheetEl);
}
export function closeSheet() {
  if (sheetEl) { const f = sheetEl._onClose; sheetEl.remove(); backdropEl.remove(); sheetEl = backdropEl = null; f && f(); }
}
export function sheetOpen() { return !!sheetEl; }

export function fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
