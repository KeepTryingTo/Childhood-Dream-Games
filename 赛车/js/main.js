/* ============================================================
 * main.js —— 入口 / 固定时间步循环 / 输入 / HUD / 菜单
 * 依赖：track.js / game.js / ai.js / storage.js / ui.js
 * ============================================================ */
(function (window, document) {
  'use strict';

  var Track = window.Track, RG = window.RaceGame;
  var RaceGame = RG.RaceGame;                       // game.js 导出 { RaceGame, PHYS, clamp }
  var AI = window.RaceAI;
  var ST = window.RaceStorage, UI = window.RaceUI, Sound = window.RaceSound;

  var STEP = 1000 / 60;              // 固定物理步长（ms）

  /* ---------------- 演示模式（?demo 或 window.RACE_DEMO）：AI 代驾玩家 ---------------- */
  var demoMode = !!window.RACE_DEMO ||
    (typeof location !== 'undefined' && location.search && location.search.indexOf('demo') >= 0);

  /* ---------------- 难度表（require.md E5） ---------------- */
  var DIFF = {
    rookie:  { aiCount: 3, label: '新手' },
    normal:  { aiCount: 4, label: '标准' },
    master:  { aiCount: 5, label: '大师' }
  };

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById('board');
  var speedEl = document.getElementById('speed');
  var lapEl = document.getElementById('lap');
  var posEl = document.getElementById('pos');
  var curLapEl = document.getElementById('cur-lap');
  var bestLapEl = document.getElementById('best-lap');
  var lastLapEl = document.getElementById('last-lap');
  var nitroBarEl = document.getElementById('nitro-bar');
  var statusEl = document.getElementById('status');
  var diffEl = document.getElementById('difficulty');
  var lapsEl = document.getElementById('laps');
  var overlayEl = document.getElementById('overlay');
  var overlayTitleEl = document.getElementById('overlay-title');
  var overlayBodyEl = document.getElementById('overlay-body');
  var overlayBtnEl = document.getElementById('overlay-btn');
  var btnPause = document.getElementById('btn-pause');
  var btnNew = document.getElementById('btn-new');
  var btnSound = document.getElementById('btn-sound');
  var countdownEl = document.getElementById('countdown');
  var rankListEl = document.getElementById('rank-list');
  var trackKey = 'default';

  /* ---------------- 状态 ---------------- */
  var game = null;
  var ui = new UI(canvas);
  var keys = Object.create(null);
  var acc = 0, lastTs = 0, rafId = 0;
  var lastLapCount = 0;
  var lastCountdownSec = -1;
  var finishedShown = false;       // 完赛结算只弹一次

  /* ---------------- 对局生命周期 ---------------- */
  function newGame() {
    var d = DIFF[diffEl.value] || DIFF.normal;
    game = new RaceGame({
      track: new Track.Track({}),
      aiCount: d.aiCount,
      raceLaps: parseInt(lapsEl.value, 10) || 3,
      countdownEnabled: true
    });
    acc = 0;
    lastLapCount = 0;
    lastCountdownSec = -1;
    finishedShown = false;
    overlayEl.classList.add('hidden');
    countdownEl.classList.add('hidden');
    btnPause.textContent = '暂停';
    refreshBest();
    updateHUD();
    game.start();
    ui.camInit = false;         // 镜头重置到玩家
    ui.skids.length = 0;
    window.__raceGame = game;   // 调试/冒烟测试引用
  }

  function onPlayerFinished() {
    Sound.finishJingle();
    var p = game.cars[0];
    var title = p.rank === 1 ? '🏆 冠军！' : '第 ' + p.rank + ' 名';
    var lines = [];
    game.ranking.forEach(function (c) {
      var mark = c.finished ? '✔' : '…';
      lines.push(mark + ' P' + c.rank + '　' + c.name +
        (c.finished ? '　' + fmtTime(c.finishTimeMs) : '　进行中'));
    });
    overlayTitleEl.textContent = title;
    overlayBodyEl.innerHTML =
      '<div class="overlay-rows">' + lines.join('<br>') + '</div>' +
      '<div class="overlay-best">最佳圈速 ' + (p.bestLapMs ? fmtTime(p.bestLapMs) : '—') + '</div>';
    overlayEl.classList.remove('hidden');
    statusEl.textContent = '比赛结束';
  }

  function refreshBest() {
    var best = ST.loadBest(trackKey, parseInt(lapsEl.value, 10) || 3);
    bestLapEl.textContent = best ? fmtTime(best) : '—';
  }

  /* ---------------- HUD ---------------- */
  function fmtTime(ms) {
    if (!ms || ms <= 0) return '—';
    var s = ms / 1000;
    var m = Math.floor(s / 60);
    var sec = s - m * 60;
    return (m > 0 ? m + ':' : '') + sec.toFixed(2);
  }

  function updateHUD(msg) {
    var p = game.cars[0];
    speedEl.textContent = Math.round(p.speed * 3.6);
    lapEl.textContent = Math.min(p.lap + 1, game.raceLaps) + ' / ' + game.raceLaps;
    posEl.textContent = 'P' + p.rank;
    curLapEl.textContent = p.finished ? fmtTime(p.lastLapMs) : fmtTime(game.timeMs - p.lapStartMs);
    lastLapEl.textContent = fmtTime(p.lastLapMs);
    nitroBarEl.style.width = p.nitro.toFixed(1) + '%';

    if (msg != null) statusEl.textContent = msg;
    else if (game.status === 'countdown') statusEl.textContent = '倒计时中……';
    else if (game.status === 'paused') statusEl.textContent = '已暂停';
    else if (p.finished) statusEl.textContent = '比赛结束';
    else if (demoMode) statusEl.textContent = p.onTrack ? '演示模式 · AI 代驾' : '演示模式 · 离开赛道';
    else statusEl.textContent = p.onTrack ? '竞速中' : '⚠ 离开赛道，减速！';
  }

  function updateRankList() {
    var html = '';
    game.ranking.forEach(function (c) {
      html += '<div class="rank-row' + (c.isAI ? '' : ' me') + '">' +
        '<span class="rk">P' + c.rank + '</span>' +
        '<span class="nm">' + c.name + (c.finished ? ' ✔' : '') + '</span>' +
        '<span class="lt">' + (c.bestLapMs ? fmtTime(c.bestLapMs) : '') + '</span>' +
        '</div>';
    });
    rankListEl.innerHTML = html;
  }

  /* ---------------- 输入映射 ---------------- */
  function playerInput() {
    var steer = 0, throttle = 0, brake = 0;
    if (keys.ArrowLeft || keys.KeyA) steer -= 1;
    if (keys.ArrowRight || keys.KeyD) steer += 1;
    if (keys.ArrowUp || keys.KeyW) throttle = 1;
    if (keys.ArrowDown || keys.KeyS) brake = 1;
    return { steer: steer, throttle: throttle, brake: brake, nitro: !!keys.ShiftLeft || !!keys.ShiftRight };
  }

  /* ---------------- 主循环（固定时间步累加器） ---------------- */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var frameMs = Math.min(ts - lastTs, 200);      // 防后台切回大跳
    lastTs = ts;
    if (!game) return;

    if (game.status === 'playing' || game.status === 'countdown') {
      acc += frameMs;
      while (acc >= STEP) {
        AI.driveAll(game, STEP / 1000);
        if (demoMode) AI.drive(game, game.cars[0], STEP / 1000);   // AI 代驾玩家
        else game.setPlayerInput(playerInput());
        game.tick(STEP / 1000);
        acc -= STEP;
      }
      // 倒计时显示
      if (game.status === 'countdown') {
        var sec = Math.ceil(game.countdown);
        countdownEl.classList.remove('hidden');
        countdownEl.textContent = sec > 0 ? sec : 'GO!';
        if (sec !== lastCountdownSec) {
          lastCountdownSec = sec;
          Sound.countdownBeep(sec === 0);
        }
      } else if (lastCountdownSec !== -1) {
        countdownEl.classList.add('hidden');
        lastCountdownSec = -1;
      }

      // 过圈提示 / 破纪录
      var p = game.cars[0];
      if (p.lap > lastLapCount) {
        lastLapCount = p.lap;
        if (p.lastLapMs > 0) {
          Sound.lapBeep();
          var broken = ST.saveBest(trackKey, game.raceLaps, p.lastLapMs);
          if (broken) refreshBest();
        }
      }
      // 玩家过线结束
      if (p.finished && game.status === 'playing' && !finishedShown) {
        finishedShown = true;
        onPlayerFinished();
      }
    }

    // 引擎音效 & 碰撞音
    var pv = game.cars[0];
    Sound.setEngine(pv.speed || 0, pv.nitroActive);
    if (pv.hit) Sound.crash();

    updateHUD();
    updateRankList();
    ui.render(game, frameMs / 1000);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 键盘：记录按下状态（e.code），首次交互激活音频
    window.addEventListener('keydown', function (e) {
      Sound.ensure();
      keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) {
        e.preventDefault();
      }
      if (e.code === 'Space') { game && game.togglePause(); syncPauseBtn(); }
      if (e.code === 'KeyR') newGame();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () {
      for (var k in keys) keys[k] = false;
      if (game && game.status === 'playing') { game.pause(); syncPauseBtn(); }
    });

    btnNew.addEventListener('click', function () { Sound.ensure(); newGame(); });
    btnPause.addEventListener('click', function () { game && game.togglePause(); syncPauseBtn(); });
    overlayBtnEl.addEventListener('click', function () { newGame(); });
    btnSound.addEventListener('click', function () {
      Sound.ensure();
      Sound.setEnabled(!Sound.enabled);
      btnSound.textContent = Sound.enabled ? '音效：开' : '音效：关';
    });
    diffEl.addEventListener('change', function () { newGame(); });
    lapsEl.addEventListener('change', function () { newGame(); });

    // 触屏虚拟按键（E7）
    bindTouch('btn-tl', 'ArrowLeft');
    bindTouch('btn-tr', 'ArrowRight');
    bindTouch('btn-gas', 'ArrowUp');
    bindTouch('brk', 'ArrowDown');
  }

  function bindTouch(id, code) {
    var el = document.getElementById(id);
    if (!el) return;
    function on(ev) { ev.preventDefault(); Sound.ensure(); keys[code] = true; }
    function off(ev) { ev.preventDefault(); keys[code] = false; }
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }

  function syncPauseBtn() {
    if (!game) return;
    btnPause.textContent = game.status === 'paused' ? '继续' : '暂停';
  }

  /* ---------------- 启动 ---------------- */
  bindEvents();
  newGame();
  rafId = requestAnimationFrame(loop);
})(window, document);
