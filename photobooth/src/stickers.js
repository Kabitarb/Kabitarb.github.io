// Built-in kawaii SVG-ish stickers drawn on canvas + emoji stickers.
// Each art fn draws centered at 0,0 inside a `size` box.

export const STICKER_ART = {
  bow(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#FF8FB1';
    ctx.save(); ctx.rotate(-0.15);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-50 * u, -40 * u, -60 * u, 30 * u, 0, 5 * u);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(50 * u, -40 * u, 60 * u, 30 * u, 0, 5 * u);
    ctx.fill();
    ctx.fillStyle = '#FF6F9C';
    ctx.beginPath(); ctx.arc(0, 0, 12 * u, 0, 7); ctx.fill();
    ctx.restore();
  },
  heart(ctx, s) {
    const u = s / 60;
    ctx.fillStyle = '#FF6F9C';
    ctx.beginPath(); ctx.moveTo(0, 20 * u);
    ctx.bezierCurveTo(-45 * u, -15 * u, -15 * u, -45 * u, 0, -18 * u);
    ctx.bezierCurveTo(15 * u, -45 * u, 45 * u, -15 * u, 0, 20 * u);
    ctx.fill();
  },
  star(ctx, s) {
    const u = s / 60;
    ctx.fillStyle = '#FFD966';
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 12 * u : 30 * u, a = k * Math.PI / 5 - Math.PI / 2;
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  },
  sparkle(ctx, s) {
    const u = s / 60;
    ctx.fillStyle = '#FFE89A';
    ctx.beginPath();
    ctx.moveTo(0, -30 * u); ctx.quadraticCurveTo(4 * u, -4 * u, 30 * u, 0);
    ctx.quadraticCurveTo(4 * u, 4 * u, 0, 30 * u);
    ctx.quadraticCurveTo(-4 * u, 4 * u, -30 * u, 0);
    ctx.quadraticCurveTo(-4 * u, -4 * u, 0, -30 * u);
    ctx.fill();
  },
  ears(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#eee'; ctx.lineWidth = 3 * u;
    for (const d of [-1, 1]) {
      ctx.save(); ctx.translate(d * 28 * u, 0); ctx.rotate(d * 0.2);
      ctx.beginPath(); ctx.ellipse(0, -10 * u, 16 * u, 45 * u, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#FFC9D8';
      ctx.beginPath(); ctx.ellipse(0, -6 * u, 8 * u, 30 * u, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.restore();
    }
  },
  cloud(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#DDF0FF'; ctx.strokeStyle = '#A8D8FF'; ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.arc(-18 * u, 5 * u, 18 * u, 0, 7); ctx.arc(10 * u, -8 * u, 24 * u, 0, 7);
    ctx.arc(28 * u, 8 * u, 16 * u, 0, 7);
    ctx.fill(); ctx.stroke();
  },
  cherry(ctx, s) {
    const u = s / 100;
    ctx.strokeStyle = '#7A9E5F'; ctx.lineWidth = 5 * u;
    ctx.beginPath(); ctx.moveTo(-15 * u, 10 * u); ctx.quadraticCurveTo(0, -45 * u, 25 * u, -40 * u);
    ctx.moveTo(18 * u, 15 * u); ctx.quadraticCurveTo(20 * u, -30 * u, 25 * u, -40 * u);
    ctx.stroke();
    ctx.fillStyle = '#FF6F7D';
    ctx.beginPath(); ctx.arc(-15 * u, 18 * u, 18 * u, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(20 * u, 22 * u, 18 * u, 0, 7); ctx.fill();
    ctx.fillStyle = '#7A9E5F';
    ctx.beginPath(); ctx.ellipse(30 * u, -42 * u, 14 * u, 7 * u, -0.5, 0, 7); ctx.fill();
  },
  flower(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#FFC9D8';
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 - Math.PI / 2;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * 22 * u, Math.sin(a) * 22 * u, 16 * u, 16 * u, 0, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#FFE89A';
    ctx.beginPath(); ctx.arc(0, 0, 12 * u, 0, 7); ctx.fill();
  },
  crown(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#FFD966';
    ctx.beginPath();
    ctx.moveTo(-35 * u, 15 * u); ctx.lineTo(-35 * u, -15 * u); ctx.lineTo(-15 * u, 0);
    ctx.lineTo(0, -30 * u); ctx.lineTo(15 * u, 0); ctx.lineTo(35 * u, -15 * u);
    ctx.lineTo(35 * u, 15 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FF8FB1';
    ctx.beginPath(); ctx.arc(0, 5 * u, 5 * u, 0, 7); ctx.fill();
  },
  bubble(ctx, s) {
    const u = s / 100;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#CDB4DB'; ctx.lineWidth = 4 * u;
    ctx.beginPath(); ctx.roundRect(-45 * u, -28 * u, 90 * u, 48 * u, 20 * u); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10 * u, 20 * u); ctx.lineTo(-18 * u, 38 * u); ctx.lineTo(5 * u, 20 * u); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#B5779A'; ctx.font = `700 ${26 * u}px Jua, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('LOVE', 0, -3 * u);
  },
};

export const EMOJI_STICKERS = ['🎀', '💗', '⭐', '✨', '🌸', '🍒', '🐰', '☁️', '👑', '💌', '🧸', '🍓', '🌙', '💎', '🫧', '🍀'];
export const ART_STICKERS = Object.keys(STICKER_ART);
