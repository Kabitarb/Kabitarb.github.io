// Dots & Boxes — 5×5 dots (16 boxes); closing a box gives another turn.
import { esc, scoreStrip } from './util.js';
import { PLAYER_COLORS } from './util.js';

const N = 5; // dots per side
export const meta = { name: 'Dots & Boxes', icon: '🟦', min: 2, max: 4, color: '#8b5cf6', blurb: 'Draw lines, close boxes, steal chains. 2–4 players.', series: 3 };

// h[r][c]: horizontal edge from dot (r,c) to (r,c+1) — r in 0..4, c in 0..3
// v[r][c]: vertical edge from dot (r,c) to (r+1,c) — r in 0..3, c in 0..4
const blank = (n = 2) => ({ h: Array.from({ length: N }, () => Array(N - 1).fill(0)), v: Array.from({ length: N - 1 }, () => Array(N).fill(0)), box: Array((N - 1) * (N - 1)).fill(-1), turn: 0, n, pts: Array(n).fill(0), winner: null, draw: false, last: null, moves: 0 });
const boxDone = (st, r, c) => st.h[r][c] && st.h[r + 1][c] && st.v[r][c] && st.v[r][c + 1];

export const engine = {
  init(n = 2) { return Object.assign(blank(n), { round: 1, score: Array(n).fill(0) }); },
  apply(st, pi, mv) {
    if (engine.over(st) || pi !== st.turn) return false;
    const r = Number(mv.r), c = Number(mv.c);
    const grid = mv.t === 'h' ? st.h : mv.t === 'v' ? st.v : null;
    if (!grid || !grid[r] || grid[r][c] === undefined || grid[r][c]) return false;
    grid[r][c] = 1 + pi;
    st.moves++;
    const closed = [];
    const check = (br, bc) => { if (br >= 0 && br < N - 1 && bc >= 0 && bc < N - 1 && st.box[br * (N - 1) + bc] === -1 && boxDone(st, br, bc)) { st.box[br * (N - 1) + bc] = pi; closed.push(br * (N - 1) + bc); } };
    if (mv.t === 'h') { check(r - 1, c); check(r, c); } else { check(r, c - 1); check(r, c); }
    st.pts[pi] += closed.length;
    st.last = { t: mv.t, r, c, pi, closed };
    if (st.box.every((b) => b !== -1)) {
      const best = Math.max(...st.pts); const tops = st.pts.map((p, i) => (p === best ? i : -1)).filter((i) => i >= 0);
      if (tops.length > 1) st.draw = true; else { st.winner = tops[0]; st.score[st.winner]++; }
      return true;
    }
    if (!closed.length) st.turn = (st.turn + 1) % (st.n || 2);
    return true;
  },
  again(st) { const round = st.round + 1, score = st.score, n = st.n || 2; Object.assign(st, blank(n), { round, score, turn: (round - 1) % n }); },
  over(st) { return st.winner !== null || st.draw; },
};

export function view(ctx) {
  let el, seen = -1;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.moves}`; seen = `${st.round}:${st.moves}`;
      const S = 20, G = 60, size = S * 2 + G * (N - 1);
      const P = (i) => PLAYER_COLORS[i];
      let svg = `<svg viewBox="0 0 ${size} ${size}" class="dots ${mine ? 'mine' : ''}">`;
      st.box.forEach((b, i) => { const r = Math.floor(i / (N - 1)), c = i % (N - 1); if (b >= 0) svg += `<rect class="dbox ${fresh && st.last.closed.includes(i) ? 'pop' : ''}" x="${S + c * G + 4}" y="${S + r * G + 4}" width="${G - 8}" height="${G - 8}" rx="10" fill="${P(b)}" opacity=".28"/><text x="${S + c * G + G / 2}" y="${S + r * G + G / 2 + 7}" text-anchor="middle" font-size="20" font-weight="700" fill="${P(b)}">${esc(ctx.nameOf(s.players[b])[0].toUpperCase())}</text>`; });
      const line = (t, r, c, x1, y1, x2, y2) => { const v = t === 'h' ? st.h[r][c] : st.v[r][c]; const isLast = fresh && st.last.t === t && st.last.r === r && st.last.c === c; return `<line class="dl ${v ? 'on' : mine ? 'can' : ''} ${isLast ? 'draw' : ''}" data-t="${t}" data-r="${r}" data-c="${c}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${v ? P(v - 1) : 'currentColor'}"/>`; };
      for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) svg += line('h', r, c, S + c * G, S + r * G, S + (c + 1) * G, S + r * G);
      for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) svg += line('v', r, c, S + c * G, S + r * G, S + c * G, S + (r + 1) * G);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) svg += `<circle class="dot" cx="${S + c * G}" cy="${S + r * G}" r="5"/>`;
      svg += '</svg>';
      const tally = st.pts.map((p, i) => `<b style="color:${P(i)}">${p}</b>`).join(' : ');
      const status = over ? (st.draw ? "It's a draw" : st.winner === ctx.my ? `You win with ${st.pts[st.winner]} boxes!` : `${esc(ctx.nameOf(s.players[st.winner]))} wins with ${st.pts[st.winner]} boxes`)
        : mine ? (fresh && st.last.pi === ctx.my && st.last.closed.length ? 'Box! Go again' : 'Your turn — draw a line') : `${esc(ctx.nameOf(s.players[st.turn]))}'s turn`;
      el.innerHTML = `${scoreStrip(ctx, s, over)}
        <div class="g-round">Round ${st.round} · boxes ${tally}</div>
        <div class="dots-wrap">${svg}</div><div class="game-status">${status}</div>`;
      el.querySelectorAll('.dl.can').forEach((l) => { l.onclick = () => { ctx.haptic(); ctx.fx(600, 0.05, 0, 0.05); ctx.move({ t: l.dataset.t, r: Number(l.dataset.r), c: Number(l.dataset.c) }); }; });
      if (fresh && st.last.closed.length) { ctx.fx(880, 0.1, 0, 0.06, 'sine'); ctx.fx(1320, 0.15, 0.08, 0.06, 'sine'); if (st.last.pi === ctx.my) ctx.haptic([20, 40, 20]); }
    },
    unmount() { el = null; },
  };
}
