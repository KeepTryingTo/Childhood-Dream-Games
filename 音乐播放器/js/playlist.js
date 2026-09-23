/* ============================================================
 * playlist.js —— 播放列表管理 / 播放模式索引计算（纯逻辑，可单元测试）
 * UMD：浏览器(挂 window.MPPlaylist) / Node(require) 双端可用
 *
 * 核心职责（require.md 风险 6：所有索引变更集中于此模块并配单测）：
 *   - 曲目增删改查，currentIndex 全局唯一维护点
 *   - 四种播放模式的下一/上一索引计算：
 *       order      顺序（末首结束停止）
 *       list-loop  列表循环
 *       single     单曲循环（ended 时由 player 重播，manual 仍切下一首）
 *       shuffle    随机（Fisher–Yates 洗牌队列，一轮不重不漏）
 *   - 删除/清空时的索引与洗牌队列一致性维护
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.MPPlaylist = factory(root.MPModel);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var MODES = ['order', 'list-loop', 'single', 'shuffle'];

  function Playlist(tracks) {
    this.tracks = tracks || [];
    this.currentIndex = this.tracks.length ? 0 : -1;
    this.mode = 'order';
    this._shuffle = [];      // 洗牌后的索引队列
    this._shufflePos = -1;   // 当前在队列中的位置
    this._rebuildShuffle();
  }

  Playlist.MODES = MODES;

  Playlist.prototype.size = function () { return this.tracks.length; };

  Playlist.prototype.get = function (i) {
    return (i >= 0 && i < this.tracks.length) ? this.tracks[i] : null;
  };

  Playlist.prototype.current = function () { return this.get(this.currentIndex); };

  Playlist.prototype.indexOfId = function (id) {
    for (var i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i].id === id) return i;
    }
    return -1;
  };

  /** 批量追加曲目；首次添加时自动指向第 0 首。返回新增数量。 */
  Playlist.prototype.add = function (tracks) {
    var added = 0;
    for (var i = 0; i < (tracks || []).length; i++) {
      this.tracks.push(tracks[i]);
      this._shuffle.push(this.tracks.length - 1);
      added++;
    }
    if (this.currentIndex < 0 && this.tracks.length) this.currentIndex = 0;
    return added;
  };

  /**
   * 删除指定索引的曲目（索引维护核心逻辑，T7 覆盖）。
   * @returns {{removed:object|null, wasCurrent:boolean, nextCurrentIndex:number}}
   *   - wasCurrent=true 时 newCurrentIndex 为删除后应指向的位置(-1 表示空列表)，
   *     是否续播由调用方决定
   */
  Playlist.prototype.removeAt = function (i) {
    var n = this.tracks.length;
    if (i < 0 || i >= n) return { removed: null, wasCurrent: false, nextCurrentIndex: this.currentIndex };

    var removed = this.tracks.splice(i, 1)[0];
    var wasCurrent = (i === this.currentIndex);

    // --- currentIndex 维护 ---
    if (this.currentIndex > i) {
      this.currentIndex--;          // 删除的是当前之前的 → 索引左移
    } else if (wasCurrent) {
      this.currentIndex = (i < this.tracks.length) ? i : this.tracks.length - 1;
    }
    // 删除的是当前之后的 → 不变

    // --- 洗牌队列维护：移除 i，其后所有索引 -1 ---
    var p = this._shuffle.indexOf(i);
    if (p >= 0) this._shuffle.splice(p, 1);
    for (var k = 0; k < this._shuffle.length; k++) {
      if (this._shuffle[k] > i) this._shuffle[k]--;
    }
    if (p >= 0 && p < this._shufflePos) this._shufflePos--;

    // --- 删除的是当前曲：把"新的当前曲"对齐到队列当前位置 ---
    // 否则剩余队列中仍包含当前曲，继续播放会出现重复，破坏不重不漏语义
    if (wasCurrent && this.currentIndex >= 0) {
      var q = this._shuffle.indexOf(this.currentIndex);
      if (q >= 0 && q !== this._shufflePos) {
        var v = this._shuffle.splice(q, 1)[0];
        var at = Math.min(Math.max(this._shufflePos, 0), this._shuffle.length);
        this._shuffle.splice(at, 0, v);
      }
      this._shufflePos = Math.max(0, Math.min(this._shufflePos, this._shuffle.length - 1));
    }

    return { removed: removed, wasCurrent: wasCurrent, nextCurrentIndex: this.currentIndex };
  };

  Playlist.prototype.removeById = function (id) {
    return this.removeAt(this.indexOfId(id));
  };

  /** 清空列表 */
  Playlist.prototype.clear = function () {
    this.tracks.length = 0;
    this.currentIndex = -1;
    this._shuffle = [];
    this._shufflePos = -1;
  };

  /** 设置当前索引（自动 clamp） */
  Playlist.prototype.setCurrent = function (i) {
    if (this.tracks.length === 0) { this.currentIndex = -1; return this.currentIndex; }
    this.currentIndex = Math.max(0, Math.min(i, this.tracks.length - 1));
    return this.currentIndex;
  };

  Playlist.prototype.setCurrentById = function (id) {
    var i = this.indexOfId(id);
    if (i >= 0) this.setCurrent(i);
    return i;
  };

  /* ---------------- 洗牌队列 ---------------- */

  function fisherYates(n) {
    var arr = new Array(n);
    for (var i = 0; i < n; i++) arr[i] = i;
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
    }
    return arr;
  }

  Playlist.prototype._rebuildShuffle = function () {
    var arr = fisherYates(this.tracks.length);
    // 把当前曲目放到队首（随机模式下切歌从当前开始，一轮不重不漏）
    if (this.currentIndex >= 0 && this.currentIndex < arr.length) {
      var pos = arr.indexOf(this.currentIndex);
      if (pos > 0) {
        arr.splice(pos, 1);
        arr.unshift(this.currentIndex);
      }
    }
    this._shuffle = arr;
    this._shufflePos = this.currentIndex >= 0 ? 0 : -1;
  };

  Playlist.prototype._nextShuffle = function () {
    if (this.tracks.length === 0) return -1;
    if (this._shuffle.length !== this.tracks.length) this._rebuildShuffle();
    if (this._shufflePos < 0) this._shufflePos = 0;
    else this._shufflePos++;
    if (this._shufflePos >= this._shuffle.length) {
      // 一轮结束：开启新一轮，当前曲目仍放队首（避免立即重复）
      this._rebuildShuffle();
      this._shufflePos = this._shuffle.length > 1 ? 1 : 0;
    }
    return this._shuffle[this._shufflePos];
  };

  Playlist.prototype._prevShuffle = function () {
    if (this.tracks.length === 0 || this._shuffle.length !== this.tracks.length) {
      this._rebuildShuffle();
    }
    this._shufflePos = Math.max(0, this._shufflePos - 1);
    return this._shuffle[this._shufflePos];
  };

  /* ---------------- 模式索引计算 ---------------- */

  /**
   * 计算下一首索引。
   * @param {boolean} fromEnded true=自然播完触发；false=手动切歌
   * @returns {number} 下一索引；-1 表示无下一首（order 末首结束 → 停止）
   */
  Playlist.prototype.nextIndex = function (fromEnded) {
    var n = this.tracks.length;
    if (n === 0) return -1;
    var i = this.currentIndex;

    switch (this.mode) {
      case 'list-loop':
        return (i + 1) % n;
      case 'single':
        return fromEnded ? i : (i + 1) % n;   // 播完重播当前；手动仍切下一首
      case 'shuffle':
        return this._nextShuffle();
      case 'order':
      default:
        return (i + 1 < n) ? i + 1 : -1;      // 末首结束 → 停止
    }
  };

  /** 计算上一首索引（order/循环模式到头回绕；shuffle 走队列回退）。 */
  Playlist.prototype.prevIndex = function () {
    var n = this.tracks.length;
    if (n === 0) return -1;
    var i = this.currentIndex;
    if (this.mode === 'shuffle') return this._prevShuffle();
    return (i - 1 + n) % n;
  };

  return Playlist;
});
