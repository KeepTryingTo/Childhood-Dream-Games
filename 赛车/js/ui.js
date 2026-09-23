/* ============================================================
 * ui.js —— Canvas 渲染 / 镜头跟随 / 轮胎痕迹 / 小地图 / 音效
 *          （浏览器专用，不参与单元测试）
 *
 * 渲染层：
 *   - 矢量赛道：草底 → 红白路缘 → 沥青路面 → 中线 → 起点格纹
 *   - 车辆：旋转绘制（车身 / 座舱 / 轮子 / 氮气尾焰 / 玩家光圈）
 *   - 轮胎痕迹：侧滑超阈值时落点，随时间淡出
 *   - 镜头：跟随 + 速度方向前瞻 + 变焦（指数平滑防抖动）
 *   - 小地图：右上角轨迹缩略 + 实时车点
 *
 * 音效（Web Audio 合成）：引擎声随速度变调、碰撞、氮气、过线提示
 * ============================================================ */
(function (window) {
  'use strict';

  var T = window.Track;
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  /* ================= 音效 ================= */
  var Sound = {
    ctx: null, master: null, engineNodes: null, enabled: true,

    ensure: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        // 引擎：锯齿波 + 低通
        var osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        var osc2 = this.ctx.createOscillator();
        osc2.type = 'square';
        var lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        var g = this.ctx.createGain();
        g.gain.value = 0;
        osc.connect(lp); osc2.connect(lp);
        lp.connect(g); g.connect(this.master);
        osc.start(); osc2.start();
        this.engineNodes = { osc: osc, osc2: osc2, gain: g, lp: lp };
      } catch (e) { this.ctx = null; }
    },

    setEnabled: function (on) {
      this.enabled = on;
      if (this.master) this.master.gain.value = on ? 0.5 : 0;
    },

    /** 每帧调用：speed 单位 m/s */
    setEngine: function (speed, nitro) {
      if (!this.ctx || !this.engineNodes) return;
      var t = this.ctx.currentTime;
      var f = 55 + speed * 4.2 + (nitro ? 40 : 0);
      this.engineNodes.osc.frequency.setTargetAtTime(f, t, 0.05);
      this.engineNodes.osc2.frequency.setTargetAtTime(f / 2, t, 0.05);
      this.engineNodes.lp.frequency.setTargetAtTime(500 + speed * 22, t, 0.1);
      var vol = speed > 0.5 ? 0.05 + clamp(speed / 55, 0, 1) * 0.09 : 0.03;
      this.engineNodes.gain.gain.setTargetAtTime(vol, t, 0.1);
    },

    _noise: function (dur, freq, q, vol) {
      if (!this.ctx) return;
      var ctx = this.ctx;
      var len = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      var g = ctx.createGain(); g.gain.value = vol;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start();
    },

    crash: function () { this._noise(0.25, 250, 0.8, 0.5); },
    skid: function () { this._noise(0.12, 900, 2, 0.08); },
    nitroBurst: function () { this._noise(0.4, 1800, 1.2, 0.25); },

    beep: function (freq, dur, vol) {
      if (!this.ctx) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.12));
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + (dur || 0.12) + 0.02);
    },
    lapBeep: function () { this.beep(880, 0.1); var s = this; setTimeout(function () { s.beep(1320, 0.15); }, 110); },
    finishJingle: function () {
      var s = this, seq = [523, 659, 784, 1047];
      seq.forEach(function (f, i) { setTimeout(function () { s.beep(f, 0.18, 0.18); }, i * 140); });
    },
    countdownBeep: function (final) { this.beep(final ? 1200 : 600, final ? 0.35 : 0.15, 0.2); }
  };

  /* ================= 渲染器 ================= */
  function RaceUI(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0; this.h = 0;

    // 镜头状态
    this.camX = 0; this.camY = 0;
    this.zoom = 4;
    this.baseZoom = 4.4;
    this.camInit = false;

    // 痕迹
    this.skids = [];            // {x, y, angle, life}
    this.MAX_SKIDS = 900;

    // 碰撞闪烁计时
    this.hitFlash = 0;

    this.resize();
    var self = this;
    if (window.addEventListener) {
      window.addEventListener('resize', function () { self.resize(); });
    }
  }

  RaceUI.prototype.resize = function () {
    var parent = this.canvas.parentElement || document.body;
    var rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(200, rect.width);
    this.h = Math.max(200, rect.height);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  };

  /* ---------------- 镜头更新 ---------------- */
  RaceUI.prototype._updateCamera = function (game, dt) {
    var p = game.cars[0];
    var speed = p.speed || 0;
    // 前瞻：速度方向偏移（低通平滑）
    var lookX = p.x + p.vx * 0.55;
    var lookY = p.y + p.vy * 0.55;
    var targetZoom = this.baseZoom * (1 - clamp(speed / 55, 0, 1) * 0.32);

    if (!this.camInit) {
      this.camX = p.x; this.camY = p.y;
      this.zoom = targetZoom;
      this.camInit = true;
    }
    var k = 1 - Math.exp(-dt * 4.5);      // 帧率无关的指数平滑
    this.camX += (lookX - this.camX) * k;
    this.camY += (lookY - this.camY) * k;
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-dt * 2));
  };

  /* ---------------- 主渲染 ---------------- */
  RaceUI.prototype.render = function (game, dtSec) {
    var ctx = this.ctx;
    this._updateCamera(game, dtSec || 1 / 60);
    var zoom = this.zoom;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#1a4a2e';            // 草地
    ctx.fillRect(0, 0, this.w, this.h);

    // 世界 → 屏幕变换
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camX, -this.camY);

    this._drawTrack(ctx, game.track);
    this._drawStartLine(ctx, game.track);
    this._updateSkids(game, dtSec || 1 / 60);
    this._drawSkids(ctx);
    this._drawCars(ctx, game);

    // 小地图（屏幕坐标）
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._drawMinimap(ctx, game);
  };

  /* ---------------- 赛道 ---------------- */
  RaceUI.prototype._trackPath = function (ctx, track) {
    var pts = track.pts, n = pts.length;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < n; i += 2) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  };

  RaceUI.prototype._drawTrack = function (ctx, track) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // 1) 路缘底色（红）
    this._trackPath(ctx, track);
    ctx.strokeStyle = '#d94848';
    ctx.lineWidth = track.width + 3;
    ctx.stroke();
    // 2) 白色 dash 叠加 → 红白相间
    ctx.strokeStyle = '#f1f3f5';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 3) 沥青路面（盖住中间，只露两侧路缘）
    this._trackPath(ctx, track);
    ctx.strokeStyle = '#3b3f46';
    ctx.lineWidth = track.width;
    ctx.stroke();
    // 4) 中心虚线
    this._trackPath(ctx, track);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.35;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  RaceUI.prototype._drawStartLine = function (ctx, track) {
    var p = track.pointAtS(0);
    var nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    var half = track.halfWidth;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    // 2×8 格纹，格宽 = 赛道宽/8，格高 1.2m
    var cols = 8, cw = (half * 2) / cols, ch = 1.2;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f8f9fa' : '#212529';
        ctx.fillRect(-half + c * cw, r * ch - ch, cw, ch);
      }
    }
    ctx.restore();
  };

  /* ---------------- 轮胎痕迹 ---------------- */
  RaceUI.prototype._updateSkids = function (game, dt) {
    // 侧滑超阈值 → 两侧后轮落痕
    var i, cars = game.cars;
    for (i = 0; i < cars.length; i++) {
      var c = cars[i];
      if ((c.slide || 0) > 6.5 && (c.speed || 0) > 8) {
        var cosA = Math.cos(c.angle), sinA = Math.sin(c.angle);
        // 后轴两侧（后 1.5m，横 ±0.9m）
        var bx = c.x - cosA * 1.5, by = c.y - sinA * 1.5;
        this.skids.push({ x: bx - (-sinA) * 0.9, y: by - cosA * 0.9, angle: c.angle, life: 1 });
        this.skids.push({ x: bx + (-sinA) * 0.9, y: by + cosA * 0.9, angle: c.angle, life: 1 });
      }
    }
    // 衰减与裁剪
    for (i = 0; i < this.skids.length; i++) this.skids[i].life -= dt * 0.14;
    while (this.skids.length > this.MAX_SKIDS) this.skids.shift();
    while (this.skids.length && this.skids[0].life <= 0) this.skids.shift();
  };

  RaceUI.prototype._drawSkids = function (ctx) {
    ctx.save();
    ctx.strokeStyle = '#212529';
    ctx.lineCap = 'round';
    for (var i = 0; i < this.skids.length; i++) {
      var s = this.skids[i];
      if (s.life <= 0) continue;
      ctx.globalAlpha = clamp(s.life, 0, 1) * 0.5;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      var cosA = Math.cos(s.angle), sinA = Math.sin(s.angle);
      ctx.moveTo(s.x - cosA * 0.9, s.y - sinA * 0.9);
      ctx.lineTo(s.x + cosA * 0.9, s.y + sinA * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------------- 车辆 ---------------- */
  RaceUI.prototype._drawCars = function (ctx, game) {
    for (var i = 0; i < game.cars.length; i++) {
      var c = game.cars[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);

      // 玩家光圈
      if (!c.isAI) {
        ctx.beginPath();
        ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }

      // 氮气尾焰
      if (c.nitroActive) {
        var flame = 2.2 + Math.random() * 1.6;
        ctx.beginPath();
        ctx.moveTo(-2.3, -0.55);
        ctx.lineTo(-2.3 - flame, 0);
        ctx.lineTo(-2.3, 0.55);
        ctx.closePath();
        ctx.fillStyle = Math.random() > 0.5 ? '#4dabf7' : '#a5d8ff';
        ctx.fill();
      }

      // 轮子
      ctx.fillStyle = '#212529';
      ctx.fillRect(-1.6, -1.35, 1.0, 0.55);   // 左后
      ctx.fillRect(-1.6, 0.8, 1.0, 0.55);     // 右后
      ctx.fillRect(0.75, -1.35, 0.85, 0.55);  // 左前
      ctx.fillRect(0.75, 0.8, 0.85, 0.55);    // 右前

      // 车身（圆角矩形近似）
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(-2.2, -1.05);
      ctx.lineTo(1.5, -0.9);
      ctx.quadraticCurveTo(2.5, -0.55, 2.5, 0);
      ctx.quadraticCurveTo(2.5, 0.55, 1.5, 0.9);
      ctx.lineTo(-2.2, 1.05);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.18;
      ctx.stroke();

      // 座舱
      ctx.fillStyle = 'rgba(20,22,26,0.85)';
      ctx.beginPath();
      ctx.moveTo(-0.9, -0.62);
      ctx.lineTo(0.8, -0.5);
      ctx.lineTo(0.8, 0.5);
      ctx.lineTo(-0.9, 0.62);
      ctx.closePath();
      ctx.fill();

      // 碰撞闪烁
      if (c.hit) {
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,220,80,0.8)';
        ctx.lineWidth = 0.35;
        ctx.stroke();
        c.hit = false;
      }

      ctx.restore();
    }
  };

  /* ---------------- 小地图 ---------------- */
  RaceUI.prototype._drawMinimap = function (ctx, game) {
    var track = game.track;
    var mw = 150, mh = 105, pad = 10;
    var ox = this.w - mw - pad, oy = pad;
    var sx = mw / track.W, sy = mh / track.H;
    var sc = Math.min(sx, sy);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(15,23,32,0.75)';
    ctx.fillRect(ox, oy, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, mw, mh);

    // 轨迹
    ctx.beginPath();
    var pts = track.pts, n = pts.length;
    for (var i = 0; i < n; i += 4) {
      var px = ox + mw / 2 + pts[i].x * sc;
      var py = oy + mh / 2 + pts[i].y * sc;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 车点
    for (i = 0; i < game.cars.length; i++) {
      var c = game.cars[i];
      ctx.beginPath();
      ctx.arc(ox + mw / 2 + c.x * sc, oy + mh / 2 + c.y * sc, c.isAI ? 2.4 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      if (!c.isAI) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  window.RaceUI = RaceUI;
  window.RaceSound = Sound;
})(window);
