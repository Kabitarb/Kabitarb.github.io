// 2048 Duel — both players get the same tile sequence on their own board; highest score when time is up wins.
import { rng, esc, scoreStrip } from './util.js';

export const meta = { name: '2048 Duel', icon: '🔢', min: 2, max: 2, color: '#8b5cf6', blurb: 'Same tiles, two boards. Highest score in 2 minutes wins.', series: 1, simul: true, isNew: true };
const N = 4, TIME = 120;

function spawn(b, seed, pi, k) {
  const r = rng(((seed >>> 0) ^ ((pi + 1) * 7919) ^ (k * 104729)) >>> 0);
  const empty = []; b.forEach((v, i) => { if (!v) empty.push(i); });
  if (!empty.length) return;
  b[empty[Math.floor(r() * empty.length)]] = r() < 0.9 ? 2 : 4;
}
// d: 0 left, 1 up, 2 right, 3 down
export function slide(b, d) {
  let gained = 0, moved = false; const nb = b.slice(); const merged = [];
  for (let i = 0; i < N; i++) {
    const idx = []; for (let j = 0; j < N; j++) idx.push(d === 0 ? i * N + j : d === 2 ? i * N + (N - 1 - j) : d === 1 ? j * N + i : (N - 1 - j) * N + i);
    const vals = idx.map((k) => nb[k]).filter(Boolean); const out = [];
    for (let k = 0; k < vals.length; k++) { if (vals[k] === vals[k + 1]) { out.push(vals[k] * 2); gained += vals[k] * 2; merged.push(idx[out.length - 1]); k++; } else out.push(vals[k]); }
    while (out.length < N) out.push(0);
    idx.forEach((k, j) => { if (nb[k] !== out[j]) moved = true; nb[k] = out[j]; });
  }
  return { b: nb, gained, moved, merged };
}
const canMove = (b) => [0, 1, 2, 3].some((d) => slide(b, d).moved);
function finish(st) { st.done = true; st.winner = st.scores[0] === st.scores[1] ? -1 : st.scores[0] > st.scores[1] ? 0 : 1; }

export const engine = {
  init(n, seed) {
    const boards = [0, 1].map((pi) => { const b = Array(16).fill(0); spawn(b, seed, pi, 0); spawn(b, seed, pi, 1); return b; });
    return { seed, boards, scores: [0, 0], moves: [0, 0], stuck: [false, false], best: [2, 2], endsAt: Date.now() + TIME * 1000, winner: null, done: false };
  },
  myTurn(st, pi) { return !st.done && !st.stuck[pi]; },
  apply(st, pi, mv) {
    if (st.done) return false;
    if (mv.a === 'end') { if (Date.now() < st.endsAt - 500 && !(st.stuck[0] && st.stuck[1])) return false; finish(st); return true; }
    if (st.stuck[pi] || Date.now() > st.endsAt + 3000) return false;
    const d = Number(mv.d); if (!(d >= 0 && d < 4)) return false;
    const r = slide(st.boards[pi], d); if (!r.moved) return false;
    st.boards[pi] = r.b; st.scores[pi] += r.gained; st.moves[pi]++;
    spawn(st.boards[pi], st.seed, pi, st.moves[pi] + 1);
    st.best[pi] = Math.max(...st.boards[pi]);
    if (!canMove(st.boards[pi])) st.stuck[pi] = true;
    if (st.stuck[0] && st.stuck[1]) finish(st);
    return true;
  },
  // Both players move at once: keep whichever side of each board is newer.
  merge(st, other) {
    let ch = false;
    for (const i of [0, 1]) if ((other.moves?.[i] || 0) > (st.moves[i] || 0)) { st.boards[i] = other.boards[i]; st.scores[i] = other.scores[i]; st.moves[i] = other.moves[i]; st.stuck[i] = other.stuck[i]; st.best[i] = other.best[i]; ch = true; }
    if (other.done && !st.done) { st.done = true; ch = true; }
    if (st.done && ch) finish(st);
    return ch;
  },
  over(st) { return st.done; },
};

const TILE_BG = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
export function view(ctx) {
  let el, iv = 0, endSent = false, s0 = null, lastMoves = null;
  const board = (b, big, merged = []) => `<div class="d2-board ${big ? 'big' : 'small'}">${b.map((v, i) => `<div class="d2-tile ${v ? 'v' + Math.min(v, 2048) : ''} ${merged.includes(i) ? 'pop' : ''}" style="${v ? `background:${TILE_BG[v] || '#3c3a32'};color:${v > 4 ? '#f9f6f2' : '#776e65'}` : ''}">${v || ''}</div>`).join('')}</div>`;
  const mv = (d) => { if (!s0 || !engine.myTurn(s0.state, ctx.my)) return; const r = slide(s0.state.boards[ctx.my], d); if (!r.moved) { ctx.haptic(5); return; } ctx.haptic(); ctx.fx(r.gained ? 700 : 500, 0.05, 0, 0.04, 'sine'); ctx.move({ d }); };
  const onKey = (e) => { const d = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3 }[e.key]; if (d !== undefined) { e.preventDefault(); mv(d); } };
  return {
    mount(host) {
      el = host; window.addEventListener('keydown', onKey);
      iv = setInterval(() => { if (!s0 || !el) return; const st = s0.state; const left = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000)); const t = el.querySelector('#d2-time'); if (t) { t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; t.classList.toggle('low', left <= 10); } if (!st.done && Date.now() > st.endsAt && !endSent) { endSent = true; ctx.move({ a: 'end' }); } }, 500);
    },
    update(s) {
      s0 = s; const st = s.state, me = ctx.my, op = 1 - me, over = engine.over(st);
      const merged = lastMoves !== null && st.moves[me] > lastMoves ? slide(st.boards[me], 0).merged.length ? [] : [] : [];
      lastMoves = st.moves[me];
      const left = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000));
      el.innerHTML = `${scoreStrip(ctx, s, over)}
        <div class="d2-top"><span class="d2-score me">You <b>${st.scores[me]}</b></span><span class="d2-time ${left <= 10 ? 'low' : ''}" id="d2-time">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span><span class="d2-score">${esc(ctx.nameOf(s.players[op]))} <b>${st.scores[op]}</b></span></div>
        <div class="d2 ${over ? 'over' : ''}">${board(st.boards[me], true, merged)}<div class="d2-side"><div class="tiny muted">${esc(ctx.nameOf(s.players[op]))}${st.stuck[op] ? ' · stuck' : ''}</div>${board(st.boards[op], false)}<div class="tiny muted">best ${st.best[op]}</div></div></div>
        <div class="d2-pad"><button data-d="1" aria-label="Up">▲</button><div><button data-d="0" aria-label="Left">◀</button><button data-d="3" aria-label="Down">▼</button><button data-d="2" aria-label="Right">▶</button></div></div>
        <div class="game-status">${over ? (st.winner === me ? 'You win!' : st.winner < 0 ? "It's a draw" : `${esc(ctx.nameOf(s.players[st.winner]))} wins`) : st.stuck[me] ? 'No moves left — waiting for the clock' : 'Swipe or use the arrows · merge tiles to score'}</div>`;
      el.querySelectorAll('.d2-pad button').forEach((b) => { b.onclick = () => mv(Number(b.dataset.d)); });
      const bd = el.querySelector('.d2-board.big'); let p0 = null;
      bd.onpointerdown = (e) => { p0 = [e.clientX, e.clientY]; bd.setPointerCapture(e.pointerId); };
      bd.onpointerup = (e) => { if (!p0) return; const dx = e.clientX - p0[0], dy = e.clientY - p0[1]; p0 = null; if (Math.hypot(dx, dy) < 24) return; mv(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 0) : (dy > 0 ? 3 : 1)); };
      bd.onpointercancel = () => { p0 = null; };
    },
    unmount() { clearInterval(iv); window.removeEventListener('keydown', onKey); el = null; s0 = null; },
  };
}
