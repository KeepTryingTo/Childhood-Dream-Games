/* ============================================================
 * lrc.js —— LRC 歌词解析与同步定位（纯逻辑，可单元测试）
 * UMD：浏览器(挂 window.MPLrc) / Node(require) 双端可用
 *
 * 支持：
 *   - [mm:ss] / [mm:ss.xx] / [mm:ss.xxx] 时间标签
 *   - 一行多个时间标签
 *   - [offset:+/-毫秒] 全局偏移
 *   - [ti:][ar:][al:][by:] 等元数据标签自动忽略
 *   - 输出按时间升序的 [{t, text}]，t 为秒（含 offset 修正）
 *   - findLrcIndex：二分查找当前播放时间对应的歌词行
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPLrc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 时间标签：[mm:ss] [mm:ss.xx] [mm:ss.xxx]（分钟允许 1~2 位，兼容 [0:12.5]）
  var TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  // 元数据/功能标签行
  var META_RE = /^\s*\[(ti|ar|al|by|offset|re|ve|length):(.*)\]\s*$/i;

  function _fracToSec(fracText) {
    if (!fracText) return 0;
    // '5'→0.5s，'50'→0.50s，'500'→0.500s：按位数补齐千分位
    var n = parseInt(fracText, 10);
    var scale = Math.pow(10, fracText.length);
    return n / scale;
  }

  /**
   * 解析 LRC 文本
   * @param {string} text
   * @returns {Array<{t:number, text:string}>} 按时间升序（同刻保原顺序）
   */
  function parseLrc(text) {
    var out = [];
    var offsetMs = 0;
    var lines = String(text || '').split(/\r\n|\n|\r/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;

      var meta = line.match(META_RE);
      if (meta) {
        if (meta[1].toLowerCase() === 'offset') {
          var v = parseInt(meta[2].trim(), 10);
          if (!isNaN(v)) offsetMs = v;   // 正值整体前移（标准约定）
        }
        continue;                         // 其余元数据忽略
      }

      TIME_TAG_RE.lastIndex = 0;
      var times = [];
      var m;
      var hasTag = false;
      while ((m = TIME_TAG_RE.exec(line)) !== null) {
        hasTag = true;
        var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + _fracToSec(m[3]);
        times.push(t);
      }
      if (!hasTag) continue;

      var content = line.replace(TIME_TAG_RE, '').trim();
      for (var j = 0; j < times.length; j++) {
        // offset 正值表示整体提前（歌词时间减去 offset）
        out.push({ t: Math.max(0, times[j] - offsetMs / 1000), text: content });
      }
    }

    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /**
   * 二分查找：返回最后一个 t <= time 的歌词行索引；time 早于首行返回 -1。
   * @param {Array<{t:number,text:string}>} sortedLines 升序歌词行
   */
  function findLrcIndex(sortedLines, time) {
    if (!sortedLines || sortedLines.length === 0) return -1;
    var lo = 0, hi = sortedLines.length - 1;
    if (time < sortedLines[0].t) return -1;
    var ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (sortedLines[mid].t <= time) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  return {
    parseLrc: parseLrc,
    findLrcIndex: findLrcIndex
  };
});
