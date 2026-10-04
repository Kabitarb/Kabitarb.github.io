// Cross-frame stabilisation: match numbers to tracks, smooth boxes, vote on values.
export class NumberTracker {
  constructor() {
    this.tracks = [];
    this.maxVotes = 7;
    this.minHits = 2;
    this.keepAlive = 900; // ms
    this.smoothing = 0.45;
    this.nextId = 1;
  }

  reset() { this.tracks = []; }

  update(detections, now) {
    const pairs = [];
    this.tracks.forEach((t, ti) => {
      detections.forEach((d, di) => {
        const tol = Math.max(t.box.h, d.box.h) * 0.8;
        const dx = (t.box.x + t.box.w / 2) - (d.box.x + d.box.w / 2);
        const dy = (t.box.y + t.box.h / 2) - (d.box.y + d.box.h / 2);
        const dist = Math.hypot(dx, dy);
        const overlaps = t.box.x < d.box.x + d.box.w && d.box.x < t.box.x + t.box.w &&
                         t.box.y < d.box.y + d.box.h && d.box.y < t.box.y + t.box.h;
        if (dist < tol || overlaps) pairs.push({ dist, ti, di });
      });
    });
    pairs.sort((a, b) => a.dist - b.dist);
    const usedT = new Set(), usedD = new Set();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      const t = this.tracks[p.ti], d = detections[p.di], s = this.smoothing;
      t.box = {
        x: t.box.x + (d.box.x - t.box.x) * s, y: t.box.y + (d.box.y - t.box.y) * s,
        w: t.box.w + (d.box.w - t.box.w) * s, h: t.box.h + (d.box.h - t.box.h) * s,
      };
      t.votes.push(d.text); if (t.votes.length > this.maxVotes) t.votes.shift();
      t.circledVotes.push(d.circled); if (t.circledVotes.length > this.maxVotes) t.circledVotes.shift();
      t.hits++; t.lastSeen = now; t.last = d;
      usedT.add(p.ti); usedD.add(p.di);
    }
    detections.forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({ id: this.nextId++, box: { ...d.box }, votes: [d.text], circledVotes: [d.circled], hits: 1, lastSeen: now, last: d });
    });
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.keepAlive);

    // Remove duplicates that converged on the same spot (keep the better-established one).
    const kept = [];
    for (const t of [...this.tracks].sort((a, b) => b.hits - a.hits)) {
      const dup = kept.some((o) => {
        const ox = Math.min(o.box.x + o.box.w, t.box.x + t.box.w) - Math.max(o.box.x, t.box.x);
        const oy = Math.min(o.box.y + o.box.h, t.box.y + t.box.h) - Math.max(o.box.y, t.box.y);
        if (ox <= 0 || oy <= 0) return false;
        const smaller = Math.min(o.box.w * o.box.h, t.box.w * t.box.h);
        return ox * oy > smaller * 0.6;
      });
      if (!dup) kept.push(t);
    }
    this.tracks = kept;

    return this.tracks.filter((t) => t.hits >= this.minHits).map((t) => {
      const text = mode(t.votes);
      const circled = t.circledVotes.filter(Boolean).length * 2 > t.circledVotes.length;
      return { id: t.id, text, value: parseFloat(text), circled, box: t.box, digits: t.last.digits };
    });
  }
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = values[values.length - 1], bestCount = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    const c = counts.get(values[i]);
    if (c > bestCount) { best = values[i]; bestCount = c; }
  }
  return best;
}

// Cluster numbers into up to 5 vertical columns by horizontal position.
export function groupColumns(numbers, maxColumns = 5) {
  if (!numbers.length) return [];
  const sorted = [...numbers].sort((a, b) => cx(a) - cx(b));
  const widths = sorted.map((n) => n.box.w).sort((a, b) => a - b);
  const medianW = widths[widths.length >> 1];
  const threshold = Math.max(medianW * 0.9, 0.05);
  const clusters = [];
  for (const n of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const center = last.reduce((s, m) => s + cx(m), 0) / last.length;
      const minX = Math.min(...last.map((m) => m.box.x));
      const maxX = Math.max(...last.map((m) => m.box.x + m.box.w));
      const overlaps = n.box.x < maxX && n.box.x + n.box.w > minX;
      if (Math.abs(cx(n) - center) < threshold || overlaps) { last.push(n); continue; }
    }
    clusters.push([n]);
  }
  while (clusters.length > maxColumns) {
    let bi = 0, bg = Infinity;
    for (let i = 0; i < clusters.length - 1; i++) {
      const a = clusters[i].reduce((s, m) => s + cx(m), 0) / clusters[i].length;
      const b = clusters[i + 1].reduce((s, m) => s + cx(m), 0) / clusters[i + 1].length;
      if (b - a < bg) { bg = b - a; bi = i; }
    }
    clusters[bi].push(...clusters[bi + 1]);
    clusters.splice(bi + 1, 1);
  }
  return clusters.map((members, id) => {
    members.sort((a, b) => a.box.y - b.box.y);
    const total = members.reduce((s, m) => s + (m.circled ? -m.value : m.value), 0);
    const heights = members.map((m) => m.box.h).sort((a, b) => a - b);
    return {
      id, numbers: members, total: Math.round(total * 100) / 100,
      minX: Math.min(...members.map((m) => m.box.x)),
      maxX: Math.max(...members.map((m) => m.box.x + m.box.w)),
      bottomY: Math.max(...members.map((m) => m.box.y + m.box.h)),
      rowH: heights[heights.length >> 1],
    };
  });
}

const cx = (n) => n.box.x + n.box.w / 2;
