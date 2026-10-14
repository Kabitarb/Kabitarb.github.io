// Frame themes — procedural canvas drawing, no image assets.
// Each theme: {id,name, bg(ctx,W,H), radius(du), border:{color,width}|null,
//   shadow:{color,blur,dy}|null, textColor, subColor, font, decorate(ctx,W,H,cells)}

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
function stars(ctx, W, H, color, n, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = 4 + rnd() * 10;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 3);
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.4 : r, a = k * Math.PI / 5 - Math.PI / 2;
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
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
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = color;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = 10 + rnd() * 16;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 6.3);
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
  }
}
function hearts(ctx, W, H, color, n = 14) {
  let s = 5; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) heart(ctx, rnd() * W, rnd() * H, 14 + rnd() * 26);
  function heart(c, x, y, r) {
    c.save(); c.translate(x, y); c.scale(r / 30, r / 30);
    c.beginPath(); c.moveTo(0, 12);
    c.bezierCurveTo(-28, -10, -10, -30, 0, -12);
    c.bezierCurveTo(10, -30, 28, -10, 0, 12);
    c.fill(); c.restore();
  }
}
function sprockets(ctx, W, H, color) {
  ctx.fillStyle = color;
  const s = 34, step = 64;
  for (let y = 20; y < H - 20; y += step) {
    ctx.beginPath(); ctx.roundRect(14, y, s, s * 0.7, 8); ctx.fill();
    ctx.beginPath(); ctx.roundRect(W - 14 - s, y, s, s * 0.7, 8); ctx.fill();
  }
  ctx.font = '600 30px Quicksand, sans-serif'; ctx.textAlign = 'center';
  let n = 1;
  for (let y = 70; y < H - 40; y += 200) {
    ctx.fillText(`▶ ${n}A`, 70, y); ctx.fillText(`▶ ${n}A`, W - 70, y); n++;
  }
}
function noise(ctx, W, H, color) {
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = color; ctx.globalAlpha = 0.5;
  for (let i = 0; i < 2200; i++) ctx.fillRect(rnd() * W, rnd() * H, 3, 3);
  ctx.globalAlpha = 1;
}
function stamp(ctx, W, H) {
  ctx.save(); ctx.translate(W - 130, 130); ctx.rotate(0.25);
  ctx.strokeStyle = 'rgba(160,80,80,.6)'; ctx.lineWidth = 5;
  ctx.strokeRect(-70, -45, 140, 90);
  ctx.fillStyle = 'rgba(160,80,80,.65)'; ctx.font = '34px "Gaegu", cursive';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('달콤', 0, -12); ctx.fillText('booth', 0, 24);
  ctx.restore();
}
function bunnyEars(ctx, W, H, cells) {
  if (!cells.length) return;
  const c = cells[0];
  const cx = c.x + c.w / 2, top = c.y;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#eee'; ctx.lineWidth = 4;
  for (const dx of [-90, 90]) {
    ctx.save(); ctx.translate(cx + dx, top); ctx.rotate(dx < 0 ? -0.15 : 0.15);
    ctx.beginPath(); ctx.ellipse(0, -55, 34, 90, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFC9D8';
    ctx.beginPath(); ctx.ellipse(0, -45, 16, 58, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.restore();
  }
}
function cornerLogo(ctx, W, H, color) {
  ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = 0.6;
  ctx.font = '26px Jua, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('dalkom booth ♡', W - 30, H - 18); ctx.restore();
}

const T = (o) => o;

export const THEMES = [
  T({ id: 'white', name: 'Classic White', radius: 0, border: null, shadow: { color: 'rgba(0,0,0,.12)', blur: 10, dy: 4 },
      textColor: '#4a4a4a', subColor: '#9a8f85', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); },
      decorate: cornerLogo }),
  T({ id: 'black', name: 'Classic Black', radius: 0, border: null, shadow: null,
      textColor: '#FFFFFF', subColor: '#bbbbbb', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#141414'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H) => cornerLogo(c, W, H, 'rgba(255,255,255,.5)') }),
  T({ id: 'strawberry', name: 'Strawberry Milk', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(255,120,160,.25)', blur: 14, dy: 6 },
      textColor: '#E35A8B', subColor: '#F0A0BC', font: 'Jua',
      bg: (c, W, H) => { c.fillStyle = '#FFD9E4'; c.fillRect(0, 0, W, H); dots(c, W, H, 'rgba(255,255,255,.75)', 90, 10); },
      decorate: (c, W, H) => cornerLogo(c, W, H, '#E35A8B') }),
  T({ id: 'cloud', name: 'Baby Blue Cloud', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(90,140,200,.2)', blur: 14, dy: 6 },
      textColor: '#4A7FB5', subColor: '#8FB8DF', font: 'Dongle',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#A8D8FF'); g.addColorStop(1, '#DDF0FF'); c.fillStyle = g; c.fillRect(0, 0, W, H); clouds(c, W, H, 'rgba(255,255,255,.85)'); } }),
  T({ id: 'butter', name: 'Butter Gingham', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(180,140,40,.18)', blur: 12, dy: 5 },
      textColor: '#8A6A1F', subColor: '#C1A45E', font: 'Gaegu',
      bg: (c, W, H) => gingham(c, W, H, '#FFF6D8', '#FFE89A', 120) }),
  T({ id: 'matcha', name: 'Matcha Latte', radius: 12, border: { color: '#F6F1E4', width: 8 }, shadow: { color: 'rgba(90,110,70,.18)', blur: 12, dy: 5 },
      textColor: '#5F7A4E', subColor: '#9AAF8D', font: 'Nanum Pen Script',
      bg: (c, W, H) => { c.fillStyle = '#D8E2C8'; c.fillRect(0, 0, W, H); dots(c, W, H, 'rgba(246,241,228,.8)', 110, 8); } }),
  T({ id: 'lavender', name: 'Lavender Dream', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(140,110,180,.25)', blur: 14, dy: 6 },
      textColor: '#7A5FA8', subColor: '#B49FD6', font: 'Great Vibes',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#E6DCF5'); g.addColorStop(1, '#CDB4DB'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,255,255,.8)', 40); } }),
  T({ id: 'peach', name: 'Peach Check', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(220,140,90,.2)', blur: 12, dy: 5 },
      textColor: '#C96F4A', subColor: '#E8A583', font: 'Dongle',
      bg: (c, W, H) => checker(c, W, H, '#FFE5D4', '#FFD3BC', 130) }),
  T({ id: 'film', name: 'Film Negative', radius: 0, border: { color: '#2a2a2a', width: 4 }, shadow: null,
      textColor: '#E8D9B8', subColor: '#a89877', font: 'Gaegu',
      bg: (c, W, H) => { c.fillStyle = '#1D1712'; c.fillRect(0, 0, W, H); },
      decorate: (c, W, H) => { sprockets(c, W, H, 'rgba(232,217,184,.7)'); } }),
  T({ id: 'blossom', name: 'Cherry Blossom', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(230,140,170,.25)', blur: 14, dy: 6 },
      textColor: '#D15B8A', subColor: '#EFA9C4', font: 'Nanum Pen Script',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FFE3EE'); g.addColorStop(1, '#FFC9DD'); c.fillStyle = g; c.fillRect(0, 0, W, H); petals(c, W, H, 'rgba(255,255,255,.7)'); } }),
  T({ id: 'bunny', name: 'Bunny', radius: 24, border: { color: '#FFE3EE', width: 8 }, shadow: { color: 'rgba(200,150,170,.2)', blur: 12, dy: 5 },
      textColor: '#B5779A', subColor: '#D8A9C2', font: 'Jua',
      bg: (c, W, H) => { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H); dots(c, W, H, '#FFEEF5', 100, 9); },
      decorate: (c, W, H, cells) => { bunnyEars(c, W, H, cells); } }),
  T({ id: 'love', name: 'Love Letter', radius: 12, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(200,60,60,.2)', blur: 12, dy: 5 },
      textColor: '#C93A50', subColor: '#E08595', font: 'Great Vibes',
      bg: (c, W, H) => { c.fillStyle = '#FFF0F0'; c.fillRect(0, 0, W, H); hearts(c, W, H, 'rgba(230,120,140,.35)'); } }),
  T({ id: 'y2k', name: 'Y2K Chrome', radius: 0, border: { color: '#fff', width: 6 }, shadow: { color: 'rgba(120,120,140,.3)', blur: 12, dy: 5 },
      textColor: '#555a70', subColor: '#8a90a8', font: 'Dongle',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#e8e9ee'); g.addColorStop(0.5, '#c9ccd8'); g.addColorStop(1, '#eef0f5'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,255,255,.9)', 55, 13); } }),
  T({ id: 'night', name: 'Night Sky', radius: 12, border: { color: '#2a3355', width: 6 }, shadow: null,
      textColor: '#F4E9B8', subColor: '#9aa5d0', font: 'Great Vibes',
      bg: (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#141c3a'); g.addColorStop(1, '#2a3560'); c.fillStyle = g; c.fillRect(0, 0, W, H); stars(c, W, H, 'rgba(255,240,190,.85)', 70, 17); } }),
  T({ id: 'kraft', name: 'Kraft Paper', radius: 0, border: { color: '#fff', width: 10 }, shadow: { color: 'rgba(120,90,50,.25)', blur: 10, dy: 5 },
      textColor: '#6B543A', subColor: '#A08862', font: 'Nanum Pen Script',
      bg: (c, W, H) => { c.fillStyle = '#E6D5BC'; c.fillRect(0, 0, W, H); noise(c, W, H, '#C9B494'); },
      decorate: stamp }),
  T({ id: 'rainbow', name: 'Pastel Rainbow', radius: 24, border: { color: '#fff', width: 8 }, shadow: { color: 'rgba(150,120,160,.2)', blur: 12, dy: 5 },
      textColor: '#9A6FB8', subColor: '#C2A4D8', font: 'Jua',
      bg: (c, W, H) => {
        const cols = ['#FFD9E4', '#FFE9C9', '#FFF6C9', '#D3F2D8', '#C9E7FF', '#E0D3F5'];
        const g = c.createLinearGradient(0, 0, 0, H);
        cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col));
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      } }),
];

export function getTheme(id) { return THEMES.find(t => t.id === id); }
