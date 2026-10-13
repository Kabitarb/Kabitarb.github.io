// Shared helpers for the game modules.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Deterministic PRNG (mulberry32) so both devices derive the same boards from one seed.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randSeed = () => (Math.random() * 0x7fffffff) | 0;

export const h = (tag, attrs = {}, html = '') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v; else el.setAttribute(k, v); }
  if (html) el.innerHTML = html;
  return el;
};

// Status line helpers shared by the turn-based games.
export function turnText(ctx, s, over) {
  const st = s.state;
  if (over) {
    if (st.winner === null || st.winner === undefined || st.winner < 0) return "It's a draw";
    return st.winner === ctx.my ? 'You win!' : `${esc(ctx.nameOf(s.players[st.winner]))} wins`;
  }
  return st.turn === ctx.my ? 'Your turn' : `${esc(ctx.nameOf(s.players[st.turn]))}'s turn`;
}

// Score strip: avatar + name + wins for each player, active one highlighted.
export function scoreStrip(ctx, s, over, marks = []) {
  const st = s.state;
  return `<div class="g-score">${s.players.map((p, i) => `<div class="g-player ${!over && st.turn === i ? 'active' : ''} ${i === ctx.my ? 'me' : ''}" style="--pc:${PLAYER_COLORS[i % PLAYER_COLORS.length]}">${ctx.avatar(p, 'sm')}<span class="g-pname">${esc(ctx.nameOf(p))}</span>${marks[i] ? `<span class="g-mark">${marks[i]}</span>` : ''}<b class="g-wins">${(st.score && st.score[i]) || 0}</b></div>`).join('<span class="g-vs">vs</span>')}</div>`;
}
export const PLAYER_COLORS = ['#3b82f6', '#f43f5e', '#f59e0b', '#10b981'];
