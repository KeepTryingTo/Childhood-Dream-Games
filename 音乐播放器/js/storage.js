/* ============================================================
 * storage.js —— 设置持久化(localStorage) + 本地曲目 Blob 持久化(IndexedDB)
 * UMD：浏览器(挂 window.MPStorage) / Node(require) 双端可用
 *
 * - 设置（音量/静音/模式/主题）：localStorage，键 'mp.settings.v1'
 * - 本地文件持久化：IndexedDB 'mp-db' / store 'tracks'，存
 *   { id, title, artist, duration, lrc, blob }，刷新后重建 objectURL
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SETTINGS_KEY = 'mp.settings.v1';

  /* ---------------- 设置（localStorage，带内存降级） ---------------- */

  function lsBackend() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var probe = '__mp_probe__';
        localStorage.setItem(probe, '1');
        if (localStorage.getItem(probe) === '1') {
          localStorage.removeItem(probe);
          return localStorage;
        }
      }
    } catch (e) { /* 禁用环境降级 */ }
    var mem = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }

  function loadSettings() {
    try {
      var raw = lsBackend().getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveSettings(settings) {
    try { lsBackend().setItem(SETTINGS_KEY, JSON.stringify(settings || {})); }
    catch (e) { /* ignore */ }
  }

  /* ---------------- 本地曲目 Blob（IndexedDB） ---------------- */

  var DB_NAME = 'mp-db';
  var STORE = 'tracks';

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB unavailable'));
      }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function _tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var out = fn(store);
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /** 保存/更新一首本地曲目（含 Blob），重复 id 覆盖 */
  function saveTrackRecord(rec) {
    return _tx('readwrite', function (store) { return store.put(rec); });
  }

  /** 读取全部持久化曲目（含 Blob） */
  function getAllTrackRecords() {
    return _tx('readonly', function (store) { return store.getAll(); })
      .then(function (res) { return res || []; });
  }

  function deleteTrackRecord(id) {
    return _tx('readwrite', function (store) { return store.delete(id); });
  }

  function clearTrackRecords() {
    return _tx('readwrite', function (store) { return store.clear(); });
  }

  return {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    saveTrackRecord: saveTrackRecord,
    getAllTrackRecords: getAllTrackRecords,
    deleteTrackRecord: deleteTrackRecord,
    clearTrackRecords: clearTrackRecords
  };
});
