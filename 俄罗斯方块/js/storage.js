/* ============================================================
 * storage.js —— 最高分与设置持久化（localStorage，带内存降级）
 * UMD：浏览器(挂 window.TetrisStorage) / Node(require) 双端可用
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TetrisStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'tetris.best.v1';

  function backend() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var probe = '__tetris_probe__';
        localStorage.setItem(probe, '1');
        if (localStorage.getItem(probe) === '1') {
          localStorage.removeItem(probe);
          return localStorage;
        }
      }
    } catch (e) { /* 降级 */ }
    var mem = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }
    };
  }

  return {
    /** 读取最高分（无记录返回 0） */
    loadBest: function () {
      try {
        var n = parseInt(backend().getItem(KEY), 10);
        return isNaN(n) ? 0 : n;
      } catch (e) { return 0; }
    },

    /** 写入最高分；返回 true 表示刷新纪录 */
    saveBest: function (score) {
      try {
        if (score > this.loadBest()) {
          backend().setItem(KEY, String(score));
          return true;
        }
        return false;
      } catch (e) { return false; }
    }
  };
});
