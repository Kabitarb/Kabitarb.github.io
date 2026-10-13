// Cup Pong — flick the ball into the other side's six cups. Landing is a pure
// function of the flick, so both devices agree on hits.
import { esc, scoreStrip } from './util.js';

export const meta = { name: 'Cup Pong', icon: '🥤', min: 2, max: 2, color: '#f97316', blurb: 'Flick to throw. Sink all six cups first.', series: 1 };
const W = 400, H = 640, CUP_R = 22;
// cup centres for the far side (row of 3, 2, 1 — pointing at the thrower)
const CUPS = [[-50, 60], [0, 60], [50, 60], [-25, 104], [25, 104], [0, 148]].map(([dx, dy]) => [W / 2 + dx, dy]);
const START = [W / 2, H - 70];

export function landing(vx, vy) {
  // ball thrown from START with planar velocity (vx,vy) and vertical speed vz=|v|*0.9; gravity pulls it back to cup height
  const vz = Math.hypot(vx, vy) * 0.95, gr = 0.9; const t = (2 * vz) / gr;
  return [START[0] + vx * t, START[1] + vy * t, t];
}
const blank = () => ({ cups: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]], turn: 0, winner: null, last: null, n: 0, streak: 0 });
export const engine = {
  init() { return Object.assign(blank(), { round: 1, score: [0, 0] }); },
  apply(st, pi, mv) {
    if (engine.over(st) || st.turn !== pi) return false;
    const vx = Number(mv.vx), vy = Number(mv.vy); if (!isFinite(vx) || !isFinite(vy) || vy >= 0 || Math.hypot(vx, vy) > 24) return false;
    const [lx, ly] = landing(vx, vy);
    const cups = st.cups[1 - pi];
    let hit = -1;
    CUPS.forEach(([cx, cy], k) => { if (cups[k] && hit < 0 && Math.hypot(lx - cx, ly - cy) < CUP_R * 0.95) hit = k; });
    st.n++;
    if (hit >= 0) { cups[hit] = 0; st.streak = pi === (st.last && st.last.pi) ? st.streak + 1 : 1; } else st.streak = 0;
    st.last = { pi, vx, vy, lx: Math.round(lx), ly: Math.round(ly), hit, n: st.n };
    if (cups.every((c) => !c)) { st.winner = pi; st.score[pi]++; return true; }
    if (hit < 0 || st.streak >= 2) { st.turn = 1 - pi; st.streak = 0; }
    return true;
  },
  again(st) { const round = st.round + 1, score = st.score; Object.assign(st, blank(), { round, score, turn: round % 2 }); },
  over(st) { return st.winner !== null; },
};

export function view(ctx) {
  let el, cv, g, raf = 0, seen = -1, drag = null, s0 = null, playing = false;
  function draw(st, ball, flick) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = w * H / W; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0); g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#7c2d12'); grad.addColorStop(1, '#9a3412');
    g.fillStyle = grad; g.beginPath(); g.roundRect(0, 0, W, H, 20); g.fill();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, H / 2 - 1, W, 2);
    const me = ctx.my, opp = 1 - me;
    const drawCup = (x, y, on, mine) => { if (!on) return; g.fillStyle = mine ? '#2563eb' : '#dc2626'; g.beginPath(); g.arc(x, y, CUP_R, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(x, y, CUP_R * 0.72, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x, y, CUP_R * 0.45, 0, 7); g.fill(); };
    CUPS.forEach(([x, y], k) => drawCup(x, y, st.cups[opp][k], false));           // enemy cups far side
    CUPS.forEach(([x, y], k) => drawCup(x, H - y, st.cups[me][k], true));         // my cups near side
    if (flick) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([5, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(START[0], START[1]); g.lineTo(START[0] + flick.vx * 14, START[1] + flick.vy * 14); g.stroke(); g.setLineDash([]); }
    if (ball) { const r = 9 * (1 + ball.z * 0.9); g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(ball.x + 4, ball.y + 6 + ball.z * 20, 8, 0, 7); g.fill(); g.fillStyle = '#fff7ed'; g.beginPath(); g.arc(ball.x, ball.y - ball.z * 50, r, 0, 7); g.fill(); }
    else g.fillStyle = '#fff7ed', g.beginPath(), g.arc(START[0], START[1], 9, 0, 7), g.fill();
  }
  function animate(st, last, done) {
    playing = true; cancelAnimationFrame(raf);
    const [lx, ly, T] = landing(last.vx, last.vy); const mirror = last.pi !== ctx.my;
    const sx = START[0], sy = START[1]; let t = 0;
    const tick = () => { if (!cv) return; t += 1.6; const f = Math.min(1, t / T); const x = sx + (lx - sx) * f, y = sy + (ly - sy) * f; const z = 4 * f * (1 - f);
      draw(st, { x: mirror ? W - x : x, y: mirror ? H - y : y, z }); if (f < 1) raf = requestAnimationFrame(tick); else { playing = false; done(); } };
    if (ctx.reduced) { playing = false; done(); return; }
    tick();
  }
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; const first = seen === -1; seen = `${st.round}:${st.n}`;
      if (!cv || !el.contains(cv)) {
        el.innerHTML = `${scoreStrip(ctx, s, over)}<div class="pong-wrap"><canvas class="pong" id="pong-cv"></canvas></div><div class="game-status" id="pong-status"></div>`;
        cv = el.querySelector('#pong-cv'); g = cv.getContext('2d');
        cv.onpointerdown = (e) => { if (!s0 || playing || s0.players[s0.state.turn] !== ctx.pk || engine.over(s0.state)) return; cv.setPointerCapture(e.pointerId); drag = { p: pos(e), t: performance.now() }; e.preventDefault(); };
        cv.onpointermove = (e) => { if (!drag) return; const [x, y] = pos(e); const vx = (x - drag.p[0]) / 9, vy = (y - drag.p[1]) / 9; drag.v = [vx, vy]; if (vy < 0) draw(s0.state, null, { vx: Math.max(-24, Math.min(24, vx)), vy: Math.max(-24, vy) }); };
        cv.onpointerup = () => { if (!drag) return; const v = drag.v; drag = null; if (!v || v[1] >= -3) { draw(s0.state); return; } let [vx, vy] = v; const sp = Math.hypot(vx, vy); if (sp > 24) { vx *= 24 / sp; vy *= 24 / sp; } ctx.haptic(15); ctx.fx(700, 0.06, 0, 0.06, 'sine'); ctx.move({ vx: Math.round(vx * 100) / 100, vy: Math.round(vy * 100) / 100 }); };
        cv.onpointercancel = () => { drag = null; draw(s0.state); };
      } else el.querySelector('.g-score').outerHTML = scoreStrip(ctx, s, over);
      s0 = s;
      const left = (i) => st.cups[i].filter(Boolean).length;
      const statusEl = el.querySelector('#pong-status');
      const status = over ? (st.winner === ctx.my ? 'You sank them all!' : `${esc(ctx.nameOf(s.players[st.winner]))} wins`) : `${st.last && st.last.n === st.n ? (st.last.hit >= 0 ? (st.last.pi === ctx.my ? 'Splash! ' : `${esc(ctx.nameOf(s.players[st.last.pi]))} sank one! `) : '') : ''}${mine ? 'Your throw — flick upward' : `${esc(ctx.nameOf(s.players[st.turn]))} is throwing…`} · cups ${left(ctx.my)} : ${left(1 - ctx.my)}`;
      const finish = () => { draw(st); statusEl.innerHTML = status; el.querySelector('.pong-wrap').classList.toggle('mine', mine); };
      if (fresh && !first && st.last) {
        const before = JSON.parse(JSON.stringify(st)); if (st.last.hit >= 0) before.cups[1 - st.last.pi][st.last.hit] = 1;
        statusEl.textContent = '…';
        animate(before, st.last, () => { finish(); if (st.last.hit >= 0) { ctx.fx(500, 0.08, 0, 0.07, 'sine'); ctx.fx(800, 0.15, 0.08, 0.07, 'sine'); ctx.haptic([15, 30, 15]); } else ctx.fx(300, 0.1, 0, 0.04, 'triangle'); });
      } else finish();
    },
    unmount() { cancelAnimationFrame(raf); cv = null; el = null; seen = -1; },
  };
}
