/* ============================================================
 * model.js —— 方块定义 / 旋转 / 7-bag 随机器（纯逻辑，可单元测试）
 * UMD：浏览器(挂 window.TetrisModel) / Node(require) 双端可用
 *
 * 方块矩阵采用标准 SRS 尺寸：
 *   I → 4×4（初始占第 2 行）、O → 2×2（不旋转）、JLSTZ → 3×3
 * 旋转（顺时针）= 转置后每行反转；I/O/JLSTZ 均满足"旋转 4 次回到初始"。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TetrisModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 七种方块类型 */
  var TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  /** 类型 → 色值（渲染用） */
  var COLORS = {
    I: '#00bcd4',   // 青
    O: '#ffc107',   // 黄
    T: '#ab47bc',   // 紫
    S: '#4caf50',   // 绿
    Z: '#f44336',   // 红
    J: '#3f7fd6',   // 蓝
    L: '#ff9800'    // 橙
  };

  /** 0 旋转状态（spawn）的形状矩阵 */
  var SHAPES = {
    I: [[0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]],
    O: [[1, 1],
        [1, 1]],
    T: [[0, 1, 0],
        [1, 1, 1],
        [0, 0, 0]],
    S: [[0, 1, 1],
        [1, 1, 0],
        [0, 0, 0]],
    Z: [[1, 1, 0],
        [0, 1, 1],
        [0, 0, 0]],
    J: [[1, 0, 0],
        [1, 1, 1],
        [0, 0, 0]],
    L: [[0, 0, 1],
        [1, 1, 1],
        [0, 0, 0]]
  };

  /** 顺时针旋转：转置后每行反转 */
  function rotateCW(shape) {
    var n = shape.length;
    var out = [];
    for (var r = 0; r < n; r++) {
      out.push(new Array(n));
    }
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        out[j][n - 1 - i] = shape[i][j];
      }
    }
    return out;
  }

  /** 逆时针旋转 = 顺时针转 3 次 */
  function rotateCCW(shape) {
    return rotateCW(rotateCW(rotateCW(shape)));
  }

  /** 取某旋转状态（0~3）的形状矩阵（带缓存） */
  var _cache = {};
  function shapeOf(type, rotation) {
    var key = type + rotation;
    if (!_cache[key]) {
      var s = SHAPES[type];
      for (var i = 0; i < (rotation % 4); i++) s = rotateCW(s);
      _cache[key] = s;
    }
    return _cache[key];
  }

  /**
   * 7-bag 随机器：返回打乱后的 7 种方块类型数组（Fisher–Yates）。
   * 每种恰好出现一次，杜绝"一直不出某块"。
   */
  function createBag() {
    var bag = TYPES.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    return bag;
  }

  /** 可注入随机源的 7-bag（供单元测试确定性行为） */
  function createBagWith(rng) {
    var bag = TYPES.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    return bag;
  }

  /** spawn 锚点列：使矩阵水平居中 */
  function spawnCol(cols, type) {
    var w = SHAPES[type][0].length;
    return Math.floor((cols - w) / 2);
  }

  return {
    TYPES: TYPES,
    COLORS: COLORS,
    SHAPES: SHAPES,
    rotateCW: rotateCW,
    rotateCCW: rotateCCW,
    shapeOf: shapeOf,
    createBag: createBag,
    createBagWith: createBagWith,
    spawnCol: spawnCol
  };
});
