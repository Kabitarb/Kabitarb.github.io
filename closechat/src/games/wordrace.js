// Word Race — same 4×4 letter grid for both players; find more and longer words in 90 seconds.
import { rng, esc, scoreStrip } from './util.js';
import { isWord } from './words.js';

export const meta = { name: 'Word Race', icon: '🔤', min: 2, max: 2, color: '#0ea5e9', blurb: 'Same letters, 90 seconds. Who finds more words?', series: 1, simul: true };
const DICE = ['AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS', 'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY', 'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW', 'EIOSST', 'ELRTTY', 'HIMNQU', 'HLNNRZ'];
const TIME = 90;
export const points = (w) => (w.length <= 4 ? 1 : w.length === 5 ? 2 : w.length === 6 ? 3 : w.length === 7 ? 5 : 11);
const adjacent = (a, b) => a !== b && Math.abs((a >> 2) - (b >> 2)) <= 1 && Math.abs((a & 3) - (b & 3)) <= 1;
export function makeGrid(seed) {
  const r = rng(seed); const dice = DICE.slice();
  for (let i = dice.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [dice[i], dice[j]] = [dice[j], dice[i]]; }
  return dice.map((d) => { const c = d[Math.floor(r() * 6)]; return c === 'Q' ? 'Qu' : c; });
}
export function pathWord(grid, path) {
  if (!Array.isArray(path) || path.length < 2 || new Set(path).size !== path.length) return null;
  for (let i = 0; i < path.length; i++) { const k = Number(path[i]); if (!(k >= 0 && k < 16) || (i && !adjacent(Number(path[i - 1]), k))) return null; }
  return path.map((k) => grid[Number(k)]).join('').toLowerCase();
}
function finish(st) { st.done = true; st.winner = st.scores[0] === st.scores[1] ? -1 : st.scores[0] > st.scores[1] ? 0 : 1; }
const total = (ws) => ws.reduce((a, w) => a + points(w), 0);

export const engine = {
  init(n, seed) { return { grid: makeGrid(seed), found: [[], []], scores: [0, 0], endsAt: Date.now() + TIME * 1000, winner: null, done: false }; },
  myTurn(st) { return !st.done; },
  apply(st, pi, mv) {
    if (st.done) return false;
    if (mv.a === 'end') { if (Date.now() < st.endsAt - 500) return false; finish(st); return true; }
    if (Date.now() > st.endsAt + 3000) return false;
    const w = pathWord(st.grid, mv.path); if (!w || w.length < 3 || !isWord(w) || st.found[pi].includes(w)) return false;
    st.found[pi].push(w); st.scores[pi] = total(st.found[pi]);
    return true;
  },
  merge(st, other) {
    let ch = false;
    for (const i of [0, 1]) if ((other.found?.[i]?.length || 0) > st.found[i].length) { st.found[i] = other.found[i]; st.scores[i] = total(st.found[i]); ch = true; }
    if (other.done && !st.done) { st.done = true; ch = true; }
    if (st.done && ch) finish(st);
    return ch;
  },
  over(st) { return st.done; },
};

export function view(ctx) {
  let el, iv = 0, endSent = false, s0 = null, path = [], flash = '';
  const word = () => (s0 ? path.map((k) => s0.state.grid[k]).join('') : '');
  return {
    mount(host) {
      el = host;
      iv = setInterval(() => { if (!s0 || !el) return; const st = s0.state; const left = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000)); const t = el.querySelector('#wr-time'); if (t) { t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; t.classList.toggle('low', left <= 10); } if (!st.done && Date.now() > st.endsAt && !endSent) { endSent = true; ctx.move({ a: 'end' }); } }, 500);
    },
    update(s) {
      s0 = s; const st = s.state, me = ctx.my, op = 1 - me, over = engine.over(st);
      const left = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000));
      const w = word(), lw = w.toLowerCase(), valid = lw.length >= 3 && isWord(lw) && !st.found[me].includes(lw), dup = st.found[me].includes(lw);
      const mine = st.found[me].slice().reverse(), theirs = st.found[op];
      el.innerHTML = `${scoreStrip(ctx, s, over)}
        <div class="d2-top"><span class="d2-score me">You <b>${st.scores[me]}</b></span><span class="d2-time ${left <= 10 ? 'low' : ''}" id="wr-time">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span><span class="d2-score">${esc(ctx.nameOf(s.players[op]))} <b>${st.scores[op]}</b></span></div>
        <div class="wr-word ${valid ? 'ok' : dup ? 'dup' : ''} ${flash}">${w ? esc(w) : '<span class="muted">Tap letters to build a word</span>'}${valid ? `<small>+${points(lw)}</small>` : ''}</div>
        <div class="wr-grid ${over ? 'over' : ''}">${st.grid.map((ch, i) => { const k = path.indexOf(i); return `<button class="wr-cell ${k >= 0 ? 'sel' : ''} ${k === path.length - 1 ? 'head' : ''}" data-i="${i}" ${over ? 'disabled' : ''}>${ch}${k >= 0 ? `<i>${k + 1}</i>` : ''}</button>`; }).join('')}</div>
        <div class="wr-actions"><button class="btn ghost small" id="wr-clear" ${path.length ? '' : 'disabled'}>Clear</button><button class="btn primary small" id="wr-ok" ${valid && !over ? '' : 'disabled'}>Add word</button></div>
        <div class="wr-found"><div><b>You · ${mine.length}</b> ${mine.map((x) => `<span>${esc(x)}</span>`).join('') || '<span class="muted">—</span>'}</div><div><b>${esc(ctx.nameOf(s.players[op]))} · ${theirs.length}</b> ${over ? theirs.map((x) => `<span>${esc(x)}</span>`).join('') : theirs.map(() => '<span>•••</span>').join('')}</div></div>
        <div class="game-status">${over ? (st.winner === me ? 'You win!' : st.winner < 0 ? "It's a draw" : `${esc(ctx.nameOf(s.players[st.winner]))} wins`) : '3+ letters, neighbours only · longer words score more'}</div>`;
      flash = '';
      el.querySelectorAll('.wr-cell').forEach((b) => { b.onclick = () => {
        const i = Number(b.dataset.i), k = path.indexOf(i);
        if (k >= 0) path = path.slice(0, k === path.length - 1 ? -1 : k + 1);
        else if (!path.length || adjacent(path[path.length - 1], i)) path.push(i); else path = [i];
        ctx.haptic(5); ctx.fx(440 + path.length * 40, 0.04, 0, 0.03, 'sine'); this.update(s);
      }; });
      el.querySelector('#wr-clear').onclick = () => { path = []; this.update(s); };
      el.querySelector('#wr-ok').onclick = () => { const p = path.slice(); path = []; flash = 'added'; ctx.haptic(15); ctx.fx(880, 0.08, 0, 0.05, 'sine'); ctx.fx(1320, 0.1, 0.08, 0.05, 'sine'); if (!ctx.move({ path: p })) this.update(s); };
    },
    unmount() { clearInterval(iv); el = null; s0 = null; path = []; },
  };
}
