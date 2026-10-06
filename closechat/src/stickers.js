// Built-in vector sticker packs. A sticker message carries only the id; the
// artwork is generated locally so stickers cost a few bytes on the wire.
const W = 120;
const O = '#0b1016';

function face(fill, eyes, mouth, extra = '') {
  return `<defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <circle cx="60" cy="60" r="52" fill="${fill}" stroke="#fff" stroke-width="6"/><circle cx="60" cy="60" r="52" fill="url(#g)"/>${eyes}${mouth}${extra}`;
}
const EYES = {
  dots: `<circle cx="42" cy="50" r="6" fill="${O}"/><circle cx="78" cy="50" r="6" fill="${O}"/>`,
  happy: `<path d="M32 52q10-12 20 0M68 52q10-12 20 0" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  wink: `<circle cx="42" cy="50" r="6" fill="${O}"/><path d="M68 52q10-10 20 0" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  hearts: `<path d="M42 60 32 50a7 7 0 0 1 10-9 7 7 0 0 1 10 9zM78 60 68 50a7 7 0 0 1 10-9 7 7 0 0 1 10 9z" fill="#e63946"/>`,
  shades: `<path d="M26 44h68v6c0 10-8 16-18 16s-16-6-16-14c0 8-6 14-16 14S26 60 26 50z" fill="${O}"/><path d="M34 50h18M68 50h18" stroke="#5aa7ff" stroke-width="3" opacity=".8"/>`,
  sad: `<circle cx="42" cy="52" r="6" fill="${O}"/><circle cx="78" cy="52" r="6" fill="${O}"/><path d="M30 42l16 6M90 42l-16 6" stroke="${O}" stroke-width="4" stroke-linecap="round"/>`,
  angry: `<circle cx="42" cy="54" r="6" fill="${O}"/><circle cx="78" cy="54" r="6" fill="${O}"/><path d="M30 40l18 8M90 40l-18 8" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  wide: `<circle cx="42" cy="50" r="10" fill="#fff"/><circle cx="78" cy="50" r="10" fill="#fff"/><circle cx="42" cy="50" r="5" fill="${O}"/><circle cx="78" cy="50" r="5" fill="${O}"/>`,
  sleepy: `<path d="M32 54h20M68 54h20" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  look: `<circle cx="42" cy="50" r="9" fill="#fff"/><circle cx="78" cy="50" r="9" fill="#fff"/><circle cx="46" cy="48" r="5" fill="${O}"/><circle cx="82" cy="48" r="5" fill="${O}"/>`,
};
const MOUTH = {
  smile: `<path d="M38 72q22 22 44 0" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  grin: `<path d="M34 70q26 28 52 0z" fill="${O}"/><path d="M40 72q20 12 40 0z" fill="#fff"/>`,
  laugh: `<path d="M34 66q26 34 52 0z" fill="${O}"/><path d="M44 80q16 10 32 0 -8 8 -16 8 -8 0 -16 -8z" fill="#e63946"/>`,
  o: `<ellipse cx="60" cy="78" rx="10" ry="13" fill="${O}"/>`,
  flat: `<path d="M44 76h32" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  frown: `<path d="M40 84q20-18 40 0" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  smirk: `<path d="M44 76q14 10 32-4" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>`,
  kiss: `<path d="M56 70q10 2 10 8t-10 8q6-8 0-16z" fill="#e63946"/>`,
  tongue: `<path d="M38 70q22 20 44 0z" fill="${O}"/><path d="M58 74h14v8a7 7 0 0 1-14 0z" fill="#ff6b81"/>`,
  zz: `<path d="M44 78h32" stroke="${O}" stroke-width="4" stroke-linecap="round"/><text x="84" y="40" font-size="20" font-weight="800" fill="#fff" stroke="${O}" stroke-width="1.5">z</text><text x="96" y="26" font-size="14" font-weight="800" fill="#fff" stroke="${O}" stroke-width="1.5">z</text>`,
};
const TEAR = `<path d="M84 60q10 16 0 22-10-6 0-22z" fill="#5aa7ff" stroke="#fff" stroke-width="2"/>`;
const TEARS = `<path d="M84 60q10 16 0 22-10-6 0-22zM36 60q-10 16 0 22 10-6 0-22z" fill="#5aa7ff" stroke="#fff" stroke-width="2"/>`;
const BLUSH = `<ellipse cx="34" cy="68" rx="8" ry="5" fill="#ff8fa3" opacity=".8"/><ellipse cx="86" cy="68" rx="8" ry="5" fill="#ff8fa3" opacity=".8"/>`;
const HAT = `<path d="M60 4 86 44H34z" fill="#8b5cf6" stroke="#fff" stroke-width="4"/><circle cx="60" cy="6" r="6" fill="#f1c40f"/><circle cx="50" cy="30" r="3" fill="#f1c40f"/><circle cx="68" cy="24" r="3" fill="#2ecc71"/>`;
const SWEAT = `<path d="M92 36q12 14 0 20-10-6 0-20z" fill="#5aa7ff" stroke="#fff" stroke-width="2"/>`;
const HALO = `<ellipse cx="60" cy="10" rx="30" ry="7" fill="none" stroke="#f1c40f" stroke-width="5"/>`;
const STEAM = `<path d="M24 28q-8-10 0-18M96 28q8-10 0-18" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;

function badge(text, fill, fg = '#fff', size = 34) {
  return `<rect x="8" y="30" width="104" height="60" rx="22" fill="${fill}" stroke="#fff" stroke-width="6"/><text x="60" y="72" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-weight="900" font-size="${size}" fill="${fg}">${text}</text>`;
}
const heart = (fill, extra = '') => `<path d="M60 104 20 64a22 22 0 0 1 40-26 22 22 0 0 1 40 26z" fill="${fill}" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>${extra}`;
const shine = `<path d="M38 44q4-10 14-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".8"/>`;

const Y = '#f6c343', Y2 = '#f8d36b';
export const PACKS = [
  { id: 'faces', name: 'Faces', items: {
    happy: face(Y, EYES.happy, MOUTH.smile, BLUSH),
    grin: face(Y, EYES.dots, MOUTH.grin),
    lol: face(Y, EYES.happy, MOUTH.laugh, TEARS),
    love: face(Y, EYES.hearts, MOUTH.smile, BLUSH),
    cool: face(Y, EYES.shades, MOUTH.smirk),
    wink: face(Y, EYES.wink, MOUTH.tongue),
    kiss: face(Y, EYES.wink, MOUTH.kiss, BLUSH),
    sad: face(Y2, EYES.sad, MOUTH.frown),
    cry: face(Y2, EYES.sad, MOUTH.frown, TEAR),
    angry: face('#ff6b6b', EYES.angry, MOUTH.flat, STEAM),
    wow: face(Y, EYES.wide, MOUTH.o),
    sleepy: face(Y2, EYES.sleepy, MOUTH.zz),
    party: face(Y, EYES.happy, MOUTH.grin, HAT),
    phew: face(Y, EYES.look, MOUTH.smile, SWEAT),
    angel: face(Y, EYES.happy, MOUTH.smile, HALO),
    meh: face(Y2, EYES.look, MOUTH.flat),
  } },
  { id: 'words', name: 'Words', items: {
    lol: badge('LOL', '#8b5cf6'), omg: badge('OMG', '#ec4899'), gg: badge('GG', '#22c55e'),
    brb: badge('BRB', '#f97316'), ok: badge('OK!', '#2d8cff'), yes: badge('YES', '#14b8a6'),
    no: badge('NOPE', '#ff4d5e', '#fff', 28), wow: badge('WOW', '#f1c40f', O), hi: badge('HI!', '#2d8cff'),
    bye: badge('BYE', '#6366f1'), gn: badge('GN 🌙', '#1e293b', '#fff', 26), ty: badge('THX', '#22c55e'),
    call: badge('CALL?', '#2d8cff', '#fff', 26), food: badge('FOOD', '#f97316', '#fff', 28),
    late: badge('LATE', '#ff4d5e', '#fff', 28), love: badge('ILY', '#e63946'),
  } },
  { id: 'love', name: 'Love', items: {
    heart: heart('#e63946', shine),
    pink: heart('#ff6b81', shine),
    purple: heart('#8b5cf6', shine),
    blue: heart('#2d8cff', shine),
    gold: heart('#f1c40f', shine),
    green: heart('#22c55e', shine),
    broken: heart('#e63946') + `<path d="M60 40 50 58l14 12-8 20" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`,
    sparkle: heart('#e63946') + `<path d="M92 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3zM22 90l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#f1c40f"/>`,
    fire: `<path d="M60 10c6 20 28 28 28 56a28 28 0 0 1-56 0c0-14 8-20 10-30 6 6 8 10 8 16 6-10 4-28 10-42z" fill="#f97316" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="M60 60c4 10 14 14 14 26a14 14 0 0 1-28 0c0-8 6-12 8-18 2 4 4 6 6 8z" fill="#f1c40f"/>`,
    star: `<path d="M60 8l15 32 35 4-26 24 7 35-31-17-31 17 7-35L10 44l35-4z" fill="#f1c40f" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`,
    thumb: `<path d="M22 56h18v50H22zM44 56l14-40c10 0 16 6 14 16l-4 20h26a8 8 0 0 1 8 10l-10 34a10 10 0 0 1-10 8H44z" fill="#f6c343" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`,
    hundred: badge('100', '#ff4d5e', '#fff', 40) + `<path d="M20 98h80" stroke="#ff4d5e" stroke-width="6" stroke-linecap="round"/>`,
    ghost: `<path d="M24 110V56a36 36 0 0 1 72 0v54l-12-10-12 10-12-10-12 10-12-10z" fill="#fff" stroke="${O}" stroke-width="4" stroke-linejoin="round"/><circle cx="46" cy="56" r="6" fill="${O}"/><circle cx="74" cy="56" r="6" fill="${O}"/><ellipse cx="60" cy="74" rx="6" ry="8" fill="${O}"/>`,
    cat: `<path d="M22 30l14 18h48l14-18v40a38 32 0 0 1-76 0z" fill="#9aa5b1" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="M44 62l6 6 6-6M64 62l6 6 6-6" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/><path d="M56 78h8l-4 5z" fill="#ff8fa3"/><path d="M60 83q-6 8-14 4M60 83q6 8 14 4M20 80h22M78 80h22M24 92l18-6M96 92l-18-6" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`,
    coffee: `<path d="M24 44h60v34a24 24 0 0 1-24 24H48a24 24 0 0 1-24-24z" fill="#fff" stroke="${O}" stroke-width="4"/><path d="M84 52h8a12 12 0 0 1 0 24h-8" fill="none" stroke="${O}" stroke-width="4"/><path d="M28 50h52v22a20 20 0 0 1-20 20H48a20 20 0 0 1-20-20z" fill="#6f4e37"/><path d="M40 34q-6-8 0-16M56 34q-6-8 0-16M72 34q-6-8 0-16" fill="none" stroke="#9fb0c2" stroke-width="4" stroke-linecap="round"/>`,
    pizza: `<path d="M60 112 12 30a60 60 0 0 1 96 0z" fill="#f6c343" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="M60 100 24 38a50 50 0 0 1 72 0z" fill="#f4a261"/><circle cx="48" cy="50" r="8" fill="#e63946"/><circle cx="72" cy="56" r="8" fill="#e63946"/><circle cx="58" cy="78" r="8" fill="#e63946"/>`,
  } },
];

const ALL = {};
for (const p of PACKS) for (const [k, svg] of Object.entries(p.items)) ALL[p.id + '/' + k] = svg;

export function stickerIds(packId) { const p = PACKS.find((x) => x.id === packId); return p ? Object.keys(p.items).map((k) => p.id + '/' + k) : []; }
export function stickerSvg(id, size = W) {
  const body = ALL[id];
  if (!body) return '';
  return `<svg viewBox="0 0 ${W} ${W}" width="${size}" height="${size}" class="sticker">${body}</svg>`;
}
export function isSticker(id) { return !!ALL[id]; }

// Animated emoji: a plain emoji glyph plus a CSS animation. Sent as sticker id
// `anim/<key>`; the glyph is included in the id-less fallback preview.
export const ANIM = [
  ['lol', '😂', 'bounce'], ['love', '😍', 'beat'], ['kiss', '😘', 'pulse'], ['party', '🥳', 'wiggle'],
  ['cool', '😎', 'slide'], ['think', '🤔', 'tilt'], ['cry', '😭', 'shake'], ['angry', '😡', 'shake'],
  ['mind', '🤯', 'pop'], ['wow', '😮', 'pop'], ['sleep', '😴', 'float'], ['heart', '❤️', 'beat'],
  ['hearts', '💕', 'float'], ['fire', '🔥', 'flicker'], ['hundred', '💯', 'pop'], ['clap', '👏', 'clap'],
  ['thumb', '👍', 'bounce'], ['wave', '👋', 'wave'], ['pray', '🙏', 'pulse'], ['tada', '🎉', 'wiggle'],
  ['rocket', '🚀', 'rocket'], ['eyes', '👀', 'look'], ['skull', '💀', 'shake'], ['ghost', '👻', 'float'],
  ['dance', '💃', 'wiggle'], ['poop', '💩', 'bounce'], ['star', '⭐', 'spin'], ['cake', '🎂', 'tilt'],
  ['beer', '🍻', 'tilt'], ['ok', '👌', 'pop'], ['laugh', '🤣', 'spin'], ['sob', '🥺', 'pulse'],
];
const ANIM_BY_ID = Object.fromEntries(ANIM.map(([k, e, a]) => ['anim/' + k, { e, a }]));
export function animIds() { return Object.keys(ANIM_BY_ID); }
export function animOf(id) { return ANIM_BY_ID[id] || null; }
export function animHtml(id, cls = '') {
  const x = ANIM_BY_ID[id];
  return x ? `<span class="aemoji a-${x.a} ${cls}">${x.e}</span>` : '';
}
