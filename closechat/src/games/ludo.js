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
export function renderLudo(s, myIdx, nameOf) {
  const st = s.state, C = 30, S = 15 * C;
  let svg = `<svg viewBox="0 0 ${S} ${S}" class="ludo">`;
  const colorFill = (ci) => LUDO_COLORS[ci].fill;
  const quad = (ci) => {
    const [ox, oy] = BASE_ORIGIN[ci];
    const active = st.colors.includes(ci);
    svg += `<rect x="${ox * C}" y="${oy * C}" width="${6 * C}" height="${6 * C}" rx="10" fill="${active ? colorFill(ci) : '#8892a0'}" opacity="${active ? 1 : .35}"/>
      <rect x="${(ox + 1) * C}" y="${(oy + 1) * C}" width="${4 * C}" height="${4 * C}" rx="8" fill="#fff" opacity=".92"/>`;
    for (const [bx, by] of BASE_SPOTS) svg += `<circle cx="${(ox + bx + 0.5) * C}" cy="${(oy + by + 0.5) * C}" r="${C * 0.36}" fill="${active ? colorFill(ci) : '#cfd5dd'}" opacity=".25"/>`;
  };
  for (let ci = 0; ci < 4; ci++) quad(ci);
  TRACK.forEach(([c, r], i) => {
    const startOf = START.indexOf(i);
    const fill = startOf >= 0 ? colorFill(startOf) : '#fff';
    svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${fill}" stroke="#c9d1db" stroke-width="1.2"/>`;
    if (SAFE.has(i) && startOf < 0) svg += `<text class="safe-star" x="${(c + 0.5) * C}" y="${(r + 0.5) * C + 6}" text-anchor="middle" font-size="18" fill="#9aa5b1">★</text>`;
  });
  HOME_COL.forEach((cells, ci) => { for (const [c, r] of cells) svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${colorFill(ci)}" opacity=".85" stroke="#c9d1db" stroke-width="1.2"/>`; });
  const cx = 7.5 * C, m = 6 * C, M = 9 * C;
  svg += `<path d="M${m} ${m}L${cx} ${cx}L${m} ${M}Z" fill="${colorFill(0)}"/><path d="M${m} ${m}L${cx} ${cx}L${M} ${m}Z" fill="${colorFill(1)}"/><path d="M${M} ${m}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(2)}"/><path d="M${m} ${M}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(3)}"/>`;
  // tokens
  const legal = new Set(st.turn === myIdx ? LUDO.legal(st, myIdx) : []);
  const occupancy = {};
  const placed = [];
  st.tokens.forEach((toks, pi) => {
    const ci = st.colors[pi];
    toks.forEach((pos, i) => {
      let x, y;
      if (pos === -1) { const [ox, oy] = BASE_ORIGIN[ci]; const [bx, by] = BASE_SPOTS[i]; x = (ox + bx + 0.5) * C; y = (oy + by + 0.5) * C; }
      else { const [c, r] = cellOf(ci, pos); const key = c + ',' + r; const k = occupancy[key] = (occupancy[key] || 0) + 1; x = (c + 0.5) * C + ((k - 1) % 2) * 7 - 3; y = (r + 0.5) * C + Math.floor((k - 1) / 2) * 7 - 3; if (pos === 56) { x = cx + (ci % 2 ? 0 : (ci === 0 ? -20 : 20)); y = cx + (ci % 2 ? (ci === 1 ? -20 : 20) : 0); } }
      const can = pi === myIdx && legal.has(i);
      placed.push({ x, y, ci, pi, i, pos, can, cap: can && ludoCaptures(st, pi, i), mine: pi === myIdx });
    });
  });
  // where legal tokens would land (ghost targets)
  for (const t of placed) if (t.can) {
    const to = t.pos === -1 ? 0 : t.pos + st.dice; const [tx, ty] = ludoXY(st, t.pi, t.i, to, C);
    svg += `<circle class="target ${t.cap ? 'cap' : ''}" cx="${tx}" cy="${ty}" r="${C * 0.42}" fill="none" stroke="${t.cap ? '#ff4d5e' : colorFill(t.ci)}" stroke-width="3" stroke-dasharray="5 4"/>`;
  }
  for (const t of placed) {
    svg += `<g class="tok ${t.can ? 'can' : ''} ${t.cap ? 'cap' : ''} ${t.pos === 56 ? 'home' : ''}" data-key="${t.pi}-${t.i}" ${t.can ? `data-tok="${t.i}"` : ''} style="--tx:${t.x}px;--ty:${t.y}px"><circle cx="0" cy="${C * 0.08}" r="${C * 0.4}" fill="rgba(0,0,0,.25)"/><circle cx="0" cy="0" r="${C * 0.4}" fill="${colorFill(t.ci)}" stroke="${t.can ? '#fff' : 'rgba(0,0,0,.5)'}" stroke-width="${t.can ? 3.5 : 2}"/><circle cx="-3" cy="-3" r="${C * 0.14}" fill="#fff" opacity=".7"/></g>`;
  }
  svg += '</svg>';
  const over = st.phase === 'done' || (st.winner !== null && st.finished.length >= st.n - 1);
  const myTurn = st.turn === myIdx && !over;
  const turnName = st.turn === myIdx ? 'Your' : esc(nameOf(s.players[st.turn])) + "'s";
  let status = '';
  if (st.winner !== null) status = `🏆 ${st.winner === myIdx ? 'You won!' : esc(nameOf(s.players[st.winner])) + ' won'}${over ? '' : ' · others still playing'}`;
  if (!over) {
    if (st.phase === 'roll') status = `${turnName} turn — ${myTurn ? 'roll the dice' : 'rolling…'}`;
    else status = `${turnName} turn — rolled ${st.dice}${myTurn ? ', pick a token' : ''}`;
  }
  const players = s.players.map((p, i) => `<span class="ludo-player ${st.turn === i && !over ? 'active' : ''}" style="--c:${colorFill(st.colors[i])}"><i></i>${esc(nameOf(p))}${st.finished.includes(i) ? ' 🏁' : ''}</span>`).join('');
  const dice = `<button class="dice ${myTurn && st.phase === 'roll' ? 'can' : ''}" data-game-act="roll" data-d="${st.dice || 0}" ${myTurn && st.phase === 'roll' ? '' : 'disabled'} aria-label="Dice"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></button>`;
  const turnColor = colorFill(st.colors[st.turn]);
  return `<div class="ludo-players">${players}</div>${svg}<div class="ludo-bar" style="--turn:${turnColor}">${dice}<div class="game-status">${status}</div></div>`;
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
    setTimeout(() => { dice.classList.remove('rolling'); dice.dataset.d = last.d; svg.classList.remove('waiting'); ctx.haptic(10); ctx.fx(last.d === 6 ? 1400 : 900, 0.12, 0, 0.06, 'sine'); }, 760);
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
      el.innerHTML = renderLudo(s, ctx.my, ctx.nameOf);
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
