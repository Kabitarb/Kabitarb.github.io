// Tic-Tac-Toe — best-of series with animated marks.
import { esc, turnText, scoreStrip } from './util.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const meta = { name: 'Tic-Tac-Toe', icon: '⭕', min: 2, max: 2, color: '#3b82f6', blurb: 'Three in a row. Best of 5.', series: 5 };

export const engine = {
  init() { return { b: Array(9).fill(-1), turn: 0, winner: null, line: null, draw: false, round: 1, score: [0, 0], last: null }; },
  apply(st, pi, mv) {
    if (st.winner !== null || st.draw || pi !== st.turn) return false;
    const i = Number(mv.i); if (!(i >= 0 && i < 9) || st.b[i] !== -1) return false;
    st.b[i] = pi; st.last = i;
    for (const l of LINES) if (l.every((k) => st.b[k] === pi)) { st.winner = pi; st.line = l; st.score[pi]++; return true; }
    if (st.b.every((x) => x !== -1)) { st.draw = true; return true; }
    st.turn = 1 - st.turn;
    return true;
  },
  again(st) { Object.assign(st, { b: Array(9).fill(-1), turn: st.round % 2, winner: null, line: null, draw: false, round: st.round + 1, last: null }); },
  over(st) { return st.winner !== null || st.draw; },
};

const X = '<svg viewBox="0 0 100 100" class="mk x"><path d="M22 22 78 78"/><path d="M78 22 22 78"/></svg>';
const O = '<svg viewBox="0 0 100 100" class="mk o"><circle cx="50" cy="50" r="30"/></svg>';

export function view(ctx) {
  let el, lastSeen = null;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), fresh = st.last !== null && lastSeen !== `${st.round}:${st.last}:${st.b.filter((x) => x !== -1).length}`;
      lastSeen = `${st.round}:${st.last}:${st.b.filter((x) => x !== -1).length}`;
      const cells = st.b.map((v, i) => {
        const win = st.line && st.line.includes(i);
        const can = v === -1 && st.turn === ctx.my && !over;
        return `<button class="ttt-cell ${win ? 'win' : ''} ${can ? 'can' : ''} p${v} ${fresh && st.last === i ? 'pop' : ''}" data-i="${i}" ${can ? '' : 'disabled'} aria-label="Cell ${i + 1}">${v === 0 ? X : v === 1 ? O : ''}</button>`;
      }).join('');
      el.innerHTML = `${scoreStrip(ctx, s, over, ['✕', '◯'])}
        <div class="g-round">Round ${st.round} · first to ${Math.ceil(meta.series / 2)}</div>
        <div class="ttt ${over ? 'over' : ''} ${st.turn === ctx.my && !over ? 'mine' : ''}">${cells}</div>
        <div class="game-status">${turnText(ctx, s, over)}</div>`;
      el.querySelectorAll('.ttt-cell.can').forEach((b) => { b.onclick = () => { ctx.haptic(); ctx.fx(st.turn === 0 ? 520 : 660, 0.06, 0, 0.05, 'sine'); ctx.move({ i: Number(b.dataset.i) }); }; });
      if (fresh && st.last !== null && s.players[st.b[st.last]] !== ctx.pk) ctx.fx(st.b[st.last] === 0 ? 520 : 660, 0.06, 0, 0.05, 'sine');
    },
    unmount() { el = null; },
  };
}
