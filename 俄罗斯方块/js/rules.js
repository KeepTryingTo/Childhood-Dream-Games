/* ============================================================
 * rules.js —— 碰撞 / 旋转踢墙(SRS) / 消行 / 计分（纯逻辑，可单元测试）
 * UMD：浏览器(挂 window.TetrisRules) / Node(require) 双端可用
 *
 * 坐标系：row ∈ [0, rows-1] 向下，col ∈ [0, cols-1] 向右。
 * SRS 踢墙表原始坐标为 (x, y)：x 正=右、y 正=上；
 * 本实现统一转换为 (dCol, dRow) = (x, -y)。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.TetrisRules = factory(root.TetrisModel);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  /** 创建空网格 */
  function createEmptyGrid(rows, cols) {
    var g = [];
    for (var r = 0; r < rows; r++) g.push(new Array(cols).fill(0));
    return g;
  }

  /**
   * 碰撞检测：形状所有非零格必须全部在网格内且不与已锁定方块重叠。
   * 允许 row < 0（顶部上方隐藏区，供 spawn/旋转上踢使用）。
   */
  function isValid(grid, shape, row, col) {
    var rows = grid.length, cols = grid[0].length;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        var gr = row + r, gc = col + c;
        if (gc < 0 || gc >= cols) return false;      // 左右越界
        if (gr >= rows) return false;                // 底部越界
        if (gr >= 0 && grid[gr][gc]) return false;   // 与锁定块重叠
      }
    }
    return true;
  }

  /**
   * SRS 踢墙表。键 = from.toString() + to.toString()。
   * 每项为 [dCol, dRow]（已从 SRS (x,y) 转换，dRow 正=下）。
   */
  // JLSTZ 系列
  var KICKS_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };
  // I 系列
  var KICKS_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };

  /** 获取踢墙偏移序列（已转换为 [dCol, dRow]） */
  function kicksFor(type, from, to) {
    var key = from.toString() + to.toString();
    var table = (type === 'I') ? KICKS_I : KICKS_JLSTZ;
    return table[key] || [[0, 0]];
  }

  /**
   * 带踢墙的顺时针旋转。
   * piece 采用扁平坐标 {type, rotation, row, col}（与 game.js 一致）。
   * @returns {{ok:boolean, rotation:number, row:number, col:number}}
   *          失败时返回原状态（旋转被拒绝）。
   */
  function rotateCWWithKick(grid, piece) {
    var from = piece.rotation;
    var to = (from + 1) % 4;
    var newShape = M.shapeOf(piece.type, to);

    // O 方块旋转无实际效果（形状恒定），直接成功
    if (piece.type === 'O') {
      return { ok: true, rotation: to, row: piece.row, col: piece.col };
    }

    var kicks = kicksFor(piece.type, from, to);
    for (var i = 0; i < kicks.length; i++) {
      var dCol = kicks[i][0], dRow = kicks[i][1];
      var nr = piece.row + dRow;
      var nc = piece.col + dCol;
      if (isValid(grid, newShape, nr, nc)) {
        return { ok: true, rotation: to, row: nr, col: nc };
      }
    }
    return { ok: false, rotation: from, row: piece.row, col: piece.col };
  }

  /** 带踢墙的逆时针旋转（from → to = (from+3)%4） */
  function rotateCCWWithKick(grid, piece) {
    var from = piece.rotation;
    var to = (from + 3) % 4;
    var newShape = M.shapeOf(piece.type, to);
    if (piece.type === 'O') {
      return { ok: true, rotation: to, row: piece.row, col: piece.col };
    }
    // 逆时针(from→to)的踢墙 = 顺时针(to→from)踢墙表的逆序应用
    var kicks = kicksFor(piece.type, to, from);
    for (var i = 0; i < kicks.length; i++) {
      var dCol = kicks[i][0], dRow = kicks[i][1];
      var nr = piece.row + dRow;
      var nc = piece.col + dCol;
      if (isValid(grid, newShape, nr, nc)) {
        return { ok: true, rotation: to, row: nr, col: nc };
      }
    }
    return { ok: false, rotation: from, row: piece.row, col: piece.col };
  }

  /** 检测所有满行（无 0 的行），返回行号数组（升序） */
  function findFullRows(grid) {
    var rows = [];
    for (var r = 0; r < grid.length; r++) {
      var full = true;
      for (var c = 0; c < grid[r].length; c++) {
        if (!grid[r][c]) { full = false; break; }
      }
      if (full) rows.push(r);
    }
    return rows;
  }

  /**
   * 从网格中移除指定行，上方整体下移，顶部补空行。
   * 实现为"过滤掉满行 + 顶部补空行"：剩余行保持相对顺序整体下移，
   * 与"逐行下移填充"数学等价（正确性由 T8/T9 单测保证）。
   */
  function removeRows(grid, rowsToRemove) {
    if (!rowsToRemove.length) return grid;
    var set = {};
    for (var i = 0; i < rowsToRemove.length; i++) set[rowsToRemove[i]] = true;
    var kept = grid.filter(function (row, r) { return !set[r]; });
    var empty = [];
    for (var j = 0; j < rowsToRemove.length; j++) {
      empty.push(new Array(grid[0].length).fill(0));
    }
    // 原地写回（保持 grid 引用不变）
    var next = empty.concat(kept);
    for (var r = 0; r < grid.length; r++) grid[r] = next[r];
    return grid;
  }

  /** 经典 NES 计分：[0, 100, 300, 500, 800] × 等级 */
  function scoreForLines(n, level) {
    var table = [0, 100, 300, 500, 800];
    return (table[Math.min(n, 4)] || 0) * level;
  }

  /** 等级 N 的自然下落间隔（毫秒）：max(100, 800 - (N-1)*50) */
  function fallInterval(level) {
    return Math.max(100, 800 - (level - 1) * 50);
  }

  return {
    createEmptyGrid: createEmptyGrid,
    isValid: isValid,
    kicksFor: kicksFor,
    rotateCWWithKick: rotateCWWithKick,
    rotateCCWWithKick: rotateCCWWithKick,
    findFullRows: findFullRows,
    removeRows: removeRows,
    scoreForLines: scoreForLines,
    fallInterval: fallInterval
  };
});
