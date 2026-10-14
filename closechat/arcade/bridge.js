// Chatly arcade bridge: reports the final score to the parent app and adds touch controls where the game has none.
(function () {
  var game = document.currentScript.getAttribute('data-game'), reported = false, lastScore = 0;
  function post(type, extra) { try { parent.postMessage(Object.assign({ chatlyArcade: game, type: type }, extra || {}), '*'); } catch (e) {} }
  function over(score) { score = Math.max(0, Math.round(Number(score) || 0)); if (reported && score === lastScore) return; reported = true; lastScore = score; post('over', { score: score }); }
  function reset() { reported = false; }
  window.__chatlyOver = over;
  function key(code, k) { var ev = { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true }; document.dispatchEvent(new KeyboardEvent('keydown', ev)); window.dispatchEvent(new KeyboardEvent('keydown', ev)); setTimeout(function () { document.dispatchEvent(new KeyboardEvent('keyup', ev)); window.dispatchEvent(new KeyboardEvent('keyup', ev)); }, 60); }
  var meta = document.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  if (!document.querySelector('meta[name=viewport]')) document.head.appendChild(meta);
  var st = document.createElement('style'); st.textContent = 'html,body{overscroll-behavior:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}'; document.head.appendChild(st);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var fit = {
    trex: '.interstitial-wrapper{width:62vw!important;max-width:none!important;margin:0 auto!important;padding-top:40vh!important}.arcade-mode .interstitial-wrapper{padding-top:0!important}#messageBox{display:none!important}body{overflow:hidden;background:#fff}',
    hextris: '.rrssb-buttons,#Share-button,a[href*="itunes"],a[href*="apple.com"],a[href*="play.google"],img[src*="store"],img[src*="Store"],img[src*="google"]{display:none!important}',
    invaders: '#gamecontainer{position:absolute!important;left:0!important;top:50%!important;width:100vw!important;margin:0!important;transform:translateY(-50%)}#gameCanvas,#gamecanvas{width:100vw!important;height:auto!important;max-height:100vh}#info{display:none!important}',
    pacman: 'body{width:100vw!important;max-width:100vw;margin:0!important;min-height:100vh;display:flex;flex-direction:column;justify-content:center;background:#000;color:#fff}h1,body>a,#shim,body>br{display:none!important}#pacman{width:100vw!important}',
    clumsy: 'html,body{height:100%;margin:0;background:#000}body{display:flex;align-items:center;justify-content:center}#screen{width:100%}#screen canvas{position:static!important;display:block;margin:0 auto}'
  };
  if (fit[game]) { var fs = document.createElement('style'); fs.textContent = fit[game]; document.head.appendChild(fs); }
  setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 150);
  if (game === 'trex') { var h = document.querySelector('#messageBox h1'); if (h) h.textContent = 'Tap to start'; }
  if (game === 'pacman') Array.prototype.forEach.call(document.body.childNodes, function (n) { if (n.nodeType === 3) n.textContent = ''; });
  if (game === 'trex') {
    document.addEventListener('touchstart', function (e) { key(32, ' '); if (e.cancelable) e.preventDefault(); }, { passive: false });
    var t = setInterval(function () {
      if (!window.Runner || !Runner.prototype.gameOver) return; clearInterval(t);
      var go = Runner.prototype.gameOver, rs = Runner.prototype.restart;
      Runner.prototype.gameOver = function () { go.apply(this, arguments); over(this.distanceMeter.getActualDistance(Math.ceil(this.distanceRan))); };
      Runner.prototype.restart = function () { reset(); return rs.apply(this, arguments); };
    }, 50);
  } else if (game === 'hextris') {
    setInterval(function () { if (window.gameState === 2) over(window.score); else if (window.gameState === 1) reset(); }, 300);
  } else if (game === 'clumsy') {
    setInterval(function () { try { if (me.state.isCurrent(me.state.GAME_OVER)) over(game_data()); else if (me.state.isCurrent(me.state.PLAY)) reset(); } catch (e) {} }, 300);
    function game_data() { return window.game && game.data ? game.data.score : 0; }
  } else if (game === 'invaders') {
    setInterval(function () { try { var s = window.game && game.currentState && game.currentState(); if (s && s.constructor && s.constructor.name === 'GameOverState') over(game.score); else if (s && s.constructor && s.constructor.name === 'PlayState') reset(); } catch (e) {} }, 300);
    // tap left/right half to move, tap top half to fire
    var pressed = null;
    function inv(e) { var x = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX, y = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY; if (y < innerHeight * 0.55) { key(32, ' '); return; } var code = x < innerWidth / 2 ? 37 : 39; if (pressed !== code) { if (pressed) window.game.keyUp(pressed); pressed = code; window.game.keyDown(code); } }
    document.addEventListener('touchstart', function (e) { if (window.game && game.currentState && game.currentState().constructor.name !== 'PlayState') { key(32, ' '); e.preventDefault(); return; } inv(e); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', function (e) { inv(e); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', function () { if (pressed) { window.game.keyUp(pressed); pressed = null; } });
  } else if (game === 'pacman') {
    // swipe to steer, tap to start a new game
    var sx = 0, sy = 0, moved = false;
    document.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; }, { passive: true });
    document.addEventListener('touchmove', function (e) { var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (moved || Math.hypot(dx, dy) < 24) return; moved = true; key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 39 : 37) : (dy > 0 ? 40 : 38)); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', function () { if (!moved) { key(78, 'n'); reset(); } });
    document.addEventListener('keydown', function (e) { if (e.keyCode === 78) reset(); });
  }
  post('ready');
})();
