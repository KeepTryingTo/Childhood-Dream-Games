/* ============================================================
 * ui.js —— DOM 渲染与交互绑定（UI 层，可完整替换）
 * 浏览器专用 IIFE
 *
 * 职责：
 *   - 播放列表渲染 / 过滤 / 高亮当前项（跳动动效）
 *   - 信息区（旋转唱片缺省封面）与歌词面板（rAF + 二分高亮 + 平滑滚动）
 *   - 自定义进度条（pointer 拖拽 seek，拖拽中不抖动）
 *   - 音量滑条 / 静音 / 播放模式按钮
 *   - 键盘快捷键（输入框聚焦时失效，T10）
 *   - 主题切换 / toast / 拖拽导入提示
 * 逻辑层通过 ctx = {bus, player, playlist, callbacks} 注入，
 * PlayerCore 不触碰任何 DOM（满足非功能需求：逻辑与 UI 分离）。
 * ============================================================ */
(function (window, document) {
  'use strict';
  var M = window.MPModel, Lrc = window.MPLrc;

  var MODE_ICON = {
    'order': {
      title: '顺序播放',
      svg: '<svg viewBox="0 0 24 24"><path d="M4 7h11l-2.5-2.5L14 3l5 5-5 5-1.5-1.5L15 9H4V7zm16 10v2H4v-2h16zm-3.5-7l4.5 4.5L16.5 19 15 17.5 17.5 15 15 12.5 16.5 11z" fill="currentColor"/></svg>'
    },
    'list-loop': {
      title: '列表循环',
      svg: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>'
    },
    'single': {
      title: '单曲循环',
      svg: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" fill="currentColor"/><text x="12" y="15" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor">1</text></svg>'
    },
    'shuffle': {
      title: '随机播放',
      svg: '<svg viewBox="0 0 24 24"><path d="M17 3l4 4-4 4V8.5h-2.2l-2.3 2.8-1.4-1.6L13.9 6.5H17V3zM3 6.5h4.2l8 9.9H17V13l4 4-4 4v-3.5h-4.7L4.2 8.5H3V6.5zm11.2 8.7l2.4-2.9 0.4 0.4v2.5h-2.8zM3 17.5h1.2l1.9-2.3 1.4 1.7-2.1 2.6H3v-2z" fill="currentColor"/></svg>'
    }
  };

  function UI(ctx) {
    var self = this;
    this.bus = ctx.bus;
    this.player = ctx.player;
    this.playlist = ctx.playlist;
    this.cb = ctx.callbacks || {};

    this.$ = function (sel) { return document.querySelector(sel); };
    this.listEl = this.$('#track-list');
    this.lrcInner = this.$('#lrc-inner');
    this.lrcPanel = this.$('#lrc-panel');
    this.progressEl = this.$('#progress');
    this.progressFill = this.$('#progress-fill');
    this.progressThumb = this.$('#progress-thumb');
    this.playBtn = this.$('#btn-play');
    this.modeBtn = this.$('#btn-mode');
    this.volumeEl = this.$('#volume');
    this.curTimeEl = this.$('#time-cur');
    this.totTimeEl = this.$('#time-total');
    this.titleEl = this.$('#np-title');
    this.artistEl = this.$('#np-artist');
    this.discEl = this.$('#disc');
    this.countEl = this.$('#list-count');
    this.toastEl = this.$('#toast');

    this._filter = '';
    this._dragging = false;
    this._lrcLines = [];
    this._lrcEls = [];
    this._lrcIdx = -2;
    this._raf = 0;
    this._toastTimer = 0;

    this._bindProgress();
    this._bindVolume();
    this._bindMode();
    this._bindPlay();
    this._bindNextPrev();
    this._bindKeyboard();
    this._bindTheme();
    this._bindFilter();
    this._startRaf();

    // ---- 逻辑层事件 → UI 更新 ----
    this.bus.on('trackchange', function (t) { self.renderCurrent(t); self.renderList(); });
    this.bus.on('play', function () { self._renderPlayState(true); });
    this.bus.on('pause', function () { self._renderPlayState(false); });
    this.bus.on('duration', function (t) { self._updateRowDuration(t); });
    this.bus.on('volume', function (v) { self.renderVolume(v); });
    this.bus.on('toast', function (msg) { self.toast(msg); });
    this.bus.on('playlistend', function () { self.toast('播放列表播完啦'); });
  }

  /* ---------------- 播放列表 ---------------- */

  UI.prototype.renderList = function () {
    var self = this;
    var pl = this.playlist;
    var filter = this._filter.toLowerCase();
    var list = this.listEl;
    list.innerHTML = '';
    var shown = 0;

    pl.tracks.forEach(function (t, i) {
      if (filter &&
          t.title.toLowerCase().indexOf(filter) < 0 &&
          t.artist.toLowerCase().indexOf(filter) < 0) return;
      shown++;
      var li = document.createElement('li');
      li.className = 'track-item' + (i === pl.currentIndex ? ' current' : '');
      li.dataset.id = t.id;
      li.innerHTML =
        '<span class="t-idx">' +
          (i === pl.currentIndex
            ? '<span class="eq"><i></i><i></i><i></i></span>'
            : (shown + '.')) +
        '</span>' +
        '<div class="t-meta"><div class="t-title"></div><div class="t-artist"></div></div>' +
        '<span class="t-dur">' + (t.duration ? M.formatTime(t.duration) : '--:--') + '</span>' +
        '<button class="t-del" title="移除">' +
          '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3 0v8h1.5v-8H16z" fill="currentColor"/></svg>' +
        '</button>';
      li.querySelector('.t-title').textContent = t.title;
      li.querySelector('.t-artist').textContent = t.artist;
      li.addEventListener('click', function () {
        var idx = pl.indexOfId(t.id);
        if (idx >= 0) { self.playlist.setCurrent(idx); self.player.loadAt(idx, { autoplay: true }); }
      });
      li.querySelector('.t-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (self.cb.onRemoveTrack) self.cb.onRemoveTrack(t.id);
      });
      list.appendChild(li);
    });

    this.countEl.textContent = String(this.playlist.size());
    if (shown === 0) {
      var empty = document.createElement('li');
      empty.className = 'track-empty';
      empty.textContent = this.playlist.size() === 0
        ? '列表空空如也，点击底部「导入」或拖拽音频文件进来吧'
        : '没有匹配的歌曲';
      list.appendChild(empty);
    }
  };

  UI.prototype._updateRowDuration = function (track) {
    var li = this.listEl.querySelector('[data-id="' + track.id + '"] .t-dur');
    if (li && track.duration) li.textContent = M.formatTime(track.duration);
    if (this.playlist.current() === track) this.totTimeEl.textContent = M.formatTime(track.duration);
  };

  /* ---------------- 当前曲目 / 播放状态 ---------------- */

  UI.prototype.renderCurrent = function (track) {
    track = track || this.playlist.current();
    this.titleEl.textContent = track ? track.title : '未在播放';
    this.artistEl.textContent = track ? track.artist : '导入歌曲开始享受吧';
    this.totTimeEl.textContent = track && track.duration ? M.formatTime(track.duration) : '00:00';
    this._setLrc(track);
    this._renderProgress(0);
  };

  UI.prototype._renderPlayState = function (playing) {
    this.playBtn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5.14v13.72L19 12 8 5.14z" fill="currentColor"/></svg>';
    this.playBtn.title = playing ? '暂停' : '播放';
    this.discEl.classList.toggle('spinning', playing);
    this._renderMode();
  };

  /* ---------------- 进度条 ---------------- */

  UI.prototype._renderProgress = function (frac) {
    var pct = Math.max(0, Math.min(1, frac)) * 100;
    this.progressFill.style.width = pct + '%';
    this.progressThumb.style.left = pct + '%';
  };

  UI.prototype._bindProgress = function () {
    var self = this;
    var el = this.progressEl;

    function fracFromEvent(e) {
      var rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    el.addEventListener('pointerdown', function (e) {
      if (!self.player.audio.duration || !isFinite(self.player.audio.duration)) return;
      self._dragging = true;
      el.setPointerCapture(e.pointerId);
      self._renderProgress(fracFromEvent(e));
    });
    el.addEventListener('pointermove', function (e) {
      if (!self._dragging) return;
      var f = fracFromEvent(e);
      self._renderProgress(f);
      self.curTimeEl.textContent = M.formatTime(f * self.player.audio.duration);
    });
    el.addEventListener('pointerup', function (e) {
      if (!self._dragging) return;
      self._dragging = false;
      var f = fracFromEvent(e);
      self.player.seek(f * self.player.audio.duration);   // 松手才 seek（T3 不抖动）
    });
    el.addEventListener('pointercancel', function () { self._dragging = false; });
  };

  /* ---------------- 音量 / 静音 ---------------- */

  UI.prototype.renderVolume = function (v) {
    this.volumeEl.value = v.muted ? 0 : Math.round(v.volume * 100);
    var muteBtn = this.$('#btn-mute');
    muteBtn.innerHTML = (v.muted || v.volume === 0)
      ? '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm13.6 3l2.7 2.7-1.4 1.4-2.7-2.7-2.7 2.7-1.4-1.4 2.7-2.7-2.7-2.7 1.4-1.4 2.7 2.7 2.7-2.7 1.4 1.4-2.7 2.7z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor"/></svg>';
  };

  UI.prototype._bindVolume = function () {
    var self = this;
    var vol = this.volumeEl;
    vol.addEventListener('input', function () {
      self.player.setVolume(Number(vol.value) / 100);
    });
    this.$('#btn-mute').addEventListener('click', function () {
      self.player.toggleMute();
    });
  };

  /* ---------------- 播放模式 ---------------- */

  UI.prototype.renderMode = function () {
    var mode = this.playlist.mode;
    var conf = MODE_ICON[mode] || MODE_ICON.order;
    this.modeBtn.innerHTML = conf.svg;
    this.modeBtn.title = conf.title;
  };

  UI.prototype._bindMode = function () {
    var self = this;
    this.modeBtn.addEventListener('click', function () {
      var modes = window.MPPlaylist.MODES;
      var idx = modes.indexOf(self.playlist.mode);
      self.playlist.mode = modes[(idx + 1) % modes.length];
      if (self.cb.onModeChange) self.cb.onModeChange(self.playlist.mode);
      self.renderMode();
      self.toast(MODE_ICON[self.playlist.mode].title);
    });
    this.renderMode();
  };

  UI.prototype._bindPlay = function () {
    var self = this;
    this.playBtn.addEventListener('click', function () { self.player.toggle(); });
  };

  UI.prototype._bindNextPrev = function () {
    var self = this;
    this.$('#btn-prev').addEventListener('click', function () { self.player.prev(); });
    this.$('#btn-next').addEventListener('click', function () { self.player.next(false); });
  };

  /* ---------------- 歌词 ---------------- */

  UI.prototype._setLrc = function (track) {
    var self = this;
    this._lrcLines = [];
    this._lrcEls = [];
    this._lrcIdx = -2;
    this.lrcInner.innerHTML = '';

    var raw = track && track.lrc;
    if (!raw) {
      var tip = document.createElement('div');
      tip.className = 'lrc-empty';
      tip.textContent = track ? '♪ 暂无歌词（可将同名 .lrc 文件与音频一起拖入）' : '♪';
      this.lrcInner.appendChild(tip);
      return;
    }
    this._lrcLines = Lrc.parseLrc(raw);
    if (this._lrcLines.length === 0) {
      var tip2 = document.createElement('div');
      tip2.className = 'lrc-empty';
      tip2.textContent = '歌词文件解析失败';
      this.lrcInner.appendChild(tip2);
      return;
    }
    this._lrcLines.forEach(function (line) {
      var div = document.createElement('div');
      div.className = 'lrc-line';
      div.textContent = line.text || '···';
      self.lrcInner.appendChild(div);
      self._lrcEls.push(div);
    });
  };

  UI.prototype._updateLrc = function (time) {
    if (this._lrcLines.length === 0) return;
    var idx = Lrc.findLrcIndex(this._lrcLines, time);
    if (idx === this._lrcIdx) return;
    this._lrcIdx = idx;
    var els = this._lrcEls;
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle('active', i === idx);
    }
    if (idx >= 0) {
      var el = els[idx];
      var panelH = this.lrcPanel.clientHeight;
      var y = el.offsetTop - panelH / 2 + el.clientHeight / 2;
      this.lrcInner.style.transform = 'translateY(' + (-y) + 'px)';  // transform 平滑过渡
    }
  };

  /* ---------------- rAF 主刷新（进度 + 歌词） ---------------- */

  UI.prototype._startRaf = function () {
    var self = this;
    (function tick() {
      var a = self.player.audio;
      if (!self._dragging) {
        var d = a.duration;
        if (d && isFinite(d)) {
          self._renderProgress(a.currentTime / d);
          self.curTimeEl.textContent = M.formatTime(a.currentTime);
        }
        self._updateLrc(a.currentTime || 0);
      }
      self._raf = requestAnimationFrame(tick);
    })();
  };

  /* ---------------- 键盘快捷键（T10：输入框聚焦失效） ---------------- */

  UI.prototype._bindKeyboard = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                t.tagName === 'SELECT' || t.isContentEditable)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          self.player.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          self.player.seekBy(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          self.player.seekBy(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          self.player.setVolume(self.player.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          self.player.setVolume(self.player.volume - 0.1);
          break;
        case 'KeyN':
          self.player.next(false);
          break;
        case 'KeyP':
          self.player.prev();
          break;
      }
    });
  };

  /* ---------------- 主题 / 过滤 ---------------- */

  UI.prototype._bindTheme = function () {
    var self = this;
    this.$('#btn-theme').addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      if (self.cb.onThemeChange) self.cb.onThemeChange(next);
    });
  };

  UI.prototype.setTheme = function (theme) {
    document.documentElement.setAttribute('data-theme', theme);
  };

  UI.prototype._bindFilter = function () {
    var self = this;
    this.$('#search').addEventListener('input', function (e) {
      self._filter = e.target.value.trim();
      self.renderList();
    });
  };

  /* ---------------- Toast ---------------- */

  UI.prototype.toast = function (msg) {
    var self = this;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () {
      self.toastEl.classList.remove('show');
    }, 2600);
  };

  window.MPUI = { UI: UI };
})(window, document);
