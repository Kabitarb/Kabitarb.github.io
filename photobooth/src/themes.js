// Frame themes in 4 categories: plain | cute | film | written.
// {id,name,category, bg(ctx,W,H), radius(du), border:{color,width}|null,
//  shadow, textColor, subColor, font, decorate(ctx,W,H,cells)}
// decorate() may draw over cell corners (drawn after cells, under stickers/text? no: called after text, before stickers).

const KF = '"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const ink = '#3a3236';
const HAND = `Gaegu,${KF}`;

// ---------- shared helpers ----------
function dots(ctx, W, H, color, gap, r) {
  ctx.fillStyle = color;
  for (let y = gap / 2; y < H; y += gap)
    for (let x = gap / 2; x < W; x += gap) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
}
function gingham(ctx, W, H, c1, c2, s) {
  ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = c2; ctx.globalAlpha = 0.45;
  for (let x = 0; x < W; x += s) ctx.fillRect(x, 0, s / 2, H);
  for (let y = 0; y < H; y += s) ctx.fillRect(0, y, W, s / 2);
  ctx.globalAlpha = 1;
}
function checker(ctx, W, H, c1, c2, s) {
  for (let y = 0; y < H; y += s)
    for (let x = 0; x < W; x += s) {
      ctx.fillStyle = ((x / s + y / s) % 2) ? c1 : c2;
      ctx.fillRect(x, y, s, s);
    }
}
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function stars(ctx, W, H, color, n, seed = 7) {
  const rnd = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = 4 + rnd() * 10;
    star(ctx, x, y, r);
  }
}
function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.4 : r, a = k * Math.PI / 5 - Math.PI / 2;
    ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}
function clouds(ctx, W, H, color) {
  ctx.fillStyle = color;
  const spots = [[0.12, 0.08, 90], [0.85, 0.13, 110], [0.2, 0.92, 100], [0.78, 0.88, 80], [0.5, 0.04, 70]];
  for (const [fx, fy, r] of spots) {
    const x = fx * W, y = fy * H;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, 7); ctx.arc(x - r * 0.6, y + r * 0.15, r * 0.45, 0, 7);
    ctx.arc(x + r * 0.6, y + r * 0.15, r * 0.5, 0, 7); ctx.fill();
  }
}
function petals(ctx, W, H, color) {
  const rnd = rng(11);
  ctx.fillStyle = color;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = 10 + rnd() * 16;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 6.3);
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
  }
}
function heartsFill(ctx, W, H, color, n = 14) {
  const rnd = rng(5);
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) heartPath(ctx, rnd() * W, rnd() * H, 14 + rnd() * 26, true);
}
function heartPath(ctx, x, y, r, fill) {
  ctx.save(); ctx.translate(x, y); ctx.scale(r / 30, r / 30);
  ctx.beginPath(); ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-28, -10, -10, -30, 0, -12);
  ctx.bezierCurveTo(10, -30, 28, -10, 0, 12);
  fill ? ctx.fill() : ctx.stroke();
  ctx.restore();
}
function noise(ctx, W, H, color) {
  const rnd = rng(3);
  ctx.fillStyle = color; ctx.globalAlpha = 0.5;
  for (let i = 0; i < 2200; i++) ctx.fillRect(rnd() * W, rnd() * H, 3, 3);
  ctx.globalAlpha = 1;
}
function stamp(ctx, W, H) {
  ctx.save(); ctx.translate(W - 130, 130); ctx.rotate(0.25);
  ctx.strokeStyle = 'rgba(160,80,80,.6)'; ctx.lineWidth = 5;
  ctx.strokeRect(-70, -45, 140, 90);
  ctx.fillStyle = 'rgba(160,80,80,.65)'; ctx.font = `34px ${HAND}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('달콤', 0, -12); ctx.fillText('booth', 0, 24);
  ctx.restore();
}
function bunnyEars(ctx, W, H, cells) {
  if (!cells.length) return;
  const c = cells.reduce((a, b) => (b.y < a.y ? b : a));
  const cx = c.x + c.w / 2, top = c.y;
  for (const dx of [-90, 90]) {
    ctx.save(); ctx.translate(cx + dx, top); ctx.rotate(dx < 0 ? -0.15 : 0.15);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#eee'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, -55, 34, 90, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFC9D8';
    ctx.beginPath(); ctx.ellipse(0, -45, 16, 58, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
}
function cornerLogo(ctx, W, H, color) {
  ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = 0.6;
  ctx.font = `26px Jua,${KF}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('dalkom booth ♡', W - 30, H - 18); ctx.restore();
}

// ---------- film helpers ----------
// band = reserved edge band width in du (kept clear of cells/text by the renderer)
function sprocketsAuto(ctx, W, H, color, inkColor, band) {
  // vertical strips: bands on left/right; horizontal: top/bottom
  const vert = H >= W;
  const s = band * 0.42, step = s * 1.8, rad = s * 0.24;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${Math.round(band * 0.30)}px "Courier New",monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (vert) {
    const x1 = band / 2, x2 = W - band / 2;
    for (let y = s * 0.7; y < H - s; y += step) {
      for (const x of [x1, x2]) {
        ctx.beginPath(); ctx.roundRect(x - s / 2, y, s, s * 0.66, rad); ctx.fill();
      }
    }
    ctx.fillStyle = inkColor;
    ctx.save(); ctx.translate(x1, H / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('1  ▶1A   2  ▶2A   3  ▶3A   4  ▶4A', 0, band * 0.34); ctx.restore();
    ctx.save(); ctx.translate(x2, H / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('DALKOM 400   ▶   DALKOM 400', 0, -band * 0.34); ctx.restore();
  } else {
    const y1 = band / 2, y2 = H - band / 2;
    for (let x = s * 0.7; x < W - s; x += step) {
      for (const y of [y1, y2]) {
        ctx.beginPath(); ctx.roundRect(x, y - s * 0.33, s, s * 0.66, rad); ctx.fill();
      }
    }
    ctx.fillStyle = inkColor;
    ctx.fillText('1  ▶1A   2  ▶2A   3  ▶3A   4  ▶4A   5  ▶5A', W / 2, y1 + band * 0.34);
    ctx.fillText('DALKOM 400   ▶   DALKOM 400   ▶   DALKOM 400', W / 2, y2 - band * 0.34);
  }
  ctx.restore();
}
function filmDecorate(color, ink) {
  return (ctx, W, H, cells, info) => sprocketsAuto(ctx, W, H, color, ink, info.band);
}
function cinemaDecorate(ctx, W, H, cells, info) {
  const band = Math.max(info.band, 30);
  ctx.font = `600 ${Math.round(band * 0.55)}px "Courier New",monospace`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FF3B30';
  ctx.beginPath(); ctx.arc(band * 0.62, band / 2, band * 0.2, 0, 7); ctx.fill();
  ctx.fillText('REC', band * 0.95, band / 2 + 2);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
  ctx.fillText('00:00:03:12', W - band * 0.35, band / 2 + 2);
  // corner brackets around each cell
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  const L = 60, o = -10;
  for (const c of cells) {
    const x0 = c.x + o, y0 = c.y + o, x1 = c.x + c.w - o, y1 = c.y + c.h - o;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
    ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
    ctx.stroke();
  }
}

// ---------- written (handwriting margin) helpers ----------
// margin areas around the union of rects (cells + text blocks)
function margins(W, H, rects) {
  const b = rects.reduce((a, c) => ({
    l: Math.min(a.l, c.x), t: Math.min(a.t, c.y),
    r: Math.max(a.r, c.x + c.w), b: Math.max(a.b, c.y + c.h),
  }), { l: W, t: H, r: 0, b: 0 });
  const areas = [];
  if (b.t > 50) areas.push({ x: 0, y: 0, w: W, h: b.t, dir: 'h' });
  if (H - b.b > 50) areas.push({ x: 0, y: b.b, w: W, h: H - b.b, dir: 'h' });
  if (b.l > 50) areas.push({ x: 0, y: 0, w: b.l, h: H, dir: 'v' });
  if (W - b.r > 50) areas.push({ x: b.r, y: 0, w: W - b.r, h: H, dir: 'v' });
  return areas;
}
// horizontal gaps between rows of cells (never overlaps text blocks)
function cellGaps(cells, texts) {
  const hit = (r) => texts.some(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
  const rows = [];
  for (const c of cells) {
    const row = rows.find(r => r.top < c.y + c.h && r.bottom > c.y);
    if (row) { row.top = Math.min(row.top, c.y); row.bottom = Math.max(row.bottom, c.y + c.h); }
    else rows.push({ top: c.y, bottom: c.y + c.h });
  }
  rows.sort((a, b) => a.top - b.top);
  const gaps = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const g = { x: 0, y: rows[i].bottom, w: 0, h: rows[i + 1].top - rows[i].bottom, dir: 'h' };
    if (g.h > 44 && !hit({ ...g, x: 0, w: 0 })) gaps.push(g);
  }
  return gaps;
}
// all free regions: margins + reserved bands + cell gaps
function freeAreas(W, H, cells, texts, info) {
  const areas = margins(W, H, cells.concat(texts || []));
  if (info && info.bands) for (const b of info.bands) areas.push(b);
  const w = Math.max(...cells.map(c => c.x + c.w)) - Math.min(...cells.map(c => c.x));
  for (const g of cellGaps(cells, texts || [])) areas.push({ ...g, w });
  return areas.sort((a, b) => b.w * b.h - a.w * a.h);
}
// fit-and-place: measure each item, scale to region, stack without overlap, drop if <60%
function placeTexts(ctx, regions, items) {
  for (const a of regions) {
    if (!items.length) break;
    if (a.dir === 'h') {
      let y = a.y + 8;
      for (let i = 0; i < items.length;) {
        const it = items[i];
        ctx.font = `${it.size}px ${it.font}`;
        let size = Math.min(it.size, a.h * 0.5);
        ctx.font = `${size}px ${it.font}`;
        const tw = ctx.measureText(it.text).width;
        if (tw > a.w * 0.9) size *= (a.w * 0.9) / tw;
        const lineH = Math.max(size * 1.5, it.size * 0.6 * 1.5);
        if (size < it.size * 0.6 || y + lineH > a.y + a.h) { i++; continue; }
        y += lineH / 2;
        wtext(ctx, it.text, a.x + a.w / 2, y, size, it.rot || 0, it.color || ink, it.font);
        y += lineH / 2;
        items.splice(i, 1);
      }
    } else {
      let x = a.x + a.w / 2;
      for (let i = 0; i < items.length;) {
        const it = items[i];
        let size = Math.min(it.size, a.w * 0.6);
        ctx.font = `${size}px ${it.font}`;
        const tw = ctx.measureText(it.text).width;
        if (tw > a.h * 0.85) size *= (a.h * 0.85) / tw;
        if (size < it.size * 0.6) { i++; continue; }
        ctx.save(); ctx.translate(x, a.y + a.h / 2); ctx.rotate(-Math.PI / 2 + (it.rot || 0));
        ctx.fillStyle = it.color || ink; ctx.font = `${size}px ${it.font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.text, 0, 0); ctx.restore();
        items.splice(i, 1);
        x += size * 1.8;
        if (x > a.x + a.w - size) break;
      }
    }
  }
  return items; // leftovers, unused by caller or ignored
}
// place phrases into free regions; tiny doodles may touch photo corners
function writeInMargins(ctx, W, H, cells, info, phrases, doodles, seed = 3) {
  const rnd = rng(seed);
  const areas = freeAreas(W, H, cells, info.texts || [], info);
  const j = () => (rnd() - 0.5) * 0.12;
  const items = phrases.map(t => ({ text: t, size: Math.min(W, H) * 0.065, font: HAND, rot: j() }));
  placeTexts(ctx, areas, items);
  if (doodles) {
    const rnd2 = rng(seed + 99);
    const sMax = Math.min(W, H) * 0.04;
    let di = 0;
    for (const a of areas) {
      const count = a.dir === 'h' ? 2 : 3;
      for (let k = 0; k < count && di < doodles.length; k++, di++) {
        doodles[di](a.x + a.w * (0.2 + rnd2() * 0.6), a.y + a.h * (0.15 + rnd2() * 0.7), (rnd2() - 0.5) * 0.5, sMax);
      }
    }
    // a couple may overlap cell corners
    for (let k = 0; k < 2 && di < doodles.length; k++, di++) {
      const c = cells[di % cells.length];
      doodles[di](c.x + c.w - sMax * 0.6, c.y + c.h - sMax * 0.6, (rnd2() - 0.5) * 0.5, sMax);
    }
  }
}
function wtext(ctx, txt, x, y, size, rot, color = ink, font = HAND) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color; ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, 0, 0); ctx.restore();
}
function wHeart(ctx, x, y, s, rot, color = '#E0526B') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s / 30, s / 30);
  ctx.strokeStyle = color; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-27, -9, -9, -28, 0, -11);
  ctx.bezierCurveTo(9, -28, 27, -9, 0, 12);
  ctx.stroke(); ctx.restore();
}
function wStar(ctx, x, y, s, rot, color = '#D9A52B') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k <= 5; k++) {
    const a = k * Math.PI * 4 / 5 - Math.PI / 2;
    ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * s, Math.sin(a) * s);
  }
  ctx.stroke(); ctx.restore();
}
function wSwirl(ctx, x, y, s, rot, color = ink) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 3.6; a += 0.3) {
    const r = s * a / (Math.PI * 3.6);
    ctx[a ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke(); ctx.restore();
}
function wSmiley(ctx, x, y, s, color = ink) {
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x - s * 0.35, y - s * 0.2, s * 0.09, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + s * 0.35, y - s * 0.2, s * 0.09, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0.3, Math.PI - 0.3); ctx.stroke();
}
function wArrow(ctx, x, y, s, rot, color = ink) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
  ctx.moveTo(s * 0.5, -s * 0.45); ctx.lineTo(s, 0); ctx.lineTo(s * 0.5, s * 0.45);
  ctx.stroke(); ctx.restore();
}
const T = (o) => o;
const todayYear = new Date().getFullYear();
const todayShort = () => { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}`; };

// reserve: fractions of the canvas SHORT side kept clear of cells/text.
// number = all edges; {top,right,bottom,left}; or fn(W,H)->object.
export const longEdges = (f) => (W, H) => (H >= W ? { left: f, right: f } : { top: f, bottom: f });
export function resolveReserve(theme, W, H) {
  const r = theme.reserve;
  if (!r) return { t: 0, r: 0, b: 0, l: 0 };
  const s = Math.min(W, H);
  const o = typeof r === 'function' ? r(W, H)
    : typeof r === 'number' ? { top: r, right: r, bottom: r, left: r } : r;
  return { t: (o.top || 0) * s, r: (o.right || 0) * s, b: (o.bottom || 0) * s, l: (o.left || 0) * s };
}

export const THEMES = [
  // ===== PLAIN =====
  T({ id: 'plain-white', name: 'Plain White', category: 'plain', radius: 0, border: null, shadow: null,
      textColor: '#2B2B2B', subColor: '#8A8A8A', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); } }),
  T({ id: 'plain-black', name: 'Plain Black', category: 'plain', radius: 0, border: null, shadow: null,
      textColor: '#FFFFFF', subColor: '#BBBBBB', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#111111'; c.fillRect(0, 0, W, H); } }),
  T({ id: 'ivory', name: 'Ivory', category: 'plain', radius: 0, border: null, shadow: null,
      textColor: '#4a4238', subColor: '#a2988a', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#FAF6EE'; c.fillRect(0, 0, W, H); } }),
  T({ id: 'softgray', name: 'Soft Gray', category: 'plain', radius: 0, border: null, shadow: null,
      textColor: '#3a3a3a', subColor: '#7a7a7a', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#E9E9EB'; c.fillRect(0, 0, W, H); } }),
  T({ id: 'blush', name: 'Blush', category: 'plain', radius: 0, border: null, shadow: null,
      textColor: '#9a4a63', subColor: '#c78ba0', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#F8D9E0'; c.fillRect(0, 0, W, H); } }),

  // ===== CUTE =====
  T({ id: 'strawberry', name: 'Strawberry Milk', category: 'cute', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(255,120,160,.25)', blur: 14, dy: 6 },
      textColor: '#E35A8B', subColor: '#F0A0BC', font: 'Jua',
      bg: (c, W, H) => { c.fillStyle = '#FFD9E4'; c.fillRect(0, 0, W, H); dots(c, W, H, 'rgba(255,255,255,.75)', 90, 10); },
      decorate: (c, W, H) => cornerLogo(c, W, H, '#E35A8B') }),
  T({ id: 'cloud', name: 'Baby Blue Cloud', category: 'cute', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(90,140,200,.2)', blur: 14, dy: 6 },
      textColor: '#4A7FB5', subColor: '#8FB8DF', font: 'Dongle',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#A8D8FF'); g.addColorStop(1, '#DDF0FF'); c.fillStyle = g; c.fillRect(0, 0, W, H); clouds(c, W, H, 'rgba(255,255,255,.85)'); } }),
  T({ id: 'butter', name: 'Butter Gingham', category: 'cute', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(180,140,40,.18)', blur: 12, dy: 5 },
      textColor: '#8A6A1F', subColor: '#C1A45E', font: 'Gaegu',
      bg: (c, W, H) => gingham(c, W, H, '#FFF6D8', '#FFE89A', 120) }),
  T({ id: 'matcha', name: 'Matcha Latte', category: 'cute', radius: 12, border: { color: '#F6F1E4', width: 8 }, shadow: { color: 'rgba(90,110,70,.18)', blur: 12, dy: 5 },
      textColor: '#5F7A4E', subColor: '#9AAF8D', font: 'Nanum Pen Script',
      bg: (c, W, H) => { c.fillStyle = '#D8E2C8'; c.fillRect(0, 0, W, H); dots(c, W, H, 'rgba(246,241,228,.8)', 110, 8); } }),
  T({ id: 'lavender', name: 'Lavender Dream', category: 'cute', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(140,110,180,.25)', blur: 14, dy: 6 },
      textColor: '#7A5FA8', subColor: '#B49FD6', font: 'Great Vibes',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#E6DCF5'); g.addColorStop(1, '#CDB4DB'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,255,255,.8)', 40); } }),
  T({ id: 'peach', name: 'Peach Check', category: 'cute', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(220,140,90,.2)', blur: 12, dy: 5 },
      textColor: '#C96F4A', subColor: '#E8A583', font: 'Dongle',
      bg: (c, W, H) => checker(c, W, H, '#FFE5D4', '#FFD3BC', 130) }),
  T({ id: 'blossom', name: 'Cherry Blossom', category: 'cute', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(230,140,170,.25)', blur: 14, dy: 6 },
      textColor: '#D15B8A', subColor: '#EFA9C4', font: 'Nanum Pen Script',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FFE3EE'); g.addColorStop(1, '#FFC9DD'); c.fillStyle = g; c.fillRect(0, 0, W, H); petals(c, W, H, 'rgba(255,255,255,.7)'); } }),
  T({ id: 'bunny', name: 'Bunny', category: 'cute', radius: 24, border: { color: '#FFE3EE', width: 8 }, shadow: { color: 'rgba(200,150,170,.2)', blur: 12, dy: 5 },
      textColor: '#B5779A', subColor: '#D8A9C2', font: 'Jua',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); dots(c, W, H, '#FFEEF5', 100, 9); },
      decorate: (c, W, H, cells) => bunnyEars(c, W, H, cells) }),
  T({ id: 'love', name: 'Love Letter', category: 'cute', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(200,60,60,.2)', blur: 12, dy: 5 },
      textColor: '#C93A50', subColor: '#E08595', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#FFF0F0'; c.fillRect(0, 0, W, H); heartsFill(c, W, H, 'rgba(230,120,140,.35)'); } }),
  T({ id: 'rainbow', name: 'Pastel Rainbow', category: 'cute', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(150,120,160,.2)', blur: 12, dy: 5 },
      textColor: '#9A6FB8', subColor: '#C2A4D8', font: 'Jua',
      bg: (c, W, H) => {
        const cols = ['#FFD9E4', '#FFE9C9', '#FFF6C9', '#D3F2D8', '#C9E7FF', '#E0D3F5'];
        const g = c.createLinearGradient(0, 0, 0, H);
        cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col));
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      } }),
  T({ id: 'y2k', name: 'Y2K Chrome', category: 'cute', radius: 0, border: { color: '#fff', width: 6 }, shadow: { color: 'rgba(120,120,140,.3)', blur: 12, dy: 5 },
      textColor: '#555a70', subColor: '#8a90a8', font: 'Dongle',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#e8e9ee'); g.addColorStop(0.5, '#c9ccd8'); g.addColorStop(1, '#eef0f5'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,255,255,.9)', 55, 13); } }),
  T({ id: 'night', name: 'Night Sky', category: 'cute', radius: 12, border: { color: '#2a3355', width: 6 }, shadow: null,
      textColor: '#F4E9B8', subColor: '#9aa5d0', font: 'Great Vibes',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#141c3a'); g.addColorStop(1, '#2a3560'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,240,190,.85)', 70, 17); } }),

  // ===== FILM =====
  T({ id: 'film-black', name: 'Black Film', category: 'film', radius: 0, border: null, shadow: null,
      reserve: longEdges(0.1),
      textColor: '#E8D9B8', subColor: '#a89877', font: 'Gaegu',
      bg: (c, W, H) => { c.fillStyle = '#151515'; c.fillRect(0, 0, W, H); },
      decorate: filmDecorate('rgba(255,255,255,.85)', 'rgba(255,255,255,.6)') }),
  T({ id: 'film-white', name: 'White Film', category: 'film', radius: 0, border: null, shadow: null,
      reserve: longEdges(0.1),
      textColor: '#2B2B2B', subColor: '#8A8A8A', font: 'Gaegu',
      bg: (c, W, H) => { c.fillStyle = '#F7F5F0'; c.fillRect(0, 0, W, H); },
      decorate: filmDecorate('rgba(20,20,20,.85)', 'rgba(20,20,20,.55)') }),
  T({ id: 'amber', name: 'Amber Negative', category: 'film', radius: 0, border: null, shadow: null,
      reserve: longEdges(0.1),
      textColor: '#FFE9C9', subColor: '#e0b88f', font: 'Gaegu',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#C8743A'); g.addColorStop(1, '#8E4A22'); c.fillStyle = g; c.fillRect(0, 0, W, H); },
      decorate: filmDecorate('rgba(40,20,8,.8)', 'rgba(255,233,201,.8)') }),
  T({ id: 'kraft', name: 'Kraft Vintage', category: 'film', radius: 0, border: { color: '#fff', width: 10 }, shadow: { color: 'rgba(120,90,50,.25)', blur: 10, dy: 5 },
      reserve: longEdges(0.1),
      textColor: '#6B543A', subColor: '#A08862', font: 'Nanum Pen Script',
      bg: (c, W, H) => { c.fillStyle = '#E6D5BC'; c.fillRect(0, 0, W, H); noise(c, W, H, '#C9B494'); },
      decorate: (c, W, H, cells, info) => { sprocketsAuto(c, W, H, 'rgba(107,84,58,.5)', 'rgba(107,84,58,.7)', info.band); } }),
  T({ id: 'cinema', name: 'Cinema', category: 'film', radius: 0, border: null, shadow: null,
      reserve: { top: 0.07 },
      textColor: '#FFFFFF', subColor: '#BBBBBB', font: 'Gaegu',
      bg: (c, W, H) => { c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, W, H); },
      decorate: cinemaDecorate }),

  // ===== WRITTEN =====
  T({ id: 'besties', name: 'Besties', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: ink, subColor: '#9a8f85', font: 'Gaegu', defaultTitle: 'best friends forever ♡',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => writeInMargins(c, W, H, cells, info,
        ['bff', 'always together'],
        [(x, y, r, s) => wHeart(c, x, y, Math.min(26, s), r), (x, y, r, s) => wHeart(c, x, y, Math.min(18, s), r, '#FF8FB1'),
         (x, y, r, s) => wSwirl(c, x, y, Math.min(24, s), r), (x, y, r, s) => wHeart(c, x, y, Math.min(22, s), r)], 3) }),
  T({ id: 'lovenotes', name: 'Love Notes', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: '#C93A50', subColor: '#9a8f85', font: 'Gaegu', defaultTitle: 'i love us',
      bg: (c, W, H) => { c.fillStyle = '#FFFDFB'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => writeInMargins(c, W, H, cells, info,
        ['you & me', 'forever ♡'],
        [(x, y, r, s) => wHeart(c, x, y, Math.min(28, s), r), (x, y, r, s) => wHeart(c, x, y, Math.min(20, s), r),
         (x, y, r, s) => wHeart(c, x, y, Math.min(24, s), r), (x, y, r, s) => wSwirl(c, x, y, Math.min(22, s), r, '#E0526B')], 7) }),
  T({ id: 'mood', name: "Today's Mood", category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: ink, subColor: '#9a8f85', font: 'Gaegu', defaultTitle: "today's mood: happy",
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => writeInMargins(c, W, H, cells, info,
        ['say cheese!', 'so cute'],
        [(x, y, r, s) => wStar(c, x, y, Math.min(22, s), r), (x, y, r, s) => wStar(c, x, y, Math.min(16, s), r, '#E0A83B'),
         (x, y, r, s) => wSmiley(c, x, y, Math.min(20, s)), (x, y, r, s) => wStar(c, x, y, Math.min(20, s), r)], 11) }),
  T({ id: 'seouldiary', name: 'Seoul Diary', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: ink, subColor: '#9a8f85', font: 'Gaegu', defaultTitle: `seoul ♡ ${todayYear}`,
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => writeInMargins(c, W, H, cells, info,
        ['우리 오늘 예쁘다', '서울 데이트'],
        [(x, y, r, s) => wArrow(c, x, y, Math.min(26, s), r + 0.3), (x, y, r, s) => wHeart(c, x, y, Math.min(20, s), r, '#FF8FB1'),
         (x, y, r, s) => wArrow(c, x, y, Math.min(22, s), r - 0.5), (x, y, r, s) => wSwirl(c, x, y, Math.min(20, s), r)], 17) }),
  T({ id: 'script', name: 'Script', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: ink, subColor: '#9a8f85', font: 'Caveat', defaultTitle: 'photo booth',
      bg: (c, W, H) => { c.fillStyle = '#FFFEFB'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => {
        const areas = freeAreas(W, H, cells, info.texts || [], info).filter(a => a.dir === 'v');
        const b = cells.reduce((a, cc) => ({ l: Math.min(a.l, cc.x), r: Math.max(a.r, cc.x + cc.w), b: Math.max(a.b, cc.y + cc.h) }), { l: W, r: 0, b: 0 });
        const side = W - b.r >= b.l ? { x: (W + b.r) / 2, w: W - b.r } : { x: b.l / 2, w: b.l };
        if (side.w > 40)
          wtext(c, 'photo booth', side.x, H / 2, Math.min(72, side.w * 0.5), -Math.PI / 2 - 0.03, ink, 'Caveat');
        if (H - b.b > 90)
          wtext(c, todayShort(), W / 2, b.b + (H - b.b) * 0.55, Math.min(44, (H - b.b) * 0.4), 0.02, '#8A8A8A', 'Caveat');
      } }),
  T({ id: 'doodle', name: 'Doodle', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      textColor: ink, subColor: '#9a8f85', font: 'Gaegu', defaultTitle: 'cute!!',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => writeInMargins(c, W, H, cells, info,
        ['wow ♡'],
        [(x, y, r, s) => wSmiley(c, x, y, Math.min(22, s)), (x, y, r, s) => wSwirl(c, x, y, Math.min(26, s), r),
         (x, y, r, s) => wHeart(c, x, y, Math.min(22, s), r, '#FF8FB1'), (x, y, r, s) => wStar(c, x, y, Math.min(20, s), r),
         (x, y, r, s) => wSwirl(c, x, y, Math.min(18, s), r, '#7A8FB5')], 23) }),
  T({ id: 'newspaper', name: 'Newspaper', category: 'written', radius: 0, border: null, shadow: null,
      reserve: { top: 0.1 },
      textColor: '#1a1a1a', subColor: '#666', font: 'Quicksand', defaultTitle: 'our headlines',
      bg: (c, W, H) => { c.fillStyle = '#FDFBF7'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => {
        const band = info.band;
        // masthead inside the reserved top band only
        c.fillStyle = '#1a1a1a'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `700 ${Math.round(band * 0.52)}px Georgia,serif`;
        c.fillText('THE DAILY US', W / 2, band * 0.34);
        c.strokeStyle = '#1a1a1a'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(30, band * 0.62); c.lineTo(W - 30, band * 0.62); c.stroke();
        c.font = `${Math.round(band * 0.24)}px Georgia,serif`; c.fillStyle = '#666';
        c.fillText(`Vol. 1 · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, W / 2, band * 0.8);
        // fake column bars only in free bottom space
        const areas = freeAreas(W, H, cells, info.texts || [], info).filter(a => a.dir === 'h' && a.y > 0 && a.h > 110);
        for (const a of areas.slice(0, 1)) {
          const rnd = rng(31); c.fillStyle = '#bbb';
          const y0 = a.y + 20;
          for (let col = 0; col < 3; col++)
            for (let ln = 0; ln < Math.min(4, (a.h - 40) / 30); ln++)
              c.fillRect(a.x + 40 + col * ((a.w - 80) / 3), y0 + ln * 30, (a.w - 110) / 3 * (0.7 + rnd() * 0.25), 10);
        }
      } }),
  T({ id: 'ticket', name: 'Ticket', category: 'written', radius: 8, border: { color: '#eee', width: 4 }, shadow: null,
      reserve: { bottom: 0.11 },
      textColor: '#7a4a1f', subColor: '#b08a5a', font: 'Caveat', defaultTitle: 'best night ever',
      bg: (c, W, H) => { c.fillStyle = '#FFFDF6'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H, cells, info) => {
        const band = info.band, py = H - band;
        c.save(); c.setLineDash([18, 14]); c.strokeStyle = '#c9a86a'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(30, py); c.lineTo(W - 30, py); c.stroke(); c.restore();
        wtext(c, 'ADMIT ONE · Dalkom Cinema', W / 2, py + band * 0.42, band * 0.36, 0.02, '#7a4a1f', 'Caveat');
        wtext(c, 'keep this stub ♡', W / 2, py + band * 0.75, band * 0.26, -0.02, '#b08a5a', 'Caveat');
      } }),
];

export const THEME_CATEGORIES = [
  { id: 'plain', label: 'Plain' },
  { id: 'cute', label: 'Cute' },
  { id: 'film', label: 'Film' },
  { id: 'written', label: 'Written' },
];

export function getTheme(id) {
  return THEMES.find(t => t.id === id)
      || THEMES.find(t => t.id === ({ white: 'plain-white', black: 'plain-black', film: 'film-black' })[id])
      || THEMES[0];
}
