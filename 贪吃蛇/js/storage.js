/* ============================================================
 * storage.js —— 最高分持久化（浏览器 localStorage / Node 内存降级）
 * key: snake_best_v1_<difficulty>
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'snake_best_v1_';
  var cachedBackend;

  function backend() {
    if (cachedBackend) return cachedBackend;
    // 优先使用浏览器 localStorage，但需通过"写入-读取"往返探测
    // （部分环境存在 localStorage 对象但被禁用/静默失效，如 Node 全局 webstorage）
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var probe = '__snake_probe__';
        localStorage.setItem(probe, '1');
        if (localStorage.getItem(probe) === '1') {
          localStorage.removeItem(probe);
          cachedBackend = localStorage;
          return cachedBackend;
        }
      }
    } catch (e) { /* 禁用/隐私模式 → 降级内存 */ }
    var mem = Object.create(null);
    cachedBackend = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      keys: function () { return Object.keys(mem); }
    };
    return cachedBackend;
  }

  /** 枚举后端全部 key（兼容 localStorage 与内存后端） */
  function listKeys(b) {
    if (typeof b.keys === 'function') return b.keys();
    var arr = [];
    for (var i = 0; i < b.length; i++) {
      var k = b.key(i);
      if (k) arr.push(k);
    }
    return arr;
  }

  return {
    /** 读取某难度的最高分，无记录返回 0 */
    loadBest: function (difficulty) {
      try {
        var v = backend().getItem(PREFIX + difficulty);
        var n = v ? parseInt(v, 10) : 0;
        return isNaN(n) ? 0 : n;
      } catch (e) { return 0; }
    },

    /**
     * 写入最高分（仅当破纪录时真正写入）。
     * @returns true 表示刷新了纪录
     */
    saveBest: function (difficulty, score) {
      try {
        var best = this.loadBest(difficulty);
        if (score > best) {
          backend().setItem(PREFIX + difficulty, String(score));
          return true;
        }
        return false;
      } catch (e) { return false; }
    },

    clearAll: function () {
      try {
        var b = backend();
        listKeys(b).forEach(function (k) {
          if (k.indexOf(PREFIX) === 0) b.removeItem(k);
        });
      } catch (e) { /* ignore */ }
    }
  };
});
