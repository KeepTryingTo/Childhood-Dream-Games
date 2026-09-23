/* ============================================================
 * storage.js —— 最佳圈速持久化（浏览器 localStorage / Node 内存降级）
 * key: race_best_v1_<trackKey>_<laps>   值：毫秒数字符串
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RaceStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'race_best_v1_';
  var cachedBackend;

  function backend() {
    if (cachedBackend) return cachedBackend;
    // 探测 localStorage 真实可用（隐私模式可能静默失效）
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var probe = '__race_probe__';
        localStorage.setItem(probe, '1');
        if (localStorage.getItem(probe) === '1') {
          localStorage.removeItem(probe);
          cachedBackend = localStorage;
          return cachedBackend;
        }
      }
    } catch (e) { /* 禁用 → 降级内存 */ }
    var mem = Object.create(null);
    cachedBackend = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      keys: function () { return Object.keys(mem); }
    };
    return cachedBackend;
  }

  function listKeys(b) {
    if (typeof b.keys === 'function') return b.keys();
    var arr = [];
    for (var i = 0; i < b.length; i++) {
      var k = b.key(i);
      if (k) arr.push(k);
    }
    return arr;
  }

  function key(trackKey, laps) { return PREFIX + trackKey + '_' + laps; }

  return {
    /** 读取某赛道+圈数档的最佳圈速（ms），无记录返回 0 */
    loadBest: function (trackKey, laps) {
      try {
        var v = backend().getItem(key(trackKey, laps));
        var n = v ? parseFloat(v) : 0;
        return (isNaN(n) || n <= 0) ? 0 : n;
      } catch (e) { return 0; }
    },

    /**
     * 写入最佳圈速（仅当破纪录时真正写入）。
     * @returns true 表示刷新了纪录
     */
    saveBest: function (trackKey, laps, lapMs) {
      try {
        if (!lapMs || lapMs <= 0) return false;
        var best = this.loadBest(trackKey, laps);
        if (!best || lapMs < best) {
          backend().setItem(key(trackKey, laps), String(lapMs));
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
