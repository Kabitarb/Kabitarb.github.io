// 8-Ball Pool — continuous physics (rolling friction, cushions, ball spin), aim anywhere, pull the cue or the power
// slider to shoot. Shots are simulated identically on both devices; the mover's final state is authoritative.
import { esc, scoreStrip } from './util.js';

export const meta = { name: '8-Ball Pool', icon: '🎱', min: 2, max: 2, color: '#16a34a', blurb: 'Real cue physics. Pot your group, then the 8.', series: 1 };
export const W = 800, H = 400, R = 11, PAD = 34, PR = 20;
const POCKETS = [[PAD, PAD], [W / 2, PAD - 6], [W - PAD, PAD], [PAD, H - PAD], [W / 2, H - PAD + 6], [W - PAD, H - PAD]];
const COLORS = ['#f5f5f5', '#f8c21c', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d', '#111', '#f8c21c', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d'];
const typeOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe');
const FR = 0.032, DRAG = 0.9982, STOP = 0.045, CUSH = 0.82, BALL = 0.965, SUB = 2, MAX_STEPS = 3200, SPS = 150;

export function rack() {
  const balls = [{ n: 0, x: W * 0.25, y: H / 2, on: 1 }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let k = 0; const sx = W * 0.72, d = R * 2 + 0.6;
  for (let col = 0; col < 5; col++) for (let row = 0; row <= col; row++) {
    const n = order[k++]; balls.push({ n, x: sx + col * d * 0.87, y: H / 2 + (row - col / 2) * d, on: 1 });
  }
  return balls.sort((a, b) => a.n - b.n);
}

const free = (balls, x, y, self = 0) => x >= PAD + R && x <= W - PAD - R && y >= PAD + R && y <= H - PAD - R && balls.every((b) => b.n === self || !b.on || (b.x - x) ** 2 + (b.y - y) ** 2 >= 4.4 * R * R);

// Deterministic fixed-step simulation (rolling friction + drag, restitution on balls and cushions, English on the cue
// ball). Returns potted ball numbers in order, the first object ball touched and a timeline of events for sound/FX.
export function simulate(balls, shot, onStep) {
  const b = balls.filter((x) => x.on);
  const cue = b.find((x) => x.n === 0); if (!cue) return { potted: [], first: null, events: [] };
  const v = 3 + 25 * Math.min(1, Math.max(0, shot.pow));
  const spin = shot.spin && isFinite(shot.spin.x) && isFinite(shot.spin.y) ? { x: Math.max(-1, Math.min(1, shot.spin.x)), y: Math.max(-1, Math.min(1, shot.spin.y)) } : { x: 0, y: 0 };
  cue.vx = Math.cos(shot.ang) * v; cue.vy = Math.sin(shot.ang) * v;
  let sx = spin.x, sy = spin.y, applied = false;
  for (const x of b) { x.vx = x.vx || 0; x.vy = x.vy || 0; x.rot = x.rot || 0; }
  const potted = [], events = []; let first = null, steps = 0;
  while (steps++ < MAX_STEPS) {
    let moving = false;
    for (let s = 0; s < SUB; s++) {
      for (const x of b) {
        if (!x.on || (!x.vx && !x.vy)) continue;
        x.x += x.vx / SUB; x.y += x.vy / SUB;
        if (s === SUB - 1) {
          const sp = Math.hypot(x.vx, x.vy);
          x.rot += sp / R;
          const nv = Math.max(0, sp * DRAG - FR);
          if (nv < STOP) { x.vx = 0; x.vy = 0; } else { x.vx *= nv / sp; x.vy *= nv / sp; moving = true; }
          if (x.n === 0) { sx *= 0.992; sy *= 0.99; }
        }
        for (const [px, py] of POCKETS) { const dx = x.x - px, dy = x.y - py; if (dx * dx + dy * dy < PR * PR) { x.on = 0; x.vx = 0; x.vy = 0; potted.push(x.n); events.push({ t: steps, k: 'pot', n: x.n, px, py }); break; } }
        if (!x.on) continue;
        const nearPocket = POCKETS.some(([px, py]) => Math.abs(x.x - px) < PR + 5 && Math.abs(x.y - py) < PR + 5);
        if (!nearPocket) {
          let rail = false;
          if (x.x < PAD + R) { x.x = PAD + R; x.vx = -x.vx * CUSH; rail = true; } else if (x.x > W - PAD - R) { x.x = W - PAD - R; x.vx = -x.vx * CUSH; rail = true; }
          if (x.y < PAD + R) { x.y = PAD + R; x.vy = -x.vy * CUSH; rail = true; } else if (x.y > H - PAD - R) { x.y = H - PAD - R; x.vy = -x.vy * CUSH; rail = true; }
          if (rail) {
            if (x.n === 0 && sx) { const a = Math.atan2(x.vy, x.vx) + sx * 0.35, sp = Math.hypot(x.vx, x.vy); x.vx = Math.cos(a) * sp; x.vy = Math.sin(a) * sp; sx *= 0.5; }
            events.push({ t: steps, k: 'rail', v: Math.hypot(x.vx, x.vy) });
          }
        }
      }
      const L = b.filter((x) => x.on);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const a = L[i], c = L[j]; const dx = c.x - a.x, dy = c.y - a.y; const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = 2 * R - d;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; c.x += nx * overlap / 2; c.y += ny * overlap / 2;
        const p = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny; if (p <= 0) continue;
        const imp = p * (1 + BALL) / 2;
        a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
        events.push({ t: steps, k: 'hit', v: p });
        if (a.n === 0 || c.n === 0) {
          if (first === null) first = a.n === 0 ? c.n : a.n;
          if (!applied) {
            // Follow / draw: the cue ball keeps rolling forward (top) or comes back (back) after the first contact.
            applied = true; const k = (2.5 + 6 * shot.pow); const ux = Math.cos(shot.ang), uy = Math.sin(shot.ang);
            cue.vx += ux * k * sy - uy * k * 0.4 * sx; cue.vy += uy * k * sy + ux * k * 0.4 * sx; sy = 0;
          }
        }
        moving = true;
      }
    }
    if (onStep && onStep(b, steps) === false) break;
    if (!moving) break;
  }
  for (const x of b) { x.x = Math.round(x.x * 100) / 100; x.y = Math.round(x.y * 100) / 100; delete x.vx; delete x.vy; delete x.rot; }
  return { potted, first, events };
}

function placeCue(balls) {
  const cue = balls.find((b) => b.n === 0); cue.on = 1;
  for (let k = 0; k < 60; k++) {
    const x = W * 0.25 - (k % 10) * 8, y = H / 2 + ((k / 10 | 0) % 2 ? 1 : -1) * (k / 10 | 0) * 14;
    if (free(balls, x, y)) { cue.x = x; cue.y = y; return; }
  }
  cue.x = W * 0.25; cue.y = H / 2;
}

export const engine = {
  init() { return { balls: rack(), turn: 0, groups: [null, null], winner: null, last: null, n: 0, round: 1, score: [0, 0], msg: '', inHand: null }; },
  apply(st, pi, mv) {
    if (engine.over(st) || st.turn !== pi) return false;
    if (mv.place) {
      // Ball in hand after a foul: the shooter may put the cue ball anywhere free before shooting.
      if (st.inHand !== pi) return false;
      const x = Math.round(Number(mv.place[0]) * 10) / 10, y = Math.round(Number(mv.place[1]) * 10) / 10; if (!isFinite(x) || !isFinite(y) || !free(st.balls, x, y)) return false;
      const cue = st.balls.find((b) => b.n === 0); cue.x = x; cue.y = y; cue.on = 1; return true;
    }
    const ang = Number(mv.ang), pow = Number(mv.pow); if (!isFinite(ang) || !(pow > 0 && pow <= 1)) return false;
    const spin = mv.spin && isFinite(Number(mv.spin.x)) && isFinite(Number(mv.spin.y)) ? { x: Math.round(Math.max(-1, Math.min(1, Number(mv.spin.x))) * 100) / 100, y: Math.round(Math.max(-1, Math.min(1, Number(mv.spin.y))) * 100) / 100 } : null;
    const { potted, first } = simulate(st.balls, { ang, pow, spin });
    st.n++; st.inHand = null;
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
      if (foul) { st.inHand = st.turn; msg += ' · ball in hand'; }
    }
    st.last = { pi, ang, pow, spin, potted, first, foul, n: st.n };
    st.msg = msg;
    return true;
  },
  again(st) { Object.assign(st, { balls: rack(), turn: st.round % 2, groups: [null, null], winner: null, last: null, n: 0, round: st.round + 1, msg: '', inHand: null }); },
  over(st) { return st.winner !== null; },
};

const ballColor = (n) => COLORS[n];
export function view(ctx) {
  let el, cv, g, raf = 0, snapshot = null, seen = -1, s0 = null, playing = false, rot = false, spin = { x: 0, y: 0 };
  let aimAng = 0, pull = null, pow = 0, drag = null, strike = 0, ro = null, lastClack = 0;
  const copy = (b) => b.map((x) => ({ ...x }));
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    rot = window.innerHeight > window.innerWidth * 1.1; cv.parentElement.classList.toggle('rot', rot); cv.parentElement.parentElement.classList.toggle('rot', rot);
    const w = cv.clientWidth, h = rot ? w * 2 : w / 2;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
    const sc = cv.width / (rot ? H : W);
    if (rot) g.setTransform(0, sc, -sc, 0, H * sc, 0); else g.setTransform(sc, 0, 0, sc, 0, 0);
  }
  function table() {
    g.clearRect(0, 0, W, H);
    const wood = g.createLinearGradient(0, 0, W, H); wood.addColorStop(0, '#6b4423'); wood.addColorStop(1, '#3f2412');
    g.fillStyle = wood; g.beginPath(); g.roundRect(0, 0, W, H, 26); g.fill();
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 24); g.fill();
    const felt = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62); felt.addColorStop(0, '#2b9a52'); felt.addColorStop(1, '#176b37');
    g.fillStyle = felt; g.fillRect(PAD - 9, PAD - 9, W - 2 * PAD + 18, H - 2 * PAD + 18);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(PAD - 9, PAD - 9, W - 2 * PAD + 18, 4); g.fillRect(PAD - 9, PAD - 9, 4, H - 2 * PAD + 18);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(W * 0.25 - 1, PAD, 2, H - 2 * PAD);
    g.beginPath(); g.arc(W * 0.72, H / 2, 3, 0, 7); g.fill();
    g.fillStyle = '#e9d8a6';
    for (let i = 1; i < 8; i++) if (i !== 4) { const x = PAD + (W - 2 * PAD) * i / 8; g.beginPath(); g.arc(x, 12, 2.6, 0, 7); g.arc(x, H - 12, 2.6, 0, 7); g.fill(); }
    for (let i = 1; i < 4; i++) { const y = PAD + (H - 2 * PAD) * i / 4; g.beginPath(); g.arc(12, y, 2.6, 0, 7); g.arc(W - 12, y, 2.6, 0, 7); g.fill(); }
    for (const [px, py] of POCKETS) {
      g.fillStyle = '#3a2412'; g.beginPath(); g.arc(px, py, PR + 6, 0, 7); g.fill();
      const pk = g.createRadialGradient(px, py, 2, px, py, PR); pk.addColorStop(0, '#000'); pk.addColorStop(1, '#151515');
      g.fillStyle = pk; g.beginPath(); g.arc(px, py, PR, 0, 7); g.fill();
    }
  }
  function ball(b, scale = 1) {
    const r = R * scale, t = typeOf(b.n);
    g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse(b.x + 2.5, b.y + 3.5, r, r * 0.9, 0, 0, 7); g.fill();
    const base = g.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r * 1.05);
    const c = t === 'stripe' ? '#f5f5f5' : ballColor(b.n); base.addColorStop(0, t === 'eight' ? '#555' : '#fff'); base.addColorStop(0.18, c); base.addColorStop(1, t === 'eight' ? '#000' : c);
    g.fillStyle = base; g.beginPath(); g.arc(b.x, b.y, r, 0, 7); g.fill();
    const ph = (b.rot || 0) % (Math.PI * 2);
    if (t === 'stripe') { g.save(); g.beginPath(); g.arc(b.x, b.y, r, 0, 7); g.clip(); g.fillStyle = ballColor(b.n); const band = r * (0.55 + 0.25 * Math.cos(ph)); g.fillRect(b.x - r, b.y - band / 2 * 1.1 - r * 0.25 * Math.sin(ph), 2 * r, band * 1.1); g.restore(); }
    if (b.n) { const ox = r * 0.3 * Math.sin(ph) * (scale < 1 ? 0 : 1); g.fillStyle = '#fff'; g.beginPath(); g.arc(b.x + ox, b.y, r * 0.46, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = `bold ${7 * scale}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(b.x + ox, b.y + 0.5); if (rot) g.rotate(-Math.PI / 2); g.fillText(b.n, 0, 0); g.restore(); }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(b.x - r * 0.38, b.y - r * 0.42, r * 0.22, r * 0.16, -0.6, 0, 7); g.fill();
  }
  function guide(balls, ang, pw) {
    const cue = balls.find((b) => b.n === 0 && b.on); if (!cue) return;
    const ux = Math.cos(ang), uy = Math.sin(ang); let hit = null, gx = cue.x, gy = cue.y;
    for (let t = 0; t < 1200; t += 2) {
      gx = cue.x + ux * t; gy = cue.y + uy * t;
      if (gx < PAD + R || gx > W - PAD - R || gy < PAD + R || gy > H - PAD - R) break;
      hit = balls.find((b) => b.on && b.n !== 0 && (b.x - gx) ** 2 + (b.y - gy) ** 2 <= 4 * R * R); if (hit) break;
    }
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.setLineDash([5, 7]); g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(cue.x + ux * R, cue.y + uy * R); g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(gx, gy, R, 0, 7); g.stroke();
    if (hit) {
      const nx = (hit.x - gx) / (2 * R), ny = (hit.y - gy) / (2 * R), dot = ux * nx + uy * ny;
      g.strokeStyle = 'rgba(255,255,120,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(hit.x, hit.y); g.lineTo(hit.x + nx * 110 * Math.max(0.2, dot), hit.y + ny * 110 * Math.max(0.2, dot)); g.stroke();
      const tx = ux - dot * nx, ty = uy - dot * ny, tl = Math.hypot(tx, ty) || 1;
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + tx / tl * 60, gy + ty / tl * 60); g.stroke();
    }
    cueStick(cue, ang, 16 + pw * 80);
  }
  function cueStick(cue, ang, back) {
    const sx = cue.x - Math.cos(ang) * (R + back), sy = cue.y - Math.sin(ang) * (R + back), ex = sx - Math.cos(ang) * 260, ey = sy - Math.sin(ang) * 260;
    g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 8; g.beginPath(); g.moveTo(sx + 2, sy + 3); g.lineTo(ex + 2, ey + 3); g.stroke();
    const grad = g.createLinearGradient(sx, sy, ex, ey); grad.addColorStop(0, '#f1dcb8'); grad.addColorStop(0.08, '#d9a066'); grad.addColorStop(0.75, '#8a4b1f'); grad.addColorStop(1, '#2b1a0e');
    g.strokeStyle = grad; g.lineWidth = 6; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = '#3b82f6'; g.lineWidth = 6; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - Math.cos(ang) * 4, sy - Math.sin(ang) * 4); g.stroke();
  }
  function draw(balls, opts = {}) {
    if (!cv) return; fit();
    if (zoom > 0.001) { const cue = balls.find((b) => b.n === 0); if (cue) { const z = 1 + zoom; g.translate(cue.x, cue.y); g.scale(z, z); g.translate(-cue.x, -cue.y); } }
    table();
    const mine = s0 && !playing && s0.players[s0.state.turn] === ctx.pk && !engine.over(s0.state);
    if (mine && !opts.noGuide) guide(balls, aimAng, pull ? pull.pow : pow);
    for (const b of balls) if (b.on) ball(b);
    if (opts.pots) for (const p of opts.pots) ball({ n: p.n, x: p.px, y: p.py, rot: 0 }, p.scale);
    if (opts.strike) { const cue = balls.find((b) => b.n === 0 && b.on) || opts.strikeAt; if (cue) cueStick(cue, opts.strike.ang, opts.strike.back); }
  }
  function play(from, shot, done) {
    playing = true; const balls = copy(from); const frames = [];
    const { events } = simulate(balls, shot, (b) => { frames.push(b.map((x) => ({ n: x.n, x: x.x, y: x.y, on: x.on, rot: x.rot }))); return frames.length < MAX_STEPS; });
    if (ctx.reduced || !frames.length) { playing = false; done(); return; }
    cancelAnimationFrame(raf); const t0 = performance.now(); let ev = 0; const cueStart = from.find((b) => b.n === 0);
    const tick = (now) => {
      if (!cv) return;
      const ms = now - t0, k = Math.min(frames.length - 1, Math.floor(Math.max(0, ms - 110) / 1000 * SPS));
      while (ev < events.length && events[ev].t <= k) { const e = events[ev++]; if (e.k === 'hit' && now - lastClack > 50 && e.v > 1.5) { lastClack = now; ctx.fx(2400, 0.025, 0, Math.min(0.12, e.v / 40), 'square'); } else if (e.k === 'pot') { ctx.fx(180, 0.14, 0, 0.1, 'triangle'); ctx.haptic(12); } else if (e.k === 'rail' && e.v > 4 && now - lastClack > 80) { lastClack = now; ctx.fx(300, 0.04, 0, 0.04, 'sine'); } }
      const pots = events.filter((e) => e.k === 'pot' && k >= e.t && k < e.t + 16).map((e) => ({ ...e, scale: 1 - (k - e.t) / 16 }));
      const strike = ms < 110 ? { ang: shot.ang, back: 60 * (1 - ms / 110) ** 2 } : null;
      draw(frames[k], { noGuide: true, pots, strike, strikeAt: cueStart });
      if (k < frames.length - 1) raf = requestAnimationFrame(tick); else { playing = false; done(); }
    };
    raf = requestAnimationFrame(tick);
  }
  function pos(e) { const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; let [x, y] = rot ? [sy / r.height * W, H - sx / r.width * H] : [sx / r.width * W, sy / r.height * H]; if (zoom > 0.001 && s0) { const cue = s0.state.balls.find((b) => b.n === 0); const z = 1 + zoom; x = cue.x + (x - cue.x) / z; y = cue.y + (y - cue.y) / z; } return [x, y]; }
  function myTurn() { return s0 && !playing && s0.players[s0.state.turn] === ctx.pk && !engine.over(s0.state); }
  function shoot(ang, pw) {
    const shot = { ang: Math.round(ang * 1000) / 1000, pow: Math.round(Math.max(0.08, Math.min(1, pw)) * 100) / 100, spin: spin.x || spin.y ? { ...spin } : undefined };
    pull = null; pow = 0; setPower(0); ctx.haptic(20); ctx.move(shot);
  }
  let zoom = 0, zoomT = 0, zoomRaf = 0;
  function zoomTick() { zoom += (zoomT - zoom) * 0.16; if (Math.abs(zoomT - zoom) < 0.003) zoom = zoomT; else zoomRaf = requestAnimationFrame(zoomTick); if (!playing && s0 && cv) draw(s0.state.balls); }
  function setZoom(t) { if (ctx.reduced) t = 0; zoomT = t; cancelAnimationFrame(zoomRaf); zoomRaf = requestAnimationFrame(zoomTick); }
  function setPower(p) { setZoom(p * 0.55); const bar = el && el.querySelector('#pool-power i'); if (bar) bar.style.setProperty('--p', Math.round(p * 100)); const lbl = el && el.querySelector('#pool-power-lbl'); if (lbl) lbl.textContent = p > 0 ? `${Math.round(p * 100)}%` : 'Power'; }
  function autoAim(st) {
    const cue = st.balls.find((b) => b.n === 0); const mine = st.groups[ctx.my];
    const targets = st.balls.filter((b) => b.on && b.n && (mine ? typeOf(b.n) === mine || (typeOf(b.n) === 'eight' && !st.balls.some((x) => x.on && typeOf(x.n) === mine)) : b.n !== 8));
    const t = targets.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
    aimAng = t ? Math.atan2(t.y - cue.y, t.x - cue.x) : 0;
  }
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), mine = st.turn === ctx.my && !over;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; const firstDraw = seen === -1; seen = `${st.round}:${st.n}`;
      const gname = (i) => (st.groups[i] ? st.groups[i] + 's' : 'open');
      const remaining = (i) => st.balls.filter((b) => b.on && b.n && b.n !== 8 && typeOf(b.n) === st.groups[i]).map((b) => b.n);
      if (!cv || !el.contains(cv)) {
        el.innerHTML = `${scoreStrip(ctx, s, over)}<div class="pool-info" id="pool-info"></div>
          <div class="pool-box"><div class="pool-wrap"><canvas class="pool" id="pool-cv"></canvas><div class="pool-hand hidden" id="pool-hand">Ball in hand — drag the cue ball</div></div>
          <div class="game-status pool-status" id="pool-status"></div>
          <div class="pool-tools"><div class="pool-spin" id="pool-spin" title="Spin: tap where to hit the cue ball" aria-label="Spin"><i></i></div><span class="tiny muted" id="pool-spin-lbl">Spin: centre</span><div class="pool-power" id="pool-power" aria-label="Power — drag, release to shoot"><i></i><span id="pool-power-lbl">Power</span></div></div></div>`;
        const sp = el.querySelector('#pool-spin'), spDot = sp.querySelector('i'), spLbl = el.querySelector('#pool-spin-lbl');
        const setSpin = (e) => { const r = sp.getBoundingClientRect(); let x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = -((e.clientY - r.top) / r.height - 0.5) * 2; const m = Math.hypot(x, y); if (m > 0.85) { x = x / m * 0.85; y = y / m * 0.85; } if (m < 0.15) { x = 0; y = 0; } spin = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }; spDot.style.left = `${50 + spin.x * 50}%`; spDot.style.top = `${50 - spin.y * 50}%`; spLbl.textContent = `Spin: ${!spin.x && !spin.y ? 'centre' : (spin.y > 0.2 ? 'top ' : spin.y < -0.2 ? 'back ' : '') + (spin.x > 0.2 ? 'right' : spin.x < -0.2 ? 'left' : '')}`.trim(); ctx.haptic(5); };
        sp.onpointerdown = (e) => { sp.setPointerCapture(e.pointerId); setSpin(e); sp.onpointermove = setSpin; };
        sp.onpointerup = sp.onpointercancel = () => { sp.onpointermove = null; };
        const pw = el.querySelector('#pool-power');
        const powAt = (e) => { const r = pw.getBoundingClientRect(); return r.width > r.height ? Math.max(0, Math.min(1, (e.clientX - r.left - 6) / Math.max(1, r.width - 12))) : Math.max(0, Math.min(1, (e.clientY - r.top - 6) / Math.max(1, r.height - 12))); };
        pw.onpointerdown = (e) => { if (!myTurn()) return; pw.setPointerCapture(e.pointerId); pow = powAt(e); setPower(pow); pw.classList.add('on'); draw(s0.state.balls); pw.onpointermove = (ev) => { pow = powAt(ev); setPower(pow); draw(s0.state.balls); }; };
        pw.onpointerup = () => { pw.onpointermove = null; pw.classList.remove('on'); if (myTurn() && pow > 0.05) shoot(aimAng, pow); else { pow = 0; setPower(0); draw(s0.state.balls); } };
        pw.onpointercancel = () => { pw.onpointermove = null; pw.classList.remove('on'); pow = 0; setPower(0); };
        cv = el.querySelector('#pool-cv'); g = cv.getContext('2d');
        cv.onpointerdown = (e) => {
          if (!myTurn()) return; cv.setPointerCapture(e.pointerId); e.preventDefault();
          const [x, y] = pos(e); const cue = s0.state.balls.find((b) => b.n === 0); const near = Math.hypot(x - cue.x, y - cue.y) < 3.5 * R;
          if (near && s0.state.inHand === ctx.my) drag = { x, y };
          else if (near) pull = { ang: aimAng, pow: 0 };
          else { aimAng = Math.atan2(y - cue.y, x - cue.x); draw(s0.state.balls); }
        };
        cv.onpointermove = (e) => {
          if (!s0 || !myTurn()) return; const [x, y] = pos(e); const cue = s0.state.balls.find((b) => b.n === 0);
          if (drag) { if (free(s0.state.balls, x, y)) { cue.x = x; cue.y = y; } draw(s0.state.balls, { noGuide: true }); }
          else if (pull) { const dx = x - cue.x, dy = y - cue.y; pull.ang = Math.atan2(-dy, -dx); aimAng = pull.ang; pull.pow = Math.min(1, Math.max(0.08, Math.pow(Math.hypot(dx, dy) / 400, 1.35))); setPower(pull.pow); draw(s0.state.balls); }
          else if (e.buttons) { aimAng = Math.atan2(y - cue.y, x - cue.x); draw(s0.state.balls); }
        };
        cv.onpointerup = () => {
          if (drag) { const cue = s0.state.balls.find((b) => b.n === 0); drag = null; ctx.move({ place: [cue.x, cue.y] }); }
          else if (pull) { const p = pull; pull = null; if (p.pow > 0.05) shoot(p.ang, p.pow); else { setPower(0); draw(s0.state.balls); } }
        };
        cv.onpointercancel = () => { pull = null; drag = null; setPower(0); if (s0) draw(s0.state.balls); };
        if (window.ResizeObserver) { ro = new ResizeObserver(() => { if (cv && s0 && !playing) draw(s0.state.balls); }); ro.observe(cv.parentElement); }
      } else { el.querySelector('.g-score').outerHTML = scoreStrip(ctx, s, over); }
      s0 = s;
      el.querySelector('#pool-info').innerHTML = s.players.map((p, i) => `<span class="${st.turn === i && !over ? 'active' : ''}">${esc(ctx.nameOf(p))} · <b>${gname(i)}</b>${st.groups[i] ? ` · ${remaining(i).length} left` : ''}</span>`).join('');
      const status = over ? `${st.winner === ctx.my ? 'You win!' : esc(ctx.nameOf(s.players[st.winner])) + ' wins'} — ${esc(st.msg)}` : `${st.msg ? esc(st.msg) + ' · ' : ''}${mine ? (st.inHand === ctx.my ? 'Drag the cue ball, then shoot' : 'Your shot — tap to aim, pull cue or power bar') : `${esc(ctx.nameOf(s.players[st.turn]))} is shooting…`}`;
      const statusEl = el.querySelector('#pool-status');
      const finish = () => { snapshot = copy(st.balls); if (mine && !pull) autoAim(st); el.querySelector('.pool-wrap').classList.toggle('mine', mine); el.querySelector('.pool-box').classList.toggle('mine', mine); el.querySelector('#pool-hand').classList.toggle('hidden', !(mine && st.inHand === ctx.my)); draw(st.balls); statusEl.innerHTML = status; };
      if (fresh && !firstDraw && snapshot && st.last && (st.last.pi !== ctx.my || true)) {
        statusEl.textContent = st.last.pi === ctx.my ? '…' : `${ctx.nameOf(s.players[st.last.pi])} shoots…`;
        ctx.fx(900, 0.04, 0, 0.08, 'square');
        play(snapshot, st.last, () => { finish(); if (st.last.foul) ctx.fx(150, 0.3, 0.1, 0.06, 'sawtooth'); });
      } else finish();
    },
    unmount() { cancelAnimationFrame(raf); cancelAnimationFrame(zoomRaf); zoom = zoomT = 0; if (ro) ro.disconnect(); ro = null; cv = null; el = null; snapshot = null; seen = -1; playing = false; },
  };
}
