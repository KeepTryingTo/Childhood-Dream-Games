/* ============================================================
 * ui.js —— Canvas 渲染 / 插值动画 / WebAudio 音效（浏览器专用）
 * 依赖：window.SnakeGame 的数据结构
 * ============================================================ */
(function (window) {
  'use strict';

  /* ---------------- WebAudio 简易音效 ---------------- */
  var Sound = {
    ctx: null, on: true,
    ensure: function () {
      if (!this.on) return null;
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, vol, delay, slideTo) {
      var ac = this.ensure();
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol || 0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    eat: function ()     { this.tone(880, 0.09, 'square', 0.15); },
    special: function () { this.tone(660, 0.1, 'triangle', 0.2); this.tone(990, 0.12, 'triangle', 0.2, 0.09); },
    die: function ()     { this.tone(330, 0.5, 'sawtooth', 0.22, 0, 60); },
    win: function ()     { var s = this; [523, 659, 784, 1046].forEach(function (f, i) { s.tone(f, 0.16, 'triangle', 0.22, i * 0.13); }); }
  };

  /* ---------------- 调色板 ---------------- */
  var COLORS = {
    bg: '#f3e2c0', grid: 'rgba(93,64,55,.12)', border: '#5d4037',
    food: '#e53935', foodShine: '#ff8a80',
    obstacle: '#6d4c41', obstacleDark: '#4e342e',
    snake1: { head: '#66bb6a', body: '#2e7d32', dark: '#1b5e20' },
    snake2: { head: '#42a5f5', body: '#1565c0', dark: '#0d47a1' },
    special: { bonus: '#f9a825', slow: '#039be5', shrink: '#8e24aa' },
    specialText: { bonus: '分', slow: '慢', shrink: '缩' }
  };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function SnakeUI(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = 24;
    this.W = 0; this.H = 0;
    this.dpr = 1;
    this.prevBodies = null;   // 上一逻辑帧蛇身快照（插值用）
  }

  /** 按棋盘尺寸设置画布（含高分屏适配） */
  SnakeUI.prototype.setup = function (game) {
    var target = 660;
    this.cell = Math.max(16, Math.floor(target / game.cols));
    var w = this.cell * game.cols, h = this.cell * game.rows;
    this.W = w; this.H = h;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.aspectRatio = w + ' / ' + h;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.prevBodies = null;
  };

  /** tick 前调用：保存蛇身快照用于平滑插值 */
  SnakeUI.prototype.capturePrev = function (game) {
    this.prevBodies = game.snakes.map(function (s) {
      return s.body.map(function (p) { return { r: p.r, c: p.c }; });
    });
  };

  SnakeUI.prototype.render = function (game, alpha) {
    var ctx = this.ctx, cell = this.cell;
    var W = this.W, H = this.H;
    if (alpha === undefined) alpha = 0;

    // 背景 + 网格
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 1; c < game.cols; c++) { ctx.moveTo(c * cell, 0); ctx.lineTo(c * cell, H); }
    for (var r = 1; r < game.rows; r++) { ctx.moveTo(0, r * cell); ctx.lineTo(W, r * cell); }
    ctx.stroke();

    // 障碍
    ctx.fillStyle = COLORS.obstacle;
    game.obstacles.forEach(function (k) {
      var parts = k.split(',');
      var x = +parts[1] * cell, y = +parts[0] * cell;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.fillStyle = COLORS.obstacleDark;
      ctx.fillRect(x + cell * 0.2, y + cell * 0.55, cell * 0.6, cell * 0.12);
      ctx.fillRect(x + cell * 0.2, y + cell * 0.3, cell * 0.6, cell * 0.12);
      ctx.fillStyle = COLORS.obstacle;
    });

    // 普通食物（红苹果）
    if (game.food) {
      var fx = game.food.c * cell, fy = game.food.r * cell;
      ctx.fillStyle = COLORS.food;
      ctx.beginPath();
      ctx.arc(fx + cell / 2, fy + cell / 2, cell * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.foodShine;
      ctx.beginPath();
      ctx.arc(fx + cell * 0.4, fy + cell * 0.4, cell * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx + cell / 2, fy + cell * 0.18);
      ctx.lineTo(fx + cell / 2 + 3, fy + cell * 0.05);
      ctx.stroke();
    }

    // 特殊食物（限时）
    if (game.specialFood) {
      var sf = game.specialFood;
      var sx = sf.c * cell, sy = sf.r * cell;
      var blink = ((game.tickCount - sf.born) % 10) < 6 ? 1 : 0.35;   // 临期闪烁
      ctx.globalAlpha = blink;
      ctx.fillStyle = COLORS.special[sf.type] || '#f9a825';
      this.roundRect(ctx, sx + 3, sy + 3, cell - 6, cell - 6, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.floor(cell * 0.5) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(COLORS.specialText[sf.type] || '?', sx + cell / 2, sy + cell / 2 + 1);
      ctx.globalAlpha = 1;
    }

    // 蛇（双人两色）
    var self = this;
    game.snakes.forEach(function (s, idx) {
      if (!s.alive && game.status === 'over') {
        // 死蛇半透明绘制
        ctx.globalAlpha = 0.35;
      }
      self.drawSnake(ctx, game, s, idx, alpha, cell);
      ctx.globalAlpha = 1;
    });
  };

  SnakeUI.prototype.drawSnake = function (ctx, game, s, idx, alpha, cell) {
    var pal = idx === 0 ? COLORS.snake1 : COLORS.snake2;
    var prev = this.prevBodies && this.prevBodies[idx] ? this.prevBodies[idx] : null;
    var body = s.body;
    var pad = Math.max(1.5, cell * 0.06);
    var radius = Math.max(3, cell * 0.28);

    var posAt = function (i) {
      var p = body[i];
      if (!prev || alpha <= 0 || i >= prev.length) return { r: p.r, c: p.c };
      var q = prev[i];
      // 穿墙跳变不插值
      if (Math.abs(p.r - q.r) > 1 || Math.abs(p.c - q.c) > 1) return { r: p.r, c: p.c };
      return { r: lerp(q.r, p.r, alpha), c: lerp(q.c, p.c, alpha) };
    };

    // 身体（从尾到头画，头在最上层）
    for (var i = body.length - 1; i >= 1; i--) {
      var p = posAt(i);
      var t = 1 - i / body.length;          // 越靠头越亮
      ctx.fillStyle = t > 0.5 ? pal.body : pal.dark;
      this.roundRect(ctx, p.c * cell + pad, p.r * cell + pad, cell - pad * 2, cell - pad * 2, radius);
      ctx.fill();
    }

    // 头
    var h = posAt(0);
    var hx = h.c * cell, hy = h.r * cell;
    var grad = ctx.createRadialGradient(hx + cell * 0.35, hy + cell * 0.35, 2, hx + cell / 2, hy + cell / 2, cell * 0.6);
    grad.addColorStop(0, pal.head);
    grad.addColorStop(1, pal.body);
    ctx.fillStyle = grad;
    this.roundRect(ctx, hx + pad - 0.5, hy + pad - 0.5, cell - pad * 2 + 1, cell - pad * 2 + 1, radius + 1);
    ctx.fill();

    // 眼睛（头部沿方向前移，两眼垂直于方向分布）
    var d = s.dir;
    var eyeR = Math.max(1.6, cell * 0.09);
    var fx = hx + cell / 2 + d.c * cell * 0.16;   // 眼睛中心前移
    var fy = hy + cell / 2 + d.r * cell * 0.16;
    var off = cell * 0.17;                        // 垂直偏移量
    var eyeOffsets = d.r !== 0
      ? [[-off, 0], [off, 0]]                    // 上下方向：左右分布
      : [[0, -off], [0, off]];                   // 左右方向：上下分布
    eyeOffsets.forEach(function (o) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(fx + o[0], fy + o[1], eyeR + 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212121';
      ctx.beginPath();
      ctx.arc(fx + o[0], fy + o[1], eyeR, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  SnakeUI.prototype.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /* ---------------- 触摸滑动方向检测 ---------------- */
  SnakeUI.prototype.swipeDirection = function (startX, startY, endX, endY) {
    var dx = endX - startX, dy = endY - startY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { r: 0, c: 1 } : { r: 0, c: -1 };
    return dy > 0 ? { r: 1, c: 0 } : { r: -1, c: 0 };
  };

  window.SnakeUI2 = {
    SnakeUI: SnakeUI,
    Sound: Sound,
    COLORS: COLORS
  };
})(window);
