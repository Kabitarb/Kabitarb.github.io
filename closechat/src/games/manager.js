// GameManager: sessions live in app.state.games and travel over the encrypted
// chat-control channel. Every move carries the full post-move state, so a lost
// relay event never desyncs the players; a stale peer gets our newer state back.
import { GAMES, ENGINES } from './registry.js';
import { randSeed } from './util.js';

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
  engine(s) { return ENGINES[s.type]; }
  isOver(s) { return s.status === 'playing' && !!s.state && this.engine(s).over(s.state); }
  isMyTurn(s) {
    if (s.status !== 'playing' || !s.state || this.isOver(s)) return false;
    const E = this.engine(s), my = this.myIndex(s);
    if (my < 0) return false;
    return E.myTurn ? E.myTurn(s.state, my) : s.state.turn === my;
  }

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
    s.seed = randSeed();
    s.state = this.engine(s).init(s.players.length, s.seed);
    s.status = 'playing'; s.seq = 1; s.ts = Date.now();
    this.app.store.save();
    this.send(s, { a: 'start', players: s.players, state: s.state, seq: s.seq, seed: s.seed });
    this.emit('update', { id });
  }
  move(id, mv) {
    const s = this.get(id); if (!s || s.status !== 'playing') return false;
    const pi = this.myIndex(s); if (pi < 0) return false;
    const E = this.engine(s);
    let ok;
    if (mv && mv.a === 'again') {
      if (!E.over(s.state) || !E.again) return false;
      E.again(s.state, pi); ok = true;
    } else ok = E.apply(s.state, pi, mv);
    if (!ok) return false;
    s.seq++; s.ts = Date.now();
    this.afterMove(s);
    this.app.store.save();
    this.send(s, { a: 'move', seq: s.seq, mv, state: s.state });
    this.emit('update', { id });
    return true;
  }
  // Round finished: drop a card into the chat once per round.
  afterMove(s) {
    const st = s.state;
    if (!this.engine(s).over(st)) return;
    const key = `${st.round || 1}`;
    if (s.cardFor === key) return;
    s.cardFor = key;
    const w = st.winner;
    const G = GAMES[s.type];
    const roundTxt = st.round && st.round > 1 ? ` (round ${st.round})` : '';
    if (w !== null && w !== undefined && w >= 0) this.card(s, `${w === this.myIndex(s) ? 'You' : this.app.nameOf(s.players[w])} won ${G.name}${roundTxt} 🏆`);
    else this.card(s, `${G.name}${roundTxt} ended in a draw`);
  }
  quit(id) {
    const s = this.get(id); if (!s || s.status === 'done') return;
    s.status = 'done'; s.quitBy = this.app.pk; s.ts = Date.now();
    this.card(s, `You left ${GAMES[s.type].name}`);
    this.app.store.save();
    this.send(s, { a: 'quit' });
    this.emit('update', { id });
  }
  legal(id) { const s = this.get(id); const E = s && this.engine(s); return s && s.status === 'playing' && E.legal ? E.legal(s.state, this.myIndex(s)) : []; }

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
        s.players = c.players.slice(0, GAMES[s.type].max); s.state = c.state; s.seq = Number(c.seq) || 1; s.seed = Number(c.seed) || 0; s.status = 'playing'; s.ts = Date.now();
        break;
      case 'move':
        if (!s || s.chatId !== chatId || s.status !== 'playing' || !s.players.includes(from)) return;
        if (!c.state) return;
        if (!(Number(c.seq) > s.seq)) {
          // Peer is behind (their last update to us was lost): push our newer state back, at most every 3 s.
          if (from !== me && Number(c.seq) < s.seq && (this._resyncAt?.[id] || 0) < Date.now() - 3000) {
            (this._resyncAt ||= {})[id] = Date.now();
            this.send(s, { a: 'move', seq: s.seq, mv: null, state: s.state });
          }
          return;
        }
        s.state = c.state; s.seq = Number(c.seq); s.ts = Date.now();
        this.afterMove(s);
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
