// Dalkom Booth — SPA. Flow: theme → size → source → (booth|trim|gallery) → editor → album.
import { state, el, toast, newProject, emptyCell, closeSheet, clearToasts } from './state.js';
import { LAYOUTS, SIZES, getLayout, layoutSize } from './layouts.js';
import { THEMES, THEME_CATEGORIES, getTheme } from './themes.js';
import { render, ensureFonts } from './render.js';
import { attachRuntime, fileToMedia } from './media.js';
import { renderBooth } from './booth.js';
import { renderTrim } from './trim.js';
import { renderEditor, fillCells, openSaveSheet, openAdjust, dirty } from './editor.js';
import { albumList, albumDelete } from './album.js';
import { isShell, shellVersion, hasPickLive, pickLive, haptic } from './bridge.js';

const SCREENS = ['theme', 'size', 'source', 'booth', 'pick', 'trim', 'editor', 'album'];
const $ = id => document.getElementById(id);
let boothCtl = null;
const navStack = [];

// inline SVG line icons (24px, 2px stroke, round caps)
const I = (paths) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
export const ICONS = {
  camera: I('<rect x="3" y="7" width="18" height="14" rx="3"/><circle cx="12" cy="14" r="3.5"/><path d="M8 7l1.2-2.4h5.6L16 7"/>'),
  upload: I('<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>'),
  film: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
  album: I('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/>'),
  save: I('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
};

function go(screen, push = true) {
  if (boothCtl && screen !== 'booth') { boothCtl.stopCam && boothCtl.stopCam(); boothCtl = null; }
  closeSheet();
  clearToasts();
  hideCTA();
  const transient = ['trim', 'pick', 'booth'];
  if (push && state.screen !== screen && !transient.includes(state.screen) && !transient.includes(screen)) navStack.push(state.screen);
  state.screen = screen;
  for (const s of SCREENS) $('scr-' + s).classList.toggle('on', s === screen);
  $('btn-back').classList.toggle('hidden', screen === 'theme');
  $('btn-save-top').classList.toggle('hidden', screen !== 'editor');
  $('btn-album').classList.toggle('hidden', screen === 'album');
  $('app-title').textContent = screen === 'editor' ? '편집 Edit' : '달콤부스';
  updateSteps();
  renderScreen(screen);
}
function goBack() { go(navStack.pop() || 'theme', false); }

$('btn-back').onclick = goBack;
$('btn-save-top').onclick = () => openSaveSheet();
$('btn-album').onclick = () => go('album');

const STEP_ORDER = ['theme', 'size', 'source'];
function updateSteps() {
  const steps = $('steps');
  const i = STEP_ORDER.indexOf(state.screen);
  steps.classList.toggle('hidden', i < 0);
  if (i < 0) return;
  steps.querySelectorAll('.step').forEach((b, k) => {
    b.classList.toggle('done', k < i);
    b.classList.toggle('on', k === i);
  });
}
$('steps').addEventListener('click', e => {
  const b = e.target.closest('.step');
  if (b && b.classList.contains('done')) go(b.dataset.s, false);
});

function renderScreen(s) {
  ({
    theme: renderTheme, size: renderSize, source: renderSource,
    pick: renderPick, album: renderAlbum,
    editor: () => renderEditor($('scr-editor')),
  }[s] || (() => {}))();
}

function showCTA(label, fn, disabled = false) {
  const root = $('cta-root');
  root.innerHTML = '';
  root.append(el('button', { class: 'pill cta', onclick: fn, ...(disabled ? { disabled: true } : {}) }, label));
}
function hideCTA() { $('cta-root').innerHTML = ''; }

async function checkUpdate() {
  if (!isShell()) return;
  try {
    const r = await fetch('app/source.json');
    const src = await r.json();
    const latest = src.apps && src.apps[0] && src.apps[0].version;
    const mine = shellVersion();
    if (latest && mine && latest !== mine) {
      $('scr-theme').prepend(el('div', {
        class: 'update-banner',
        onclick: () => location.href = 'app/',
      }, `⬆ Update available (${latest}) — tap to install`));
    }
  } catch (e) {}
}

// ---------- Theme screen ----------
function miniProject(over = {}) {
  return attachRuntime({
    layoutId: 'A',
    themeId: state.project?.themeId || 'plain-white',
    beauty: 0,
    filter: { id: 'original', intensity: 100 },
    text: { title: 'our cute day ♡', subtitle: 'Our Special Day', date: new Date().toISOString(), dateFormat: 'ymd', font: null, color: 'auto', show: true, showDate: true },
    cells: [], stickers: [], ...over,
  });
}
function renderCard(canvas, layoutId, themeId) {
  const s = layoutSize(getLayout(layoutId));
  const proj = miniProject({ layoutId, themeId });
  const sc = canvas.width / s.w;
  ensureFonts(proj, getTheme(themeId)).then(() =>
    render(canvas.getContext('2d'), proj, { scale: sc }));
  render(canvas.getContext('2d'), proj, { scale: sc });
}

function renderTheme() {
  const root = $('scr-theme');
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'Choose a theme ', el('span', { class: 'en' }, '테마')));
  const tabs = el('div', { class: 'tabs seg' });
  const grid = el('div', { class: 'theme-card-grid' });
  const fill = () => {
    grid.innerHTML = '';
    for (const t of THEMES.filter(t => t.category === state.themeTab)) {
      const card = el('div', { class: 'theme-card' + (state.project?.themeId === t.id ? ' on' : '') });
      const c = el('canvas');
      const s = layoutSize(getLayout('A'));
      c.width = Math.round(s.w * 0.28); c.height = Math.round(s.h * 0.28);
      card.append(c, el('div', { class: 'lname' }, t.name));
      card.onclick = () => {
        if (state.project) state.project.themeId = t.id;
        else state.selTheme = t.id;
        state.selTheme = t.id;
        grid.querySelectorAll('.theme-card').forEach(x => x.classList.remove('on'));
        card.classList.add('on');
        showCTA('Next →', () => go('size'));
      };
      grid.append(card);
      renderCard(c, 'A', t.id);
    }
  };
  for (const cat of THEME_CATEGORIES) {
    const b = el('button', { class: 'tab' + (state.themeTab === cat.id ? ' on' : '') }, cat.label);
    b.onclick = () => { state.themeTab = cat.id; tabs.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b)); fill(); };
    tabs.append(b);
  }
  root.append(tabs, grid);
  fill();
  if (!state.project) state.project = newProject('D', 'plain-white');
  if (state.selTheme) state.project.themeId = state.selTheme;
  else if (state.project.themeId) state.selTheme = state.project.themeId;
  // mark current
  setTimeout(() => {
    grid.querySelectorAll('.theme-card').forEach((c, i) => {
      c.classList.toggle('on', THEMES.filter(t => t.category === state.themeTab)[i].id === state.project.themeId);
    });
  });
  showCTA('Next →', () => go('size'));
  checkUpdate();
}

// ---------- Size screen ----------
const SIZE_ORDER = [['2x6', '2×6 Strip'], ['6x2', '6×2 Wide'], ['4x6L', '4×6 Land.'], ['4x6P', '4×6 Port.']];
function renderSize() {
  const root = $('scr-size');
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'Pick a size ', el('span', { class: 'en' }, '크기')));
  const chips = el('div', { class: 'size-chips' });
  for (const [id, label] of SIZE_ORDER) {
    const s = SIZES[id];
    const ar = s.w / s.h;
    const iw = ar >= 1 ? 30 : Math.round(30 * ar), ih = ar >= 1 ? Math.round(30 / ar) : 30;
    chips.append(el('button', {
      class: 'size-chip' + (state.sizeId === id ? ' on' : ''),
      onclick: (e) => { state.sizeId = id; chips.querySelectorAll('.size-chip').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); fill(); },
    }, el('span', { class: 'ar-box', style: `width:${iw}px;height:${ih}px` }), el('span', {}, label)));
  }
  const grid = el('div', { class: 'layout-grid' });
  const fill = () => {
    grid.innerHTML = '';
    for (const l of LAYOUTS.filter(l => l.size === state.sizeId)) {
      const card = el('div', { class: 'layout-card' + (state.project.layoutId === l.id ? ' on' : '') });
      const c = el('canvas');
      const s = layoutSize(l);
      c.width = Math.round(s.w * 0.22); c.height = Math.round(s.h * 0.22);
      card.append(c, el('div', { class: 'lname' }, `${l.id} · ${l.name}`), el('div', { class: 'lmeta' }, `${l.cells.length} cuts`));
      card.onclick = () => {
        state.project.layoutId = l.id;
        while (state.project.cells.length < l.cells.length) state.project.cells.push(emptyCell());
        grid.querySelectorAll('.layout-card').forEach(x => x.classList.remove('on'));
        card.classList.add('on');
        showCTA('Next →', () => go('source'));
      };
      grid.append(card);
      renderCard(c, l.id, state.project.themeId);
    }
  };
  root.append(chips, grid);
  fill();
  showCTA('Next →', () => go('source'));
}

// ---------- Source ----------
function renderSource() {
  const root = $('scr-source');
  root.innerHTML = '';
  const layout = getLayout(state.project.layoutId);
  const theme = getTheme(state.project.themeId);

  const sum = el('div', { class: 'source-summary' });
  const mini = el('canvas'); const s = layoutSize(layout);
  mini.width = Math.round(s.w * 0.12); mini.height = Math.round(s.h * 0.12);
  renderCard(mini, layout.id, theme.id);
  mini.style.width = '56px';
  sum.append(mini, el('div', { class: 'sum-txt' },
    el('b', {}, `${theme.name} · ${layout.id} ${layout.name}`),
    el('span', { class: 'en' }, `${layout.cells.length} cuts · ${SIZES[layout.size].label}`)),
    el('button', { class: 'opt-chip', onclick: () => go('theme', false) }, 'Change'));
  root.append(el('h2', { class: 'screen-title' }, 'Add photos ', el('span', { class: 'en' }, '사진')) , sum);

  const gInput = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: 'display:none' });
  const vInput = el('input', { type: 'file', accept: 'video/*', multiple: true, style: 'display:none' });
  gInput.onchange = () => galleryFiles(gInput.files);
  vInput.onchange = () => galleryFiles(vInput.files, true);

  const card = (icon, title, hint, fn, id) => el('button', { class: 'src-card', onclick: fn, ...(id ? { 'data-id': id } : {}) },
    el('span', { class: 'src-icon', html: icon }), el('span', { class: 'src-txt' }, el('b', {}, title), el('span', { class: 'en' }, hint)));

  const wrap = el('div', { class: 'source-buttons' },
    card(ICONS.camera, 'Take photos 찰칵', 'Booth camera · countdown', () => go('booth'), 'booth'),
    card(ICONS.upload, 'Upload photos', 'From your gallery', () => gInput.click(), 'gallery'),
    card(ICONS.film, 'Video / Live Photo', 'Trim to a 3s clip', () => vInput.click(), 'video'));
  if (isShell() && hasPickLive()) {
    wrap.append(card(ICONS.film, 'Live Photo (iOS)', 'via iPhone Photos', async () => {
      const items = await pickLive(layout.cells.length).catch(e => { toast('pickLive: ' + e); return []; });
      state.trimQueue = state.trimQueue || [];
      for (const it of items) {
        const bin = atob(it.b64); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: it.mime });
        blob.name = it.name && it.name.includes('.') ? it.name
          : (it.name || 'live') + ({ 'video/quicktime': '.mov', 'video/mp4': '.mp4' }[it.mime] || '.mp4');
        state.trimQueue.push(await fileToMedia(blob));
      }
      if (state.trimQueue.length) nextTrim();
    }, 'livephoto'));
  } else {
    wrap.append(el('div', { class: 'hint' }, 'Live Photo: in Photos tap Share → Save as Video, then pick it here'));
  }
  if (layout.cells.some((_, i) => state.project.cells[i] && state.project.cells[i].media))
    wrap.append(el('button', { class: 'pill secondary', onclick: () => go('editor') }, 'Go to editor →'));
  root.append(wrap, gInput, vInput);
}

function galleryFiles(files) {
  const list = [...files];
  state.trimQueue = [];
  const stills = [];
  (async () => {
    for (const f of list) {
      const media = await fileToMedia(f).catch(() => null);
      if (!media) { toast('Skipped ' + f.name); continue; }
      if (media.type === 'video') state.trimQueue.push(media);
      else stills.push(media);
    }
    const layout = getLayout(state.project.layoutId);
    for (const m of stills) {
      let idx = state.project.cells.findIndex((c, i) => i < layout.cells.length && (!c || !c.media));
      if (idx < 0) idx = state.project.cells.length;
      const cell = state.project.cells[idx] || (state.project.cells[idx] = emptyCell());
      cell.media = m;
    }
    if (state.trimQueue.length) nextTrim();
    else go('editor');
  })();
}

function nextTrim() {
  const media = state.trimQueue.shift();
  if (!media) { go('editor'); return; }
  state.trimCellIndex = null;
  state.trimMedia = media;
  state.trimAfter = () => nextTrim();
  go('trim');
}

window.addEventListener('booth:trim', e => {
  const { media, cellIndex, autoFill } = e.detail;
  if (autoFill) {
    const layout = getLayout(state.project.layoutId);
    let idx = state.project.cells.findIndex((c, i) => i < layout.cells.length && (!c || !c.media));
    if (idx < 0) idx = layout.cells.length - 1;
    state.trimCellIndex = idx;
  } else state.trimCellIndex = cellIndex;
  state.trimMedia = media;
  state.trimAfter = () => go('editor');
  go('trim');
});

// ---------- Pick ----------
function renderPick() {
  const root = $('scr-pick');
  root.innerHTML = '';
  const layout = getLayout(state.project.layoutId);
  const n = layout.cells.length;
  root.append(el('h2', { class: 'screen-title' }, `Pick ${n} shots `, el('span', { class: 'en' }, 'tap in order')));
  const chosen = [];
  const grid = el('div', { class: 'pick-grid' });
  const done = el('button', { class: 'pill cta-inline', disabled: true }, `Use ${n} photos →`);
  state.booth.shots.forEach((m, si) => {
    const it = el('div', { class: 'pick-item' });
    if (m.type === 'video') {
      const v = el('video', { muted: true, playsinline: true, loop: true, autoplay: true });
      v.src = URL.createObjectURL(m.blob); it.append(v);
    } else {
      const img = el('img'); img.src = URL.createObjectURL(m.blob); it.append(img);
    }
    const badge = el('span', { class: 'badge hidden' });
    it.append(badge);
    it.onclick = () => {
      const k = chosen.indexOf(si);
      if (k >= 0) chosen.splice(k, 1);
      else if (chosen.length < n) chosen.push(si);
      state.booth.shots.forEach((_, j) => {
        const b = grid.children[j].querySelector('.badge');
        const idx = chosen.indexOf(j);
        b.classList.toggle('hidden', idx < 0);
        b.textContent = idx + 1;
        grid.children[j].classList.toggle('sel', idx >= 0);
      });
      done.disabled = chosen.length < n;
      done.textContent = `Use ${n} photos → (${chosen.length}/${n})`;
    };
    grid.append(it);
  });
  done.onclick = () => {
    chosen.forEach((si, ci) => {
      const cell = state.project.cells[ci] || (state.project.cells[ci] = emptyCell());
      cell.media = state.booth.shots[si];
    });
    go('editor');
  };
  root.append(el('div', { class: 'hint' }, `Tap ${n} shots in cell order.`), grid, done);
}

// ---------- Album ----------
async function renderAlbum() {
  const root = $('scr-album');
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'My Album ', el('span', { class: 'en' }, '저장')));
  const items = await albumList();
  if (!items.length) { root.append(el('div', { class: 'empty' }, 'No saves yet — go make something cute!')); return; }
  const grid = el('div', { class: 'album-grid' });
  for (const it of items) {
    const card = el('div', { class: 'album-item' });
    if (it.type === 'video') {
      const v = el('video', { muted: true, playsinline: true, loop: true });
      v.src = URL.createObjectURL(it.blob); card.append(v);
      v.onmouseenter = () => v.play();
    } else {
      const img = el('img'); img.src = URL.createObjectURL(it.thumb || it.blob); card.append(img);
    }
    card.append(el('div', { class: 'adate' }, new Date(it.createdAt).toLocaleString()));
    card.onclick = () => openAlbumItem(it);
    grid.append(card);
  }
  root.append(grid);
}

function openAlbumItem(it) {
  import('./state.js').then(({ openSheet }) => {
    const node = el('div', {}, el('h3', {}, it.name || 'Saved'));
    if (it.type === 'video') {
      const v = el('video', { controls: true, playsinline: true, style: 'width:100%;border-radius:14px' });
      v.src = URL.createObjectURL(it.blob); node.append(v);
    } else {
      const img = el('img', { style: 'width:100%;border-radius:14px' });
      img.src = URL.createObjectURL(it.blob); node.append(img);
    }
    const row = el('div', { class: 'btn-row' });
    row.append(
      el('button', {
        class: 'pill', onclick: async () => {
          const { deliver } = await import('./editor.js');
          await deliver(it.blob, it.name || `dalkom-booth.${it.type === 'video' ? 'mp4' : 'png'}`, it.type === 'video' ? 'video' : 'image');
        }
      }, 'Save / Share'),
      el('button', {
        class: 'pill secondary', onclick: async () => {
          await albumDelete(it.id); closeSheet(); renderAlbum(); toast('Deleted');
        }
      }, 'Delete'));
    node.append(row);
    openSheet(node);
  });
}

// ---------- Booth & trim mounts ----------
async function mountBooth() {
  boothCtl = await renderBooth($('scr-booth'), { onDone: () => go('pick'), goBack });
}
async function mountTrim() {
  await renderTrim($('scr-trim'), {
    media: state.trimMedia,
    onDone: (media) => {
      const idx = state.trimCellIndex;
      if (idx != null) {
        const cell = state.project.cells[idx] || (state.project.cells[idx] = emptyCell());
        cell.media = media;
      } else {
        const layout = getLayout(state.project.layoutId);
        let i = state.project.cells.findIndex((c, k) => k < layout.cells.length && (!c || !c.media));
        if (i < 0) i = layout.cells.length - 1;
        (state.project.cells[i] || (state.project.cells[i] = emptyCell())).media = media;
      }
      const f = state.trimAfter || (() => go('editor'));
      state.trimAfter = null; state.trimCellIndex = null;
      f();
    },
  });
}
const origGo = go;
go = function (s, push = true) {
  origGo(s, push);
  if (s === 'booth') mountBooth();
  if (s === 'trim') mountTrim();
};

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

go('theme', false);
