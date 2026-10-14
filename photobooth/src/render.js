// Single renderer used by previews, layout cards and export.
// render(ctx, project, {scale, time, preview}) — draws in design units scaled by `scale`.
// Canvas must already be sized to size.w*scale x size.h*scale.

import { getLayout, layoutSize } from './layouts.js';
import { getTheme, resolveReserve } from './themes.js';
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
    // cute placeholder cell: pastel fill + drawn camera glyph
    s.fillStyle = '#FFF0F5';
    s.fillRect(0, 0, px, py);
    const g = s.createLinearGradient(0, 0, px, py);
    g.addColorStop(0, 'rgba(255,143,177,.10)'); g.addColorStop(1, 'rgba(168,216,255,.12)');
    s.fillStyle = g; s.fillRect(0, 0, px, py);
    const gs = Math.min(px, py) * 0.42;
    s.save(); s.translate(px / 2, py / 2);
    s.fillStyle = 'rgba(240,110,150,.55)';
    // camera body
    const bw = gs, bh = gs * 0.68;
    s.beginPath(); s.roundRect ? s.roundRect(-bw / 2, -bh / 2 + gs * 0.08, bw, bh, gs * 0.16) : s.rect(-bw / 2, -bh / 2, bw, bh); s.fill();
    // top bump
    s.beginPath(); s.roundRect ? s.roundRect(-bw * 0.22, -bh / 2 - gs * 0.10, bw * 0.44, gs * 0.2, gs * 0.06) : s.rect(-bw * 0.22, -bh / 2 - gs * 0.1, bw * 0.44, gs * 0.2); s.fill();
    // lens
    s.fillStyle = '#fff';
    s.beginPath(); s.arc(0, gs * 0.08, gs * 0.2, 0, 7); s.fill();
    s.fillStyle = 'rgba(168,216,255,.9)';
    s.beginPath(); s.arc(0, gs * 0.08, gs * 0.11, 0, 7); s.fill();
    // sparkle
    s.fillStyle = 'rgba(255,232,154,.95)';
    s.beginPath();
    const sp = gs * 0.14, sx = bw * 0.34, sy = -bh * 0.3;
    s.moveTo(sx, sy - sp); s.quadraticCurveTo(sx, sy, sx + sp, sy);
    s.quadraticCurveTo(sx, sy, sx, sy + sp); s.quadraticCurveTo(sx, sy, sx - sp, sy);
    s.quadraticCurveTo(sx, sy, sx, sy - sp); s.fill();
    s.restore();
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
    ctx.font = `${weight} ${size}px "${family}", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`.trim();
    if (ctx.measureText(text).width <= maxW) return size;
    size *= 0.92;
  }
  ctx.font = `10px "${family}", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  return 10;
}

function wrapText(ctx, text, family, weight, baseSize, maxW) {
  // returns {lines:[], size}
  let size = baseSize;
  while (size > 10) {
    ctx.font = `${weight} ${size}px "${family}", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
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

  if (block.roles[0] === 'titledate' && theme.category === 'written') {
    // written themes: title is the main handwriting line, date on its own line
    const h = block.h;
    const titleSize = h * 0.5, dateSize = h * 0.3;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `${titleSize}px "${font}", "Apple SD Gothic Neo", "Noto Sans KR", cursive`;
    const title = t.title || theme.defaultTitle || 'dalkom booth';
    // shrink to fit width
    let ts = titleSize;
    while (ts > 10 && ctx.measureText(title).width > block.w * 0.94) { ts *= 0.92; ctx.font = `${ts}px "${font}", "Apple SD Gothic Neo", "Noto Sans KR", cursive`; }
    ctx.fillText(title, cx, block.y + h * 0.32);
    if (t.showDate !== false) {
      ctx.font = `500 ${dateSize}px Quicksand, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      ctx.fillStyle = subColor;
      ctx.fillText(dateStr, cx, block.y + h * 0.78);
    }
    ctx.restore();
    return;
  }
  if (block.roles[0] === 'titledate') {
    // one line: title left-ish + date, centered as a row
    const h = block.h;
    const titleSize = h * 0.52, dateSize = h * 0.34;
    ctx.font = `${titleSize}px "${font}", "Apple SD Gothic Neo", "Noto Sans KR", cursive`;
    const title = t.title || 'dalkom booth';
    const tw = ctx.measureText(title).width;
    ctx.font = `500 ${dateSize}px Quicksand, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    const dw = ctx.measureText(dateStr).width;
    const gap = Math.min(40, block.h * 0.35);
    const total = tw + gap + dw;
    let x = block.x + (block.w - total) / 2;
    const mid = block.y + block.h / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = `${titleSize}px "${font}", "Apple SD Gothic Neo", "Noto Sans KR", cursive`;
    ctx.fillText(title, x, mid + titleSize * 0.08);
    x += tw + gap;
    ctx.font = `500 ${dateSize}px Quicksand, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    ctx.fillStyle = subColor;
    ctx.fillText(dateStr, x, mid + dateSize * 0.2);
    ctx.restore();
    return;
  }

  const items = [];
  for (const role of block.roles) {
    if (role === 'title') {
      const { lines, size } = wrapText(ctx, t.title || theme.defaultTitle || 'dalkom booth', font, '', Math.min(block.h * 0.5, block.w / 6), block.w);
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
    ctx.font = `600 ${it.size}px "${it.family}", "Apple SD Gothic Neo", "Noto Sans KR", ${it.family === 'Quicksand' ? 'sans-serif' : 'cursive'}`;
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
  const fams = [project.text.font || theme.font || 'Great Vibes', 'Jua', 'Quicksand', 'Gaegu', 'Caveat'];
  await Promise.all(fams.map(f => document.fonts.load(`40px "${f}"`).catch(() => {})));
}

export function render(ctx, project, { scale = 1, time = 0, preview = false } = {}) {
  const layout = getLayout(project.layoutId);
  const theme = getTheme(project.themeId);
  const size = layoutSize(layout);
  const filter = getFilter(project.filter.id);
  const intensity = (project.filter.intensity ?? 100) / 100;
  const beauty = (project.beauty || 0) / 100;
  const filterEng = (src, w, h) => applyFilter(src, w, h, filter, intensity, beauty);

  // reserved bands: map all layout rects into the inset content box
  const res = resolveReserve(theme, size.w, size.h);
  const bw = size.w - res.l - res.r, bh = size.h - res.t - res.b;
  const mapR = (r) => ({
    x: res.l + r.x / size.w * bw, y: res.t + r.y / size.h * bh,
    w: r.w / size.w * bw, h: r.h / size.h * bh,
  });
  const cells = layout.cells.map(mapR);
  const texts = (layout.text || []).map(b => ({ ...b, ...mapR(b) }));
  const band = Math.max(res.t, res.r, res.b, res.l);
  const bands = [];
  if (res.t) bands.push({ x: 0, y: 0, w: size.w, h: res.t, dir: 'h' });
  if (res.b) bands.push({ x: 0, y: size.h - res.b, w: size.w, h: res.b, dir: 'h' });
  if (res.l) bands.push({ x: 0, y: 0, w: res.l, h: size.h, dir: 'v' });
  if (res.r) bands.push({ x: size.w - res.r, y: 0, w: res.r, h: size.h, dir: 'v' });
  const info = { reserve: res, band, bands, texts, box: { x: res.l, y: res.t, w: bw, h: bh } };

  ctx.save();
  ctx.scale(scale, scale);
  theme.bg(ctx, size.w, size.h);

  // cells
  cells.forEach((rect, i) => {
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
  for (const block of texts) drawTextBlock(ctx, block, project, theme);

  // decorations (under stickers)
  if (theme.decorate) theme.decorate(ctx, size.w, size.h, cells, info);

  // stickers
  for (const st of project.stickers || []) drawSticker(ctx, st, size.w, size.h);

  ctx.restore();
}
