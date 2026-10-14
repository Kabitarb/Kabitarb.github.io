// Arcade shelf: open-source single-player HTML5 games that run inside the fullscreen game shell (sandboxed iframe,
// served from this site — no third-party scripts). Each one posts its final score back through arcade/bridge.js.
export const ARCADE = {
  trex: { name: 'T-Rex Runner', icon: '🦖', color: '#64748b', blurb: 'Tap to jump the cacti. How far can you run?', license: 'BSD-3-Clause · The Chromium Authors', src: 'https://github.com/wayou/t-rex-runner' },
  hextris: { name: 'Hextris', icon: '⬡', color: '#0ea5e9', blurb: 'Rotate the hexagon, match three sides. Fast puzzle.', license: 'GPL-3.0 · Logan Engstrom, Garrett Finucane, Noah Moroze, Michael Yang', src: 'https://github.com/Hextris/hextris' },
  clumsy: { name: 'Clumsy Bird', icon: '🐦', color: '#22c55e', blurb: 'Tap to flap through the pipes.', license: 'GPL-3.0 · Ellison Leão (melonJS)', src: 'https://github.com/ellisonleao/clumsy-bird' },
  invaders: { name: 'Space Invaders', icon: '👾', color: '#a855f7', blurb: 'Tap left/right to move, tap up top to fire.', license: 'MIT · Dave Kerr', src: 'https://github.com/dwmkerr/spaceinvaders' },
  pacman: { name: 'Pac-Man', icon: '🟡', color: '#facc15', blurb: 'Swipe to steer, tap to start. Eat every dot.', license: 'WTFPL · Dale Harvey', src: 'https://github.com/daleharvey/pacman' },
};
export const ARCADE_ORDER = Object.keys(ARCADE);
const key = (id) => `chatly:arcade:best:${id}`;
export const bestScore = (id) => Number(localStorage.getItem(key(id)) || 0);
export function recordScore(id, score) { const b = bestScore(id); const nb = score > b; if (nb) localStorage.setItem(key(id), String(score)); return { best: Math.max(b, score), newBest: nb && b > 0, first: b === 0 }; }
