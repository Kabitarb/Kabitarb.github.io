// Snakes & Ladders — 2–4 players, exact roll to finish, 6 rolls again.
import { esc } from './util.js';
import { LUDO_COLORS, pieceGlyph } from './ludo.js';

export const meta = { name: 'Snakes & Ladders', icon: '🐍', min: 2, max: 4, color: '#f97316', blurb: 'Roll, climb ladders, dodge snakes. First to 100. 2–4 players.', series: 1, isNew: true };
export const JUMPS = { 4: 14, 9: 31, 17: 7, 20: 38, 28: 84, 40: 59, 51: 67, 54: 34, 62: 19, 63: 81, 64: 60, 71: 91, 87: 24, 93: 73, 95: 75, 99: 78 };

export const engine = {
  init(n) { return { n, pos: Array(n).fill(0), turn: 0, dice: 0, winner: null, last: null, seq: 0 }; },
  apply(st, pi, mv) {
    if (st.winner !== null || pi !== st.turn || !mv || mv.a !== 'roll') return false;
    const d = Number(mv.d); if (!(d >= 1 && d <= 6)) return false;
    const from = st.pos[pi]; let to = from + d, jump = null;
    if (to > 100) to = from; else if (JUMPS[to]) { jump = [to, JUMPS[to]]; to = JUMPS[to]; }
    st.pos[pi] = to; st.dice = d; st.seq++;
    st.last = { pi, d, from, mid: jump ? jump[0] : to, to, snake: !!jump && jump[1] < jump[0], ladder: !!jump && jump[1] > jump[0], stuck: from + d > 100 };
    if (to === 100) st.winner = pi; else if (d !== 6) st.turn = (pi + 1) % st.n;
    return true;
  },
  over(st) { return st.winner !== null; },
};

const C = 40, S = 10 * C;
export function cellXY(n) {
  if (n <= 0) return [-C * 0.3, S + C * 0.3];
  const i = n - 1, row = Math.floor(i / 10), col = row % 2 ? 9 - (i % 10) : i % 10;
  return [(col + 0.5) * C, (9 - row + 0.5) * C];
}
function boardSvg(st, myIdx, pieces, names) {
  let svg = `<svg viewBox="${-C * 0.95} ${-C * 0.3} ${S + C * 1.55} ${S + C * 0.9}" class="snl">`;
  svg += `<rect x="-4" y="-4" width="${S + 8}" height="${S + 8}" rx="10" fill="#7c3f12"/>`;
  for (let n = 1; n <= 100; n++) { const [x, y] = cellXY(n); const dark = (Math.floor((n - 1) / 10) + n) % 2; svg += `<rect x="${x - C / 2}" y="${y - C / 2}" width="${C}" height="${C}" fill="${dark ? '#fef3c7' : '#fde68a'}"/><text x="${x - C / 2 + 4}" y="${y - C / 2 + 12}" font-size="10" fill="#92400e">${n}</text>`; }
  for (const [a, b] of Object.entries(JUMPS)) {
    const [x1, y1] = cellXY(Number(a)), [x2, y2] = cellXY(b);
    if (b > Number(a)) {
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L * 7, ny = dx / L * 7;
      svg += `<g class="ladder" stroke="#b45309" stroke-width="3.5" stroke-linecap="round"><line x1="${x1 + nx}" y1="${y1 + ny}" x2="${x2 + nx}" y2="${y2 + ny}"/><line x1="${x1 - nx}" y1="${y1 - ny}" x2="${x2 - nx}" y2="${y2 - ny}"/>`;
      const rungs = Math.max(2, Math.round(L / 22));
      for (let k = 1; k < rungs; k++) { const t = k / rungs, rx = x1 + dx * t, ry = y1 + dy * t; svg += `<line x1="${rx + nx}" y1="${ry + ny}" x2="${rx - nx}" y2="${ry - ny}" stroke-width="2.5"/>`; }
      svg += '</g>';
    } else {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, w = Math.min(60, L * 0.35);
      const d = `M${x1} ${y1} Q${mx + nx * w} ${my + ny * w} ${mx} ${my} T${x2} ${y2}`;
      const hue = (Number(a) * 37) % 360;
      svg += `<g class="snake"><path d="${d}" fill="none" stroke="hsl(${hue} 60% 30%)" stroke-width="11" stroke-linecap="round"/><path d="${d}" fill="none" stroke="hsl(${hue} 70% 48%)" stroke-width="7" stroke-linecap="round" stroke-dasharray="6 7"/><circle cx="${x1}" cy="${y1}" r="8" fill="hsl(${hue} 60% 30%)"/><circle cx="${x1 - 3}" cy="${y1 - 2}" r="1.8" fill="#fff"/><circle cx="${x1 + 3}" cy="${y1 - 2}" r="1.8" fill="#fff"/><line x1="${x1}" y1="${y1 + 6}" x2="${x1}" y2="${y1 + 13}" stroke="#ef4444" stroke-width="2"/></g>`;
    }
  }
  svg += `<text x="${S / 2}" y="${-C * 0.08}" text-anchor="middle" font-size="12" font-weight="700" fill="#fde68a">🏁 100</text>`;
  const occ = {};
  st.pos.forEach((p, pi) => {
    const [x0, y0] = cellXY(p); const k = occ[p] = (occ[p] || 0) + 1; const x = x0 + ((k - 1) % 2) * 12 - 6, y = y0 + Math.floor((k - 1) / 2) * 12 - 6;
    const col = LUDO_COLORS[pi % 4].fill, g = pieceGlyph(pieces[pi]);
    svg += `<g class="tok ${pi === st.turn && st.winner === null ? 'turn' : ''}" data-pi="${pi}" style="--tx:${x}px;--ty:${y}px"><circle cy="2" r="12" fill="rgba(0,0,0,.3)"/><circle r="12" fill="${col}" stroke="#fff" stroke-width="2.5"/>${g ? `<text y="5" text-anchor="middle" font-size="13">${g}</text>` : `<circle r="5" fill="#fff" opacity=".9"/>`}</g>`;
  });
  return svg + '</svg>';
}
export function view(ctx) {
  let el, seen = -1;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), my = ctx.my, myTurn = st.turn === my && !over;
      const pieces = s.players.map((p, i) => (s.pieces && s.pieces[p]) || 'coin');
      const fresh = st.last && seen !== -1 && seen !== st.seq; const prevSeq = seen; seen = st.seq;
      const players = s.players.map((p, i) => `<span class="snl-player ${st.turn === i && !over ? 'active' : ''}" style="--c:${LUDO_COLORS[i % 4].fill}"><i></i>${esc(ctx.nameOf(p))} <b>${st.pos[i]}</b></span>`).join('');
      let status = over ? `🏆 ${st.winner === my ? 'You won!' : esc(ctx.nameOf(s.players[st.winner])) + ' won'}` : `${st.turn === my ? 'Your' : esc(ctx.nameOf(s.players[st.turn])) + "'s"} turn — ${myTurn ? 'roll the dice' : 'rolling…'}`;
      if (!over && st.last && st.last.pi !== undefined && fresh) { const L = st.last; const who = L.pi === my ? 'You' : esc(ctx.nameOf(s.players[L.pi])); status = `${who} rolled ${L.d}${L.snake ? ` — 🐍 down to ${L.to}!` : L.ladder ? ` — 🪜 up to ${L.to}!` : L.stuck ? ' — needs an exact roll' : ''}`; }
      const dice = `<button class="dice ${myTurn ? 'can' : ''}" data-game-act="roll" data-d="${st.dice || 0}" ${myTurn ? '' : 'disabled'} aria-label="Dice"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></button>`;
      el.innerHTML = `<div class="snl-players">${players}</div>${boardSvg(st, my, pieces, s.players)}<div class="ludo-bar snl-bar" style="--turn:${LUDO_COLORS[st.turn % 4].fill}">${dice}<div class="game-status">${status}</div></div>`;
      const roll = el.querySelector('[data-game-act=roll]'); if (roll) roll.onclick = () => { ctx.haptic(15); roll.disabled = true; ctx.move({ a: 'roll', d: 1 + Math.floor(Math.random() * 6) }); };
      if (fresh && st.last && !ctx.reduced) {
        const L = st.last, tok = el.querySelector(`.tok[data-pi="${L.pi}"]`), diceEl = el.querySelector('.dice'); if (!tok) return;
        if (diceEl) { diceEl.classList.add('rolling'); setTimeout(() => { diceEl.classList.remove('rolling'); diceEl.dataset.d = L.d; }, 1100); }
        for (let k = 0; k < 6; k++) ctx.fx(500 + Math.random() * 500, 0.04, k * 0.11, 0.05, 'square');
        const end = [parseFloat(tok.style.getPropertyValue('--tx')), parseFloat(tok.style.getPropertyValue('--ty'))];
        const pts = []; for (let p = L.from; p <= L.mid; p++) pts.push(cellXY(p));
        if (L.mid !== L.to) pts.push(cellXY(L.to));
        pts[pts.length - 1] = end; const n = pts.length - 1; if (n < 1) return;
        const frames = []; const stepDur = 170, jumpDur = L.mid !== L.to ? 700 : 0, total = stepDur * (L.mid - L.from) + jumpDur + 1100;
        frames.push({ transform: `translate(${pts[0][0]}px,${pts[0][1]}px)`, offset: 0 });
        const t0 = 1100 / total;
        frames.push({ transform: `translate(${pts[0][0]}px,${pts[0][1]}px)`, offset: t0 });
        pts.forEach(([x, y], k) => { if (!k) return; const isJump = L.mid !== L.to && k === n; const at = t0 + (stepDur * Math.min(k, L.mid - L.from) + (isJump ? jumpDur : 0)) / total; if (!isJump) { const [px, py] = pts[k - 1]; frames.push({ transform: `translate(${(px + x) / 2}px,${(py + y) / 2 - 10}px) scale(1.3)`, offset: Math.min(1, at - stepDur / 2 / total) }); } frames.push({ transform: `translate(${x}px,${y}px)`, offset: Math.min(1, at) }); });
        tok.parentNode.appendChild(tok); tok.classList.add('moving');
        const a = tok.animate(frames, { duration: total, easing: 'linear', fill: 'both' });
        for (let k = 1; k <= L.mid - L.from; k++) ctx.fx(700 + k * 40, 0.03, (1100 + stepDur * k) / 1000, 0.04);
        if (L.snake) { ctx.fx(400, 0.3, (1100 + stepDur * (L.mid - L.from)) / 1000, 0.08, 'sawtooth'); ctx.fx(200, 0.3, (1300 + stepDur * (L.mid - L.from)) / 1000, 0.08, 'sawtooth'); }
        if (L.ladder) { ctx.fx(800, 0.15, (1100 + stepDur * (L.mid - L.from)) / 1000, 0.06, 'sine'); ctx.fx(1300, 0.2, (1250 + stepDur * (L.mid - L.from)) / 1000, 0.06, 'sine'); }
        a.onfinish = () => { a.cancel(); tok.classList.remove('moving'); ctx.haptic(10); if (L.snake && L.pi === my) ctx.toast('Snake! 🐍'); if (L.ladder && L.pi === my) ctx.toast('Ladder! 🪜'); if (st.winner === L.pi) { ctx.fx(1000, 0.15, 0, 0.06, 'sine'); ctx.fx(1500, 0.25, 0.12, 0.06, 'sine'); ctx.confetti(el, 24); } };
      }
    },
    unmount() { el = null; seen = -1; },
  };
}
