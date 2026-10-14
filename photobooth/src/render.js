// Single renderer used by previews, layout cards and export.
// render(ctx, project, {scale, time, preview}) — draws in design units scaled by `scale`.
// Canvas must already be sized to size.w*scale x size.h*scale.

import { getLayout, layoutSize } from './layouts.js';
import { getTheme } from './themes.js';
import { getFilter, applyFilter } from './filters.js';

export const FONT_FAMILIES = [
  { id: 'Great Vibes', label: 'Script' },
  { id: 'Jua', label: 'Jua' },
  { id: 'Gaegu', label: 'Gaegu' },
  { id: 'Nanum Pen Script', label: 'Nanum Pen' },
  { id: 'Dongle', label: 'Dongle' },
  { id: 'Quicksand', label: 'Quicksand' },
];

export const DATE_FORMATS = [
  { id: 'dmy', label: '24.03.2026' },
  { id: 'ymd', label: '2026.03.24' },
  { id: 'mdy', label: 'Mar 24 2026' },
];

export function formatDate(d, fmt) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  if (fmt === 'ymd') return `${yyyy}.${mm}.${dd}`;
  if (fmt === 'mdy') return `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()} ${yyyy}`;
  return `${dd}.${mm}.${yyyy}`;
}

const scratch = document.createElement('canvas');

// Per-cell transform math — identical for preview and export.
function drawCellMedia(ctx, cell, rect, project, scale, time, filterEng) {
  const m = cell.media;
  const px = rect.w * scale, py = rect.h * scale;
  scratch.width = Math.max(2, Math.round(px));
  scratch.height = Math.max(2, Math.round(py));
  const s = scratch.getContext('2d');
  s.clearRect(0, 0, scratch.width, scratch.height);
  if (m) {
    const iw = m.w, ih = m.h;
    const cover = Math.max(px / iw, py / ih);
    const fit = Math.min(px / iw, py / ih);
    // cell.scale: 1 = cover, <1 interpolates toward fit (letterbox), >1 zooms in
    const k = cell.scale >= 1 ? cover * cell.scale : cover + (fit - cover) * (1 - cell.scale);
    s.save();
    s.translate(px / 2 + cell.ox * px, py / 2 + cell.oy * py);
    s.rotate(cell.rot || 0);
    if (cell.flip) s.scale(-1, 1);
    s.scale(k, k);
    const src = project.getMediaSource(m, time);
    if (src) s.drawImage(src, -iw / 2, -ih / 2);
    s.restore();
  } else {
    // placeholder cell
    s.fillStyle = 'rgba(0,0,0,.05)';
    s.fillRect(0, 0, px, py);
    s.strokeStyle = 'rgba(0,0,0,.15)'; s.lineWidth = Math.max(2, 3 * scale);
    s.setLineDash([14 * scale, 12 * scale]);
    s.strokeRect(10 * scale, 10 * scale, px - 20 * scale, py - 20 * scale);
    s.setLineDash([]);
    s.fillStyle = 'rgba(0,0,0,.28)';
    s.font = `${Math.round(py * 0.22)}px Jua, sans-serif`;
    s.textAlign = 'center'; s.textBaseline = 'middle';
    s.fillText(String((project.cells.indexOf(cell) % 9) + 1), px / 2, py / 2);
  }
  const filtered = m && filterEng
    ? filterEng(scratch, scratch.width, scratch.height)
    : scratch;
  ctx.drawImage(filtered, rect.x, rect.y, rect.w, rect.h);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function fitFont(ctx, text, family, weight, baseSize, maxW) {
  let size = baseSize;
  while (size > 10) {
    ctx.font = `${weight || ''} ${size}px "${family}", sans-serif`.trim().replace('  ', ' ');
    if (ctx.measureText(text).width <= maxW) return size;
    size *= 0.92;
  }
  ctx.font = `10px "${family}", sans-serif`;
  return 10;
}

function wrapText(ctx, text, family, weight, baseSize, maxW) {
  // returns {lines:[], size}
  let size = baseSize;
  while (size > 10) {
    ctx.font = `${weight} ${size}px "${family}", sans-serif`;
    const words = text.split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length <= 2 || size <= baseSize * 0.5) return { lines, size };
    size *= 0.9;
  }
  return { lines: [text], size: 10 };
}

function drawTextBlock(ctx, block, project, theme) {
  const t = project.text;
  if (t.show === false) return;
  const cx = block.x + block.w / 2;
  const font = t.font || theme.font || 'Great Vibes';
  const color = t.color === 'auto' || !t.color ? theme.textColor : t.color;
  const subColor = theme.subColor || color;
  const dateStr = formatDate(t.date ? new Date(t.date) : new Date(), t.dateFormat || 'dmy');
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;

  if (block.roles[0] === 'titledate') {
    // one line: title left-ish + date, centered as a row
    const h = block.h;
    const titleSize = h * 0.52, dateSize = h * 0.34;
    ctx.font = `${titleSize}px "${font}", cursive`;
    const title = t.title || 'dalkom booth';
    const tw = ctx.measureText(title).width;
    ctx.font = `500 ${dateSize}px Quicksand, sans-serif`;
    const dw = ctx.measureText(dateStr).width;
    const gap = Math.min(40, block.h * 0.35);
    const total = tw + gap + dw;
    let x = block.x + (block.w - total) / 2;
    const mid = block.y + block.h / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = `${titleSize}px "${font}", cursive`;
    ctx.fillText(title, x, mid + titleSize * 0.08);
    x += tw + gap;
    ctx.font = `500 ${dateSize}px Quicksand, sans-serif`;
    ctx.fillStyle = subColor;
    ctx.fillText(dateStr, x, mid + dateSize * 0.2);
    ctx.restore();
    return;
  }

  const items = [];
  for (const role of block.roles) {
    if (role === 'title') {
      const { lines, size } = wrapText(ctx, t.title || 'dalkom booth', font, '', Math.min(block.h * 0.5, block.w / 6), block.w);
      for (const ln of lines) items.push({ text: ln, size, family: font, color, gap: size * 0.15 });
    } else if (role === 'subtitle') {
      const size = Math.min(block.h * 0.4, 46);
      fitFont(ctx, (t.subtitle || 'Our Special Day').toUpperCase(), 'Quicksand', '600', size, block.w * 0.9);
      items.push({ text: (t.subtitle || 'Our Special Day').toUpperCase(), size, family: 'Quicksand', color: subColor, spacing: size * 0.25 });
    } else if (role === 'date') {
      if (t.showDate === false) continue;
      const size = Math.min(block.h * 0.28, 52);
      items.push({ text: dateStr, size, family: 'Quicksand', color: subColor });
    }
  }
  if (!items.length) { ctx.restore(); return; }
  const totalH = items.reduce((a, i) => a + i.size * 1.35, 0);
  let y = block.y + (block.h - totalH) / 2;
  for (const it of items) {
    const lh = it.size * 1.35;
    y += lh / 2;
    ctx.fillStyle = it.color;
    ctx.font = `600 ${it.size}px "${it.family}", ${it.family === 'Quicksand' ? 'sans-serif' : 'cursive'}`;
    if (it.spacing && ctx.letterSpacing !== undefined) ctx.letterSpacing = it.spacing + 'px';
    ctx.fillText(it.text, cx, y);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    y += lh / 2;
  }
  ctx.restore();
}

const emojiCache = new Map();
function drawEmoji(ctx, ch, x, y, size) {
  ctx.font = `${size}px "Noto Color Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
}

import { STICKER_ART } from './stickers.js';

function drawSticker(ctx, st, W, H) {
  const x = st.x * W, y = st.y * H, size = st.s * W;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(st.r || 0);
  if (st.kind === 'emoji') drawEmoji(ctx, st.value, 0, 0, size);
  else if (STICKER_ART[st.value]) STICKER_ART[st.value](ctx, size);
  ctx.restore();
}

export async function ensureFonts(project, theme) {
  const fams = [project.text.font || theme.font || 'Great Vibes', 'Jua', 'Quicksand'];
  await Promise.all(fams.map(f => document.fonts.load(`40px "${f}"`).catch(() => {})));
}

export function render(ctx, project, { scale = 1, time = 0, preview = false } = {}) {
  const layout = getLayout(project.layoutId);
  const theme = getTheme(project.themeId);
  const size = layoutSize(layout);
  const filter = getFilter(project.filter.id);
  const intensity = (project.filter.intensity ?? 100) / 100;
  const filterEng = (src, w, h) => applyFilter(src, w, h, filter, intensity);

  ctx.save();
  ctx.scale(scale, scale);
  theme.bg(ctx, size.w, size.h);

  // cells
  layout.cells.forEach((rect, i) => {
    const cell = project.cells[i] || {};
    ctx.save();
    if (theme.shadow) {
      ctx.shadowColor = theme.shadow.color;
      ctx.shadowBlur = theme.shadow.blur;
      ctx.shadowOffsetY = theme.shadow.dy;
      ctx.fillStyle = '#fff';
      roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius || 0);
      ctx.fill();
      ctx.restore(); ctx.save();
    }
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius || 0);
    ctx.clip();
    drawCellMedia(ctx, cell, rect, project, scale, time, filterEng);
    ctx.restore();
    if (theme.border) {
      ctx.save();
      ctx.strokeStyle = theme.border.color; ctx.lineWidth = theme.border.width;
      roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius || 0);
      ctx.stroke(); ctx.restore();
    }
  });

  // text
  for (const block of layout.text || []) drawTextBlock(ctx, block, project, theme);

  // decorations (under stickers)
  if (theme.decorate) theme.decorate(ctx, size.w, size.h, layout.cells);

  // stickers
  for (const st of project.stickers || []) drawSticker(ctx, st, size.w, size.h);

  ctx.restore();
}
