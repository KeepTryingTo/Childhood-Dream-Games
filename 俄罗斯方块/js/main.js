/* ============================================================
 * main.js —— 入口：固定时间步游戏循环 / HUD / 状态机 / 音效
 * 浏览器专用 IIFE
 *
 * 游戏循环（非功能需求：逻辑 tick 与渲染解耦）：
 *   requestAnimationFrame 独立渲染；
 *   累计 elapsed 达到下落间隔才调用 game.tick()；
 *   消行闪烁期间由 updateClearing(dt) 推进，不进行下落。
 * ============================================================ */
(function (window, document) {
  'use strict';
  var M = window.TetrisModel;
  var R = window.TetrisRules;
  var Storage = window.TetrisStorage;

  /* ---------------- 音效（Web Audio 合成，E3） ---------------- */
  var Sound = {
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, vol, delay, slide) {
      var ac = this.ensure();
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    move: function ()   { this.tone(180, 0.05, 'square', 0.06); },
    rotate: function () { this.tone(320, 0.06, 'triangle', 0.10); },
    lock: function ()   { this.tone(120, 0.08, 'square', 0.14); this.tone(80, 0.10, 'sine', 0.18, 0.02); },
    clear: function ()  { var s = this; [440, 554, 659].forEach(function (f, i) { s.tone(f, 0.10, 'triangle', 0.16, i * 0.06); }); },
    tetris: function () { var s = this; [523, 659, 784, 1046].forEach(function (f, i) { s.tone(f, 0.13, 'triangle', 0.2, i * 0.07); }); },
    hold: function ()   { this.tone(500, 0.06, 'sine', 0.1); this.tone(650, 0.06, 'sine', 0.1, 0.06); },
    over: function ()   { var s = this; [400, 300, 200, 120].forEach(function (f, i) { s.tone(f, 0.22, 'sawtooth', 0.14, i * 0.16); }); },
    levelup: function () { var s = this; [392, 523, 659, 784].forEach(function (f, i) { s.tone(f, 0.09, 'square', 0.1, i * 0.05); }); }
  };
  var soundOn = true;

  /* ---------------- 组件装配 ---------------- */
  var game = new window.TetrisGame({ rng: Math.random, clearingMs: 320 });
  var boardUI = new window.TetrisUI.BoardUI(document.getElementById('board'));

  var el = function (id) { return document.getElementById(id); };
  var scoreEl = el('score'), bestEl = el('best'), levelEl = el('level'), linesEl = el('lines');
  var statusEl = el('status');
  var overlayEl = el('overlay'), overlayTitle = el('overlay-title'), overlayBtn = el('overlay-btn');
  var nextCanvases = [el('next0'), el('next1'), el('next2')];
  var holdCanvas = el('hold');
  var best = Storage.loadBest();
  bestEl.textContent = String(best);

  /* ---------------- 渲染 ---------------- */

  function renderPreviews() {
    // NEXT 前 3 个
    for (var i = 0; i < 3; i++) {
      window.TetrisUI.BoardUI.renderMini(nextCanvases[i], game.queue[i] || null);
    }
    window.TetrisUI.BoardUI.renderMini(holdCanvas, game.hold);
  }

  function renderHUD() {
    scoreEl.textContent = String(game.score);
    levelEl.textContent = String(game.level);
    linesEl.textContent = String(game.lines);
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = String(best);
    }
  }

  function renderStatus() {
    var text = { ready: '按 Enter 开始', playing: '游戏中', paused: '已暂停', over: '游戏结束' };
    statusEl.textContent = text[game.status] || '';
    document.body.classList.toggle('paused', game.status === 'paused');
    document.body.classList.toggle('gameover', game.status === 'over');
  }

  function render() {
    boardUI.render(game);
    renderPreviews();
    renderHUD();
    renderStatus();
  }

  /* ---------------- 状态弹层 ---------------- */

  function showOverlay(title, btnText) {
    overlayTitle.textContent = title;
    overlayBtn.textContent = btnText;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() { overlayEl.classList.add('hidden'); }

  overlayBtn.addEventListener('click', function () {
    hideOverlay();
    startGame();
  });

  function startGame() {
    game.start();
    hideOverlay();
    render();
  }

  function gameOver() {
    var isRecord = Storage.saveBest(game.score);
    if (isRecord) best = game.score;
    Sound.over();
    showOverlay('游戏结束  得分 ' + game.score + (isRecord ? '  🏆新纪录！' : ''), '再来一局');
  }

  /* ---------------- 动作（带音效） ---------------- */

  var actions = {
    left: function () {
      if (game.moveLeft()) Sound.move();
      render();
    },
    right: function () {
      if (game.moveRight()) Sound.move();
      render();
    },
    softDrop: function () {
      var r = game.softDrop();
      if (r === 'locked') afterLock();
      render();
    },
    rotate: function () {
      if (game.rotateCW()) Sound.rotate();
      render();
    },
    rotateCCW: function () {
      if (game.rotateCCW()) Sound.rotate();
      render();
    },
    hardDrop: function () {
      var res = game.hardDrop();
      if (res === 'locked') { Sound.lock(); afterLock(); }
      render();
    },
    hold: function () {
      if (game.holdSwap()) Sound.hold();
      render();
    },
    pause: function () {
      if (game.status === 'playing') {
        game.pause();
        showOverlay('已暂停', '继续游戏');
      } else if (game.status === 'paused') {
        game.resume();
        hideOverlay();
      }
      render();
    },
    restart: function () {
      Sound.hold();
      hideOverlay();
      startGame();
    }
  };

  /** 锁定后的收尾：检测消行音效 / 游戏结束（供软降、硬降共用） */
  function afterLock() {
    if (game.status === 'over') { gameOver(); return; }
    if (game.clearingRows.length > 0) {
      if (game.clearingRows.length >= 4) Sound.tetris();
      else Sound.clear();
      // 消行动画结束后若升级则提示音（在循环中检测）
      _lastLevel = game.level;
    }
  }

  var _lastLevel = 1;

  /* ---------------- 输入绑定 ---------------- */

  window.TetrisInput.bindInput({
    left: function () { if (game.status === 'playing') actions.left(); },
    right: function () { if (game.status === 'playing') actions.right(); },
    softDrop: function () { if (game.status === 'playing') actions.softDrop(); },
    rotate: function () {
      if (game.status === 'playing') actions.rotate();
      else if (game.status === 'ready' || game.status === 'over') { hideOverlay(); startGame(); }
    },
    rotateCCW: function () { if (game.status === 'playing') actions.rotateCCW(); },
    hardDrop: function () {
      if (game.status === 'playing') actions.hardDrop();
      else if (game.status === 'ready' || game.status === 'over') { hideOverlay(); startGame(); }
    },
    hold: function () { if (game.status === 'playing') actions.hold(); },
    pause: function () {
      if (game.status === 'ready' || game.status === 'over') { hideOverlay(); startGame(); }
      else actions.pause();
    },
    restart: actions.restart
  });

  // Enter 也能开始/重开
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Enter' && (game.status === 'ready' || game.status === 'over')) {
      hideOverlay();
      startGame();
    }
  });

  /* ---------------- 固定时间步游戏循环 ---------------- */

  var lastTs = 0, acc = 0;
  function loop(ts) {
    var dt = lastTs ? Math.min(ts - lastTs, 200) : 0;   // 切后台回来限制步长
    lastTs = ts;

    if (game.status === 'playing') {
      if (game.clearingRows.length > 0) {
        // 消行闪烁推进
        var n = game.updateClearing(dt);
        if (n > 0) {
          if (game.status === 'over') { gameOver(); }
          else {
            if (game.level > _lastLevel) { Sound.levelup(); _lastLevel = game.level; }
            _lastLevel = game.level;
          }
        }
      } else {
        // 自然下落（软降由输入即时驱动）
        acc += dt;
        var interval = game.getFallInterval();
        while (acc >= interval && game.status === 'playing' && game.clearingRows.length === 0) {
          acc -= interval;
          var r = game.tick();
          if (r === 'locked') {
            Sound.lock();
            if (game.status === 'over') gameOver();
            else if (game.clearingRows.length > 0) {
              if (game.clearingRows.length >= 4) Sound.tetris(); else Sound.clear();
            }
            break;
          }
        }
      }
    } else {
      acc = 0;
    }

    render();
    requestAnimationFrame(loop);
  }

  /* ---------------- 启动 ---------------- */
  render();
  showOverlay('俄罗斯方块', '开始游戏');
  requestAnimationFrame(loop);
})(window, document);
