// 8-Ball Pool — drag to aim, release to shoot. Shots are simulated identically on
// both devices; the mover's final state is authoritative (full-state protocol).
import { esc, scoreStrip } from './util.js';

export const meta = { name: '8-Ball Pool', icon: '🎱', min: 2, max: 2, color: '#16a34a', blurb: 'Pot your group, then the 8. Drag to aim, release to shoot.', series: 1 };
export const W = 800, H = 400, R = 11, PAD = 34, PR = 20;
const POCKETS = [[PAD, PAD], [W / 2, PAD - 6], [W - PAD, PAD], [PAD, H - PAD], [W / 2, H - PAD + 6], [W - PAD, H - PAD]];
const COLORS = ['#f5f5f5', '#f8c21c', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d', '#111', '#f8c21c', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d'];
const typeOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe');

export function rack() {
  const balls = [{ n: 0, x: W * 0.25, y: H / 2, on: 1 }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let k = 0; const sx = W * 0.72, d = R * 2 + 0.6;
  for (let col = 0; col < 5; col++) for (let row = 0; row <= col; row++) {
    const n = order[k++]; balls.push({ n, x: sx + col * d * 0.87, y: H / 2 + (row - col / 2) * d, on: 1 });
  }
  return balls.sort((a, b) => a.n - b.n);
}

// Deterministic fixed-step simulation. Returns the list of potted ball numbers (in order) and first-contact ball.
export function simulate(balls, shot, onStep) {
  const b = balls.filter((x) => x.on);
  const cue = b.find((x) => x.n === 0); if (!cue) return { potted: [], first: null };
  const v = 2 + 26 * Math.min(1, Math.max(0, shot.pow));
  cue.vx = Math.cos(shot.ang) * v; cue.vy = Math.sin(shot.ang) * v;
  const spin = shot.spin && isFinite(shot.spin.x) && isFinite(shot.spin.y) ? { x: Math.max(-1, Math.min(1, shot.spin.x)), y: Math.max(-1, Math.min(1, shot.spin.y)) } : null; let spun = !spin;
  for (const x of b) { x.vx = x.vx || 0; x.vy = x.vy || 0; }
  const potted = []; let first = null, steps = 0;
  const live = () => b.filter((x) => x.on);
  while (steps++ < 4000) {
    let moving = false;
    for (const x of live()) {
      if (!x.vx && !x.vy) continue;
      x.x += x.vx; x.y += x.vy;
      x.vx *= 0.9855; x.vy *= 0.9855;
      if (x.vx * x.vx + x.vy * x.vy < 0.0009) { x.vx = 0; x.vy = 0; } else moving = true;
      // pockets
      for (const [px, py] of POCKETS) { const dx = x.x - px, dy = x.y - py; if (dx * dx + dy * dy < PR * PR) { x.on = 0; x.vx = 0; x.vy = 0; potted.push(x.n); break; } }
      if (!x.on) continue;
      // cushions (skip near pockets so balls can drop)
      const nearPocket = POCKETS.some(([px, py]) => Math.abs(x.x - px) < PR + 4 && Math.abs(x.y - py) < PR + 4);
      if (!nearPocket) {
        if (x.x < PAD + R) { x.x = PAD + R; x.vx = -x.vx * 0.8; } else if (x.x > W - PAD - R) { x.x = W - PAD - R; x.vx = -x.vx * 0.8; }
        if (x.y < PAD + R) { x.y = PAD + R; x.vy = -x.vy * 0.8; } else if (x.y > H - PAD - R) { x.y = H - PAD - R; x.vy = -x.vy * 0.8; }
      }
    }
    // ball-ball collisions
    const L = live();
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], c = L[j]; const dx = c.x - a.x, dy = c.y - a.y; const d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = 2 * R - d;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; c.x += nx * overlap / 2; c.y += ny * overlap / 2;
      const p = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny; if (p <= 0) continue;
      a.vx -= p * nx; a.vy -= p * ny; c.vx += p * nx; c.vy += p * ny;
      if (first === null && (a.n === 0 || c.n === 0)) first = a.n === 0 ? c.n : a.n;
      if (!spun && (a.n === 0 || c.n === 0)) {
        // English: top/back spin pushes the cue ball along/against its travel after impact, side spin nudges it sideways.
        spun = true; const k = (3 + 7 * shot.pow); const ux = Math.cos(shot.ang), uy = Math.sin(shot.ang);
        cue.vx += ux * k * spin.y - uy * k * 0.5 * spin.x; cue.vy += uy * k * spin.y + ux * k * 0.5 * spin.x;
      }
      moving = true;
    }
    if (onStep && onStep(b, steps) === false) break;
    if (!moving) break;
  }
  for (const x of b) { x.x = Math.round(x.x * 100) / 100; x.y = Math.round(x.y * 100) / 100; delete x.vx; delete x.vy; }
  return { potted, first };
}

function placeCue(balls) {
  const cue = balls.find((b) => b.n === 0); cue.on = 1;
  for (let k = 0; k < 40; k++) {
    const x = W * 0.25 - k * 6, y = H / 2 + (k % 2 ? 1 : -1) * k * 5;
    if (balls.every((b) => b.n === 0 || !b.on || (b.x - x) ** 2 + (b.y - y) ** 2 > 5 * R * R)) { cue.x = x; cue.y = y; return; }
  }
  cue.x = W * 0.25; cue.y = H / 2;
}

export const engine = {
  init() { return { balls: rack(), turn: 0, groups: [null, null], winner: null, last: null, n: 0, round: 1, score: [0, 0], msg: '' }; },
  apply(st, pi, mv) {
    if (engine.over(st) || st.turn !== pi) return false;
    const ang = Number(mv.ang), pow = Number(mv.pow); if (!isFinite(ang) || !(pow > 0 && pow <= 1)) return false;
    const spin = mv.spin && isFinite(Number(mv.spin.x)) && isFinite(Number(mv.spin.y)) ? { x: Math.round(Math.max(-1, Math.min(1, Number(mv.spin.x))) * 100) / 100, y: Math.round(Math.max(-1, Math.min(1, Number(mv.spin.y))) * 100) / 100 } : null;
    const { potted, first } = simulate(st.balls, { ang, pow, spin });
    st.n++;
    const mine = st.groups[pi], left = (g) => st.balls.filter((b) => b.on && typeOf(b.n) === g).length;
    let foul = false, again = false, msg = '';
    const scratch = potted.includes(0), eight = potted.includes(8);
    if (first === null) { foul = true; msg = 'No ball hit — foul'; }
    else if (mine && typeOf(first) !== mine && !(typeOf(first) === 'eight' && left(mine) === 0)) { foul = true; msg = 'Wrong ball first — foul'; }
    if (scratch) { foul = true; msg = 'Scratch!'; }
    if (eight) {
      const cleared = mine && left(mine) === 0;
      if (!cleared || foul) { st.winner = 1 - pi; msg = scratch ? '8-ball with a scratch — lose' : !cleared ? '8-ball too early — lose' : 'Foul on the 8-ball — lose'; }
      else { st.winner = pi; msg = '8-ball! Win'; }
      st.score[st.winner]++;
    } else {
      const own = potted.filter((n) => n !== 0 && n !== 8);
      if (!mine && own.length && !foul) {
        const t = typeOf(own[0]); st.groups[pi] = t; st.groups[1 - pi] = t === 'solid' ? 'stripe' : 'solid';
        msg = `You're ${t}s`; again = true;
      } else if (own.some((n) => typeOf(n) === st.groups[pi]) && !foul) { again = true; msg = own.length > 1 ? `${own.length} balls!` : 'Nice pot'; }
      if (scratch) placeCue(st.balls);
      if (!again || foul) st.turn = 1 - pi;
    }
    st.last = { pi, ang, pow, spin, potted, first, foul, n: st.n };
    st.msg = msg;
    return true;
  },
  again(st) { Object.assign(st, { balls: rack(), turn: st.round % 2, groups: [null, null], winner: null, last: null, n: 0, round: st.round + 1, msg: '' }); },
  over(st) { return st.winner !== null; },
};

export function view(ctx) {
  let el, cv, g, raf = 0, snapshot = null, seen = -1, aim = null, s0 = null, playing = false, rot = false, spin = { x: 0, y: 0 };
  const copy = (b) => b.map((x) => ({ ...x }));
  function draw(balls, aimInfo) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    rot = window.innerHeight > window.innerWidth * 1.1; cv.parentElement.classList.toggle('rot', rot);
    const w = cv.clientWidth, h = rot ? w * 2 : w / 2; if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
    const sc = cv.width / (rot ? H : W);
    if (rot) g.setTransform(0, sc, -sc, 0, H * sc, 0); else g.setTransform(sc, 0, 0, sc, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#5b3a1e'; g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill();
    g.fillStyle = '#1f7a3e'; g.fillRect(PAD - 8, PAD - 8, W - 2 * PAD + 16, H - 2 * PAD + 16);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(W * 0.25 - 1, PAD, 2, H - 2 * PAD);
    for (const [px, py] of POCKETS) { g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(px, py, PR, 0, 7); g.fill(); }
    const cue = balls.find((b) => b.n === 0 && b.on);
    if (aimInfo && cue) {
      const { ang, pow } = aimInfo;
      // Shot preview: ghost cue ball at first contact, object-ball direction and cue-ball deflection.
      const ux = Math.cos(ang), uy = Math.sin(ang); let hit = null, gx = cue.x, gy = cue.y;
      for (let t = 0; t < 900; t += 2) {
        gx = cue.x + ux * t; gy = cue.y + uy * t;
        if (gx < PAD + R || gx > W - PAD - R || gy < PAD + R || gy > H - PAD - R) break;
        hit = balls.find((b) => b.on && b.n !== 0 && (b.x - gx) ** 2 + (b.y - gy) ** 2 <= 4 * R * R); if (hit) break;
      }
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([6, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(cue.x, cue.y); g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(gx, gy, R, 0, 7); g.stroke();
      if (hit) {
        const nx = (hit.x - gx) / (2 * R), ny = (hit.y - gy) / (2 * R), dot = ux * nx + uy * ny;
        g.strokeStyle = 'rgba(255,255,120,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(hit.x, hit.y); g.lineTo(hit.x + nx * 90 * Math.max(0.2, dot), hit.y + ny * 90 * Math.max(0.2, dot)); g.stroke();
        const tx = ux - dot * nx, ty = uy - dot * ny, tl = Math.hypot(tx, ty) || 1;
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + tx / tl * 50, gy + ty / tl * 50); g.stroke();
      }
      // cue stick pulled back by power
      const back = 20 + pow * 70; const sx = cue.x - Math.cos(ang) * back, sy = cue.y - Math.sin(ang) * back;
      g.strokeStyle = '#d9a066'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - Math.cos(ang) * 230, sy - Math.sin(ang) * 230); g.stroke();
    }
    for (const b of balls) {
      if (!b.on) continue;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(b.x + 2, b.y + 3, R, 0, 7); g.fill();
      g.fillStyle = typeOf(b.n) === 'stripe' ? '#f5f5f5' : COLORS[b.n]; g.beginPath(); g.arc(b.x, b.y, R, 0, 7); g.fill();
      if (typeOf(b.n) === 'stripe') { g.save(); g.beginPath(); g.arc(b.x, b.y, R, 0, 7); g.clip(); g.fillStyle = COLORS[b.n]; g.fillRect(b.x - R, b.y - R * 0.55, 2 * R, R * 1.1); g.restore(); }
      if (b.n) { g.fillStyle = '#fff'; g.beginPath(); g.arc(b.x, b.y, R * 0.45, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = 'bold 7px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; if (rot) { g.save(); g.translate(b.x, b.y); g.rotate(-Math.PI / 2); g.fillText(b.n, 0, 0.5); g.restore(); } else g.fillText(b.n, b.x, b.y + 0.5); }
      g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.arc(b.x - R * 0.35, b.y - R * 0.4, R * 0.25, 0, 7); g.fill();
    }
  }
  function animate(from, shot, done) {
    playing = true; const balls = copy(from); let frames = []; 
    simulate(balls, shot, (b, step) => { if (step % 2 === 0) frames.push(copy(b)); return frames.length < 1500; });
    let k = 0; cancelAnimationFrame(raf);
    const tick = () => { if (!cv) return; draw(frames[Math.min(k, frames.length - 1)]); k += 2; if (k < frames.length) raf = requestAnimationFrame(tick); else { playing = false; done(); } };
    if (ctx.reduced || !frames.length) { playing = false; done(); return; }
    tick();
  }
  function pos(e) { const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return rot ? [sy / r.height * W, H - sx / r.width * H] : [sx / r.width * W, sy / r.height * H]; }
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; const firstDraw = seen === -1; seen = `${st.round}:${st.n}`;
      const gname = (i) => (st.groups[i] ? st.groups[i] + 's' : 'open');
      const remaining = (i) => st.balls.filter((b) => b.on && b.n && b.n !== 8 && typeOf(b.n) === st.groups[i]).map((b) => b.n);
      if (!cv || !el.contains(cv)) {
        el.innerHTML = `${scoreStrip(ctx, s, over)}<div class="pool-info" id="pool-info"></div><div class="pool-wrap"><canvas class="pool" id="pool-cv"></canvas></div><div class="pool-tools"><div class="pool-spin" id="pool-spin" title="Spin: tap where to hit the cue ball" aria-label="Spin"><i></i></div><span class="tiny muted" id="pool-spin-lbl">Spin: centre</span></div><div class="game-status" id="pool-status"></div>`;
        const sp = el.querySelector('#pool-spin'), spDot = sp.querySelector('i'), spLbl = el.querySelector('#pool-spin-lbl');
        const setSpin = (e) => { const r = sp.getBoundingClientRect(); let x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = -((e.clientY - r.top) / r.height - 0.5) * 2; const m = Math.hypot(x, y); if (m > 0.85) { x = x / m * 0.85; y = y / m * 0.85; } if (m < 0.15) { x = 0; y = 0; } spin = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }; spDot.style.left = `${50 + spin.x * 50}%`; spDot.style.top = `${50 - spin.y * 50}%`; spLbl.textContent = `Spin: ${!spin.x && !spin.y ? 'centre' : (spin.y > 0.2 ? 'top ' : spin.y < -0.2 ? 'back ' : '') + (spin.x > 0.2 ? 'right' : spin.x < -0.2 ? 'left' : '')}`.trim(); ctx.haptic(5); };
        sp.onpointerdown = (e) => { sp.setPointerCapture(e.pointerId); setSpin(e); sp.onpointermove = setSpin; };
        sp.onpointerup = sp.onpointercancel = () => { sp.onpointermove = null; };
        cv = el.querySelector('#pool-cv'); g = cv.getContext('2d');
        cv.onpointerdown = (e) => { if (!s0 || playing || !(s0.players[s0.state.turn] === ctx.pk) || engine.over(s0.state)) return; cv.setPointerCapture(e.pointerId); aim = { start: pos(e), ang: 0, pow: 0 }; e.preventDefault(); };
        cv.onpointermove = (e) => { if (!aim) return; const [x, y] = pos(e); const cue = s0.state.balls.find((b) => b.n === 0); const dx = x - cue.x, dy = y - cue.y; aim.ang = Math.atan2(dy, dx); aim.pow = Math.min(1, Math.max(0.1, Math.hypot(dx, dy) / 260)); draw(s0.state.balls, aim); };
        cv.onpointerup = () => { if (!aim) return; const shot = { ang: Math.round(aim.ang * 1000) / 1000, pow: Math.round(aim.pow * 100) / 100, spin: spin.x || spin.y ? { ...spin } : undefined }; aim = null; ctx.haptic(20); ctx.fx(900, 0.05, 0, 0.08, 'square'); ctx.move(shot); };
        cv.onpointercancel = () => { aim = null; draw(s0.state.balls); };
      } else { el.querySelector('.g-score').outerHTML = scoreStrip(ctx, s, over); }
      s0 = s;
      el.querySelector('#pool-info').innerHTML = s.players.map((p, i) => `<span class="${st.turn === i && !over ? 'active' : ''}">${esc(ctx.nameOf(p))}: <b>${gname(i)}</b>${st.groups[i] ? ` · ${remaining(i).length} left` : ''}</span>`).join('');
      const status = over ? `${st.winner === ctx.my ? 'You win!' : esc(ctx.nameOf(s.players[st.winner])) + ' wins'} — ${esc(st.msg)}` : `${st.msg ? esc(st.msg) + ' · ' : ''}${mine ? 'Your shot — drag from the cue ball to aim, release to shoot' : `${esc(ctx.nameOf(s.players[st.turn]))} is shooting…`}`;
      const statusEl = el.querySelector('#pool-status');
      const finish = () => { snapshot = copy(st.balls); draw(st.balls); statusEl.innerHTML = status; el.querySelector('.pool-wrap').classList.toggle('mine', mine); };
      if (fresh && !firstDraw && snapshot && st.last) {
        statusEl.textContent = st.last.pi === ctx.my ? '…' : `${ctx.nameOf(s.players[st.last.pi])} shoots…`;
        if (st.last.pi !== ctx.my) ctx.fx(900, 0.05, 0, 0.08, 'square');
        animate(snapshot, st.last, () => { finish(); if (st.last.potted.length) { ctx.fx(200, 0.1, 0, 0.08, 'triangle'); ctx.haptic(15); } if (st.last.foul) ctx.fx(150, 0.3, 0.1, 0.06, 'sawtooth'); });
      } else finish();
    },
    unmount() { cancelAnimationFrame(raf); cv = null; el = null; snapshot = null; seen = -1; },
  };
}
