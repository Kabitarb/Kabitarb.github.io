// Sea Battle — place your fleet, then take turns firing. A hit earns another shot.
// Both fleets travel in the shared game state (the UI hides them); fine between close friends.
import { esc, scoreStrip } from './util.js';

const N = 10, FLEET = [5, 4, 3, 3, 2];
export const meta = { name: 'Sea Battle', icon: '🚢', min: 2, max: 2, color: '#0ea5e9', blurb: 'Hide your fleet, sink theirs first.', series: 1 };

const cellsOf = (sh) => Array.from({ length: sh.len }, (_, k) => (sh.dir ? (sh.r + k) * N + sh.c : sh.r * N + sh.c + k));
export function validFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  const lens = ships.map((s) => s.len).sort((a, b) => b - a); if (lens.join() !== FLEET.join()) return false;
  const used = new Set();
  for (const sh of ships) {
    if (!(sh.r >= 0 && sh.c >= 0)) return false;
    if (sh.dir ? sh.r + sh.len > N : sh.c + sh.len > N) return false;
    for (const i of cellsOf(sh)) { if (used.has(i)) return false; used.add(i); }
  }
  return true;
}
export function randomFleet(rand = Math.random) {
  for (let tries = 0; tries < 200; tries++) {
    const ships = [];
    for (const len of FLEET) {
      let ok = false;
      for (let t = 0; t < 100 && !ok; t++) {
        const dir = rand() < 0.5 ? 0 : 1, r = Math.floor(rand() * (dir ? N - len + 1 : N)), c = Math.floor(rand() * (dir ? N : N - len + 1));
        const sh = { r, c, len, dir }; const cells = cellsOf(sh);
        // keep one cell of water around ships for readability
        const taken = new Set(ships.flatMap((s) => cellsOf(s).flatMap((i) => { const rr = i / N | 0, cc = i % N; const out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (rr + dr >= 0 && rr + dr < N && cc + dc >= 0 && cc + dc < N) out.push((rr + dr) * N + cc + dc); return out; })));
        if (cells.every((i) => !taken.has(i))) { ships.push(sh); ok = true; }
      }
      if (!ok) break;
    }
    if (ships.length === FLEET.length) return ships;
  }
  return [{ r: 0, c: 0, len: 5, dir: 0 }, { r: 2, c: 0, len: 4, dir: 0 }, { r: 4, c: 0, len: 3, dir: 0 }, { r: 6, c: 0, len: 3, dir: 0 }, { r: 8, c: 0, len: 2, dir: 0 }];
}

const blank = () => ({ phase: 'place', ships: [null, null], shots: [Array(N * N).fill(0), Array(N * N).fill(0)], turn: 0, winner: null, last: null, n: 0, sunk: [[], []] });
export const engine = {
  init() { return Object.assign(blank(), { round: 1, score: [0, 0] }); },
  myTurn(st, my) { return st.phase === 'place' ? !st.ships[my] : st.turn === my; },
  apply(st, pi, mv) {
    if (engine.over(st)) return false;
    if (mv.a === 'place') {
      if (st.phase !== 'place' || st.ships[pi] || !validFleet(mv.ships)) return false;
      st.ships[pi] = mv.ships.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir ? 1 : 0 }));
      if (st.ships[0] && st.ships[1]) st.phase = 'play';
      st.last = { a: 'place', pi }; st.n++;
      return true;
    }
    if (mv.a !== 'fire' || st.phase !== 'play' || st.turn !== pi) return false;
    const r = Number(mv.r), c = Number(mv.c); if (!(r >= 0 && r < N && c >= 0 && c < N)) return false;
    const i = r * N + c, shots = st.shots[pi]; if (shots[i]) return false;
    const enemy = st.ships[1 - pi];
    const ship = enemy.findIndex((sh) => cellsOf(sh).includes(i));
    shots[i] = ship >= 0 ? 2 : 1; st.n++;
    let sunk = false;
    if (ship >= 0 && cellsOf(enemy[ship]).every((k) => shots[k] === 2)) { st.sunk[pi].push(ship); sunk = true; }
    st.last = { a: 'fire', pi, r, c, hit: ship >= 0, sunk, ship, n: st.n };
    if (st.sunk[pi].length === FLEET.length) { st.winner = pi; st.score[pi]++; return true; }
    if (ship < 0) st.turn = 1 - pi;
    return true;
  },
  again(st) { const round = st.round + 1, score = st.score; Object.assign(st, blank(), { round, score, turn: round % 2 }); },
  over(st) { return st.winner !== null; },
};

export function view(ctx) {
  let el, seen = -1, draft = null, pick = null;
  const grid = (cls, cellFn) => { let out = `<div class="sb-grid ${cls}">`; for (let i = 0; i < N * N; i++) out += cellFn(i, i / N | 0, i % N); return out + '</div>'; };
  return {
    mount(host) { el = host; },
    update(s) {
      const st = s.state, over = engine.over(st), my = ctx.my, opp = 1 - my;
      const fresh = st.last && seen !== `${st.round}:${st.n}`; seen = `${st.round}:${st.n}`;
      if (st.phase === 'place') {
        if (!draft) draft = randomFleet();
        const mine = !st.ships[my];
        const map = {}; draft.forEach((sh, k) => cellsOf(sh).forEach((i) => { map[i] = k; }));
        const board = grid('own place', (i) => `<div class="sb-cell ${map[i] !== undefined ? 'ship' : ''} ${pick !== null && map[i] === pick ? 'pick' : ''}" data-i="${i}"></div>`);
        el.innerHTML = `${scoreStrip(ctx, s, over)}
          <div class="g-round">${mine ? 'Place your fleet' : `Waiting for ${esc(ctx.nameOf(s.players[opp]))} to place their fleet…`}</div>
          <div class="sb-wrap">${board}</div>
          ${mine ? `<div class="sb-tools"><button class="btn ghost" id="sb-shuffle">Shuffle</button><button class="btn ghost" id="sb-rotate" ${pick === null ? 'disabled' : ''}>Rotate</button><button class="btn primary" id="sb-ready">Ready</button></div><div class="game-status">Tap a ship, then a square to move it · Rotate · Shuffle</div>` : `<div class="game-status">Your fleet is set. ${st.ships[opp] ? '' : 'Waiting…'}</div>`}`;
        if (!mine) return;
        el.querySelector('#sb-shuffle').onclick = () => { ctx.haptic(); draft = randomFleet(); pick = null; this.update(s); };
        el.querySelector('#sb-rotate').onclick = () => { if (pick === null) return; const sh = draft[pick]; const t = { ...sh, dir: sh.dir ? 0 : 1 }; const test = draft.map((x, k) => (k === pick ? t : x)); if (validFleet(test)) { draft = test; ctx.haptic(); } else ctx.haptic([10, 30, 10]); this.update(s); };
        el.querySelector('#sb-ready').onclick = () => { ctx.haptic(20); ctx.fx(700, 0.1, 0, 0.06, 'sine'); ctx.move({ a: 'place', ships: draft }); };
        el.querySelectorAll('.sb-cell').forEach((c) => { c.onclick = () => {
          const i = Number(c.dataset.i);
          if (map[i] !== undefined) { pick = pick === map[i] ? null : map[i]; ctx.haptic(8); this.update(s); return; }
          if (pick === null) return;
          const sh = draft[pick]; const t = { ...sh, r: i / N | 0, c: i % N }; const test = draft.map((x, k) => (k === pick ? t : x));
          if (validFleet(test)) { draft = test; ctx.haptic(); } else ctx.haptic([10, 30, 10]);
          this.update(s);
        }; });
        return;
      }
      const mine = st.turn === my && !over;
      const myShots = st.shots[my], theirShots = st.shots[opp];
      const enemy = st.ships[opp], fleet = st.ships[my];
      const sunkCells = new Set(st.sunk[my].flatMap((k) => cellsOf(enemy[k])));
      const theirSunk = new Set(st.sunk[opp].flatMap((k) => cellsOf(fleet[k])));
      const myMap = new Set(fleet.flatMap(cellsOf));
      const isLast = (i, pi) => fresh && st.last.a === 'fire' && st.last.pi === pi && st.last.r * N + st.last.c === i;
      const enemyGrid = grid(`enemy ${mine ? 'mine' : ''}`, (i) => `<div class="sb-cell ${myShots[i] === 2 ? 'hit' : myShots[i] === 1 ? 'miss' : mine ? 'can' : ''} ${sunkCells.has(i) ? 'sunk' : ''} ${isLast(i, my) ? 'boom' : ''}" data-i="${i}"></div>`);
      const ownGrid = grid('own small', (i) => `<div class="sb-cell ${myMap.has(i) ? 'ship' : ''} ${theirShots[i] === 2 ? 'hit' : theirShots[i] === 1 ? 'miss' : ''} ${theirSunk.has(i) ? 'sunk' : ''} ${isLast(i, opp) ? 'boom' : ''}"></div>`);
      const fleetBar = (sunk) => `<div class="sb-fleet">${FLEET.map((len, k) => `<span class="${sunk.includes(k) ? 'down' : ''}">${'▮'.repeat(len)}</span>`).join('')}</div>`;
      const l = st.last && st.last.a === 'fire' ? st.last : null;
      const status = over ? (st.winner === my ? 'You sank their whole fleet!' : `${esc(ctx.nameOf(s.players[st.winner]))} sank your fleet`)
        : l && l.n === st.n ? `${l.pi === my ? 'You' : esc(ctx.nameOf(s.players[l.pi]))} ${l.sunk ? 'sank a ship!' : l.hit ? 'hit!' : 'missed'} · ${mine ? 'your shot' : `${esc(ctx.nameOf(s.players[st.turn]))}'s shot`}` : mine ? 'Your shot — tap the enemy sea' : `${esc(ctx.nameOf(s.players[st.turn]))} is aiming…`;
      el.innerHTML = `${scoreStrip(ctx, s, over)}
        <div class="sb-play"><div class="sb-col"><div class="sb-label">Enemy waters ${fleetBar(st.sunk[my])}</div>${enemyGrid}</div>
        <div class="sb-col side"><div class="sb-label">Your fleet ${fleetBar(st.sunk[opp])}</div>${ownGrid}</div></div>
        <div class="game-status">${status}</div>`;
      el.querySelectorAll('.sb-grid.enemy .sb-cell.can').forEach((c) => { c.onclick = () => { const i = Number(c.dataset.i); ctx.haptic(); ctx.fx(180, 0.15, 0, 0.07, 'square'); ctx.move({ a: 'fire', r: i / N | 0, c: i % N }); }; });
      if (fresh && l) { if (l.hit) { ctx.fx(120, 0.3, 0.15, 0.1, 'sawtooth'); ctx.haptic(l.pi === my ? 20 : [30, 40, 30]); if (l.sunk) { ctx.fx(90, 0.5, 0.3, 0.1, 'sawtooth'); } } else ctx.fx(400, 0.12, 0.15, 0.04, 'sine'); }
    },
    unmount() { el = null; draft = null; pick = null; },
  };
}
