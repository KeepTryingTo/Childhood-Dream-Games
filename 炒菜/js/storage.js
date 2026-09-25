/* ============================================================
 * storage.js —— 本地持久化（浏览器 localStorage / Node 内存降级）
 *
 * keys:
 *   kitchen_best_v1      历史最高营业额（数字）
 *   kitchen_board_v1     排行榜（数组，按营业额降序 top10）
 *   kitchen_history_v1   跨局累计（成就/图鉴数据）
 *   kitchen_skin_v1      装扮 { theme: 'warm'|'celadon'|'neon'|'macaron' }
 *   kitchen_name_v1      店长昵称
 *   kitchen_guide_v1     新手引导已看过（bool）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var cachedBackend;

  function backend() {
    if (cachedBackend) return cachedBackend;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var probe = '__kitchen_probe__';
        localStorage.setItem(probe, '1');
        if (localStorage.getItem(probe) === '1') {
          localStorage.removeItem(probe);
          cachedBackend = localStorage;
          return cachedBackend;
        }
      }
    } catch (e) { /* 隐私模式 → 内存降级 */ }
    var mem = Object.create(null);
    cachedBackend = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      keys: function () { return Object.keys(mem); }
    };
    return cachedBackend;
  }

  function getJSON(key, fallback) {
    try {
      var v = backend().getItem(key);
      if (!v) return fallback;
      var obj = JSON.parse(v);
      return obj == null ? fallback : obj;
    } catch (e) { return fallback; }
  }
  function setJSON(key, obj) {
    try { backend().setItem(key, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  var K = {
    BEST: 'kitchen_best_v1',
    BOARD: 'kitchen_board_v1',
    HISTORY: 'kitchen_history_v1',
    SKIN: 'kitchen_skin_v1',
    NAME: 'kitchen_name_v1',
    GUIDE: 'kitchen_guide_v1'
  };

  return {
    KEYS: K,

    /* ---------------- 最高分 ---------------- */
    loadBest: function () {
      try {
        var v = backend().getItem(K.BEST);
        var n = v ? parseInt(v, 10) : 0;
        return isNaN(n) ? 0 : n;
      } catch (e) { return 0; }
    },
    saveBest: function (score) {
      try {
        var best = this.loadBest();
        if (score > best) { backend().setItem(K.BEST, String(score)); return true; }
        return false;
      } catch (e) { return false; }
    },

    /* ---------------- 排行榜（本地荣誉榜） ---------------- */
    loadBoard: function () { return getJSON(K.BOARD, []); },
    /** 插入一条营业记录，返回排名（1-based）；不在前 10 返回 0 */
    addBoardEntry: function (entry) {
      var board = this.loadBoard();
      board.push({
        name: entry.name || '店长',
        revenue: entry.revenue || 0,
        dishes: entry.dishes || 0,
        rating: entry.rating || 0,
        date: entry.date || ''
      });
      board.sort(function (a, b) { return b.revenue - a.revenue; });
      board = board.slice(0, 10);
      setJSON(K.BOARD, board);
      var idx = board.indexOf(board.filter(function (e) {
        return e.revenue === (entry.revenue || 0) && e.name === (entry.name || '店长');
      })[0]);
      return idx >= 0 ? idx + 1 : 0;
    },

    /* ---------------- 跨局累计（成就/图鉴） ---------------- */
    loadHistory: function () { return getJSON(K.HISTORY, {}); },
    saveHistory: function (h) { setJSON(K.HISTORY, h); },

    /* ---------------- 装扮 / 昵称 / 引导 ---------------- */
    loadSkin: function () { return getJSON(K.SKIN, { theme: 'warm' }); },
    saveSkin: function (skin) { setJSON(K.SKIN, skin); },
    loadName: function () {
      try { return backend().getItem(K.NAME) || '店长'; } catch (e) { return '店长'; }
    },
    saveName: function (n) {
      try { backend().setItem(K.NAME, String(n || '店长').slice(0, 12)); } catch (e) { /* ignore */ }
    },
    loadGuideSeen: function () { return getJSON(K.GUIDE, false); },
    saveGuideSeen: function (v) { setJSON(K.GUIDE, !!v); },

    clearAll: function () {
      try {
        var b = backend();
        [K.BEST, K.BOARD, K.HISTORY, K.SKIN, K.NAME, K.GUIDE].forEach(function (k) { b.removeItem(k); });
      } catch (e) { /* ignore */ }
    }
  };
});
