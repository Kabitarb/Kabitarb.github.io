// Ludo — 2–4 players, captures, safe squares, animated hops and dice.
import { esc } from './util.js';

export const meta = { name: 'Ludo', icon: '🎲', min: 2, max: 4, color: '#10b981', blurb: 'Race all four tokens home. 2–4 players.', series: 1 };
export const LUDO_COLORS = [
  { name: 'Red', fill: '#e63946' }, { name: 'Green', fill: '#2a9d8f' }, { name: 'Yellow', fill: '#f1c40f' }, { name: 'Blue', fill: '#3b82f6' },
];
const START = [0, 13, 26, 39];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const COLOR_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
// 52-cell track as [col,row] on a 15x15 grid, clockwise from red's start.
const TRACK = (() => {
  const t = [];
  for (let c = 1; c <= 5; c++) t.push([c, 6]);
  for (let r = 5; r >= 0; r--) t.push([6, r]);
  t.push([7, 0]);
  for (let r = 0; r <= 5; r++) t.push([8, r]);
  for (let c = 9; c <= 14; c++) t.push([c, 6]);
  t.push([14, 7]);
  for (let c = 14; c >= 9; c--) t.push([c, 8]);
  for (let r = 9; r <= 14; r++) t.push([8, r]);
  t.push([7, 14]);
  for (let r = 14; r >= 9; r--) t.push([6, r]);
  for (let c = 5; c >= 0; c--) t.push([c, 8]);
  t.push([0, 7]); t.push([0, 6]);
  return t;
})();
const HOME_COL = [
  [1, 2, 3, 4, 5].map((c) => [c, 7]), [1, 2, 3, 4, 5].map((r) => [7, r]),
  [13, 12, 11, 10, 9].map((c) => [c, 7]), [13, 12, 11, 10, 9].map((r) => [7, r]),
];
const BASE_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];
const BASE_SPOTS = [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]];

function cellOf(ci, rel) {
  if (rel <= 50) return TRACK[(START[ci] + rel) % 52];
  if (rel <= 55) return HOME_COL[ci][rel - 51];
  return [7, 7];
}
const LUDO = {
  init(n) {
    return { n, colors: COLOR_SETS[n] || COLOR_SETS[4].slice(0, n), tokens: Array.from({ length: n }, () => [-1, -1, -1, -1]), turn: 0, dice: 0, phase: 'roll', winner: null, sixes: 0, last: null, finished: [], seq: 0 };
  },
  legal(st, pi) {
    if (st.phase !== 'move' || pi !== st.turn) return [];
    const d = st.dice, out = [];
    st.tokens[pi].forEach((pos, i) => { if (pos === -1 ? d === 6 : pos + d <= 56) out.push(i); });
    return out;
  },
  next(st) { st.turn = (st.turn + 1) % st.n; while (st.finished.includes(st.turn)) st.turn = (st.turn + 1) % st.n; st.phase = 'roll'; st.dice = 0; st.sixes = 0; },
  apply(st, pi, mv) {
    if (st.winner !== null || pi !== st.turn) return false;
    if (mv.a === 'roll') {
      if (st.phase !== 'roll') return false;
      const d = Number(mv.d); if (!(d >= 1 && d <= 6)) return false;
      st.dice = d; st.seq = (st.seq || 0) + 1; st.last = { pi, a: 'roll', d, seq: st.seq };
      if (d === 6) { st.sixes++; if (st.sixes >= 3) { LUDO.next(st); return true; } }
      st.phase = 'move';
      if (!LUDO.legal(st, pi).length) { if (d === 6) { st.phase = 'roll'; } else LUDO.next(st); }
      return true;
    }
    if (mv.a === 'move') {
      const i = Number(mv.i);
      if (!LUDO.legal(st, pi).includes(i)) return false;
      const d = st.dice, toks = st.tokens[pi];
      const from = toks[i];
      const to = from === -1 ? 0 : from + d;
      toks[i] = to;
      let captured = false; const caps = [];
      if (to <= 50) {
        const abs = (START[st.colors[pi]] + to) % 52;
        if (!SAFE.has(abs)) {
          st.tokens.forEach((ot, op) => { if (op === pi) return; ot.forEach((p, k) => { if (p >= 0 && p <= 50 && (START[st.colors[op]] + p) % 52 === abs) { caps.push({ pi: op, i: k, from: p }); ot[k] = -1; captured = true; } }); });
        }
      }
      const finished = to === 56;
      st.seq = (st.seq || 0) + 1;
      st.last = { pi, a: 'move', i, from, to, captured, caps, finished, seq: st.seq };
      if (toks.every((p) => p === 56)) {
        st.finished.push(pi);
        if (st.winner === null) st.winner = pi;
        if (st.finished.length >= st.n - 1) { st.phase = 'done'; return true; }
        LUDO.next(st); return true;
      }
      if (d === 6 || captured || finished) { st.phase = 'roll'; st.dice = 0; } else LUDO.next(st);
      return true;
    }
    return false;
  },
  over(st) { return st.winner !== null; },
};

export const engine = LUDO;

// Board coordinates of a token (for hop animations in the UI). pos -1 = base.
export function ludoXY(st, pi, i, pos, C = 30) {
  const ci = st.colors[pi];
  if (pos === -1) { const [ox, oy] = BASE_ORIGIN[ci]; const [bx, by] = BASE_SPOTS[i]; return [(ox + bx + 0.5) * C, (oy + by + 0.5) * C]; }
  if (pos === 56) { const cx = 7.5 * C; return [cx + (ci % 2 ? 0 : (ci === 0 ? -20 : 20)), cx + (ci % 2 ? (ci === 1 ? -20 : 20) : 0)]; }
  const [c, r] = cellOf(ci, pos); return [(c + 0.5) * C, (r + 0.5) * C];
}
// Would moving token i capture someone? (for hints)
export function ludoCaptures(st, pi, i) {
  const pos = st.tokens[pi][i]; const to = pos === -1 ? 0 : pos + st.dice;
  if (to > 50) return false;
  const abs = (START[st.colors[pi]] + to) % 52;
  if (SAFE.has(abs)) return false;
  return st.tokens.some((ot, op) => op !== pi && ot.some((p) => p >= 0 && p <= 50 && (START[st.colors[op]] + p) % 52 === abs));
}
export const PIECES = { coin: { name: 'Classic' }, pawn: { name: 'Pawn' }, bishop: { name: 'Bishop' }, rook: { name: 'Rook' }, crown: { name: 'Crown' }, cone: { name: 'Cone' }, dome: { name: 'Dome' }, gem: { name: 'Gem' }, star: { name: 'Star' }, heart: { name: 'Heart' } };
export const PIECE_KEY = 'chatly:ludo:piece';
export const myPiece = () => (PIECES[localStorage.getItem(PIECE_KEY)] ? localStorage.getItem(PIECE_KEY) : 'coin');
export function pieceGlyph() { return ''; }
// Shade a #rrggbb colour by k (-1..1).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); const ch = (o) => { const v = (n >> o) & 255; return Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
const STAR = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.6 : 11; return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`; }).join(' L');
const SHAPES = {
  coin: (f) => `<ellipse cx="0" cy="3" rx="10.5" ry="5" fill="${f.dark}"/><path d="M-10.5 -1 V3 A10.5 5 0 0 0 10.5 3 V-1 Z" fill="${f.side}"/><ellipse cx="0" cy="-1" rx="10.5" ry="5" fill="url(#${f.rad})" stroke="${f.rim}" stroke-width="1"/><ellipse cx="0" cy="-1" rx="6.5" ry="3" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.2"/><ellipse cx="-3.5" cy="-2.6" rx="2.6" ry="1.1" fill="rgba(255,255,255,.55)"/>`,
  pawn: (f) => `<path d="M-8.5 11 Q-8.5 6.5 -3.5 4.5 L-2.5 0.5 Q-5.5 -2 -3.2 -5.2 A3.6 3.6 0 1 1 3.2 -5.2 Q5.5 -2 2.5 0.5 L3.5 4.5 Q8.5 6.5 8.5 11 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><ellipse cx="-1.6" cy="-7" rx="1.4" ry="1.9" fill="rgba(255,255,255,.5)" transform="rotate(-25 -1.6 -7)"/><path d="M-8 10.3 Q0 8.4 8 10.3" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`,
  bishop: (f) => `<path d="M-7 11 Q-7 6.5 -2.5 4.5 L-3.5 -1 Q-5 -7 0 -11 Q5 -7 3.5 -1 L2.5 4.5 Q7 6.5 7 11 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><circle cx="0" cy="-10.2" r="1.6" fill="${f.light}" stroke="${f.rim}" stroke-width=".8"/><path d="M-1.5 -2 L2.5 -6.5" stroke="rgba(255,255,255,.55)" stroke-width="1.2" stroke-linecap="round"/>`,
  rook: (f) => `<path d="M-7.5 11 L-7.5 -1 L-6 -3 L-6 -10 L-2.8 -10 L-2.8 -7 L-1 -7 L-1 -10 L1 -10 L1 -7 L2.8 -7 L2.8 -10 L6 -10 L6 -3 L7.5 -1 L7.5 11 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><path d="M-4.5 -1 L-4.5 9" stroke="rgba(255,255,255,.4)" stroke-width="1.4" stroke-linecap="round"/><path d="M-7.5 -1 H7.5" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`,
  crown: (f) => `<path d="M-9.5 10 L-9.5 -1 L-4.5 3.5 L0 -8.5 L4.5 3.5 L9.5 -1 L9.5 10 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><circle cx="-9.5" cy="-1.5" r="1.7" fill="${f.light}"/><circle cx="0" cy="-9" r="1.9" fill="${f.light}"/><circle cx="9.5" cy="-1.5" r="1.7" fill="${f.light}"/><path d="M-9.5 6.5 H9.5" stroke="rgba(255,255,255,.45)" stroke-width="1.4"/><circle cx="0" cy="6.5" r="1.4" fill="#fff" opacity=".8"/>`,
  cone: (f) => `<ellipse cx="0" cy="9" rx="9" ry="3.6" fill="${f.dark}"/><path d="M0 -11 L9 9 A9 3.6 0 0 1 -9 9 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><path d="M-1.2 -7 L-5.5 5" stroke="rgba(255,255,255,.45)" stroke-width="1.6" stroke-linecap="round"/>`,
  dome: (f) => `<ellipse cx="0" cy="7" rx="10.5" ry="4" fill="${f.dark}"/><path d="M-10.5 6 A10.5 10.5 0 0 1 10.5 6 A10.5 4 0 0 1 -10.5 6 Z" fill="url(#${f.rad})" stroke="${f.rim}" stroke-width="1.1"/><ellipse cx="-3.5" cy="-1.5" rx="3" ry="2" fill="rgba(255,255,255,.5)" transform="rotate(-30 -3.5 -1.5)"/>`,
  gem: (f) => `<path d="M0 -10.5 L9.5 -2.5 L0 11 L-9.5 -2.5 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><path d="M-9.5 -2.5 L-4 -6.5 L4 -6.5 L9.5 -2.5 Z" fill="rgba(255,255,255,.55)"/><path d="M-4 -6.5 L0 -2.5 L4 -6.5" fill="rgba(255,255,255,.25)"/><path d="M-9.5 -2.5 L0 -2.5 L0 11 Z" fill="rgba(255,255,255,.18)"/><path d="M0 -2.5 L9.5 -2.5 L0 11 Z" fill="rgba(0,0,0,.22)"/>`,
  star: (f) => `<path d="M${STAR} Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><path d="M0 -11 L0 0 L-6.5 -3.6 Z" fill="rgba(255,255,255,.35)"/><path d="M0 0 L6.5 8.9 L0 5 Z" fill="rgba(0,0,0,.2)"/>`,
  heart: (f) => `<path d="M0 10.5 C-12.5 1.5 -9.5 -9.5 -1.5 -6.5 C-0.5 -6 0 -5.3 0 -5.3 C0 -5.3 0.5 -6 1.5 -6.5 C9.5 -9.5 12.5 1.5 0 10.5 Z" fill="url(#${f.lin})" stroke="${f.rim}" stroke-width="1.1" stroke-linejoin="round"/><ellipse cx="-4.5" cy="-3.5" rx="2.2" ry="1.3" fill="rgba(255,255,255,.55)" transform="rotate(-35 -4.5 -3.5)"/>`
};
// 3D-shaded SVG token (24×24 box, origin centred) for a piece shape in a colour.
export function pieceSvg(shape, color, size = 24, extra = '') {
  const draw = SHAPES[shape] || SHAPES.coin; const key = String(color).replace(/[^a-z0-9]/gi, '');
  const f = { lin: `pl-${key}`, rad: `pr-${key}`, light: shade(color, 0.55), side: shade(color, -0.28), dark: shade(color, -0.5), rim: 'rgba(255,255,255,.85)' };
  const defs = `<defs><linearGradient id="${f.lin}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 0.5)}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.4)}"/></linearGradient><radialGradient id="${f.rad}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${shade(color, 0.6)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.35)}"/></radialGradient></defs>`;
  return `<g class="piece" transform="scale(${(size / 24).toFixed(3)})" ${extra}>${defs}<ellipse cx="0" cy="11" rx="9.5" ry="3" fill="rgba(0,0,0,.32)"/>${draw(f)}</g>`;
}

// Board is rotated so the viewer's base is bottom-left; names sit in the corner of their own base.
export function renderLudo(s, myIdx, nameOf, opts = {}) {
  const st = s.state, C = 30, S = 15 * C, cx = 7.5 * C;
  const colorFill = (ci) => LUDO_COLORS[ci].fill;
  const pieceOf = (pi) => (s.pieces && s.pieces[s.players[pi]]) || (st.pieces && st.pieces[pi]) || 'coin';
  const over = st.phase === 'done' || (st.winner !== null && st.finished.length >= st.n - 1);
  const rot = opts.rotate === false || myIdx < 0 ? 0 : ((3 - st.colors[myIdx] + 4) % 4) * 90;
  let svg = `<svg viewBox="0 0 ${S} ${S}" class="ludo" style="--rot:${rot}deg"><g class="board" transform="rotate(${rot} ${cx} ${cx})">`;
  for (let ci = 0; ci < 4; ci++) {
    const [ox, oy] = BASE_ORIGIN[ci]; const active = st.colors.includes(ci); const fill = active ? colorFill(ci) : '#9aa3ad';
    svg += `<rect x="${ox * C}" y="${oy * C}" width="${6 * C}" height="${6 * C}" fill="${fill}" opacity="${active ? 1 : .3}"/><rect x="${(ox + 1) * C}" y="${(oy + 1) * C}" width="${4 * C}" height="${4 * C}" rx="14" fill="#fff"/>`;
    for (const [bx, by] of BASE_SPOTS) svg += `<circle cx="${(ox + bx + 0.5) * C}" cy="${(oy + by + 0.5) * C}" r="${C * 0.5}" fill="${fill}" opacity="${active ? 1 : .35}"/><circle cx="${(ox + bx + 0.5) * C}" cy="${(oy + by + 0.5) * C}" r="${C * 0.5}" fill="none" stroke="#fff" stroke-width="2.5" opacity=".9"/>`;
  }
  TRACK.forEach(([c, r], i) => {
    const startOf = START.indexOf(i); const fill = startOf >= 0 ? colorFill(startOf) : '#fff';
    svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${fill}" stroke="#c9d1db" stroke-width="1.2"/>`;
    if (SAFE.has(i) && startOf < 0) svg += `<text class="safe-star" x="${(c + 0.5) * C}" y="${(r + 0.5) * C + 6}" text-anchor="middle" font-size="18" fill="#9aa5b1">★</text>`;
    if (startOf >= 0) svg += `<text x="${(c + 0.5) * C}" y="${(r + 0.5) * C + 6}" text-anchor="middle" font-size="16" fill="rgba(255,255,255,.85)" transform="rotate(${startOf * 90} ${(c + 0.5) * C} ${(r + 0.5) * C})">➜</text>`;
  });
  HOME_COL.forEach((cells, ci) => { for (const [c, r] of cells) svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${colorFill(ci)}" opacity=".85" stroke="#c9d1db" stroke-width="1.2"/>`; });
  const m = 6 * C, M = 9 * C;
  svg += `<path d="M${m} ${m}L${cx} ${cx}L${m} ${M}Z" fill="${colorFill(0)}"/><path d="M${m} ${m}L${cx} ${cx}L${M} ${m}Z" fill="${colorFill(1)}"/><path d="M${M} ${m}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(2)}"/><path d="M${m} ${M}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(3)}"/>`;
  const legal = new Set(st.turn === myIdx ? LUDO.legal(st, myIdx) : []);
  const occupancy = {}; const placed = [];
  st.tokens.forEach((toks, pi) => {
    const ci = st.colors[pi];
    toks.forEach((pos, i) => {
      let [x, y] = ludoXY(st, pi, i, pos, C);
      if (pos >= 0 && pos < 56) { const [c, r] = cellOf(ci, pos); const key = c + ',' + r; const k = occupancy[key] = (occupancy[key] || 0) + 1; x += ((k - 1) % 2) * 7 - 3; y += Math.floor((k - 1) / 2) * 7 - 3; }
      const can = pi === myIdx && legal.has(i);
      placed.push({ x, y, ci, pi, i, pos, can, cap: can && ludoCaptures(st, pi, i), mine: pi === myIdx, shape: pieceOf(pi) });
    });
  });
  for (const t of placed) if (t.can) {
    const to = t.pos === -1 ? 0 : t.pos + st.dice; const [tx, ty] = ludoXY(st, t.pi, t.i, to, C);
    svg += `<circle class="target ${t.cap ? 'cap' : ''}" cx="${tx}" cy="${ty}" r="${C * 0.42}" fill="none" stroke="${t.cap ? '#ff4d5e' : colorFill(t.ci)}" stroke-width="3" stroke-dasharray="5 4"/>`;
  }
  for (const t of placed) {
    svg += `<g class="tok ${t.can ? 'can' : ''} ${t.cap ? 'cap' : ''} ${t.pos === 56 ? 'home' : ''}" data-key="${t.pi}-${t.i}" ${t.can ? `data-tok="${t.i}"` : ''} style="--tx:${t.x}px;--ty:${t.y}px"><g transform="rotate(${-rot})">${pieceSvg(t.shape, colorFill(t.ci), C * 1.2)}</g></g>`;
  }
  svg += '</g>';
  // Names in the corner of each player's base (screen position after rotation).
  st.colors.forEach((ci, pi) => {
    const q = (ci + rot / 90) % 4; const [ox, oy] = BASE_ORIGIN[q]; const lx = (ox + 3) * C, ly = (oy ? 14.5 : 0.5) * C; const isTurn = st.turn === pi && !over;
    svg += `<g class="lname ${isTurn ? 'turn' : ''} ${pi === myIdx ? 'me' : ''}" style="--c:${colorFill(ci)}"><rect x="${lx - 2.6 * C}" y="${ly - 0.4 * C}" width="${5.2 * C}" height="${0.8 * C}" rx="12"/><text x="${lx}" y="${ly + 5}" text-anchor="middle" font-size="14" font-weight="700">${esc(nameOf(s.players[pi]))}${st.finished.includes(pi) ? ' 🏁' : ''}</text></g>`;
  });
  svg += '</svg>';
  const myTurn = st.turn === myIdx && !over;
  const turnName = st.turn === myIdx ? 'Your' : esc(nameOf(s.players[st.turn])) + "'s";
  let status = '';
  if (st.winner !== null) status = `🏆 ${st.winner === myIdx ? 'You won!' : esc(nameOf(s.players[st.winner])) + ' won'}${over ? '' : ' · others still playing'}`;
  if (!over) {
    if (st.phase === 'roll') status = `${turnName} turn — ${myTurn ? 'roll the dice' : 'rolling…'}`;
    else status = `${turnName} turn — rolled ${st.dice}${myTurn ? ', pick a token' : ''}`;
  }
  const dice = `<button class="dice ${myTurn && st.phase === 'roll' ? 'can' : ''}" data-game-act="roll" data-d="${st.dice || 0}" ${myTurn && st.phase === 'roll' ? '' : 'disabled'} aria-label="Dice"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></button>`;
  const turnColor = colorFill(st.colors[st.turn]);
  return `${svg}<div class="ludo-bar" style="--turn:${turnColor}">${dice}<div class="game-status">${status}</div></div>`;
}
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const ludoSeen = {};
function animateLudo(ctx, s, body) {
  const st = s.state, last = st.last, seq = st.seq || 0;
  const prev = ludoSeen[s.id]; ludoSeen[s.id] = seq;
  const svg = body.querySelector('.ludo'); if (!svg) return;
  const myTurn = s.players[st.turn] === ctx.pk;
  if (myTurn && st.phase === 'move' && prev !== undefined && seq !== prev) svg.classList.add('waiting');
  if (prev === undefined || seq === prev || !last || ctx.reduced) { svg.classList.remove('waiting'); return; }
  if (last.a === 'roll') {
    const dice = body.querySelector('.dice'); if (!dice) return;
    svg.classList.add('waiting'); dice.classList.add('rolling');
    for (let k = 0; k < 6; k++) ctx.fx(500 + Math.random() * 500, 0.04, k * 0.11, 0.05, 'square');
    setTimeout(() => { dice.classList.remove('rolling'); dice.dataset.d = last.d; svg.classList.remove('waiting'); ctx.haptic(10); ctx.fx(last.d === 6 ? 1400 : 900, 0.12, 0, 0.06, 'sine'); }, 1100);
    return;
  }
  if (last.a !== 'move') return;
  const tok = svg.querySelector(`[data-key="${last.pi}-${last.i}"]`);
  let dur = 0;
  if (tok) {
    const pts = [];
    if (last.from === -1) pts.push(ludoXY(st, last.pi, last.i, -1), ludoXY(st, last.pi, last.i, 0));
    else for (let p = last.from; p <= last.to; p++) pts.push(ludoXY(st, last.pi, last.i, p));
    pts[pts.length - 1] = [parseFloat(tok.style.getPropertyValue('--tx')), parseFloat(tok.style.getPropertyValue('--ty'))];
    const n = pts.length - 1; if (n < 1) return;
    const frames = [];
    pts.forEach(([x, y], k) => {
      frames.push({ transform: `translate(${x}px,${y}px) scale(1)`, offset: k / n });
      if (k < n) { const [nx, ny] = pts[k + 1]; frames.push({ transform: `translate(${(x + nx) / 2}px,${(y + ny) / 2 - 6}px) scale(1.35)`, offset: (k + 0.5) / n }); }
    });
    dur = Math.max(480, Math.min(1500, 170 * n + 150));
    svg.classList.add('waiting'); tok.classList.add('moving'); tok.parentNode.appendChild(tok);
    const a = tok.animate(frames, { duration: dur, easing: 'linear', fill: 'both' });
    for (let k = 1; k <= n; k++) ctx.fx(700 + k * 40, 0.03, (dur / n) * k / 1000, 0.04);
    a.onfinish = () => { a.cancel(); tok.classList.remove('moving'); svg.classList.remove('waiting'); ctx.haptic(8); if (last.finished) { ctx.fx(1000, 0.15, 0, 0.06, 'sine'); ctx.fx(1500, 0.25, 0.12, 0.06, 'sine'); ctx.confetti(body, 24); } };
  }
  for (const c of last.caps || []) {
    const ct = svg.querySelector(`[data-key="${c.pi}-${c.i}"]`); if (!ct) continue;
    const [sx, sy] = ludoXY(st, c.pi, c.i, c.from); const fxp = parseFloat(ct.style.getPropertyValue('--tx')), fyp = parseFloat(ct.style.getPropertyValue('--ty'));
    ct.parentNode.appendChild(ct);
    const a = ct.animate([
      { transform: `translate(${sx}px,${sy}px) scale(1)` }, { transform: `translate(${sx}px,${sy}px) scale(1.5) rotate(20deg)`, offset: 0.3 },
      { transform: `translate(${fxp}px,${fyp}px) scale(0.5)`, offset: 0.85 }, { transform: `translate(${fxp}px,${fyp}px) scale(1)` },
    ], { duration: 900, delay: Math.max(0, dur - 120), easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' });
    a.onfinish = () => a.cancel();
    setTimeout(() => { body.classList.remove('game-flash'); void body.offsetWidth; body.classList.add('game-flash'); ctx.haptic(30); ctx.fx(300, 0.25, 0, 0.08, 'sawtooth'); if (c.pi === ctx.my) ctx.toast('Your token was captured!'); else if (last.pi === ctx.my) ctx.toast('Captured! 🎯'); }, Math.max(0, dur - 120));
  }
}

export function view(ctx) {
  let el, autoTimer = null;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state;
      el.innerHTML = renderLudo(s, ctx.my, ctx.nameOf, { rotate: !ctx.local });
      animateLudo(ctx, s, el);
      el.querySelectorAll('[data-game-act=roll]').forEach((b) => { b.onclick = () => { ctx.haptic(15); b.disabled = true; ctx.move({ a: 'roll', d: 1 + Math.floor(Math.random() * 6) }); }; });
      el.querySelectorAll('.tok.can').forEach((t) => { t.onclick = () => { ctx.haptic(); ctx.move({ a: 'move', i: Number(t.dataset.tok) }); }; });
      clearTimeout(autoTimer);
      if (ctx.my >= 0 && st.phase === 'move' && st.turn === ctx.my) {
        const legal = LUDO.legal(st, ctx.my);
        if (legal.length === 1) autoTimer = setTimeout(() => ctx.move({ a: 'move', i: legal[0] }), 1150);
      }
    },
    unmount() { clearTimeout(autoTimer); el = null; },
  };
}
