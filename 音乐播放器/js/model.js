/* ============================================================
 * model.js —— 数据模型 / 工具函数 / 事件总线（纯逻辑，可单元测试）
 * UMD：浏览器(挂 window.MPModel) / Node(require) 双端可用
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var uidCounter = 1;

  /** 曲目唯一 id */
  function uid() { return 't' + (uidCounter++); }

  /**
   * 文件名解析：'艺术家 - 标题.mp3' → {artist, title}
   * 无 ' - ' 分隔时：title=去扩展名文件名，artist='未知艺术家'
   */
  function parseFileName(name) {
    var base = String(name || '').replace(/\.[^.]+$/, '').trim();
    var parts = base.split(/\s+-\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: '未知艺术家', title: base || '未知标题' };
  }

  /** 创建 Track 对象（带默认值） */
  function createTrack(opts) {
    opts = opts || {};
    var parsed = opts.title ? { title: opts.title, artist: opts.artist || '未知艺术家' }
                            : parseFileName(opts.fileName || '');
    return {
      id: opts.id || uid(),
      title: parsed.title,
      artist: parsed.artist,
      url: opts.url || '',
      cover: opts.cover || '',
      duration: opts.duration || 0,   // 秒，loadedmetadata 后回填
      lrc: opts.lrc || ''             // LRC 歌词原文，可空
    };
  }

  /** 秒 → 'mm:ss'（超过 1 小时 → 'h:mm:ss'） */
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  /** 轻量事件总线 */
  function EventBus() { this._map = Object.create(null); }

  EventBus.prototype.on = function (evt, fn) {
    (this._map[evt] || (this._map[evt] = [])).push(fn);
    return this;
  };

  EventBus.prototype.off = function (evt, fn) {
    var list = this._map[evt];
    if (!list) return this;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  };

  EventBus.prototype.emit = function (evt) {
    var list = this._map[evt];
    if (!list) return this;
    var args = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(null, args); } catch (e) { console.error(e); }
    }
    return this;
  };

  return {
    uid: uid,
    parseFileName: parseFileName,
    createTrack: createTrack,
    formatTime: formatTime,
    EventBus: EventBus
  };
});
