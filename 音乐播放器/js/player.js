/* ============================================================
 * player.js —— PlayerCore 播放核心（Audio 封装 / 模式切歌 / 错误恢复）
 * 浏览器专用（UMD 导出，依赖 DOM Audio）
 *
 * 关键设计（对应 require.md 技术基线）：
 *   - play() 的 Promise 必须 catch：捕获 NotAllowedError（自动播放策略），
 *     失败时回落实为暂停态并通过事件提示（T11）
 *   - 播放中切歌续播、暂停中切歌保持暂停（T5）
 *   - ended 按模式自动续播：order 末首停止 / list-loop 回首 /
 *     single 重播 / shuffle 走不重不漏队列（T2）
 *   - 播放错误：toast 提示 + 自动跳过；连续错误全曲失败时停止（T6）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.MPPlayer = factory(root.MPModel);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function PlayerCore(playlist, bus) {
    this.playlist = playlist;
    this.bus = bus;

    this.audio = new Audio();
    this.audio.preload = 'metadata';

    this.volume = 1.0;         // 0~1
    this.muted = false;
    this._volumeBeforeMute = 1.0;
    this.current = null;       // 当前 Track
    this._errorStreak = 0;     // 连续播放错误计数（防跳过死循环）
    this._destroyed = false;

    var self = this;
    this.audio.addEventListener('loadedmetadata', function () {
      if (self.current) {
        self.current.duration = self.audio.duration || 0;
        self.bus.emit('duration', self.current);
      }
    });
    this.audio.addEventListener('play', function () {
      self._errorStreak = 0;
      self.bus.emit('play', self.current);
    });
    this.audio.addEventListener('pause', function () { self.bus.emit('pause', self.current); });
    this.audio.addEventListener('ended', function () { self._onEnded(); });
    this.audio.addEventListener('error', function () { self._onError(); });
  }

  /* ---------------- 基础控制 ---------------- */

  /** 加载曲目。opts.autoplay 默认 true；保持"播放中续播/暂停中保持暂停" */
  PlayerCore.prototype.loadAt = function (index, opts) {
    opts = opts || {};
    var track = this.playlist.get(index);
    if (!track) return null;
    var wasPlaying = !this.audio.paused && !this.audio.ended;
    this.playlist.setCurrent(index);
    this.current = track;
    this.audio.src = track.url;
    this.audio.load();
    this.bus.emit('trackchange', track);

    var wantPlay = (opts.autoplay !== undefined) ? opts.autoplay : wasPlaying;
    if (wantPlay) this.play();
    return track;
  };

  /** 播放当前曲目；自动播放被拦截时优雅降级为暂停态并提示（T11） */
  PlayerCore.prototype.play = function () {
    if (!this.current || !this.audio.src) {
      // 空列表/未加载：尝试从列表第 0 首开始（T8）
      if (this.playlist.size() > 0) {
        this.loadAt(this.playlist.currentIndex, { autoplay: true });
      } else {
        this.bus.emit('toast', '播放列表为空，请先导入本地音频');
      }
      return;
    }
    var self = this;
    var p = this.audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          self.bus.emit('autoplayblocked', err);
          self.bus.emit('toast', '浏览器已拦截自动播放，请点击播放按钮');
        } else if (err && err.name !== 'AbortError') {
          console.error(err);
        }
      });
    }
  };

  PlayerCore.prototype.pause = function () { this.audio.pause(); };

  PlayerCore.prototype.toggle = function () {
    if (this.audio.paused) this.play();
    else this.pause();
  };

  /** 跳转（秒） */
  PlayerCore.prototype.seek = function (t) {
    if (!isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    var d = this.audio.duration;
    this.audio.currentTime = Math.max(0, Math.min(t, d - 0.05));
  };

  PlayerCore.prototype.seekBy = function (delta) {
    this.seek(this.audio.currentTime + delta);
  };

  PlayerCore.prototype.setVolume = function (v) {
    v = Math.max(0, Math.min(1, Number(v) || 0));
    this.volume = v;
    this.audio.volume = v;
    if (v > 0 && this.muted) this.setMuted(false);
    this.bus.emit('volume', { volume: v, muted: this.muted });
  };

  PlayerCore.prototype.setMuted = function (b) {
    if (b && !this.muted) this._volumeBeforeMute = this.volume;
    this.muted = !!b;
    this.audio.muted = this.muted;
    this.bus.emit('volume', { volume: this.volume, muted: this.muted });
  };

  PlayerCore.prototype.toggleMute = function () {
    this.setMuted(!this.muted);
  };

  /* ---------------- 切歌 ---------------- */

  PlayerCore.prototype.next = function (auto) {
    var idx = this.playlist.nextIndex(false);
    if (idx < 0) {
      this.pause();
      if (!auto) this.bus.emit('toast', '已经是最后一首了');
      return;
    }
    this._errorStreak = 0;
    this.loadAt(idx);           // 播放中续播 / 暂停中保持暂停
  };

  PlayerCore.prototype.prev = function () {
    // 已播放超过 3 秒 → 先回到开头（常见交互习惯）
    if (this.audio.currentTime > 3) { this.seek(0); return; }
    var idx = this.playlist.prevIndex();
    if (idx < 0) return;
    this._errorStreak = 0;
    this.loadAt(idx);
  };

  /* ---------------- 事件处理 ---------------- */

  /** 自然播完：按模式自动续播（T2） */
  PlayerCore.prototype._onEnded = function () {
    var mode = this.playlist.mode;
    if (mode === 'single') {
      this.seek(0);
      this.play();
      return;
    }
    var idx = this.playlist.nextIndex(true);
    if (idx < 0) {              // order 模式末首结束 → 停止
      this.bus.emit('playlistend');
      return;
    }
    this.loadAt(idx, { autoplay: true });
  };

  /** 播放错误：提示 + 自动跳过；连续失败达全曲数 → 停止（T6） */
  PlayerCore.prototype._onError = function () {
    var track = this.current;
    this._errorStreak++;
    if (!track || this._destroyed) return;

    if (this._errorStreak >= Math.max(this.playlist.size(), 1)) {
      this.pause();
      this.bus.emit('toast', '所有曲目均无法播放，请检查文件');
      return;
    }
    this.bus.emit('toast', '无法播放「' + track.title + '」，已自动跳过');
    var self = this;
    // 延迟一帧跳过，避免 src 未就绪时的连锁 error
    setTimeout(function () {
      if (!self._destroyed) self.next(true);
    }, 50);
  };

  PlayerCore.prototype.destroy = function () {
    this._destroyed = true;
    this.pause();
    this.audio.src = '';
  };

  return PlayerCore;
});
