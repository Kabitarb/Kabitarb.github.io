// Image pipeline: adaptive threshold -> connected components -> digits / dots / dashes / circles
// -> numbers (with decimals, negatives, circled) -> 28x28 crops classified by the CNN.

export function toGray(rgba, n) {
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = (rgba[j] * 77 + rgba[j + 1] * 151 + rgba[j + 2] * 28) >> 8;
  }
  return gray;
}

// Bradley adaptive threshold: ink where pixel is darker than local mean by a margin.
export function adaptiveThreshold(gray, W, H, opts = {}) {
  const radius = opts.radius ?? Math.max(8, Math.round(Math.min(W, H) / 20));
  const ratio = opts.ratio ?? 0.14;
  const minDiff = opts.minDiff ?? 14;
  const iw = W + 1;
  const integral = new Uint32Array(iw * (H + 1));
  for (let y = 1; y <= H; y++) {
    let rowSum = 0;
    const gRow = (y - 1) * W;
    const iRow = y * iw, pRow = (y - 1) * iw;
    for (let x = 1; x <= W; x++) {
      rowSum += gray[gRow + x - 1];
      integral[iRow + x] = integral[pRow + x] + rowSum;
    }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(H - 1, y + radius);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(W - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * iw + x1 + 1] - integral[y0 * iw + x1 + 1]
                - integral[(y1 + 1) * iw + x0] + integral[y0 * iw + x0];
      const g = gray[y * W + x];
      const mean = sum / count;
      if (g < mean * (1 - ratio) && mean - g >= minDiff) mask[y * W + x] = 1;
    }
  }
  return mask;
}

// 8-connected components. Returns {labels, comps} where comps[i] has bbox/area/centroid.
export function connectedComponents(mask, W, H) {
  const labels = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  const comps = [];
  let next = 1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0, sx = 0, sy = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % W, py = (p - px) / W;
      area++; sx += px; sy += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    comps.push({ id, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area, cx: sx / area, cy: sy / area });
  }
  return { labels, comps };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function unionBox(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
function finishBox(b) { b.w = b.x1 - b.x0 + 1; b.h = b.y1 - b.y0 + 1; b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; return b; }

// Build the 28x28 MNIST-style input for a glyph made of the given component ids.
export function makeDigitInput(labels, W, ids, box) {
  const idSet = new Set(ids);
  const s = 20 / Math.max(box.w, box.h);
  const nw = Math.max(1, Math.round(box.w * s)), nh = Math.max(1, Math.round(box.h * s));
  const small = new Float32Array(nw * nh);
  const cellArea = 1 / (s * s);
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * W;
    const ty = Math.min(nh - 1, Math.floor((y - box.y0) * s));
    for (let x = box.x0; x <= box.x1; x++) {
      if (!idSet.has(labels[row + x])) continue;
      const tx = Math.min(nw - 1, Math.floor((x - box.x0) * s));
      small[ty * nw + tx] += 1;
    }
  }
  let ink = 0;
  for (let i = 0; i < small.length; i++) { small[i] = Math.min(1, small[i] / cellArea * 1.3); ink += small[i]; }
  // Thin pen strokes end up much lighter than MNIST's thick strokes; dilate until comparable.
  let passes = 0;
  while (ink / (nw * nh) < 0.22 && passes < 2) {
    const d = new Float32Array(small.length);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= nh || xx < 0 || xx >= nw) continue;
        const v = small[yy * nw + xx] * (dx === 0 || dy === 0 ? 1 : 0.6);
        if (v > m) m = v;
      }
      d[y * nw + x] = Math.min(1, Math.max(small[y * nw + x], m * 0.85));
    }
    ink = 0;
    for (let i = 0; i < d.length; i++) { small[i] = d[i]; ink += d[i]; }
    passes++;
  }
  // Centre of mass to (14,14) like MNIST.
  let mx = 0, my = 0, tot = 0;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const v = small[y * nw + x]; mx += v * x; my += v * y; tot += v; }
  mx = tot ? mx / tot : nw / 2; my = tot ? my / tot : nh / 2;
  let ox = Math.round(14 - mx), oy = Math.round(14 - my);
  ox = Math.max(0, Math.min(28 - nw, ox)); oy = Math.max(0, Math.min(28 - nh, oy));
  const input = new Float32Array(784);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) input[(y + oy) * 28 + x + ox] = small[y * nw + x];
  return input;
}


// Tight bounding box of the glyph pixels inside [x0,x1] of a box.
function tightBox(labels, W, ids, box, x0, x1) {
  const idSet = new Set(ids);
  let bx0 = x1, bx1 = x0, by0 = box.y1, by1 = box.y0, area = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      if (!idSet.has(labels[row + x])) continue;
      area++;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
  }
  if (!area) return null;
  return finishBox({ x0: bx0, y0: by0, x1: bx1, y1: by1, ids, area });
}

// Split a wide glyph (two touching digits) at the thinnest vertical ink column; keep if both halves read as digits.
function splitGlyph(labels, W, g, classify, Hd) {
  const idSet = new Set(g.ids);
  const proj = new Int32Array(g.w);
  for (let y = g.y0; y <= g.y1; y++) {
    const row = y * W;
    for (let x = g.x0; x <= g.x1; x++) if (idSet.has(labels[row + x])) proj[x - g.x0]++;
  }
  const nParts = g.w > 1.7 * Hd ? 3 : 2;
  const cuts = [];
  for (let k = 1; k < nParts; k++) {
    const centre = (g.w * k) / nParts;
    const lo = Math.max(1, Math.round(centre - g.w * 0.18)), hi = Math.min(g.w - 2, Math.round(centre + g.w * 0.18));
    let best = -1, bestV = Infinity;
    for (let x = lo; x <= hi; x++) {
      const v = proj[x] + Math.abs(x - centre) * 0.15;
      if (v < bestV) { bestV = v; best = x; }
    }
    if (best < 0) return null;
    cuts.push(best);
  }
  const bounds = [0, ...cuts, g.w];
  const out = [];
  for (let k = 0; k < nParts; k++) {
    const x0 = g.x0 + bounds[k] + (k ? 1 : 0), x1 = g.x0 + bounds[k + 1] - (k < nParts - 1 ? 0 : 0);
    if (x1 <= x0) return null;
    const box = tightBox(labels, W, g.ids, g, x0, x1);
    if (!box || box.h < 0.4 * Hd) return null;
    const pred = classify(makeDigitInput(labels, W, g.ids, box));
    if (pred.label > 9 || pred.conf < 0.6) return null;
    out.push({ box, pred });
  }
  return out;
}

// Peel the ring of a (possibly digit-touching) circle component. Returns recovered inner pieces or null.
function peelRing(labels, mask, W, H, c, Hd) {
  const bw = c.w + 2, bh = c.h + 2;
  const ox = c.x0 - 1, oy = c.y0 - 1;
  const state = new Uint8Array(bw * bh); // 0 unknown, 1 outer background, 2 comp pixel
  const dist = new Int32Array(bw * bh);
  const queue = new Int32Array(bw * bh);
  let qh = 0, qt = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const gx = ox + x, gy = oy + y;
    const i = y * bw + x;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) { state[i] = 1; continue; }
    if (labels[gy * W + gx] === c.id) state[i] = 2;
    else if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1) { state[i] = 1; queue[qt++] = i; }
  }
  // Flood the outer background (through anything that is not this component).
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % bw, y = (i - x) / bw;
    if (x > 0 && !state[i - 1]) { state[i - 1] = 1; queue[qt++] = i - 1; }
    if (x < bw - 1 && !state[i + 1]) { state[i + 1] = 1; queue[qt++] = i + 1; }
    if (y > 0 && !state[i - bw]) { state[i - bw] = 1; queue[qt++] = i - bw; }
    if (y < bh - 1 && !state[i + bw]) { state[i + bw] = 1; queue[qt++] = i + bw; }
  }
  // Distance (in pixels) of each component pixel from the outer background.
  qh = qt = 0;
  for (let i = 0; i < bw * bh; i++) {
    if (state[i] !== 2) continue;
    const x = i % bw;
    if ((x > 0 && state[i - 1] === 1) || (x < bw - 1 && state[i + 1] === 1) || (i >= bw && state[i - bw] === 1) || (i + bw < bw * bh && state[i + bw] === 1)) {
      dist[i] = 1; queue[qt++] = i;
    }
  }
  const layer = [];
  while (qh < qt) {
    const i = queue[qh++];
    const d = dist[i];
    layer[d] = (layer[d] || 0) + 1;
    const x = i % bw;
    const nb = [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, i - bw, i + bw];
    for (const j of nb) {
      if (j < 0 || j >= bw * bh || state[j] !== 2 || dist[j]) continue;
      dist[j] = d + 1; queue[qt++] = j;
    }
  }
  if (!layer[1]) return null;
  let sw = 1;
  while (layer[sw + 1] && layer[sw + 1] > 0.4 * layer[1]) sw++;
  if (sw > 0.25 * Hd) return null; // too thick to be a pen ring
  const cut = sw + 1;
  // Inner pieces: component pixels further than the ring thickness; re-label by connectivity.
  const seen = new Uint8Array(bw * bh);
  const pieces = [];
  for (let i = 0; i < bw * bh; i++) {
    if (state[i] !== 2 || dist[i] <= cut || seen[i]) continue;
    seen[i] = 1;
    qh = 0; qt = 0; queue[qt++] = i;
    let x0 = bw, y0 = bh, x1 = -1, y1 = -1, area = 0, sx = 0, sy = 0;
    const pixels = [];
    while (qh < qt) {
      const p = queue[qh++];
      const px = p % bw, py = (p - px) / bw;
      area++; sx += px; sy += py; pixels.push((oy + py) * W + ox + px);
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const q = ny * bw + nx;
        if (state[q] === 2 && dist[q] > cut && !seen[q]) { seen[q] = 1; queue[qt++] = q; }
      }
    }
    if (area < 8) continue;
    pieces.push({ x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area, cx: ox + sx / area, cy: oy + sy / area, pixels, role: null });
  }
  if (!pieces.length) return null;
  // Sanity: the ring itself must stay big; pieces must sit well inside it.
  const ok = pieces.filter((p) => p.x0 > c.x0 + 2 && p.x1 < c.x1 - 2 && p.y0 > c.y0 + 2 && p.y1 < c.y1 - 2);
  return ok.length ? ok : null;
}

/**
 * Analyse a frame. gray: Uint8Array(W*H). classify(input784) -> {label, conf}.
 * Returns { numbers, digitH, comps, mask } with numbers in normalized coordinates.
 */
export function analyzeFrame(gray, W, H, classify, opts = {}) {
  const mask = adaptiveThreshold(gray, W, H, opts);
  const { labels, comps: all } = connectedComponents(mask, W, H);

  const comps = all.filter((c) =>
    c.area >= 5 && c.w < W * 0.5 && c.h < H * 0.5 &&
    c.x0 > 0 && c.y0 > 0 && c.x1 < W - 1 && c.y1 < H - 1);
  const result = { numbers: [], rejected: [], dots: [], digitH: 0, mask, comps, W, H };
  if (!comps.length) return result;

  // Typical digit height: median height of solid-ish, non-tiny components.
  const sizable = comps.filter((c) => c.h >= 7 && c.area >= 15);
  let Hd = median(sizable.map((c) => c.h));
  if (!Hd) return result;
  // Guard against a few very tall things (circles) dominating: use median of the lower 80%.
  const hs = sizable.map((c) => c.h).sort((a, b) => a - b);
  Hd = hs[Math.floor(hs.length * 0.5)];
  result.digitH = Hd;

  for (const c of comps) { c.role = null; c.density = c.area / (c.w * c.h); }

  // Circles: large hollow components enclosing something. A pen circle often touches the
  // digits inside it, merging them into one blob; peel the ring off to recover them.
  const circles = [];
  let nextId = all.length + 1;
  const candidates = comps.filter((c) => c.h >= 1.15 * Hd && c.w >= 0.9 * Hd && c.density < 0.5 &&
    (c.w >= 1.25 * Hd || c.h >= 1.35 * Hd));
  for (const c of candidates) {
    const padX = c.w * 0.06, padY = c.h * 0.06;
    const insideOf = (d) => d !== c && d.cx > c.x0 + padX && d.cx < c.x1 - padX && d.cy > c.y0 + padY && d.cy < c.y1 - padY &&
      d.x0 >= c.x0 - 2 && d.x1 <= c.x1 + 2 && d.y0 >= c.y0 - 2 && d.y1 <= c.y1 + 2;
    let inner = comps.filter((d) => d.role !== 'circle' && d.h >= 0.3 * Hd && insideOf(d));
    const peeled = peelRing(labels, mask, W, H, c, Hd);
    if (peeled) {
      for (const d of peeled) { d.id = nextId++; d.density = d.area / (d.w * d.h); }
      // commit new labels for the recovered pieces
      for (const d of peeled) for (const p of d.pixels) labels[p] = d.id;
      const dotLike = (d) => d.h <= 0.33 * Hd && d.w <= 0.33 * Hd && d.w / d.h > 0.6 && d.w / d.h < 1.6 && d.density >= 0.6;
      const good = peeled.filter((d) => (d.h >= 0.45 * Hd && d.w >= 2) || dotLike(d));
      comps.push(...good);
      inner = inner.concat(good);
    }
    if (inner.length) {
      c.role = 'circle';
      circles.push(c);
      for (const d of inner) d.circled = true;
    } else if (c.w >= 2.2 * Hd && c.h >= 2.2 * Hd) {
      c.role = 'junk';
    }
  }

  // Glyph pieces: group components that overlap horizontally and sit on the same line.
  const pool = comps.filter((c) => !c.role).sort((a, b) => a.x0 - b.x0);
  const glyphs = [];
  for (const c of pool) {
    let target = null;
    for (const g of glyphs) {
      const ox = Math.min(g.x1, c.x1) - Math.max(g.x0, c.x0);
      const minW = Math.min(g.w, c.w);
      const vGap = Math.max(0, Math.max(g.y0, c.y0) - Math.min(g.y1, c.y1));
      const bigEnough = Math.max(g.h, c.h) >= 0.4 * Hd;
      if (bigEnough && ox > 0.45 * minW && vGap < 0.35 * Hd && Math.max(g.y1, c.y1) - Math.min(g.y0, c.y0) < 1.9 * Hd) {
        target = g; break;
      }
    }
    if (target) {
      Object.assign(target, finishBox(unionBox(target, c)));
      target.ids.push(c.id);
      target.area += c.area;
      target.circled = target.circled || !!c.circled;
    } else {
      glyphs.push(finishBox({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, ids: [c.id], area: c.area, circled: !!c.circled }));
    }
  }

  const digits = [], dots = [], dashes = [];
  for (const g of glyphs) {
    g.density = g.area / (g.w * g.h);
    if (g.h <= 0.3 * Hd && g.w >= 1.6 * g.h && g.w >= 0.3 * Hd) dashes.push(g);
    else if (g.h <= 0.33 * Hd && g.w <= 0.45 * Hd) dots.push(g);
    else if (g.h >= 0.45 * Hd && g.h <= 2.2 * Hd && g.w <= 2.4 * Hd) digits.push(g);
  }

  result.dots = dots;
  // Numbers: runs of digits on one line, close together.
  digits.sort((a, b) => a.x0 - b.x0);
  const groups = [];
  for (const d of digits) {
    let best = null, bestGap = Infinity;
    for (const g of groups) {
      const gap = d.x0 - g.x1;
      const vo = Math.min(g.y1, d.y1) - Math.max(g.y0, d.y0);
      const dotBetween = gap > 0 && dots.some((p) => p.cx > g.x1 - 2 && p.cx < d.x0 + 2 && p.cy > g.cy && p.cy < g.y1 + 0.3 * Hd);
      const maxGap = dotBetween ? 1.25 * Hd : 0.65 * Hd;
      if (gap <= maxGap && gap >= -0.35 * Math.min(d.w, Hd) && vo >= 0.45 * Math.min(g.h, d.h) && gap < bestGap) {
        best = g; bestGap = gap;
      }
    }
    if (best) {
      best.digits.push(d);
      Object.assign(best, finishBox(unionBox(best, d)));
    } else {
      groups.push(finishBox({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, digits: [d] }));
    }
  }

  for (const g of groups) {
    // Decimal point: a dot in the lower half, horizontally inside/just right of the run.
    let dot = null;
    for (const p of dots) {
      if (p.cy > g.cy && p.cy <= g.y1 + 0.3 * Hd && p.cx > g.x0 && p.cx < g.x1 + 0.5 * Hd) {
        if (!dot || p.area > dot.area) dot = p;
      }
    }
    let dotIndex = -1;
    if (dot) {
      dotIndex = g.digits.filter((d) => d.cx < dot.cx).length;
      if (dotIndex === 0 || dotIndex >= g.digits.length) dotIndex = -1;
    }
    // Minus sign: a dash just left of the run.
    const negative = dashes.some((s) => s.x1 < g.x0 && g.x0 - s.x1 <= 0.6 * Hd && s.cy > g.y0 && s.cy < g.y1);

    let text = '', minConf = 1, bad = false;
    const digitInfos = [];
    const parts = [];
    g.digits.forEach((d, i) => {
      let pred = classify(makeDigitInput(labels, W, d.ids, d));
      if ((pred.label > 9 || pred.conf < 0.6) && d.w >= 0.7 * Hd) {
        const split = splitGlyph(labels, W, d, classify, Hd);
        if (split) { for (const sp of split) parts.push({ ...sp, dotBefore: false }); if (i === dotIndex) parts[parts.length - split.length].dotBefore = true; return; }
      }
      parts.push({ box: d, pred, dotBefore: i === dotIndex });
    });
    // A stray mark at either end of the run must not kill the whole number: trim it.
    const isBad = (p) => p.pred.label > 9 || p.pred.conf < 0.5;
    while (parts.length > 1 && isBad(parts[parts.length - 1])) parts.pop();
    while (parts.length > 1 && isBad(parts[0])) { parts.shift(); parts[0].dotBefore = false; }
    for (const p of parts) {
      digitInfos.push({ box: p.box, label: p.pred.label, conf: p.pred.conf });
      if (isBad(p)) bad = true;
      else {
        if (p.dotBefore) text += '.';
        text += String(p.pred.label);
        if (p.pred.conf < minConf) minConf = p.pred.conf;
      }
    }
    if (parts.length && !bad) {
      const b = parts.reduce((acc, p) => unionBox(acc, p.box), { ...parts[0].box });
      Object.assign(g, finishBox(b));
    }
    const circled = g.digits.some((d) => d.circled);
    if (bad || !text) { result.rejected.push({ box: g, digits: digitInfos, text }); continue; }
    const value = parseFloat(text) * (negative ? -1 : 1);
    if (!Number.isFinite(value)) continue;
    result.numbers.push({
      text: (negative ? '-' : '') + text,
      value,
      circled,
      conf: minConf,
      digits: digitInfos,
      box: { x: g.x0 / W, y: g.y0 / H, w: g.w / W, h: g.h / H },
    });
  }
  result.circles = circles.map((c) => ({ x: c.x0 / W, y: c.y0 / H, w: c.w / W, h: c.h / H }));
  return result;
}
