/* ============================================================
 * model.js —— 数据模型与初始布局（纯逻辑，无 DOM 依赖）
 * UMD：浏览器(挂 window.XQModel) / Node(require) 双端可用
 *
 * 棋子编码：0=空；红正黑负
 *   1=将/帅  2=士/仕  3=象/相  4=马  5=车  6=炮  7=兵/卒
 * 坐标：(row, col)  row∈[0,9]  col∈[0,8]
 *   row 0 为黑方底线（渲染在棋盘顶部），row 9 为红方底线
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XQModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 10, COLS = 9;
  var RED = 'red', BLACK = 'black';

  // 棋子类型常量
  var KING = 1, ADVISOR = 2, ELEPHANT = 3, HORSE = 4, CHARIOT = 5, CANNON = 6, PAWN = 7;

  /**
   * 初始布局（row 0 为黑方）：
   * r0: -5 -4 -3 -2 -1 -2 -3 -4 -5
   * r2:  0 -6  0  0  0  0  0 -6  0
   * r3: -7  0 -7  0 -7  0 -7  0 -7
   * r6:  7  0  7  0  7  0  7  0  7
   * r7:  0  6  0  0  0  0  0  6  0
   * r9:  5  4  3  2  1  2  3  4  5
   */
  function initBoard() {
    var b = [];
    for (var r = 0; r < ROWS; r++) b.push(new Array(COLS).fill(0));
    b[0] = [-5, -4, -3, -2, -1, -2, -3, -4, -5];
    b[2][1] = -6; b[2][7] = -6;
    b[3] = [-7, 0, -7, 0, -7, 0, -7, 0, -7];
    b[6] = [7, 0, 7, 0, 7, 0, 7, 0, 7];
    b[7][1] = 6; b[7][7] = 6;
    b[9] = [5, 4, 3, 2, 1, 2, 3, 4, 5];
    return b;
  }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function inBoard(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  /** piece > 0 → 'red'；piece < 0 → 'black'；0 → null */
  function sideOf(piece) {
    if (piece > 0) return RED;
    if (piece < 0) return BLACK;
    return null;
  }

  function opp(side) { return side === RED ? BLACK : RED; }

  /** 是否在 side 方九宫内（黑：row0-2；红：row7-9；col 3-5） */
  function inPalace(r, c, side) {
    if (c < 3 || c > 5) return false;
    return side === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }

  /** (r,c) 是否已过河（红过河：r<=4；黑过河：r>=5） */
  function crossedRiver(r, side) {
    return side === RED ? r <= 4 : r >= 5;
  }

  /** 棋子显示汉字 */
  var PIECE_CHAR = {
    red:   { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' },
    black: { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '卒' }
  };

  /** side 的中文名 */
  var SIDE_CN = { red: '红方', black: '黑方' };

  return {
    ROWS: ROWS, COLS: COLS,
    RED: RED, BLACK: BLACK,
    KING: KING, ADVISOR: ADVISOR, ELEPHANT: ELEPHANT,
    HORSE: HORSE, CHARIOT: CHARIOT, CANNON: CANNON, PAWN: PAWN,
    initBoard: initBoard,
    cloneBoard: cloneBoard,
    inBoard: inBoard,
    sideOf: sideOf,
    opp: opp,
    inPalace: inPalace,
    crossedRiver: crossedRiver,
    PIECE_CHAR: PIECE_CHAR,
    SIDE_CN: SIDE_CN
  };
});
