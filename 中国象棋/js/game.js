/* ============================================================
 * game.js —— 对局流程层（回合、悔棋、存档、中文记谱）
 * 依赖 model.js / rules.js（纯逻辑，无 DOM 依赖）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./rules.js'));
  } else {
    root.XQGame = factory(root.XQModel, root.XQRules);
  }
})(typeof self !== 'undefined' ? self : this, function (M, R) {
  'use strict';

  var RED = M.RED, BLACK = M.BLACK;
  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /* ---------------- 中文记谱（如"炮二平五"） ---------------- */

  /** side 视角的列名：红方从右往左 汉字一~九；黑方从其右往左 数字1~9 */
  function colName(side, col) {
    return side === RED ? CN_NUM[8 - col] : String(col + 1);
  }

  function numName(side, n) {
    return side === RED ? CN_NUM[n - 1] : String(n);
  }

  /**
   * 在走子前的棋盘上，把着法转换为中文记谱。
   * 直线子（车炮兵将帅）进退报格数；斜走子（马象士）进退报目标列。
   * 同列同名子用 前/中/后 区分（红方 row 小者为"前"）。
   */
  function formatMoveCN(board, mv) {
    var piece = board[mv.fr][mv.fc];
    if (!piece) return '';
    var side = M.sideOf(piece);
    var type = Math.abs(piece);
    var name = M.PIECE_CHAR[side][type];
    var isDiag = (type === M.ADVISOR || type === M.ELEPHANT || type === M.HORSE);

    // 同列同名子消歧
    var disp = name;
    var sameRows = [];
    for (var r = 0; r < M.ROWS; r++) if (board[r][mv.fc] === piece) sameRows.push(r);
    if (sameRows.length > 1) {
      sameRows.sort(function (a, b) { return side === RED ? a - b : b - a; });
      var idx = sameRows.indexOf(mv.fr);
      var tags = ['前', '中', '后'];
      var tag = sameRows.length === 2 ? (idx === 0 ? '前' : '后') : tags[Math.min(idx, 2)];
      disp = tag + name;
    }

    var action;
    if (mv.tr === mv.fr) {
      action = '平' + colName(side, mv.tc);
    } else {
      var forward = side === RED ? (mv.tr < mv.fr) : (mv.tr > mv.fr);
      var verb = forward ? '进' : '退';
      action = isDiag ? verb + colName(side, mv.tc)
                      : verb + numName(side, Math.abs(mv.tr - mv.fr));
    }
    return disp + colName(side, mv.fc) + action;
  }

  /* ---------------- 对局状态机 ---------------- */

  function Game() { this.reset(); }

  Game.prototype.reset = function () {
    this.board = M.initBoard();
    this.turn = RED;              // 红先黑后
    this.history = [];            // [{fr,fc,tr,tc,piece,captured,record}]
    this.status = 'playing';      // playing | red_win | black_win
    this.endReason = '';          // checkmate | stalemate
    this.checkSide = null;        // 当前被将军的一方（用于提示）
  };

  /** (r,c) 处是否为当前行棋方的棋子 */
  Game.prototype.ownPieceAt = function (r, c) {
    return this.status === 'playing' && M.sideOf(this.board[r][c]) === this.turn;
  };

  /** 选中棋子后的合法落点 */
  Game.prototype.legalTargets = function (r, c) {
    var ms = R.getLegalMoves(this.board, this.turn);
    return ms.filter(function (m) { return m.fr === r && m.fc === c; });
  };

  /**
   * 应用着法：记谱 → 试走 → 切换回合 → 将军/胜负检测
   * @returns {{record, captured, check}} 供 UI 使用
   */
  Game.prototype.applyMove = function (mv) {
    if (this.status !== 'playing') throw new Error('对局已结束');
    var piece = this.board[mv.fr][mv.fc];
    if (M.sideOf(piece) !== this.turn) throw new Error('不是该方的棋子');

    var record = formatMoveCN(this.board, mv);          // 走子前记谱
    var captured = R.makeMove(this.board, mv);
    this.history.push({
      fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc,
      piece: piece, captured: captured, record: record
    });

    this.turn = M.opp(this.turn);
    var result = null;

    // 无合法着法 → 将死 / 困毙（均判负）
    if (R.getLegalMoves(this.board, this.turn).length === 0) {
      this.endReason = R.isChecked(this.board, this.turn) ? 'checkmate' : 'stalemate';
      this.status = this.turn === RED ? 'black_win' : 'red_win';
    } else {
      this.checkSide = R.isChecked(this.board, this.turn) ? this.turn : null;
    }

    return { record: record, captured: captured, check: this.checkSide };
  };

  /** 悔一步棋 */
  Game.prototype.undo = function () {
    var last = this.history.pop();
    if (!last) return false;
    R.undoMove(this.board, last, last.captured);
    this.turn = M.opp(this.turn);
    this.status = 'playing';
    this.endReason = '';
    this.checkSide = null;
    return true;
  };

  /** 序列化（存档） */
  Game.prototype.serialize = function () {
    return {
      v: 1,
      board: M.cloneBoard(this.board),
      turn: this.turn,
      status: this.status,
      endReason: this.endReason,
      history: this.history.slice(),
      checkSide: this.checkSide
    };
  };

  /** 反序列化（读档）；数据非法返回 false */
  Game.prototype.deserialize = function (data) {
    try {
      if (!data || data.v !== 1) return false;
      if (!Array.isArray(data.board) || data.board.length !== M.ROWS) return false;
      for (var r = 0; r < M.ROWS; r++) {
        if (!Array.isArray(data.board[r]) || data.board[r].length !== M.COLS) return false;
      }
      if (data.turn !== RED && data.turn !== BLACK) return false;

      this.board = M.cloneBoard(data.board);
      this.turn = data.turn;
      this.status = data.status || 'playing';
      this.endReason = data.endReason || '';
      this.history = (data.history || []).slice();
      this.checkSide = data.checkSide || null;
      return true;
    } catch (e) {
      return false;
    }
  };

  return {
    Game: Game,
    formatMoveCN: formatMoveCN,
    colName: colName
  };
});
