// Checkers (draughts) — forced captures, multi-jumps, kings.
import { esc, scoreStrip } from './util.js';

export const meta = { name: 'Checkers', icon: '⚫', min: 2, max: 2, color: '#ef4444', blurb: 'Jump, capture, crown kings. Captures are mandatory.', series: 1 };
const dark = (i) => ((i >> 3) + (i & 7)) % 2 === 1;
const owner = (v) => (v < 0 ? -1 : v & 1);
const king = (v) => v >= 2;

function movesFor(st, pi, from) {
  const v = st.b[from]; if (v < 0 || owner(v) !== pi) return [];
  const r = from >> 3, c = from & 7;
  const dirs = king(v) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : (pi === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
  const steps = [], jumps = [];
  for (const [dr, dc] of dirs) {
    const r1 = r + dr, c1 = c + dc; if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
    const i1 = r1 * 8 + c1;
    if (st.b[i1] === -1) steps.push({ from, to: i1 });
    else if (owner(st.b[i1]) === 1 - pi) {
      const r2 = r + 2 * dr, c2 = c + 2 * dc; if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
      const i2 = r2 * 8 + c2; if (st.b[i2] === -1) jumps.push({ from, to: i2, cap: i1 });
    }
  }
  return { steps, jumps };
}
function legalMoves(st, pi) {
  if (st.chain !== null && st.chain !== undefined) return movesFor(st, pi, st.chain).jumps;
  let steps = [], jumps = [];
  for (let i = 0; i < 64; i++) if (st.b[i] >= 0 && owner(st.b[i]) === pi) { const m = movesFor(st, pi, i); steps = steps.concat(m.steps); jumps = jumps.concat(m.jumps); }
  return jumps.length ? jumps : steps;
}
const start = () => { const b = Array(64).fill(-1); for (let i = 0; i < 64; i++) if (dark(i)) { if (i < 24) b[i] = 1; else if (i >= 40) b[i] = 0; } return b; };

export const engine = {
  init() { return { b: start(), turn: 0, winner: null, draw: false, chain: null, last: null, round: 1, score: [0, 0], n: 0, quiet: 0 }; },
  legal(st, pi) { return engine.over(st) || pi !== st.turn ? [] : legalMoves(st, pi); },
  apply(st, pi, mv) {
    if (engine.over(st) || pi !== st.turn) return false;
    const from = Number(mv.from), to = Number(mv.to);
    const m = legalMoves(st, pi).find((x) => x.from === from && x.to === to); if (!m) return false;
    const v = st.b[from]; st.b[from] = -1; st.b[to] = v; st.n++;
    let crowned = false;
    if (m.cap !== undefined) { st.b[m.cap] = -1; st.quiet = 0; } else st.quiet++;
    if (!king(v) && ((pi === 0 && to < 8) || (pi === 1 && to >= 56))) { st.b[to] = v + 2; crowned = true; }
    const path = st.last && st.last.pi === pi && st.chain === from ? st.last.path.concat([to]) : [from, to];
    const caps = st.last && st.last.pi === pi && st.chain === from ? st.last.caps.concat(m.cap !== undefined ? [m.cap] : []) : (m.cap !== undefined ? [m.cap] : []);
    st.last = { pi, path, caps, crowned, n: st.n };
    st.chain = null;
    if (m.cap !== undefined && !crowned && movesFor(st, pi, to).jumps.length) { st.chain = to; return true; }
    st.turn = 1 - pi;
    const oppHas = st.b.some((x) => x >= 0 && owner(x) === 1 - pi);
    if (!oppHas || !legalMoves(st, 1 - pi).length) { st.winner = pi; st.score[pi]++; }
    else if (st.quiet >= 80) st.draw = true;
    return true;
  },
  again(st) { Object.assign(st, { b: start(), turn: st.round % 2, winner: null, draw: false, chain: null, last: null, round: st.round + 1, n: 0, quiet: 0 }); },
  over(st) { return st.winner !== null || st.draw; },
};

export function view(ctx) {
  let el, sel = null, seen = -1;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; seen = `${st.round}:${st.n}`;
      const legal = mine ? legalMoves(st, ctx.my) : [];
      if (st.chain !== null && st.chain !== undefined && mine) sel = st.chain;
      if (sel !== null && !legal.some((m) => m.from === sel)) sel = null;
      const froms = new Set(legal.map((m) => m.from)), tgts = new Set(legal.filter((m) => m.from === sel).map((m) => m.to));
      const flip = ctx.my === 1; // each player sees their own pieces at the bottom
      const counts = [0, 0]; st.b.forEach((v) => { if (v >= 0) counts[owner(v)]++; });
      let cells = '';
      for (let k = 0; k < 64; k++) {
        const i = flip ? 63 - k : k; const v = st.b[i];
        const isLast = fresh && st.last.path.includes(i);
        cells += `<div class="ck-cell ${dark(i) ? 'd' : 'l'} ${tgts.has(i) ? 'tgt' : ''} ${isLast ? 'last' : ''}" data-i="${i}">${v >= 0 ? `<div class="ck-piece p${owner(v)} ${king(v) ? 'king' : ''} ${froms.has(i) ? 'can' : ''} ${sel === i ? 'sel' : ''}" data-i="${i}"></div>` : ''}</div>`;
      }
      const status = over ? (st.draw ? "It's a draw" : st.winner === ctx.my ? 'You win!' : `${esc(ctx.nameOf(s.players[st.winner]))} wins`)
        : mine ? (st.chain !== null && st.chain !== undefined ? 'Keep jumping!' : legal[0] && legal[0].cap !== undefined ? 'Your turn — you must capture' : sel !== null ? 'Pick a square' : 'Your turn') : `${esc(ctx.nameOf(s.players[st.turn]))}'s turn`;
      el.innerHTML = `${scoreStrip(ctx, s, over, ['<i class="ck-dot p0"></i>', '<i class="ck-dot p1"></i>'])}
        <div class="g-round">${12 - counts[1]} captured by ${esc(ctx.nameOf(s.players[0]))} · ${12 - counts[0]} by ${esc(ctx.nameOf(s.players[1]))}</div>
        <div class="ck ${mine ? 'mine' : ''} ${over ? 'over' : ''}">${cells}</div><div class="game-status">${status}</div>`;
      if (mine) {
        el.querySelectorAll('.ck-piece.can').forEach((p) => { p.onclick = () => { ctx.haptic(8); sel = sel === Number(p.dataset.i) ? null : Number(p.dataset.i); this.update(s); }; });
        el.querySelectorAll('.ck-cell.tgt').forEach((c) => { c.onclick = () => { const to = Number(c.dataset.i), from = sel; sel = null; ctx.haptic(); ctx.fx(500, 0.06, 0, 0.05); ctx.move({ from, to }); }; });
      }
      if (fresh && !ctx.reduced) {
        const path = st.last.path, to = path[path.length - 1], from = path[path.length - 2];
        const a = el.querySelector(`.ck-cell[data-i="${from}"]`), b = el.querySelector(`.ck-piece[data-i="${to}"]`);
        if (a && b) { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); b.animate([{ transform: `translate(${ra.left - rb.left}px,${ra.top - rb.top}px) scale(1.15)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.3,.7,.3,1)' }); }
        if (st.last.caps.length) { ctx.fx(240, 0.12, 0.25, 0.08, 'sawtooth'); if (st.last.pi !== ctx.my) ctx.haptic(25); }
        if (st.last.crowned) { ctx.fx(900, 0.1, 0.3, 0.06, 'sine'); ctx.fx(1350, 0.2, 0.4, 0.06, 'sine'); }
      }
    },
    unmount() { el = null; },
  };
}
