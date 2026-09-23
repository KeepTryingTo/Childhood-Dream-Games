/* ============================================================
 * visualizer.js —— 频谱可视化（Web Audio AnalyserNode）
 * 浏览器专用 IIFE
 *
 * 关键约束（require.md 3.3）：
 *   - createMediaElementSource 同一 Audio 元素只能调用一次 → 单例保护
 *   - AudioContext 必须在用户手势链路内创建/resume → 首次 play 成功后初始化
 *   - AnalyserNode 接入后音频经 ctx 输出：ctx suspended 时无声音，
 *     因此每次播放前调用 resume()
 *   - 不可用（API 缺失/异常）→ 装饰性降级动画，不阻塞播放
 * ============================================================ */
(function (window) {
  'use strict';

  function Visualizer(canvas) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.dataArr = null;
    this.inited = false;       // createMediaElementSource 只能一次
    this.degraded = false;     // 降级装饰动画
    this._raf = 0;
    this._running = false;
    this._phase = 0;
  }

  /** 懒初始化（同一 audio 元素只绑定一次）。失败不影响播放。 */
  Visualizer.prototype.attach = function (audioEl) {
    if (this.inited || this.degraded) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio API unavailable');
      this.audioCtx = new AC();
      this.sourceNode = this.audioCtx.createMediaElementSource(audioEl); // 只许一次
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.dataArr = new Uint8Array(this.analyser.frequencyBinCount);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.inited = true;
    } catch (e) {
      console.warn('[Visualizer] 降级为装饰动画:', e.message);
      this.degraded = true;
    }
  };

  /** 播放前调用：唤醒音频上下文（用户手势链路内） */
  Visualizer.prototype.resume = function () {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(function () {});
    }
  };

  Visualizer.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    var self = this;
    (function loop() {
      if (!self._running) return;
      self._draw();
      self._raf = requestAnimationFrame(loop);
    })();
  };

  Visualizer.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._clear();
  };

  Visualizer.prototype._resize = function () {
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w: w, h: h, dpr: dpr };
  };

  Visualizer.prototype._clear = function () {
    var size = this._resize();
    this.ctx2d.clearRect(0, 0, size.w, size.h);
  };

  Visualizer.prototype._draw = function () {
    var size = this._resize();
    var ctx = this.ctx2d;
    var W = size.w, H = size.h;
    ctx.clearRect(0, 0, W, H);

    var bars = 48;
    var gap = Math.max(1, Math.round(W * 0.004));
    var barW = (W - gap * (bars - 1)) / bars;

    var values;
    if (this.inited && this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArr);
      // 取低~中频段（高频段大多接近 0，视觉利用率低）
      var useful = Math.floor(this.dataArr.length * 0.75);
      values = new Array(bars);
      for (var i = 0; i < bars; i++) {
        // 对数式分组：低频细分辨，高频合并
        var start = Math.floor(Math.pow(i / bars, 1.6) * useful);
        var end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * useful));
        var sum = 0;
        for (var j = start; j < end; j++) sum += this.dataArr[j];
        values[i] = sum / (end - start) / 255;
      }
    } else {
      // 降级：装饰性正弦波群
      this._phase += 0.045;
      values = new Array(bars);
      for (var k = 0; k < bars; k++) {
        var t = this._phase - k * 0.22;
        values[k] = 0.18 + 0.16 * (Math.sin(t) * 0.5 + 0.5) + 0.1 * Math.sin(t * 2.7 + 1.3);
      }
    }

    // 渐变配色（深空蓝 → 青紫）
    var grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#0ea5e9');
    grad.addColorStop(0.55, '#8b5cf6');
    grad.addColorStop(1, '#f472b6');
    ctx.fillStyle = grad;

    for (var b = 0; b < bars; b++) {
      var v = Math.max(0.02, Math.min(1, values[b]));
      var barH = v * H * 0.92;
      var x = b * (barW + gap);
      var y = H - barH;
      // 圆角柱
      var r = Math.min(barW / 2, 4);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, [r, r, 0, 0]);
      else ctx.rect(x, y, barW, barH);
      ctx.fill();
    }
  };

  window.MPVisualizer = Visualizer;
})(window);
