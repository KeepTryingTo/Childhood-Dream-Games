/* ============================================================
 * main.js —— 入口 / 对局控制器
 * 负责：模式切换（双人 / 人机）、难度、悔棋、存档读档、
 *       状态提示（将军/将死/困毙）、走子记录、AI 调度
 * ============================================================ */
(function (window, document) {
  'use strict';
  var M = window.XQModel, R = window.XQRules, G = window.XQGame, AI = window.XQAI;
  var UI = window.XQUI, Sound = window.XQUI.Sound;

  var SAVE_KEY = 'xiangqi.save.v1';

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById('board');
  var statusEl = document.getElementById('status');
  var moveListEl = document.getElementById('move-list');
  var modeEl = document.getElementById('mode');
  var aiSideEl = document.getElementById('ai-side');
  var diffEl = document.getElementById('difficulty');
  var aiOptsEl = document.getElementById('ai-opts');
  var overlayEl = document.getElementById('overlay');
  var overlayTextEl = document.getElementById('overlay-text');
  var overlayBtnEl = document.getElementById('overlay-btn');
  var btnNew = document.getElementById('btn-new');
  var btnUndo = document.getElementById('btn-undo');
  var btnSave = document.getElementById('btn-save');
  var btnLoad = document.getElementById('btn-load');
  var btnSound = document.getElementById('btn-sound');

  /* ---------------- 控制器状态 ---------------- */
  var game = new G.Game();
  var ctrl = {
    mode: 'ai',          // 'pvp' | 'ai'
    aiSide: M.BLACK,     // 人机模式下 AI 执子方
    difficulty: 'medium',
    busy: false,         // 动画或 AI 思考中，锁输入
    soundOn: true
  };

  var boardUI = new UI.BoardUI(canvas, {
    onCellClick: onCellClick
  });

  function humanSide() {
    return ctrl.mode === 'ai' ? M.opp(ctrl.aiSide) : null;
  }

  /* ---------------- 核心流程 ---------------- */

  function onCellClick(r, c) {
    if (ctrl.busy || game.status !== 'playing') return;
    if (ctrl.mode === 'ai' && game.turn === ctrl.aiSide) return; // 轮到 AI

    var piece = game.board[r][c];

    // 已有选中：尝试落子 / 换选 / 取消
    if (boardUI.selected) {
      var mv = boardUI.targets.find(function (t) { return t.tr === r && t.tc === c; });
      if (mv) { playMove(mv); return; }
      if (piece && M.sideOf(piece) === game.turn) { select(r, c); return; }
      deselect(); return;
    }
    // 无选中：点己方子 → 选中
    if (piece && M.sideOf(piece) === game.turn) select(r, c);
  }

  function select(r, c) {
    boardUI.selected = { r: r, c: c };
    boardUI.targets = game.legalTargets(r, c);
    boardUI.render(game.board);
  }

  function deselect() {
    boardUI.selected = null;
    boardUI.targets = [];
    boardUI.render(game.board);
  }

  /** 统一走子入口：更新状态 → 动画 → 音效 → 后续（AI 回合 / 胜负） */
  function playMove(mv) {
    var piece = game.board[mv.fr][mv.fc];
    var info = game.applyMove(mv);
    ctrl.busy = true;
    deselect();
    boardUI.lastMove = { fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc };
    if (ctrl.soundOn) (info.captured ? Sound.capture : Sound.move)();

    boardUI.startAnim(mv, piece, function () {
      ctrl.busy = false;
      afterMove(info);
    });
  }

  function afterMove(info) {
    refreshMoveList();
    updateStatus(info);
    boardUI.render(game.board);

    if (game.status !== 'playing') { onGameOver(); return; }

    if (ctrl.mode === 'ai' && game.turn === ctrl.aiSide) aiTurn();
  }

  function aiTurn() {
    ctrl.busy = true;
    statusEl.textContent = M.SIDE_CN[ctrl.aiSide] + '思考中…';
    // 让浏览器先渲染"思考中"，再进入同步搜索
    setTimeout(function () {
      var t0 = Date.now();
      var mv = AI.findBestMove(game.board, game.turn, ctrl.difficulty);
      ctrl.busy = false;
      if (!mv) { updateStatus(); boardUI.render(game.board); return; } // AI 无棋可走（已由胜负判定覆盖）
      playMove(mv);
    }, 60);
  }

  function updateStatus(info) {
    if (game.status !== 'playing') return;
    // 被将军提示 + 高亮被将的将
    boardUI.checkedKing = null;
    var text;
    if (game.checkSide) {
      var k = R.findKing(game.board, game.checkSide);
      if (k) boardUI.checkedKing = { r: k[0], c: k[1] };
      text = '将军！' + M.SIDE_CN[game.checkSide] + '被将';
      if (ctrl.soundOn) Sound.check();
    } else {
      text = M.SIDE_CN[game.turn] + '行棋';
      if (ctrl.mode === 'ai' && game.turn === ctrl.aiSide) text = M.SIDE_CN[game.turn] + '思考中…';
    }
    statusEl.textContent = text;
  }

  function onGameOver() {
    boardUI.checkedKing = null;
    boardUI.render(game.board);
    var winner = game.status === 'red_win' ? M.RED : M.BLACK;
    var reason = game.endReason === 'checkmate' ? '将死' : '困毙';
    var text = M.SIDE_CN[winner] + '胜（' + reason + '）';
    statusEl.textContent = text;
    if (ctrl.soundOn) Sound.win();
    overlayTextEl.textContent = text;
    overlayEl.classList.remove('hidden');
  }

  /* ---------------- 记录列表 ---------------- */

  function refreshMoveList() {
    moveListEl.innerHTML = '';
    var h = game.history;
    for (var i = 0; i < h.length; i += 2) {
      var li = document.createElement('li');
      var red = h[i] ? h[i].record : '';
      var black = h[i + 1] ? h[i + 1].record : '';
      li.innerHTML = '<span class="no">' + (i / 2 + 1) + '.</span>' +
                     '<span class="r">' + red + '</span>' +
                     '<span class="b">' + black + '</span>';
      moveListEl.appendChild(li);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  /* ---------------- 按钮 ---------------- */

  function newGame() {
    game.reset();
    ctrl.busy = false;
    deselect();
    boardUI.lastMove = null;
    boardUI.checkedKing = null;
    overlayEl.classList.add('hidden');
    refreshMoveList();
    statusEl.textContent = '红方行棋';
    boardUI.render(game.board);
    // AI 执红则 AI 先走
    if (ctrl.mode === 'ai' && game.turn === ctrl.aiSide) aiTurn();
  }

  btnNew.addEventListener('click', newGame);
  overlayBtnEl.addEventListener('click', newGame);

  btnUndo.addEventListener('click', function () {
    if (ctrl.busy || game.history.length === 0) return;
    if (ctrl.mode === 'ai') {
      // 撤到人类上一次行棋之前：优先撤两步（自己 + AI）；AI 执红先走时首步只撤一步
      if (game.turn === M.opp(ctrl.aiSide) && game.history.length >= 2) {
        game.undo(); game.undo();
      } else {
        game.undo();
      }
    } else {
      game.undo();
    }
    deselect();
    boardUI.checkedKing = null;
    var last = game.history[game.history.length - 1];
    boardUI.lastMove = last ? { fr: last.fr, fc: last.fc, tr: last.tr, tc: last.tc } : null;
    overlayEl.classList.add('hidden');
    refreshMoveList();
    updateStatus();
    boardUI.render(game.board);
  });

  btnSave.addEventListener('click', function () {
    try {
      var data = game.serialize();
      data.mode = ctrl.mode;
      data.aiSide = ctrl.aiSide;
      data.difficulty = ctrl.difficulty;
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      statusEl.textContent = '已存档 ✓';
      setTimeout(updateStatus, 900);
    } catch (e) {
      statusEl.textContent = '存档失败：' + e.message;
    }
  });

  btnLoad.addEventListener('click', function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { statusEl.textContent = '没有找到存档'; return; }
      var data = JSON.parse(raw);
      if (!game.deserialize(data)) { statusEl.textContent = '存档数据无效'; return; }
      if (data.mode) ctrl.mode = data.mode, modeEl.value = data.mode;
      if (data.aiSide) ctrl.aiSide = data.aiSide, aiSideEl.value = data.aiSide;
      if (data.difficulty) ctrl.difficulty = data.difficulty, diffEl.value = data.difficulty;
      syncAiOpts();
      deselect();
      boardUI.checkedKing = null;
      var last = game.history[game.history.length - 1];
      boardUI.lastMove = last ? { fr: last.fr, fc: last.fc, tr: last.tr, tc: last.tc } : null;
      overlayEl.classList.add('hidden');
      refreshMoveList();
      if (game.status !== 'playing') { onGameOver(); }
      else { statusEl.textContent = M.SIDE_CN[game.turn] + '行棋（已读档）'; boardUI.render(game.board); }
    } catch (e) {
      statusEl.textContent = '读档失败：' + e.message;
    }
  });

  btnSound.addEventListener('click', function () {
    ctrl.soundOn = !ctrl.soundOn;
    btnSound.textContent = ctrl.soundOn ? '音效：开' : '音效：关';
  });

  modeEl.addEventListener('change', function () {
    ctrl.mode = modeEl.value;
    syncAiOpts();
    newGame();
  });
  aiSideEl.addEventListener('change', function () {
    ctrl.aiSide = aiSideEl.value;
    newGame();
  });
  diffEl.addEventListener('change', function () {
    ctrl.difficulty = diffEl.value;
  });

  function syncAiOpts() {
    aiOptsEl.style.display = ctrl.mode === 'ai' ? '' : 'none';
  }

  /* ---------------- 启动 ---------------- */
  syncAiOpts();
  statusEl.textContent = '红方行棋';
  boardUI.render(game.board);
})(window, document);
