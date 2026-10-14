// Snakes & Ladders — 2–4 players, exact roll to finish, 6 rolls again.
import { esc } from './util.js';
import { LUDO_COLORS, pieceSvg } from './ludo.js';

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
function qpts(x1, y1, cx, cy, x2, y2, n) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]); } return out; }
// Snake body: an S-curve from head (cell a) to tail (cell b), sampled so it can taper.
function snakePts(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, w = Math.min(60, L * 0.35);
  const c1 = [mx + nx * w, my + ny * w], c2 = [2 * mx - c1[0], 2 * my - c1[1]];
  return qpts(x1, y1, c1[0], c1[1], mx, my, 14).concat(qpts(mx, my, c2[0], c2[1], x2, y2, 14).slice(1));
}
function snakeSvg(pts, hue, id) {
  const n = pts.length - 1; let g = `<g class="snake">`;
  const seg = (i, w, col, extra = '') => `<line x1="${pts[i][0].toFixed(1)}" y1="${pts[i][1].toFixed(1)}" x2="${pts[i + 1][0].toFixed(1)}" y2="${pts[i + 1][1].toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" ${extra}/>`;
  const width = (i) => 3 + 10 * Math.pow(1 - i / n, 0.8) * (i < 3 ? 0.9 : 1);
  for (let i = 0; i < n; i++) g += seg(i, width(i) + 2.2, `hsl(${hue} 55% 22%)`, 'opacity=".9"');
  for (let i = 0; i < n; i++) g += seg(i, width(i), `url(#sk${id})`);
  for (let i = 0; i < n; i++) if (width(i) > 5) g += seg(i, Math.max(1, width(i) * 0.32), `hsl(${hue} 70% 78%)`, 'opacity=".55"');
  for (let i = 1; i < n; i += 2) if (width(i) > 5) { const [x, y] = pts[i]; g += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(width(i) * 0.22).toFixed(1)}" ry="${(width(i) * 0.14).toFixed(1)}" fill="hsl(${hue} 60% 18%)" opacity=".6"/>`; }
  const [hx, hy] = pts[0], [bx, by] = pts[2], ang = Math.atan2(hy - by, hx - bx) * 180 / Math.PI;
  g += `<g transform="translate(${hx.toFixed(1)} ${hy.toFixed(1)}) rotate(${ang.toFixed(1)})"><ellipse cx="2" cy="0" rx="9.5" ry="7" fill="url(#sk${id})" stroke="hsl(${hue} 55% 22%)" stroke-width="1.6"/><ellipse cx="4" cy="-1.5" rx="4" ry="2" fill="hsl(${hue} 70% 80%)" opacity=".4"/><circle cx="4.5" cy="-3.6" r="2" fill="#fff"/><circle cx="4.5" cy="3.6" r="2" fill="#fff"/><circle cx="5.2" cy="-3.6" r="1" fill="#111"/><circle cx="5.2" cy="3.6" r="1" fill="#111"/><path d="M11 0 L17 0 M17 0 L20 -2.5 M17 0 L20 2.5" stroke="#e11d48" stroke-width="1.4" stroke-linecap="round" fill="none"/></g></g>`;
  return g;
}
function ladderSvg(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L * 7.5, ny = dx / L * 7.5, rungs = Math.max(2, Math.round(L / 20));
  let g = `<g class="ladder" stroke-linecap="round">`;
  for (const sgn of [1, -1]) g += `<line x1="${x1 + nx * sgn}" y1="${y1 + ny * sgn}" x2="${x2 + nx * sgn}" y2="${y2 + ny * sgn}" stroke="#4a2409" stroke-width="5.6"/><line x1="${x1 + nx * sgn}" y1="${y1 + ny * sgn}" x2="${x2 + nx * sgn}" y2="${y2 + ny * sgn}" stroke="url(#wood)" stroke-width="4"/>`;
  for (let k = 1; k < rungs; k++) { const t = k / rungs, rx = x1 + dx * t, ry = y1 + dy * t; g += `<line x1="${rx + nx}" y1="${ry + ny}" x2="${rx - nx}" y2="${ry - ny}" stroke="#4a2409" stroke-width="4"/><line x1="${rx + nx}" y1="${ry + ny}" x2="${rx - nx}" y2="${ry - ny}" stroke="url(#wood)" stroke-width="2.6"/>`; }
  return g + '</g>';
}
function boardSvg(st, myIdx, pieces, names) {
  let svg = `<svg viewBox="${-C * 0.95} ${-C * 0.3} ${S + C * 1.55} ${S + C * 0.9}" class="snl">`;
  svg += `<defs><linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9a066"/><stop offset=".5" stop-color="#a86a35"/><stop offset="1" stop-color="#7a4418"/></linearGradient><linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a4a1c"/><stop offset=".5" stop-color="#5c2e0e"/><stop offset="1" stop-color="#3f1e08"/></linearGradient><radialGradient id="felt" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#fff7dc"/><stop offset="1" stop-color="#f3dfa3"/></radialGradient>`;
  for (const [a, b] of Object.entries(JUMPS)) if (b < Number(a)) { const hue = (Number(a) * 37) % 360; svg += `<linearGradient id="sk${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 65% 58%)"/><stop offset=".5" stop-color="hsl(${hue} 70% 42%)"/><stop offset="1" stop-color="hsl(${hue} 60% 28%)"/></linearGradient>`; }
  svg += `</defs>`;
  svg += `<rect x="-9" y="-9" width="${S + 18}" height="${S + 18}" rx="14" fill="url(#frame)"/><rect x="-6" y="-6" width="${S + 12}" height="${S + 12}" rx="11" fill="none" stroke="rgba(255,220,160,.35)" stroke-width="1.2"/><rect x="0" y="0" width="${S}" height="${S}" fill="url(#felt)"/>`;
  for (let n = 1; n <= 100; n++) { const [x, y] = cellXY(n); const dark = (Math.floor((n - 1) / 10) + n) % 2; svg += `<rect x="${x - C / 2}" y="${y - C / 2}" width="${C}" height="${C}" fill="${dark ? 'rgba(180,120,50,.16)' : 'rgba(255,255,255,.18)'}" stroke="rgba(120,70,20,.18)" stroke-width=".6"/><text x="${x - C / 2 + 3.5}" y="${y - C / 2 + 11}" font-size="9" font-weight="600" fill="#7c4a12" opacity=".85">${n}</text>`; }
  for (const [a, b] of Object.entries(JUMPS)) {
    const [x1, y1] = cellXY(Number(a)), [x2, y2] = cellXY(b);
    if (b > Number(a)) svg += ladderSvg(x1, y1, x2, y2);
  }
  for (const [a, b] of Object.entries(JUMPS)) {
    const [x1, y1] = cellXY(Number(a)), [x2, y2] = cellXY(b);
    if (b < Number(a)) svg += snakeSvg(snakePts(x1, y1, x2, y2), (Number(a) * 37) % 360, a);
  }
  svg += `<text x="${S / 2}" y="${-C * 0.08}" text-anchor="middle" font-size="12" font-weight="700" fill="#fde68a">🏁 100</text>`;
  const occ = {};
  st.pos.forEach((p, pi) => {
    const [x0, y0] = cellXY(p); const k = occ[p] = (occ[p] || 0) + 1; const x = x0 + ((k - 1) % 2) * 12 - 6, y = y0 + Math.floor((k - 1) / 2) * 12 - 6;
    const col = LUDO_COLORS[pi % 4].fill;
    svg += `<g class="tok ${pi === st.turn && st.winner === null ? 'turn' : ''}" data-pi="${pi}" style="--tx:${x}px;--ty:${y}px">${pieceSvg(pieces[pi], col, 30)}</g>`;
  });
  return svg + '</svg>';
}
export function view(ctx) {
  let el, seen = -1;
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), my = ctx.my, myTurn = st.turn === my && !over;
      const pieces = s.players.map((p, i) => (s.pieces && s.pieces[p]) || 'pin');
      const fresh = st.last && seen !== -1 && seen !== st.seq; const prevSeq = seen; seen = st.seq;
      let status = over ? `🏆 ${st.winner === my ? 'You won!' : esc(ctx.nameOf(s.players[st.winner])) + ' won'}` : `${st.turn === my ? 'Your' : esc(ctx.nameOf(s.players[st.turn])) + "'s"} turn — ${myTurn ? 'roll the dice' : 'rolling…'}`;
      if (!over && st.last && st.last.pi !== undefined && fresh) { const L = st.last; const who = L.pi === my ? 'You' : esc(ctx.nameOf(s.players[L.pi])); status = `${who} rolled ${L.d}${L.snake ? ` — 🐍 down to ${L.to}!` : L.ladder ? ` — 🪜 up to ${L.to}!` : L.stuck ? ' — needs an exact roll' : ''}`; }
      const dice = `<button class="dice ${myTurn ? 'can' : ''}" data-game-act="roll" data-d="${st.dice || 0}" ${myTurn ? '' : 'disabled'} aria-label="Dice"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></button>`;
      const chips = ['', '', '', ''];
      s.players.forEach((p, i) => {
        const c = LUDO_COLORS[i % 4].fill; const q = [0, 1, 3, 2][i]; const name = ctx.nameOf(p); const isTurn = st.turn === i && !over;
        const av = ctx.avatar ? ctx.avatar(p, 'sm') : `<span class="avatar sm">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>`;
        chips[q] = `<div class="lchip q${q} ${isTurn ? 'turn' : ''} ${i === my ? 'me' : ''}" style="--c:${c}"><span class="lav">${av}</span><span class="lrib">${esc(name)}${st.winner === i ? ' 🏁' : ''}</span></div>`;
      });
      el.innerHTML = `<div class="ludo-stage snl-stage" style="--turn:${LUDO_COLORS[st.turn % 4].fill}"><div class="ludo-row top">${chips[0] || '<span></span>'}${dice}${chips[1] || '<span></span>'}</div>${boardSvg(st, my, pieces, s.players)}<div class="ludo-row bottom">${chips[3] || '<span></span>'}<span></span>${chips[2] || '<span></span>'}</div><div class="game-status ludo-status">${status}</div></div>`;
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
