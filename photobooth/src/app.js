// Dalkom Booth — SPA router + home + layout picker + source + pick + album.
import { state, el, toast, newProject, emptyCell, closeSheet } from './state.js';
import { LAYOUTS, SIZES, getLayout, layoutSize } from './layouts.js';
import { getTheme } from './themes.js';
import { render } from './render.js';
import { attachRuntime, fileToMedia } from './media.js';
import { renderBooth } from './booth.js';
import { renderTrim } from './trim.js';
import { renderEditor, fillCells, openSaveSheet, openAdjust } from './editor.js';
import { albumList, albumDelete } from './album.js';
import { isShell, shellVersion, hasPickLive, pickLive, haptic } from './bridge.js';

const SCREENS = ['home', 'layout', 'source', 'booth', 'pick', 'trim', 'editor', 'album'];
const $ = id => document.getElementById(id);
let boothCtl = null, navStack = [];

function go(screen, push = true) {
  if (boothCtl && screen !== 'booth') { boothCtl.stopCam && boothCtl.stopCam(); boothCtl = null; }
  closeSheet();
  const transient = ['trim', 'pick', 'booth'];
  if (push && state.screen !== screen && !transient.includes(state.screen) && !transient.includes(screen)) navStack.push(state.screen);
  state.screen = screen;
  for (const s of SCREENS) $('scr-' + s).classList.toggle('on', s === screen);
  $('btn-back').classList.toggle('hidden', screen === 'home');
  $('btn-save-top').classList.toggle('hidden', screen !== 'editor');
  $('app-title').textContent = screen === 'home' ? '달콤부스' : '달콤부스 Dalkom Booth';
  renderScreen(screen);
}
function goBack() { go(navStack.pop() || 'home', false); }

$('btn-back').onclick = goBack;
$('btn-save-top').onclick = () => openSaveSheet();

function renderScreen(s) {
  ({
    home: renderHome, layout: renderLayoutPicker, source: renderSource,
    pick: renderPick, album: renderAlbum,
    editor: () => renderEditor($('scr-editor')),
  }[s] || (() => {}))();
}

// ---------- Home ----------
const BUNNY = `
<svg class="mascot" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="38" cy="30" rx="13" ry="30" fill="#fff" stroke="#FFD3E2" stroke-width="3" transform="rotate(-8 38 30)"/>
  <ellipse cx="82" cy="30" rx="13" ry="30" fill="#fff" stroke="#FFD3E2" stroke-width="3" transform="rotate(8 82 30)"/>
  <ellipse cx="38" cy="32" rx="6" ry="20" fill="#FFC9D8" transform="rotate(-8 38 32)"/>
  <ellipse cx="82" cy="32" rx="6" ry="20" fill="#FFC9D8" transform="rotate(8 82 32)"/>
  <circle cx="60" cy="72" r="36" fill="#fff" stroke="#FFD3E2" stroke-width="3"/>
  <circle cx="48" cy="68" r="4" fill="#5a4a52"/><circle cx="72" cy="68" r="4" fill="#5a4a52"/>
  <ellipse cx="60" cy="78" rx="5" ry="3.5" fill="#FF8FB1"/>
  <path d="M60 81.5 Q55 87 50 83 M60 81.5 Q65 87 70 83" stroke="#5a4a52" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="40" cy="80" r="6" fill="#FFD3E2" opacity=".7"/><circle cx="80" cy="80" r="6" fill="#FFD3E2" opacity=".7"/>
  <text x="60" y="113" text-anchor="middle" font-size="11" fill="#F06E96" font-family="Jua">찰칵!</text>
</svg>`;

async function checkUpdate() {
  if (!isShell()) return;
  try {
    const r = await fetch('app/source.json');
    const src = await r.json();
    const latest = src.apps && src.apps[0] && src.apps[0].version;
    const mine = shellVersion();
    if (latest && mine && latest !== mine) {
      $('scr-home').prepend(el('div', {
        class: 'update-banner',
        onclick: () => location.href = 'app/',
      }, `⬆ Update available (${latest}) — tap to install`));
    }
  } catch (e) {}
}

function renderHome() {
  const root = $('scr-home');
  root.innerHTML = '';
  root.append(
    el('div', { html: BUNNY }),
    el('h2', { class: 'screen-title', style: 'text-align:center' }, 'Dalkom Booth ', el('span', { class: 'en' }, 'cute photo booth')),
    el('div', { class: 'home-tag' }, '인생네컷 at home ♡ snap · frame · save'),
    el('div', { class: 'home-buttons' },
      el('button', { class: 'pill', onclick: () => startFlow('camera') }, '📸 찰칵! Booth (camera)'),
      el('button', { class: 'pill blue', onclick: () => startFlow('gallery') }, '🖼️ Gallery photos'),
      el('button', { class: 'pill lilac', onclick: () => startFlow('video') }, '🎬 Video / Live Photo'),
      el('button', { class: 'pill secondary', onclick: () => go('album') }, '💝 My Album')),
  );
  checkUpdate();
}

// ---------- Layout picker ----------
function startFlow(source) {
  state.flowSource = source;
  if (!state.project) state.project = newProject('D');
  go('layout');
}

function renderLayoutPicker() {
  const root = $('scr-layout');
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'Pick a layout ', el('span', { class: 'en' }, '레이아웃')));
  const tabs = el('div', { class: 'tabs' });
  const groups = [['2x6', '2x6 Strip'], ['6x2', '6x2 Wide'], ['4x6L', '4x6 Landscape'], ['4x6P', '4x6 Portrait']];
  const grid = el('div', { class: 'layout-grid' });
  const fill = () => {
    grid.innerHTML = '';
    for (const l of LAYOUTS.filter(l => l.size === state.layoutTab)) {
      const card = el('div', { class: 'layout-card' + (state.project.layoutId === l.id ? ' on' : '') });
      const c = el('canvas');
      const s = layoutSize(l);
      c.width = Math.round(s.w * 0.2); c.height = Math.round(s.h * 0.2);
      card.append(c, el('div', { class: 'lname' }, `${l.id} · ${l.name}`),
        el('div', { class: 'lmeta' }, `${l.cells.length} cuts`));
      card.onclick = () => {
        state.project.layoutId = l.id;
        const la = getLayout(l.id);
        while (state.project.cells.length < la.cells.length) state.project.cells.push(emptyCell());
        go('source');
      };
      grid.append(card);
      const proj = {
        ...state.project, layoutId: l.id, themeId: 'white',
        text: { ...state.project.text, show: true }, cells: [], stickers: [],
        getMediaSource: () => null,
      };
      render(c.getContext('2d'), proj, { scale: c.width / s.w });
    }
  };
  for (const [id, label] of groups) {
    const t = el('button', { class: 'tab' + (state.layoutTab === id ? ' on' : ''), onclick: () => { state.layoutTab = id; fill(); tabs.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t)); } }, label);
    tabs.append(t);
  }
  root.append(tabs, grid);
  fill();
}

// ---------- Source ----------
function renderSource() {
  const root = $('scr-source');
  root.innerHTML = '';
  const layout = getLayout(state.project.layoutId);
  root.append(el('h2', { class: 'screen-title' }, `Add photos `, el('span', { class: 'en' }, `Layout ${layout.id} · ${layout.cells.length} cells`)));

  const gInput = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, style: 'display:none' });
  const vInput = el('input', { type: 'file', accept: 'video/*', multiple: true, style: 'display:none' });
  gInput.onchange = () => galleryFiles(gInput.files);
  vInput.onchange = () => galleryFiles(vInput.files, true);

  const wrap = el('div', { class: 'source-buttons' },
    el('button', { class: 'pill', onclick: () => go('booth') }, '📸 찰칵! Booth (camera)'),
    el('button', { class: 'pill blue', onclick: () => gInput.click() }, '🖼️ Gallery photos'),
    el('button', { class: 'pill lilac', onclick: () => vInput.click() }, '🎬 Video / Live Photo'),
    el('button', {
      class: 'pill secondary', onclick: () => go('editor')
    }, '✏️ Go to editor'));
  if (isShell() && hasPickLive()) {
    const lp = el('button', {
      class: 'pill butter', onclick: async () => {
        const items = await pickLive(layout.cells.length).catch(e => { toast('pickLive: ' + e); return []; });
        for (const it of items) {
          const bin = atob(it.b64); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: it.mime });
          const media = await fileToMedia(blob);
          state.trimQueue = state.trimQueue || [];
          state.trimQueue.push(media);
        }
        if (state.trimQueue && state.trimQueue.length) nextTrim();
      }
    }, '🍎 Live Photo (iOS)');
    wrap.insertBefore(lp, wrap.lastChild);
  } else {
    wrap.append(el('div', { class: 'hint' }, '💡 Live Photo: in Photos tap Share → Save as Video, then pick it here'));
  }
  root.append(wrap, gInput, vInput);
  // Booth camera entry needs the booth screen
  renderBoothIntoScreen();
}

function galleryFiles(files, onlyVideo) {
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
    // fill cells with stills first
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
  state.trimAfter = () => nextTrim();
  state.trimMedia = media;
  go('trim');
}

// ---------- Booth + trim mount ----------
function renderBoothIntoScreen() { /* booth rendered on demand below */ }

const origRenderScreen = renderScreen;
window.addEventListener('booth:trim', e => {
  const { media, cellIndex, autoFill } = e.detail;
  state.trimQueue = state.trimQueue || [];
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

// ---------- Pick screen ----------
function renderPick() {
  const root = $('scr-pick');
  root.innerHTML = '';
  const layout = getLayout(state.project.layoutId);
  const n = layout.cells.length;
  root.append(el('h2', { class: 'screen-title' }, `Pick ${n} shots `, el('span', { class: 'en' }, 'tap in order')));
  const chosen = [];
  const grid = el('div', { class: 'pick-grid' });
  const done = el('button', { class: 'pill', style: 'margin-top:16px;width:100%', disabled: true }, `Use ${n} photos →`);
  state.booth.shots.forEach((m, si) => {
    const it = el('div', { class: 'pick-item' });
    const media = m;
    if (media.type === 'video') {
      const v = el('video', { muted: true, playsinline: true, loop: true, autoplay: true });
      v.src = URL.createObjectURL(media.blob); it.append(v);
    } else {
      const img = el('img'); img.src = URL.createObjectURL(media.blob); it.append(img);
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
  root.append(el('div', { class: 'hint' }, `Tap ${n} shots in cell order — extra shots are kept for swapping later.`),
    grid, done);
}

// ---------- Album ----------
async function renderAlbum() {
  const root = $('scr-album');
  root.innerHTML = '';
  root.append(el('h2', { class: 'screen-title' }, 'My Album ', el('span', { class: 'en' }, '저장된 사진')));
  const items = await albumList();
  if (!items.length) { root.append(el('div', { class: 'empty' }, 'No saves yet — go make something cute! 🐰')); return; }
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
      }, '💾 Save / Share'),
      el('button', {
        class: 'pill secondary', onclick: async () => {
          await albumDelete(it.id); closeSheet(); renderAlbum(); toast('Deleted');
        }
      }, '🗑 Delete'));
    node.append(row);
    openSheet(node);
  });
}

// ---------- Booth & trim screens (mounted dynamically) ----------
async function mountBooth() {
  boothCtl = await renderBooth($('scr-booth'), {
    onDone: () => go('pick'),
    goBack,
  });
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
        state.trimQueue = state.trimQueue || [];
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

// ---------- SW ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

go('home');
