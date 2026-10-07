// Turn-based games played over the encrypted channel. Every move carries the
// full post-move state so a dropped relay event never desyncs the players.
export const GAMES = {
  ttt: { name: 'Tic-Tac-Toe', min: 2, max: 2, icon: '⭕' },
  ludo: { name: 'Ludo', min: 2, max: 4, icon: '🎲' },
};

/* ---------------- Tic-Tac-Toe ---------------- */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const TTT = {
  init() { return { b: Array(9).fill(-1), turn: 0, winner: null, line: null, draw: false, round: 1, score: [0, 0] }; },
  apply(st, pi, mv) {
    if (mv.a === 'again') {
      if (st.winner === null && !st.draw) return false;
      Object.assign(st, { b: Array(9).fill(-1), turn: st.round % 2, winner: null, line: null, draw: false, round: st.round + 1 });
      return true;
    }
    if (st.winner !== null || st.draw || pi !== st.turn) return false;
    const i = Number(mv.i); if (!(i >= 0 && i < 9) || st.b[i] !== -1) return false;
    st.b[i] = pi;
    for (const l of LINES) if (l.every((k) => st.b[k] === pi)) { st.winner = pi; st.line = l; st.score[pi]++; return true; }
    if (st.b.every((x) => x !== -1)) { st.draw = true; return true; }
    st.turn = 1 - st.turn;
    return true;
  },
  over(st) { return st.winner !== null || st.draw; },
};

/* ---------------- Ludo ---------------- */
export const LUDO_COLORS = [
  { name: 'Red', fill: '#e63946' }, { name: 'Green', fill: '#2a9d8f' }, { name: 'Yellow', fill: '#f1c40f' }, { name: 'Blue', fill: '#3b82f6' },
];
const START = [0, 13, 26, 39];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const COLOR_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
// 52-cell track as [col,row] on a 15x15 grid, clockwise from red's start.
const TRACK = (() => {
  const t = [];
  for (let c = 1; c <= 5; c++) t.push([c, 6]);
  for (let r = 5; r >= 0; r--) t.push([6, r]);
  t.push([7, 0]);
  for (let r = 0; r <= 5; r++) t.push([8, r]);
  for (let c = 9; c <= 14; c++) t.push([c, 6]);
  t.push([14, 7]);
  for (let c = 14; c >= 9; c--) t.push([c, 8]);
  for (let r = 9; r <= 14; r++) t.push([8, r]);
  t.push([7, 14]);
  for (let r = 14; r >= 9; r--) t.push([6, r]);
  for (let c = 5; c >= 0; c--) t.push([c, 8]);
  t.push([0, 7]); t.push([0, 6]);
  return t;
})();
const HOME_COL = [
  [1, 2, 3, 4, 5].map((c) => [c, 7]), [1, 2, 3, 4, 5].map((r) => [7, r]),
  [13, 12, 11, 10, 9].map((c) => [c, 7]), [13, 12, 11, 10, 9].map((r) => [7, r]),
];
const BASE_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];
const BASE_SPOTS = [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]];

function cellOf(ci, rel) {
  if (rel <= 50) return TRACK[(START[ci] + rel) % 52];
  if (rel <= 55) return HOME_COL[ci][rel - 51];
  return [7, 7];
}
const LUDO = {
  init(n) {
    return { n, colors: COLOR_SETS[n] || COLOR_SETS[4].slice(0, n), tokens: Array.from({ length: n }, () => [-1, -1, -1, -1]), turn: 0, dice: 0, phase: 'roll', winner: null, sixes: 0, last: null, finished: [], seq: 0 };
  },
  legal(st, pi) {
    if (st.phase !== 'move' || pi !== st.turn) return [];
    const d = st.dice, out = [];
    st.tokens[pi].forEach((pos, i) => { if (pos === -1 ? d === 6 : pos + d <= 56) out.push(i); });
    return out;
  },
  next(st) { st.turn = (st.turn + 1) % st.n; while (st.finished.includes(st.turn)) st.turn = (st.turn + 1) % st.n; st.phase = 'roll'; st.dice = 0; st.sixes = 0; },
  apply(st, pi, mv) {
    if (st.winner !== null || pi !== st.turn) return false;
    if (mv.a === 'roll') {
      if (st.phase !== 'roll') return false;
      const d = Number(mv.d); if (!(d >= 1 && d <= 6)) return false;
      st.dice = d; st.seq = (st.seq || 0) + 1; st.last = { pi, a: 'roll', d, seq: st.seq };
      if (d === 6) { st.sixes++; if (st.sixes >= 3) { LUDO.next(st); return true; } }
      st.phase = 'move';
      if (!LUDO.legal(st, pi).length) { if (d === 6) { st.phase = 'roll'; } else LUDO.next(st); }
      return true;
    }
    if (mv.a === 'move') {
      const i = Number(mv.i);
      if (!LUDO.legal(st, pi).includes(i)) return false;
      const d = st.dice, toks = st.tokens[pi];
      const from = toks[i];
      const to = from === -1 ? 0 : from + d;
      toks[i] = to;
      let captured = false; const caps = [];
      if (to <= 50) {
        const abs = (START[st.colors[pi]] + to) % 52;
        if (!SAFE.has(abs)) {
          st.tokens.forEach((ot, op) => { if (op === pi) return; ot.forEach((p, k) => { if (p >= 0 && p <= 50 && (START[st.colors[op]] + p) % 52 === abs) { caps.push({ pi: op, i: k, from: p }); ot[k] = -1; captured = true; } }); });
        }
      }
      const finished = to === 56;
      st.seq = (st.seq || 0) + 1;
      st.last = { pi, a: 'move', i, from, to, captured, caps, finished, seq: st.seq };
      if (toks.every((p) => p === 56)) {
        st.finished.push(pi);
        if (st.winner === null) st.winner = pi;
        if (st.finished.length >= st.n - 1) { st.phase = 'done'; return true; }
        LUDO.next(st); return true;
      }
      if (d === 6 || captured || finished) { st.phase = 'roll'; st.dice = 0; } else LUDO.next(st);
      return true;
    }
    return false;
  },
  over(st) { return st.winner !== null; },
};
const ENGINES = { ttt: TTT, ludo: LUDO };

/* ---------------- manager ---------------- */
export class GameManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    app.gameHandler = (chatId, from, c, rumor) => this.handle(chatId, from, c, rumor);
  }
  get sessions() { return this.app.state.games; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get(id) { return this.sessions[id]; }
  forChat(chatId) { return Object.values(this.sessions).filter((s) => s.chatId === chatId && s.status !== 'done').sort((a, b) => b.ts - a.ts); }
  myIndex(s) { return s.players.indexOf(this.app.pk); }

  prune() {
    const all = Object.values(this.sessions).sort((a, b) => b.ts - a.ts);
    for (const s of all.slice(30)) delete this.sessions[s.id];
    const dayAgo = Date.now() - 2 * 864e5;
    for (const s of all) if (s.status === 'lobby' && s.ts < dayAgo) delete this.sessions[s.id];
  }

  send(s, obj) {
    return this.app.sendChatControl(s.chatId, Object.assign({ t: 'game', id: s.id }, obj), false, true);
  }
  card(s, text) {
    const chat = this.app.store.chat(s.chatId);
    const id = 'game:' + s.id + ':' + Math.random().toString(36).slice(2, 7);
    this.app.insertMessage(chat, { id, kind: 'game', gameId: s.id, type: s.type, text, from: this.app.pk, ts: Date.now() });
  }

  invite(chatId, type) {
    if (!GAMES[type]) throw new Error('Unknown game');
    const id = Math.random().toString(36).slice(2, 10);
    const s = { id, chatId, type, host: this.app.pk, players: [this.app.pk], status: 'lobby', seq: 0, state: null, ts: Date.now() };
    this.sessions[id] = s;
    this.card(s, `You started ${GAMES[type].name}`);
    this.prune(); this.app.store.save();
    this.send(s, { a: 'invite', type });
    this.emit('update', { id });
    return s;
  }
  join(id) {
    const s = this.get(id); if (!s || s.status !== 'lobby') return;
    if (!s.players.includes(this.app.pk)) {
      if (s.players.length >= GAMES[s.type].max) throw new Error('Game is full');
      s.players.push(this.app.pk);
    }
    s.ts = Date.now(); this.app.store.save();
    this.send(s, { a: 'join' });
    this.emit('update', { id });
  }
  start(id) {
    const s = this.get(id); if (!s || s.status !== 'lobby' || s.host !== this.app.pk) return;
    if (s.players.length < GAMES[s.type].min) throw new Error('Waiting for players');
    s.state = ENGINES[s.type].init(s.players.length);
    s.status = 'playing'; s.seq = 1; s.ts = Date.now();
    this.app.store.save();
    this.send(s, { a: 'start', players: s.players, state: s.state, seq: s.seq });
    this.emit('update', { id });
  }
  move(id, mv) {
    const s = this.get(id); if (!s || s.status !== 'playing') return false;
    const pi = this.myIndex(s); if (pi < 0) return false;
    const ok = ENGINES[s.type].apply(s.state, pi, mv);
    if (!ok) return false;
    s.seq++; s.ts = Date.now();
    if (ENGINES[s.type].over(s.state) && s.type === 'ludo') this.finish(s);
    this.app.store.save();
    this.send(s, { a: 'move', seq: s.seq, mv, state: s.state });
    this.emit('update', { id });
    return true;
  }
  quit(id) {
    const s = this.get(id); if (!s || s.status === 'done') return;
    s.status = 'done'; s.quitBy = this.app.pk; s.ts = Date.now();
    this.card(s, `You left ${GAMES[s.type].name}`);
    this.app.store.save();
    this.send(s, { a: 'quit' });
    this.emit('update', { id });
  }
  finish(s) {
    s.status = 'done';
    const w = s.state.winner;
    if (w !== null && w !== undefined) this.card(s, `${this.app.nameOf(s.players[w])} won ${GAMES[s.type].name} 🏆`);
  }
  legal(id) { const s = this.get(id); return s && s.status === 'playing' ? (ENGINES[s.type].legal ? ENGINES[s.type].legal(s.state, this.myIndex(s)) : []) : []; }

  handle(chatId, from, c, rumor) {
    const id = String(c.id || ''); if (!/^[a-z0-9]{4,12}$/.test(id)) return;
    const me = this.app.pk;
    let s = this.sessions[id];
    const ts = (rumor.created_at || 0) * 1000;
    switch (c.a) {
      case 'invite': {
        if (!GAMES[c.type]) return;
        if (!s) {
          s = this.sessions[id] = { id, chatId, type: c.type, host: from, players: [from], status: 'lobby', seq: 0, state: null, ts: ts || Date.now() };
          if (from !== me) this.card(s, `${this.app.nameOf(from)} wants to play ${GAMES[c.type].name}`);
          this.prune();
        }
        break;
      }
      case 'join':
        if (!s || s.chatId !== chatId || s.status !== 'lobby') return;
        if (!s.players.includes(from) && s.players.length < GAMES[s.type].max) s.players.push(from);
        break;
      case 'start':
        if (!s || s.chatId !== chatId || from !== s.host || s.status === 'done') return;
        if (!Array.isArray(c.players) || !c.players.includes(from) || !c.state) return;
        s.players = c.players.slice(0, GAMES[s.type].max); s.state = c.state; s.seq = Number(c.seq) || 1; s.status = 'playing'; s.ts = Date.now();
        break;
      case 'move':
        if (!s || s.chatId !== chatId || s.status !== 'playing' || !s.players.includes(from)) return;
        if (!c.state) return;
        if (!(Number(c.seq) > s.seq)) {
          // Peer is behind (their last update to us was lost): push our newer state back.
          if (from !== me && Number(c.seq) < s.seq && !this._resyncAt?.[id] || (this._resyncAt?.[id] || 0) < Date.now() - 3000) {
            (this._resyncAt ||= {})[id] = Date.now();
            if (from !== me && Number(c.seq) < s.seq) this.send(s, { a: 'move', seq: s.seq, mv: null, state: s.state });
          }
          return;
        }
        s.state = c.state; s.seq = Number(c.seq); s.ts = Date.now();
        if (ENGINES[s.type].over(s.state) && s.type === 'ludo') this.finish(s);
        break;
      case 'quit':
        if (!s || s.chatId !== chatId || !s.players.includes(from) || s.status === 'done') return;
        s.status = 'done'; s.quitBy = from; s.ts = Date.now();
        if (from !== me) this.card(s, `${this.app.nameOf(from)} left ${GAMES[s.type].name}`);
        break;
      default: return;
    }
    this.emit('update', { id, from });
  }
}

/* ---------------- rendering ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderTTT(s, myIdx, nameOf) {
  const st = s.state; const marks = ['✕', '◯'];
  const cells = st.b.map((v, i) => {
    const win = st.line && st.line.includes(i);
    const can = v === -1 && st.turn === myIdx && !TTT.over(st);
    return `<button class="ttt-cell ${win ? 'win' : ''} ${can ? 'can' : ''} p${v}" data-i="${i}" ${can ? '' : 'disabled'}>${v === -1 ? '' : marks[v]}</button>`;
  }).join('');
  let status;
  if (st.winner !== null) status = `${st.winner === myIdx ? 'You win!' : esc(nameOf(s.players[st.winner])) + ' wins'} 🎉`;
  else if (st.draw) status = "It's a draw";
  else status = st.turn === myIdx ? 'Your turn' : `${esc(nameOf(s.players[st.turn]))}'s turn`;
  return `<div class="ttt-score">${s.players.map((p, i) => `<span class="${st.turn === i && !TTT.over(st) ? 'active' : ''}">${marks[i]} ${esc(nameOf(p))} <b>${st.score[i]}</b></span>`).join('')}</div>
    <div class="ttt">${cells}</div><div class="game-status">${status}</div>
    ${TTT.over(st) ? '<button class="btn primary small" data-game-act="again">Play again</button>' : ''}`;
}

// Board coordinates of a token (for hop animations in the UI). pos -1 = base.
export function ludoXY(st, pi, i, pos, C = 30) {
  const ci = st.colors[pi];
  if (pos === -1) { const [ox, oy] = BASE_ORIGIN[ci]; const [bx, by] = BASE_SPOTS[i]; return [(ox + bx + 0.5) * C, (oy + by + 0.5) * C]; }
  if (pos === 56) { const cx = 7.5 * C; return [cx + (ci % 2 ? 0 : (ci === 0 ? -20 : 20)), cx + (ci % 2 ? (ci === 1 ? -20 : 20) : 0)]; }
  const [c, r] = cellOf(ci, pos); return [(c + 0.5) * C, (r + 0.5) * C];
}
// Would moving token i capture someone? (for hints)
export function ludoCaptures(st, pi, i) {
  const pos = st.tokens[pi][i]; const to = pos === -1 ? 0 : pos + st.dice;
  if (to > 50) return false;
  const abs = (START[st.colors[pi]] + to) % 52;
  if (SAFE.has(abs)) return false;
  return st.tokens.some((ot, op) => op !== pi && ot.some((p) => p >= 0 && p <= 50 && (START[st.colors[op]] + p) % 52 === abs));
}
export function renderLudo(s, myIdx, nameOf) {
  const st = s.state, C = 30, S = 15 * C;
  let svg = `<svg viewBox="0 0 ${S} ${S}" class="ludo">`;
  const colorFill = (ci) => LUDO_COLORS[ci].fill;
  const quad = (ci) => {
    const [ox, oy] = BASE_ORIGIN[ci];
    const active = st.colors.includes(ci);
    svg += `<rect x="${ox * C}" y="${oy * C}" width="${6 * C}" height="${6 * C}" rx="10" fill="${active ? colorFill(ci) : '#8892a0'}" opacity="${active ? 1 : .35}"/>
      <rect x="${(ox + 1) * C}" y="${(oy + 1) * C}" width="${4 * C}" height="${4 * C}" rx="8" fill="#fff" opacity=".92"/>`;
    for (const [bx, by] of BASE_SPOTS) svg += `<circle cx="${(ox + bx + 0.5) * C}" cy="${(oy + by + 0.5) * C}" r="${C * 0.36}" fill="${active ? colorFill(ci) : '#cfd5dd'}" opacity=".25"/>`;
  };
  for (let ci = 0; ci < 4; ci++) quad(ci);
  TRACK.forEach(([c, r], i) => {
    const startOf = START.indexOf(i);
    const fill = startOf >= 0 ? colorFill(startOf) : '#fff';
    svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${fill}" stroke="#c9d1db" stroke-width="1.2"/>`;
    if (SAFE.has(i) && startOf < 0) svg += `<text class="safe-star" x="${(c + 0.5) * C}" y="${(r + 0.5) * C + 6}" text-anchor="middle" font-size="18" fill="#9aa5b1">★</text>`;
  });
  HOME_COL.forEach((cells, ci) => { for (const [c, r] of cells) svg += `<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${colorFill(ci)}" opacity=".85" stroke="#c9d1db" stroke-width="1.2"/>`; });
  const cx = 7.5 * C, m = 6 * C, M = 9 * C;
  svg += `<path d="M${m} ${m}L${cx} ${cx}L${m} ${M}Z" fill="${colorFill(0)}"/><path d="M${m} ${m}L${cx} ${cx}L${M} ${m}Z" fill="${colorFill(1)}"/><path d="M${M} ${m}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(2)}"/><path d="M${m} ${M}L${cx} ${cx}L${M} ${M}Z" fill="${colorFill(3)}"/>`;
  // tokens
  const legal = new Set(st.turn === myIdx ? LUDO.legal(st, myIdx) : []);
  const occupancy = {};
  const placed = [];
  st.tokens.forEach((toks, pi) => {
    const ci = st.colors[pi];
    toks.forEach((pos, i) => {
      let x, y;
      if (pos === -1) { const [ox, oy] = BASE_ORIGIN[ci]; const [bx, by] = BASE_SPOTS[i]; x = (ox + bx + 0.5) * C; y = (oy + by + 0.5) * C; }
      else { const [c, r] = cellOf(ci, pos); const key = c + ',' + r; const k = occupancy[key] = (occupancy[key] || 0) + 1; x = (c + 0.5) * C + ((k - 1) % 2) * 7 - 3; y = (r + 0.5) * C + Math.floor((k - 1) / 2) * 7 - 3; if (pos === 56) { x = cx + (ci % 2 ? 0 : (ci === 0 ? -20 : 20)); y = cx + (ci % 2 ? (ci === 1 ? -20 : 20) : 0); } }
      const can = pi === myIdx && legal.has(i);
      placed.push({ x, y, ci, pi, i, pos, can, cap: can && ludoCaptures(st, pi, i), mine: pi === myIdx });
    });
  });
  // where legal tokens would land (ghost targets)
  for (const t of placed) if (t.can) {
    const to = t.pos === -1 ? 0 : t.pos + st.dice; const [tx, ty] = ludoXY(st, t.pi, t.i, to, C);
    svg += `<circle class="target ${t.cap ? 'cap' : ''}" cx="${tx}" cy="${ty}" r="${C * 0.42}" fill="none" stroke="${t.cap ? '#ff4d5e' : colorFill(t.ci)}" stroke-width="3" stroke-dasharray="5 4"/>`;
  }
  for (const t of placed) {
    svg += `<g class="tok ${t.can ? 'can' : ''} ${t.cap ? 'cap' : ''} ${t.pos === 56 ? 'home' : ''}" data-key="${t.pi}-${t.i}" ${t.can ? `data-tok="${t.i}"` : ''} style="--tx:${t.x}px;--ty:${t.y}px"><circle cx="0" cy="${C * 0.08}" r="${C * 0.4}" fill="rgba(0,0,0,.25)"/><circle cx="0" cy="0" r="${C * 0.4}" fill="${colorFill(t.ci)}" stroke="${t.can ? '#fff' : 'rgba(0,0,0,.5)'}" stroke-width="${t.can ? 3.5 : 2}"/><circle cx="-3" cy="-3" r="${C * 0.14}" fill="#fff" opacity=".7"/></g>`;
  }
  svg += '</svg>';
  const over = st.phase === 'done' || (st.winner !== null && st.finished.length >= st.n - 1);
  const myTurn = st.turn === myIdx && !over;
  const turnName = st.turn === myIdx ? 'Your' : esc(nameOf(s.players[st.turn])) + "'s";
  let status = '';
  if (st.winner !== null) status = `🏆 ${st.winner === myIdx ? 'You won!' : esc(nameOf(s.players[st.winner])) + ' won'}${over ? '' : ' · others still playing'}`;
  if (!over) {
    if (st.phase === 'roll') status = `${turnName} turn — ${myTurn ? 'roll the dice' : 'rolling…'}`;
    else status = `${turnName} turn — rolled ${st.dice}${myTurn ? ', pick a token' : ''}`;
  }
  const players = s.players.map((p, i) => `<span class="ludo-player ${st.turn === i && !over ? 'active' : ''}" style="--c:${colorFill(st.colors[i])}"><i></i>${esc(nameOf(p))}${st.finished.includes(i) ? ' 🏁' : ''}</span>`).join('');
  const dice = `<button class="dice ${myTurn && st.phase === 'roll' ? 'can' : ''}" data-game-act="roll" data-d="${st.dice || 0}" ${myTurn && st.phase === 'roll' ? '' : 'disabled'} aria-label="Dice"><span class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></span></button>`;
  const turnColor = colorFill(st.colors[st.turn]);
  return `<div class="ludo-players">${players}</div>${svg}<div class="ludo-bar" style="--turn:${turnColor}">${dice}<div class="game-status">${status}</div></div>`;
}
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export const ENGINE = ENGINES;
