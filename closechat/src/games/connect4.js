// Four in a Row — 7×6 board, pieces drop with gravity, win line highlighted.
import { turnText, scoreStrip } from './util.js';

const W = 7, H = 6;
export const meta = { name: 'Four in a Row', icon: '🔴', min: 2, max: 2, color: '#f59e0b', blurb: 'Drop discs, connect four. Best of 5.', series: 5 };

function winLine(b, r, c, p) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[r, c]];
    for (const dir of [1, -1]) {
      let rr = r + dr * dir, cc = c + dc * dir;
      while (rr >= 0 && rr < H && cc >= 0 && cc < W && b[rr * W + cc] === p) { cells.push([rr, cc]); rr += dr * dir; cc += dc * dir; }
    }
    if (cells.length >= 4) return cells.map(([a, k]) => a * W + k);
  }
  return null;
}
export const engine = {
  init() { return { b: Array(W * H).fill(-1), turn: 0, winner: null, line: null, draw: false, round: 1, score: [0, 0], last: null, n: 0 }; },
  apply(st, pi, mv) {
    if (st.winner !== null || st.draw || pi !== st.turn) return false;
    const c = Number(mv.c); if (!(c >= 0 && c < W)) return false;
    let r = H - 1; while (r >= 0 && st.b[r * W + c] !== -1) r--;
    if (r < 0) return false;
    st.b[r * W + c] = pi; st.last = { r, c, p: pi }; st.n++;
    const line = winLine(st.b, r, c, pi);
    if (line) { st.winner = pi; st.line = line; st.score[pi]++; return true; }
    if (st.n >= W * H) { st.draw = true; return true; }
    st.turn = 1 - st.turn;
    return true;
  },
  again(st) { Object.assign(st, { b: Array(W * H).fill(-1), turn: st.round % 2, winner: null, line: null, draw: false, round: st.round + 1, last: null, n: 0 }); },
  over(st) { return st.winner !== null || st.draw; },
  hint(st, pi) {
    const drop = (c) => { let r = H - 1; while (r >= 0 && st.b[r * W + c] !== -1) r--; return r; };
    const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => drop(c) >= 0);
    const winsFor = (p) => order.find((c) => { const r = drop(c); st.b[r * W + c] = p; const ok = !!winLine(st.b, r, c, p); st.b[r * W + c] = -1; return ok; });
    const c = winsFor(pi) ?? winsFor(1 - pi) ?? order.find((k) => { const r = drop(k); if (r === 0) return true; st.b[r * W + k] = pi; const bad = !!winLine(st.b, r - 1, k, 1 - pi) && false; st.b[r * W + k] = -1; return !bad; }) ?? order[0];
    return c === undefined ? null : { c };
  },
};

export function view(ctx) {
  let el, seen = -1;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; seen = `${st.round}:${st.n}`;
      const win = new Set(st.line || []);
      let cells = '';
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const v = st.b[r * W + c];
        const drop = fresh && st.last.r === r && st.last.c === c;
        cells += `<div class="c4-cell ${v >= 0 ? 'p' + v : ''} ${win.has(r * W + c) ? 'win' : ''}" data-c="${c}" style="${drop ? `--drop:${(r + 1) * 100}%` : ''}"><i class="${drop ? 'drop' : ''}"></i></div>`;
      }
      el.innerHTML = `${scoreStrip(ctx, s, over, ['<i class="c4-dot p0"></i>', '<i class="c4-dot p1"></i>'])}
        <div class="g-round">Round ${st.round} · first to ${Math.ceil(meta.series / 2)}</div>
        <div class="c4-wrap"><div class="c4-cols ${mine ? 'mine' : ''}">${Array.from({ length: W }, (_, c) => `<button class="c4-col ${mine && st.b[c] === -1 ? 'can' : ''} ${s.hint && s.hint.c === c && mine ? 'hint' : ''}" data-c="${c}" ${mine && st.b[c] === -1 ? '' : 'disabled'} aria-label="Column ${c + 1}"><i class="c4-ghost p${ctx.my}"></i></button>`).join('')}</div>
        <div class="c4 ${over ? 'over' : ''}">${cells}</div></div>
        <div class="game-status">${turnText(ctx, s, over)}</div>`;
      el.querySelectorAll('.c4-col.can').forEach((b) => { b.onclick = () => { ctx.haptic(); ctx.move({ c: Number(b.dataset.c) }); }; });
      if (fresh) { ctx.fx(220 + st.last.r * 30, 0.08, 0.18, 0.06, 'sine'); if (st.winner !== null) ctx.fx(st.winner === ctx.my ? 880 : 330, 0.3, 0.3, 0.06, 'triangle'); }
    },
    unmount() { el = null; },
  };
}
