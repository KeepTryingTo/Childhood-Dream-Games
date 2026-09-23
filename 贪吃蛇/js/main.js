/* ============================================================
 * main.js —— 入口 / 游戏循环（固定时间步）/ 输入 / HUD / 菜单
 * 依赖：game.js / ai.js / storage.js / ui.js
 * ============================================================ */
(function (window, document) {
  'use strict';
  var SG = window.SnakeGame, AI = window.SnakeAI, ST = window.SnakeStorage, UI = window.SnakeUI2;
  var D = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };

  /* ---------------- 难度表（require.md 步骤 5） ---------------- */
  var DIFF = {
    easy:   { rows: 20, cols: 20, speedMs: 150 },
    medium: { rows: 25, cols: 25, speedMs: 100 },
    hard:   { rows: 30, cols: 30, speedMs: 70 }
  };

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById('board');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var statusEl = document.getElementById('status');
  var diffEl = document.getElementById('difficulty');
  var bestRowEl = document.getElementById('best-row');
  var overlayEl = document.getElementById('overlay');
  var overlayTextEl = document.getElementById('overlay-text');
  var overlaySubEl = document.getElementById('overlay-sub');
  var overlayBtnEl = document.getElementById('overlay-btn');
  var btnPause = document.getElementById('btn-pause');
  var btnNew = document.getElementById('btn-new');
  var btnSound = document.getElementById('btn-sound');
  var chkWrap = document.getElementById('chk-wrap');
  var chkObstacle = document.getElementById('chk-obstacle');
  var chkAccel = document.getElementById('chk-accel');
  var chkAI = document.getElementById('chk-ai');
  var chkTwo = document.getElementById('chk-two');

  /* ---------------- 控制器状态 ---------------- */
  var game = null;
  var ui = new UI.SnakeUI(canvas);
  var difficulty = diffEl ? diffEl.value : 'easy';
  var acc = 0, lastTs = 0, rafId = 0;

  function opts() {
    var d = DIFF[difficulty];
    return {
      rows: d.rows, cols: d.cols, speedMs: d.speedMs,
      wrapMode: chkWrap.checked,
      accel: chkAccel.checked,
      twoPlayer: chkTwo.checked,
      obstacleCount: chkObstacle.checked ? 12 : 0
    };
  }

  /* ---------------- 对局生命周期 ---------------- */

  function newGame() {
    game = new SG(opts());
    ui.setup(game);
    acc = 0;
    overlayEl.classList.add('hidden');
    refreshBest();
    updateHUD('按任意方向键开始');
    btnPause.textContent = '暂停';
    ui.render(game, 0);
  }

  function startGame() {
    game.status = 'playing';
    updateHUD();
    btnPause.textContent = '暂停';
  }

  function togglePause() {
    if (!game) return;
    if (game.status === 'playing') {
      game.status = 'paused';
      btnPause.textContent = '继续';
      updateHUD('已暂停');
    } else if (game.status === 'paused') {
      game.status = 'playing';
      btnPause.textContent = '暂停';
      updateHUD();
    }
  }

  function onGameOver() {
    UI.Sound.die();
    var text, sub;
    if (game.win) {
      text = '通关！棋盘已被占满';
      sub = '最终得分 ' + game.scoreOf(0);
      UI.Sound.win();
    } else if (game.twoPlayer) {
      if (game.winner === -1) { text = '平局！双蛇相撞'; sub = ''; }
      else {
        text = (game.winner === 0 ? '绿方' : '蓝方') + '获胜！';
        sub = '绿 ' + game.snakes[0].score + ' : ' + game.snakes[1].score + ' 蓝';
      }
    } else {
      text = 'GAME OVER';
      sub = '得分 ' + game.scoreOf(0) + '（' + deathText(game.deathReason) + '）';
      var isRecord = ST.saveBest(difficulty, game.scoreOf(0));
      if (isRecord) sub += ' · 新纪录！';
      refreshBest();
    }
    overlayTextEl.textContent = text;
    overlaySubEl.textContent = sub;
    overlayEl.classList.remove('hidden');
    updateHUD('游戏结束');
  }

  function deathText(reason) {
    return { wall: '撞墙', obstacle: '撞障碍', self: '咬到自己', other: '撞到对手', headon: '蛇头相撞' }[reason] || reason;
  }

  function refreshBest() {
    var best = ST.loadBest(difficulty);
    bestEl.textContent = String(best);
    bestRowEl.style.display = game && game.twoPlayer ? 'none' : '';
  }

  function updateHUD(msg) {
    if (game.twoPlayer) {
      scoreEl.textContent = '绿 ' + game.snakes[0].score + ' : 蓝 ' + game.snakes[1].score;
    } else {
      scoreEl.textContent = String(game.scoreOf(0));
    }
    if (msg) statusEl.textContent = msg;
    else if (game.status === 'playing') statusEl.textContent = game.twoPlayer ? '对局中' : '得分 ' + game.scoreOf(0);
  }

  /* ---------------- 游戏循环：固定时间步 + rAF 渲染解耦 ---------------- */

  function frame(ts) {
    var delta = Math.min(100, ts - lastTs);   // 后台切回时防大步进
    lastTs = ts;
    if (game && game.status === 'playing') {
      acc += delta;
      var guard = 0;
      while (acc >= game.speedMs && game.status === 'playing' && guard++ < 8) {
        acc -= game.speedMs;
        stepOnce();
      }
    }
    if (game) {
      var alpha = game.status === 'playing'
        ? Math.min(1, acc / game.speedMs) : 0;
      ui.render(game, alpha);
    }
    rafId = requestAnimationFrame(frame);
  }

  function stepOnce() {
    if (chkAI.checked && !game.twoPlayer) {
      var dir = AI.chooseDirection(game, 0);
      if (dir) {
        // AI 方向直接覆盖缓冲，避免残留人工输入
        game.snakes[0].dirQueue.length = 0;
        game.setDirection(dir, 0);
      }
    }
    ui.capturePrev(game);
    game.tick();
    updateHUD();
    if (game.status === 'over') onGameOver();
  }

  /* ---------------- 输入 ---------------- */

  var KEY_DIRS = {
    ArrowUp: D.up, ArrowDown: D.down, ArrowLeft: D.left, ArrowRight: D.right,
    KeyW: D.up, KeyS: D.down, KeyA: D.left, KeyD: D.right
  };

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (game && game.status !== 'over') togglePause();
      return;
    }
    if (e.code === 'KeyR') { e.preventDefault(); newGame(); return; }
    var dir = KEY_DIRS[e.code];
    if (!dir || !game) return;
    e.preventDefault();

    // AI 开启时忽略人工方向（单人）
    if (chkAI.checked && !game.twoPlayer) return;

    var player = game.twoPlayer
      ? (e.code.indexOf('Arrow') === 0 ? 1 : 0)
      : 0;

    if (game.status === 'ready') startGame();
    if (game.status === 'playing') game.setDirection(dir, player);
  });

  // 移动端滑动控制（单人）
  var touchStart = null;
  canvas.addEventListener('touchstart', function (e) {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (!touchStart || !game || game.twoPlayer) return;
    var dir = ui.swipeDirection(touchStart.x, touchStart.y,
      e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (dir) {
      if (game.status === 'ready') startGame();
      if (game.status === 'playing') game.setDirection(dir, 0);
    }
    touchStart = null;
  }, { passive: true });

  /* ---------------- 控件绑定 ---------------- */

  btnNew.addEventListener('click', newGame);
  overlayBtnEl.addEventListener('click', newGame);
  btnPause.addEventListener('click', function () {
    if (game && game.status === 'ready') startGame();
    else togglePause();
  });
  btnSound.addEventListener('click', function () {
    UI.Sound.on = !UI.Sound.on;
    btnSound.textContent = UI.Sound.on ? '音效：开' : '音效：关';
  });

  [chkWrap, chkObstacle, chkAccel, chkTwo].forEach(function (chk) {
    chk.addEventListener('change', newGame);
  });
  if (chkAI) chkAI.addEventListener('change', newGame);
  diffEl.addEventListener('change', function () {
    difficulty = diffEl.value;
    newGame();
  });

  /* ---------------- 启动 ---------------- */
  newGame();
  lastTs = performance.now();
  rafId = requestAnimationFrame(frame);
  void rafId;
})(window, document);
