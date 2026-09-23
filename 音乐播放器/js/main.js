/* ============================================================
 * main.js —— 入口装配：导入 / 持久化恢复 / Media Session / 启动
 * 浏览器专用 IIFE
 *
 * 流程：
 *   1) 恢复设置（音量/模式/主题）与 IndexedDB 持久化的本地曲目
 *   2) 绑定导入（文件选择 + 全页拖拽，音频与同名 .lrc 关联）
 *   3) 事件桥接：播放前初始化频谱（用户手势链路内，单例保护）
 *   4) Media Session：系统媒体键 / 锁屏元数据
 * ============================================================ */
(function (window, document) {
  'use strict';
  var M = window.MPModel;
  var Storage = window.MPStorage;

  /* ---------------- 组件装配 ---------------- */
  var bus = new M.EventBus();
  var playlist = new window.MPPlaylist.Playlist();
  var player = new window.MPPlayer.PlayerCore(playlist, bus);
  var visualizer = new window.MPVisualizer(document.getElementById('visualizer'));

  var theme = 'dark';

  /* ---------------- 设置恢复 ---------------- */
  var settings = Storage.loadSettings();
  if (typeof settings.volume === 'number') player.setVolume(settings.volume);
  if (settings.muted) player.setMuted(true);
  if (settings.mode && window.MPPlaylist.MODES.indexOf(settings.mode) >= 0) {
    playlist.mode = settings.mode;
  }
  if (settings.theme === 'light' || settings.theme === 'dark') theme = settings.theme;

  function persistSettings() {
    Storage.saveSettings({ volume: player.volume, muted: player.muted,
                           mode: playlist.mode, theme: theme });
  }

  /* ---------------- UI 装配 ---------------- */
  var ui = new window.MPUI.UI({
    bus: bus,
    player: player,
    playlist: playlist,
    callbacks: {
      onRemoveTrack: removeTrack,
      onModeChange: persistSettings,
      onThemeChange: function (t) { theme = t; persistSettings(); }
    }
  });
  ui.setTheme(theme);
  ui.renderList();
  ui.renderCurrent(null);
  ui.renderVolume({ volume: player.volume, muted: player.muted });

  /* ---------------- 本地文件导入 ---------------- */
  var fileInput = document.getElementById('file-input');
  document.getElementById('btn-import').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // 全页拖拽导入
  var dropOverlay = document.getElementById('drop-overlay');
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) {
    e.preventDefault();
    if (++dragDepth === 1) dropOverlay.classList.add('show');
  });
  document.addEventListener('dragleave', function () {
    if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('show'); }
  });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('show');
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  var AUDIO_EXT = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus|weba|webm)$/i;
  var LRC_EXT = /\.lrc$/i;

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var audioFiles = [], lrcMap = {};
    files.forEach(function (f) {
      if (LRC_EXT.test(f.name)) {
        lrcMap[f.name.replace(/\.lrc$/i, '').toLowerCase()] = f;
      } else if (AUDIO_EXT.test(f.name) || (f.type && f.type.indexOf('audio') === 0)) {
        audioFiles.push(f);
      }
    });
    if (!audioFiles.length) {
      if (Object.keys(lrcMap).length) ui.toast('已忽略 .lrc 文件：请与同名音频一起拖入');
      else ui.toast('未识别到音频文件');
      return;
    }

    var added = 0;
    var pending = audioFiles.length;

    audioFiles.forEach(function (file) {
      var track = M.createTrack({ fileName: file.name, url: URL.createObjectURL(file) });

      // 同名 .lrc 关联
      var lrcFile = lrcMap[file.name.replace(/\.[^.]+$/i, '').toLowerCase()];
      var readLrc = lrcFile
        ? lrcFile.text().then(function (txt) { track.lrc = txt; })
                     .catch(function () {})
        : Promise.resolve();

      readLrc.then(function () {
        playlist.add([track]);
        if (playlist.currentIndex < 0) playlist.setCurrent(0);
        ui.renderList();
        if (player.current === null) ui.renderCurrent(playlist.current());
        added++;

        // IndexedDB 持久化（音频 Blob + 元数据），刷新后可恢复
        Storage.saveTrackRecord({
          id: track.id, title: track.title, artist: track.artist,
          duration: track.duration, lrc: track.lrc, blob: file
        }).catch(function () { /* 隐私模式等场景忽略 */ });

        // 时长回填（临时探测，不阻塞列表展示）
        probeDuration(track);
      });
    });

    var wait = setInterval(function () {
      if (added >= pending) {
        clearInterval(wait);
        ui.toast('已添加 ' + added + ' 首歌曲');
      }
    }, 100);
    setTimeout(function () { clearInterval(wait); }, 8000);
  }

  /** 用一次性 Audio 元素读取时长并回填（F1/F8） */
  function probeDuration(track) {
    var probe = new Audio();
    probe.preload = 'metadata';
    probe.src = track.url;
    var done = false;
    probe.addEventListener('loadedmetadata', function () {
      if (done) return;
      done = true;
      track.duration = probe.duration || 0;
      bus.emit('duration', track);
      probe.src = '';
    });
    probe.addEventListener('error', function () {
      done = true;
      bus.emit('toast', '「' + track.title + '」可能是不支持的格式或已损坏');
      probe.src = '';
    });
    probe.load();
  }

  /* ---------------- 删除 / 清空 ---------------- */

  function revokeTrack(track) {
    if (track && track.url && track.url.indexOf('blob:') === 0) {
      URL.revokeObjectURL(track.url);   // 防 objectURL 泄漏（T12）
    }
  }

  function removeTrack(id) {
    var wasPlaying = player.current && !player.audio.paused;
    var info = playlist.removeById(id);
    if (!info.removed) return;

    Storage.deleteTrackRecord(id).catch(function () {});
    revokeTrack(info.removed);

    if (playlist.size() === 0) {
      player.pause();
      player.audio.removeAttribute('src');
      player.current = null;
      ui.renderCurrent(null);
      ui.toast('播放列表已清空');
    } else if (info.wasCurrent) {
      // 删除的是当前曲：指向原位新歌，播放中则无缝续播（T7）
      player.current = playlist.current();
      player.audio.src = player.current.url;
      bus.emit('trackchange', player.current);
      if (wasPlaying) player.play();
    }
    ui.renderList();
    ui.renderCurrent(player.current);
  }

  function clearAll() {
    if (!playlist.size()) return;
    player.pause();
    player.audio.removeAttribute('src');
    player.current = null;
    playlist.tracks.slice().forEach(revokeTrack);
    playlist.clear();
    Storage.clearTrackRecords().catch(function () {});
    ui.renderList();
    ui.renderCurrent(null);
    ui.toast('已清空播放列表');
  }

  document.getElementById('btn-clear').addEventListener('click', clearAll);

  /* ---------------- 播放事件桥接 ---------------- */

  bus.on('play', function () {
    // 频谱：首次播放（用户手势链路内）初始化 MediaElementSource（单例）
    visualizer.attach(player.audio);
    visualizer.resume();
    visualizer.start();
    persistSettings();
  });
  bus.on('pause', function () {
    visualizer.stop();
    persistSettings();
  });
  bus.on('trackchange', function (track) {
    updateMediaSession(track);
  });

  /* ---------------- Media Session（系统媒体键 / 锁屏，E4） ---------------- */

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: '网页音乐播放器',
        artwork: track.cover ? [{ src: track.cover, sizes: '512x512', type: 'image/png' }] : []
      });
    } catch (e) { /* ignore */ }
  }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', function () { player.play(); });
      navigator.mediaSession.setActionHandler('pause', function () { player.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { player.prev(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { player.next(false); });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- IndexedDB 恢复上次会话的本地曲目 ---------------- */

  Storage.getAllTrackRecords().then(function (recs) {
    if (!recs.length) return;
    var tracks = recs.map(function (r) {
      return M.createTrack({
        id: r.id, title: r.title, artist: r.artist,
        duration: r.duration, lrc: r.lrc,
        url: r.blob ? URL.createObjectURL(r.blob) : ''
      });
    });
    playlist.add(tracks);
    ui.renderList();
    ui.renderCurrent(playlist.current());
    ui.toast('已恢复上次会话的 ' + tracks.length + ' 首本地歌曲');
  }).catch(function () { /* IndexedDB 不可用，静默降级 */ });

})(window, document);
