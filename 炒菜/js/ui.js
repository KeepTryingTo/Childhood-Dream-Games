/* ============================================================
 * ui.js —— Canvas 渲染（v3.0：小人化角色 / 装修主题 / 季节粒子 /
 *          环境事件特效）+ Web Audio 音效
 * ============================================================ */
(function (window) {
  'use strict';

  var D = window.KitchenData;
  var ST = D.STATIONS;
  var TABLES = D.TABLES;

  /* ================= 音效 ================= */
  var Sound = {
    ctx: null, master: null, enabled: true, lastStir: 0,

    ensure: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    setEnabled: function (on) {
      this.enabled = on;
      if (this.master) this.master.gain.value = on ? 0.35 : 0;
    },
    _tone: function (freq, dur, type, vol, slideTo) {
      if (!this.ctx) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
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
    chop: function () { this._noise(0.12, 1600, 1.5, 0.3); },
    stir: function () {
      var now = Date.now();
      if (now - this.lastStir < 250) return;
      this.lastStir = now;
      this._noise(0.2, 2400, 0.8, 0.14);
    },
    serve: function () { this._tone(784, 0.1, 'square', 0.1); this._tone(1046, 0.16, 'square', 0.1); },
    paid: function () { this._tone(988, 0.08, 'sine', 0.12); this._tone(1319, 0.14, 'sine', 0.12); },
    angry: function () { this._tone(330, 0.2, 'sawtooth', 0.12, 200); },
    order: function () { this._tone(587, 0.08, 'sine', 0.1); this._tone(784, 0.1, 'sine', 0.1); },
    washed: function () { this._tone(880, 0.1, 'sine', 0.1); },
    burnt: function () { this._tone(160, 0.4, 'sawtooth', 0.12, 80); },
    urge: function () { this._tone(660, 0.07, 'square', 0.09); this._tone(880, 0.07, 'square', 0.09); },
    customerIn: function () { this._tone(523, 0.07, 'triangle', 0.09); },
    /* v3.0 新增 */
    achievement: function () {
      var s = this, seq = [659, 784, 988, 1319];
      seq.forEach(function (f, i) { setTimeout(function () { s._tone(f, 0.22, 'triangle', 0.14); }, i * 110); });
    },
    alertEvent: function () { this._tone(220, 0.15, 'square', 0.13); this._tone(180, 0.2, 'square', 0.11); },
    eventFixed: function () { this._tone(523, 0.09, 'sine', 0.12); this._tone(659, 0.14, 'sine', 0.12); },
    season: function () { this._tone(880, 0.3, 'sine', 0.1, 1320); },
    closeDay: function () { var s = this; [784, 659, 523].forEach(function (f, i) { setTimeout(function () { s._tone(f, 0.25, 'triangle', 0.14); }, i * 160); }); }
  };

  /* ================= 渲染器 ================= */
  var SKINS = ['#ffd8b1', '#f5c99b', '#e8b98a', '#c98d5f'];     // 肤色
  var HAIRS = ['#3d2f23', '#5c4a3a', '#2b2b2b', '#7a5230'];

  function KitchenUI(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.scale = 1;
    this.floats = [];
    this.sparks = [];
    this.particles = [];            // v3.0 季节粒子
    this._walk = {};                // v3.0 走路相位（按实体 key）
    this._look = {};                // 外观（肤/发色，按实体 key 稳定随机）
    this.resize();
    var self = this;
    if (window.addEventListener) {
      window.addEventListener('resize', function () { self.resize(); });
    }
  }

  KitchenUI.prototype.resize = function () {
    var parent = this.canvas.parentElement || document.body;
    var rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(320, rect.width);
    this.h = Math.max(280, rect.height);
    this.scale = Math.min(this.w / D.WORLD.w, this.h / D.WORLD.h);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  };

  KitchenUI.prototype.toScreen = function (x, y) {
    return {
      x: (x - D.WORLD.w / 2) * this.scale + this.w / 2,
      y: (y - D.WORLD.h / 2) * this.scale + this.h / 2
    };
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* ---------------- 主渲染 ---------------- */
  KitchenUI.prototype.render = function (sim, dtSec) {
    var ctx = this.ctx;
    dtSec = dtSec || 1 / 60;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._drawFloor(ctx, sim);
    this._drawTables(ctx, sim);
    this._drawStations(ctx, sim);
    this._drawPotDetail(ctx, sim);
    this._updateSeasonParticles(sim, dtSec);
    this._drawSeasonParticles(ctx);
    this._drawCustomers(ctx, sim);
    this._drawStaff(ctx, sim);
    this._drawEnvEvent(ctx, sim);
    this._updateParticles(dtSec);
    this._drawParticles(ctx);
    this._consumeEvents(sim);
  };

  /* ---------------- 地板：主题装修 + 季节色调 ---------------- */
  KitchenUI.prototype._drawFloor = function (ctx, sim) {
    var sc = this.scale;
    var theme = D.THEMES[(sim.skin && sim.skin.theme) || 'warm'] || D.THEMES.warm;
    var season = D.SEASONS[sim.season || 0];
    var ox = (this.w - D.WORLD.w * sc) / 2;
    var oy = (this.h - D.WORLD.h * sc) / 2;
    // 餐厅地板：季节色调
    ctx.fillStyle = season.floorA;
    ctx.fillRect(ox, oy, 620 * sc, D.WORLD.h * sc);
    // 餐厅木纹条
    ctx.fillStyle = season.floorB;
    for (var r = 0; r < 14; r++) ctx.fillRect(ox, oy + r * 48 * sc + 24 * sc, 620 * sc, 2 * sc);
    // 厨房格砖：主题色
    var s = 48 * sc;
    var kx = ox + 620 * sc;
    var kw = (D.WORLD.w - 620) * sc;
    for (var rr = 0; rr < Math.ceil(D.WORLD.h * sc / s); rr++) {
      for (var c = 0; c < Math.ceil(kw / s); c++) {
        ctx.fillStyle = (rr + c) % 2 ? theme.kitchenA : theme.kitchenB;
        ctx.fillRect(kx + c * s, oy + rr * s, s, s);
      }
    }
    // 隔断（v3.1：三段墙 + 两扇门）
    ctx.fillStyle = theme.wall;
    D.WALL.segments.forEach(function (seg) {
      ctx.fillRect(ox + seg.x * sc, oy + seg.y * sc, seg.w * sc, seg.h * sc);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    D.WALL.segments.forEach(function (seg) {
      ctx.fillRect(ox + (seg.x + 4) * sc, oy + seg.y * sc, 3 * sc, seg.h * sc);
    });
    // 两扇门（缺口处画门框、双开页、地垫、门名）
    D.WALL.gaps.forEach(function (g) {
      var gy = oy + g.from * sc, gh = (g.to - g.from) * sc, gx = ox + D.WALL.x * sc, gw = D.WALL.w * sc;
      // 地垫
      ctx.fillStyle = 'rgba(120,90,60,0.28)';
      ctx.fillRect(gx - 14 * sc, gy, (gw + 28) * sc, gh);
      // 门框
      ctx.strokeStyle = '#5c4432';
      ctx.lineWidth = 3 * sc;
      ctx.strokeRect(gx - 2 * sc, gy - 1 * sc, gw + 4 * sc, gh + 2 * sc);
      // 双开页（上下两扇，开向缺口内）
      ctx.fillStyle = '#8d6e4f';
      ctx.fillRect(gx + 1 * sc, gy + 2 * sc, gw - 2 * sc, gh * 0.42);
      ctx.fillRect(gx + 1 * sc, gy + gh * 0.58, gw - 2 * sc, gh * 0.42 - 2 * sc);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(gx + 3 * sc, gy + 4 * sc, gw - 6 * sc, 2 * sc);
      // 门名
      ctx.font = Math.floor(10 * sc) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5c4432';
      ctx.fillText(g.name, gx + gw / 2, gy + gh / 2 + 3 * sc);
    });
    // 区域标签 + 季节/节日横幅
    ctx.font = 'bold ' + Math.floor(14 * sc) + 'px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(120,90,60,0.5)';
    ctx.fillText('· 餐厅', ox + 10 * sc, oy + 22 * sc);
    ctx.fillStyle = 'rgba(70,90,110,0.5)';
    ctx.fillText('· 厨房', ox + 640 * sc, oy + 22 * sc);
    // 顶部横幅：季节 + 节日
    var banner = season.emoji + ' ' + season.label;
    if (sim.festival) banner = sim.festival.emoji + ' ' + sim.festival.name + '特惠 · ' + banner;
    ctx.textAlign = 'center';
    ctx.font = Math.floor(13 * sc) + 'px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(90,70,45,0.55)';
    ctx.fillText(banner, ox + 310 * sc, oy + 22 * sc);
  };

  /* ---------------- 餐桌与椅子 ---------------- */
  KitchenUI.prototype._drawTables = function (ctx, sim) {
    var sc = this.scale;
    var theme = D.THEMES[(sim.skin && sim.skin.theme) || 'warm'] || D.THEMES.warm;
    // 找每桌在座顾客（决定哪把椅子被占用）
    var seatTaken = {};
    sim.customers.forEach(function (c) {
      if (c.state !== 'entering' && c.state !== 'leaving' && c.state !== 'angry') {
        seatTaken[c.tableId + '_' + c.seatIdx] = c.id;
      }
    });
    for (var i = 0; i < TABLES.length; i++) {
      var t = TABLES[i];
      var p = this.toScreen(t.x, t.y);
      // 椅子 ×4（v3.1）：座面 + 靠背（朝向桌心）
      for (var si = 0; si < D.SEAT_OFFSETS.length; si++) {
        var off = D.SEAT_OFFSETS[si];
        var cp = this.toScreen(t.x + off.dx, t.y + off.dy);
        var taken = seatTaken[t.id + '_' + si];
        // 靠背在椅子外侧（远离桌心一侧）
        var bw = 18 * sc, bh = 5 * sc;                     // 横放靠背
        var vertical = Math.abs(off.dy) > 0;               // 上/下座位：靠背横条
        ctx.fillStyle = taken ? theme.tableEdge : '#b99b72';
        if (vertical) {
          var backY = off.dy < 0 ? cp.y - 10 * sc : cp.y + 6 * sc;
          roundRect(ctx, cp.x - bw / 2, backY, bw, bh, 2 * sc);
          ctx.fill();
          roundRect(ctx, cp.x - 9 * sc, cp.y - 5 * sc, 18 * sc, 11 * sc, 3 * sc);   // 座面
          ctx.fillStyle = taken ? '#d9b98c' : '#cdb48f';
          ctx.fill();
        } else {
          var backX = off.dx < 0 ? cp.x - 10 * sc : cp.x + 6 * sc;
          roundRect(ctx, backX, cp.y - bh / 2, bh, bw, 2 * sc);
          ctx.fill();
          roundRect(ctx, cp.x - 5 * sc, cp.y - 9 * sc, 11 * sc, 18 * sc, 3 * sc);
          ctx.fillStyle = taken ? '#d9b98c' : '#cdb48f';
          ctx.fill();
        }
      }
      // 桌面
      ctx.beginPath();
      ctx.arc(p.x, p.y, 38 * sc, 0, Math.PI * 2);
      ctx.fillStyle = t.dirty ? '#c9b080' : theme.table;
      ctx.fill();
      ctx.lineWidth = 3 * sc;
      ctx.strokeStyle = theme.tableEdge;
      ctx.stroke();
      // 桌布纹样（主题点缀）
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22 * sc, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 * sc;
      ctx.stroke();
      ctx.font = Math.floor(11 * sc) + 'px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(90,60,30,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText((t.id + 1) + '号桌', p.x, p.y + 52 * sc);

      if (t.dirty) {
        ctx.font = Math.floor(20 * sc) + 'px serif';
        ctx.fillText('🥢', p.x, p.y + 2 * sc);
      }
      var eating = null, waiting = null;
      for (var j = 0; j < sim.customers.length; j++) {
        var cu = sim.customers[j];
        if (cu.tableId !== t.id) continue;
        if (cu.state === 'eating') eating = cu;
        if (cu.state === 'waiting' || cu.state === 'seated') waiting = cu;
      }
      if (eating) {
        ctx.font = Math.floor(20 * sc) + 'px serif';
        var served = 0;
        for (var k = 0; k < eating.orderIds.length; k++) {
          var o = null;
          for (var m = 0; m < sim.orders.length; m++) if (sim.orders[m].id === eating.orderIds[k]) o = sim.orders[m];
          if (o && o.state === 'served') {
            ctx.fillText(D.recipeById(o.recipeId).emoji, p.x - 14 * sc + served * 28 * sc, p.y + 2 * sc);
            served++;
          }
        }
      }
      if (waiting && waiting.state === 'waiting') {
        var bx = p.x, by = p.y - 58 * sc;
        ctx.beginPath();
        ctx.arc(bx, by, 17 * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.strokeStyle = waiting.type === 'vip' ? '#f59f00' : '#adb5bd';
        ctx.lineWidth = 2 * sc;
        ctx.stroke();
        var firstOrder = null;
        for (k = 0; k < sim.orders.length; k++) if (sim.orders[k].customerId === waiting.id) { firstOrder = sim.orders[k]; break; }
        ctx.font = Math.floor(15 * sc) + 'px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (firstOrder) ctx.fillText(D.recipeById(firstOrder.recipeId).emoji, bx, by);
        if (waiting.orderIds.length > 1) {
          ctx.font = 'bold ' + Math.floor(10 * sc) + 'px sans-serif';
          ctx.fillStyle = '#e8590c';
          ctx.fillText('×' + waiting.orderIds.length, bx + 12 * sc, by - 10 * sc);
        }
        var ratio = Math.max(0, waiting.patienceMs / waiting.maxPatienceMs);
        ctx.beginPath();
        ctx.arc(bx, by, 21 * sc, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.strokeStyle = ratio > 0.5 ? '#51cf66' : (ratio > 0.25 ? '#ffd43b' : '#ff6b6b');
        ctx.lineWidth = 3.5 * sc;
        ctx.stroke();
        ctx.textBaseline = 'alphabetic';
        if (waiting.type !== 'normal') {
          ctx.font = Math.floor(11 * sc) + 'px serif';
          ctx.fillText(D.CUSTOMERS[waiting.type].emoji, bx - 20 * sc, by - 14 * sc);
        }
      }
    }
  };

  /* ---------------- 厨房设施 ---------------- */
  KitchenUI.prototype._drawStations = function (ctx, sim) {
    var sc = this.scale;
    var theme = D.THEMES[(sim.skin && sim.skin.theme) || 'warm'] || D.THEMES.warm;
    var self = this;
    Object.keys(ST).forEach(function (k) {
      var st = ST[k];
      var p = self.toScreen(st.x, st.y);
      var w = st.w * sc, h = st.h * sc;
      ctx.fillStyle = '#c9b896';
      roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 9 * sc);
      ctx.fill();
      ctx.lineWidth = 2 * sc;
      ctx.strokeStyle = '#9a8560';
      ctx.stroke();

      ctx.font = Math.floor(26 * sc) + 'px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(st.emoji, p.x, p.y - 10 * sc);
      ctx.font = Math.floor(11 * sc) + 'px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#5f5138';
      ctx.fillText(st.name, p.x, p.y + h / 2 - 11 * sc);

      if (k === 'plating') {
        ctx.font = Math.floor(11 * sc) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#2b7a3d';
        ctx.fillText('干净盘 ×' + sim.plates, p.x, p.y + h / 2 + 10 * sc);
      }
      if (k === 'prepTable') {
        var txt = [];
        D.INGREDIENTS.forEach(function (ing) {
          if (sim.prepStock[ing.id] > 0) txt.push(ing.emoji + sim.prepStock[ing.id]);
        });
        ctx.font = Math.floor(11 * sc) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#5f5138';
        ctx.fillText(txt.length ? txt.join(' ') : '（空）', p.x, p.y + h / 2 + 10 * sc);
      }
      if (k === 'sink') {
        ctx.font = Math.floor(11 * sc) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#1971c2';
        ctx.fillText(sim.sink.queue > 0 ? '洗涤中 ×' + sim.sink.queue : '空闲', p.x, p.y + h / 2 + 10 * sc);
        if (sim.sink.queue > 0) {
          var prog = 1 - sim.sink.remainMs / sim.cfg.WASH_MS;
          var bw = w * 0.7;
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(p.x - bw / 2, p.y - h / 2 - 6 * sc, bw, 5 * sc);
          ctx.fillStyle = '#4dabf7';
          ctx.fillRect(p.x - bw / 2, p.y - h / 2 - 6 * sc, bw * clamp01(prog), 5 * sc);
        }
      }
      if (k === 'pass') {
        if (sim.readyDishes.length) {
          ctx.font = Math.floor(18 * sc) + 'px serif';
          ctx.fillText(D.recipeById(sim.readyDishes[0].recipeId).emoji, p.x, p.y + 14 * sc);
          if (sim.readyDishes.length > 1) {
            ctx.font = 'bold ' + Math.floor(10 * sc) + 'px sans-serif';
            ctx.fillStyle = '#e8590c';
            ctx.fillText('×' + sim.readyDishes.length, p.x + 14 * sc, p.y + 24 * sc);
          }
        }
      }
      if (k === 'board' && sim.board.phase === 'chopping') {
        var pr = sim.board.progressMs / D.ingById(sim.board.ing).chopMs;
        var bw2 = w * 0.7;
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(p.x - bw2 / 2, p.y - h / 2 - 6 * sc, bw2, 5 * sc);
        ctx.fillStyle = '#51cf66';
        ctx.fillRect(p.x - bw2 / 2, p.y - h / 2 - 6 * sc, bw2 * clamp01(pr), 5 * sc);
      }
    });
  };

  /* ---------------- 灶台火候环 ---------------- */
  KitchenUI.prototype._drawPotDetail = function (ctx, sim) {
    var pot = sim.pot;
    var st = ST.stove;
    var p = this.toScreen(st.x, st.y + st.h / 2 + 18);
    var R = 24 * this.scale;
    var sc = this.scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, R + 5 * sc, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40,35,28,0.7)';
    ctx.fill();
    if (pot.phase === 'empty') { ctx.restore(); return; }

    ctx.font = Math.floor(12 * sc) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var s = '';
    for (var i = 0; i < pot.ings.length; i++) s += D.ingById(pot.ings[i]).emoji;
    ctx.fillStyle = '#fff';
    ctx.fillText(s, p.x, p.y - R * 0.15);

    if (pot.phase === 'cooking') {
      var pr = clamp01(pot.cookMs / sim.cfg.COOK_MS);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pr);
      ctx.strokeStyle = '#51cf66';
      ctx.lineWidth = 5 * sc;
      ctx.stroke();
    } else if (pot.phase === 'done') {
      var cf = sim.cfg;
      var start = -Math.PI / 2;
      var seg = function (from, to, color) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, start + Math.PI * 2 * from, start + Math.PI * 2 * to);
        ctx.strokeStyle = color;
        ctx.lineWidth = 6 * sc;
        ctx.stroke();
      };
      seg(0, cf.PERFECT_FROM / cf.BURN_MS, '#74c0fc');
      seg(cf.PERFECT_FROM / cf.BURN_MS, cf.PERFECT_TO / cf.BURN_MS, '#ffd43b');
      seg(cf.PERFECT_TO / cf.BURN_MS, 1, '#74c0fc');
      var pos = clamp01(pot.doneMs / cf.BURN_MS);
      var ang = start + Math.PI * 2 * pos;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(ang) * (R - 8 * sc), p.y + Math.sin(ang) * (R - 8 * sc));
      ctx.lineTo(p.x + Math.cos(ang) * (R + 8 * sc), p.y + Math.sin(ang) * (R + 8 * sc));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * sc;
      ctx.stroke();
    } else if (pot.phase === 'burnt') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = '#e03131';
      ctx.lineWidth = 6 * sc;
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ================= v3.0 小人绘制 ================= */
  /** 稳定随机外观（同一实体每次刷新不变） */
  KitchenUI.prototype._lookOf = function (key, isVip) {
    if (!this._look[key]) {
      var h = 0;
      for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      this._look[key] = {
        skin: SKINS[h % SKINS.length],
        hair: isVip ? '#f1c40f' : HAIRS[h % HAIRS.length]
      };
    }
    return this._look[key];
  };

  /** 走路相位：按移动距离累计，静止归零 */
  KitchenUI.prototype._walkPhase = function (key, x, y, dt) {
    var w = this._walk[key];
    if (!w) w = this._walk[key] = { x: x, y: y, phase: 0 };
    var dx = x - w.x, dy = y - w.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    w.x = x; w.y = y;
    if (d > 0.05) w.phase += d * 0.22;
    else w.phase *= 0.85;
    return w.phase;
  };

  /**
   * 画一个"小人"：头 + 身体 + 双腿摆动 + 双臂摆动 + 帽子/领带
   * opts = { shirt, pants, hat:'chef'|null, tie, apron, facing, phase, scale, skin, hair, angry }
   */
  KitchenUI.prototype._drawPerson = function (ctx, p, opts) {
    var sc = this.scale * (opts.scale || 1);
    var ph = opts.phase || 0;
    var swing = Math.sin(ph) * (opts.moving ? 1 : 0);
    var face = opts.facing >= 0 ? 1 : -1;

    // 影子
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 17 * sc, 13 * sc, 4.5 * sc, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // 腿（裤色，前后交替）
    ctx.strokeStyle = opts.pants;
    ctx.lineWidth = 4 * sc;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - 3.5 * sc, p.y + 6 * sc);
    ctx.lineTo(p.x - 3.5 * sc + swing * 4 * sc, p.y + 15 * sc);
    ctx.moveTo(p.x + 3.5 * sc, p.y + 6 * sc);
    ctx.lineTo(p.x + 3.5 * sc - swing * 4 * sc, p.y + 15 * sc);
    ctx.stroke();

    // 身体（衬衫色圆角矩形）
    roundRect(ctx, p.x - 7.5 * sc, p.y - 6 * sc, 15 * sc, 14 * sc, 5 * sc);
    ctx.fillStyle = opts.shirt;
    ctx.fill();

    // 围裙
    if (opts.apron) {
      roundRect(ctx, p.x - 5 * sc, p.y - 2 * sc, 10 * sc, 10 * sc, 3 * sc);
      ctx.fillStyle = opts.apron;
      ctx.fill();
    }
    // 领带
    if (opts.tie) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4 * sc);
      ctx.lineTo(p.x + 2 * sc, p.y + 2 * sc);
      ctx.lineTo(p.x, p.y + 8 * sc);
      ctx.lineTo(p.x - 2 * sc, p.y + 2 * sc);
      ctx.closePath();
      ctx.fillStyle = opts.tie;
      ctx.fill();
    }

    // 手臂（袖色=衬衫，与腿反相摆动）
    ctx.strokeStyle = opts.shirt;
    ctx.lineWidth = 3.5 * sc;
    ctx.beginPath();
    ctx.moveTo(p.x - 7 * sc, p.y - 3 * sc);
    ctx.lineTo(p.x - 9 * sc - swing * 3.5 * sc, p.y + 4 * sc);
    ctx.moveTo(p.x + 7 * sc, p.y - 3 * sc);
    ctx.lineTo(p.x + 9 * sc + swing * 3.5 * sc, p.y + 4 * sc);
    ctx.stroke();

    // 头（肤色）
    ctx.beginPath();
    ctx.arc(p.x, p.y - 12 * sc, 6.5 * sc, 0, Math.PI * 2);
    ctx.fillStyle = opts.skin || '#ffd8b1';
    ctx.fill();
    // 头发（顶部弧）
    ctx.beginPath();
    ctx.arc(p.x, p.y - 13.5 * sc, 6.5 * sc, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineTo(p.x, p.y - 17 * sc);
    ctx.closePath();
    ctx.fillStyle = opts.hair || '#5c4a3a';
    ctx.fill();
    // 眼睛（朝向）
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.arc(p.x + face * 2.5 * sc, p.y - 12 * sc, 0.9 * sc, 0, Math.PI * 2);
    ctx.arc(p.x + face * 5.5 * sc, p.y - 12 * sc, 0.9 * sc, 0, Math.PI * 2);
    ctx.fill();
    // 生气红晕
    if (opts.angry) {
      ctx.strokeStyle = '#e03131';
      ctx.lineWidth = 1.2 * sc;
      ctx.beginPath();
      ctx.moveTo(p.x + 1 * sc, p.y - 15 * sc);
      ctx.lineTo(p.x + 4 * sc, p.y - 13.5 * sc);
      ctx.moveTo(p.x + 4 * sc, p.y - 15 * sc);
      ctx.lineTo(p.x + 1 * sc, p.y - 13.5 * sc);
      ctx.stroke();
    }

    // 厨师帽（三球）
    if (opts.hat === 'chef') {
      ctx.beginPath();
      ctx.arc(p.x - 4 * sc, p.y - 19 * sc, 3.2 * sc, 0, Math.PI * 2);
      ctx.arc(p.x, p.y - 21 * sc, 4 * sc, 0, Math.PI * 2);
      ctx.arc(p.x + 4 * sc, p.y - 19 * sc, 3.2 * sc, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.fillStyle = '#f1f3f5';
      ctx.fillRect(p.x - 5 * sc, p.y - 19 * sc, 10 * sc, 3 * sc);
    }
  };

  /* ---------------- 顾客（小人，坐姿朝向桌） ---------------- */
  KitchenUI.prototype._drawCustomers = function (ctx, sim) {
    var sc = this.scale;
    for (var i = 0; i < sim.customers.length; i++) {
      var c = sim.customers[i];
      var p = this.toScreen(c.x, c.y);
      var key = 'cust' + c.id;
      var look = this._lookOf(key + c.type, c.type === 'vip');
      var phase = this._walkPhase(key, c.x, c.y, 0);
      var shirt = c.type === 'vip' ? '#ffd43b' : (c.type === 'glutton' ? '#ff8787' : '#a5b4c4');
      // v3.1 坐姿朝向：左右座位面向桌心；上下座位（横排）按 seat 定向
      var off = D.SEAT_OFFSETS[c.seatIdx % D.SEAT_OFFSETS.length];
      var facing = off.dx < 0 ? 1 : (off.dx > 0 ? -1 : 1);
      this._drawPerson(ctx, p, {
        shirt: shirt, pants: '#4a5568',
        facing: facing, phase: phase, scale: 0.92,
        skin: look.skin, hair: look.hair,
        angry: c.state === 'angry'
      });
      var label = '';
      if (c.state === 'entering') label = '找座位';
      else if (c.state === 'paying') label = '付款中';
      if (label) {
        ctx.font = Math.floor(10 * sc) + 'px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(60,50,40,0.75)';
        ctx.fillText(label, p.x, p.y - 30 * sc);
      }
    }
  };

  /* ---------------- 员工（小人 + 名牌 + 手持） ---------------- */
  KitchenUI.prototype._drawStaff = function (ctx, sim) {
    var sc = this.scale;
    var roles = ['prep', 'chef', 'runner', 'manager'];
    for (var i = 0; i < roles.length; i++) {
      var s = sim.staff[roles[i]];
      var p = this.toScreen(s.x, s.y);
      var key = 'staff' + s.role;
      var look = this._lookOf(key, false);
      var phase = this._walkPhase(key, s.x, s.y, 0);

      // 催促光圈
      if (sim.timeMs < s.buffUntilMs) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22 * sc, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(177,151,252,0.7)';
        ctx.lineWidth = 3 * sc;
        ctx.stroke();
      }

      this._drawPerson(ctx, p, {
        shirt: s.role === 'manager' ? '#e9ecef' : '#ffffff',
        pants: '#343a40',
        apron: s.role !== 'manager' ? s.color : null,
        tie: s.role === 'manager' ? '#364fc7' : null,
        hat: s.role !== 'manager' ? 'chef' : null,
        facing: 1, phase: phase,
        skin: look.skin, hair: look.hair
      });

      // 名牌
      ctx.font = Math.floor(10 * sc) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(40,35,30,0.85)';
      ctx.fillText(s.tag + s.name, p.x, p.y + 28 * sc);

      // 手持物
      if (s.hold) {
        ctx.beginPath();
        ctx.arc(p.x, p.y - 36 * sc, 12 * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.strokeStyle = '#adb5bd';
        ctx.lineWidth = 1.5 * sc;
        ctx.stroke();
        ctx.font = Math.floor(15 * sc) + 'px serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._holdIcon(s.hold), p.x, p.y - 36 * sc);
        if (s.hold.quality === 'perfect') {
          ctx.font = Math.floor(9 * sc) + 'px sans-serif';
          ctx.fillStyle = '#f59f00';
          ctx.fillText('★', p.x + 9 * sc, p.y - 44 * sc);
        }
        ctx.textBaseline = 'alphabetic';
      }

      // 工作动画
      if (s.role === 'prep' && s.state === 'chopping') {
        var bob = Math.sin(Date.now() / 60) * 4 * sc;
        ctx.font = Math.floor(14 * sc) + 'px serif';
        ctx.fillText('🔪', p.x - 16 * sc, p.y - 20 * sc + bob);
      }
      if (s.role === 'chef' && (s.state === 'cooking' || s.state === 'waitPerfect')) {
        var bob2 = Math.sin(Date.now() / 90) * 5 * sc;
        ctx.font = Math.floor(14 * sc) + 'px serif';
        ctx.fillText('🥄', p.x + 16 * sc, p.y - 18 * sc + bob2);
      }
      // 经理修事件进度
      if (s.role === 'manager' && s.state === 'fixing' && sim.envEvent) {
        var total = sim.envEvent.type === 'leak' ? D.EVENTS.LEAK.fixMs : D.EVENTS.FIRE.fixMs;
        var pr = 1 - s.timerMs / total;
        var bw = 30 * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(p.x - bw / 2, p.y - 44 * sc, bw, 5 * sc);
        ctx.fillStyle = '#b197fc';
        ctx.fillRect(p.x - bw / 2, p.y - 44 * sc, bw * clamp01(pr), 5 * sc);
      }
    }
  };

  KitchenUI.prototype._holdIcon = function (hold) {
    if (hold.type === 'ing') {
      var ing = D.ingById(hold.id);
      return ing ? ing.emoji : '❓';
    }
    if (hold.type === 'ings') {
      var s = '';
      for (var i = 0; i < hold.ids.length && i < 2; i++) s += D.ingById(hold.ids[i]).emoji;
      return s || '❓';
    }
    if (hold.type === 'dish') return hold.quality === 'burnt' ? '😖' : (D.recipeById(hold.recipeId) || { emoji: '🍳' }).emoji;
    if (hold.type === 'plated') return '🍽️';
    if (hold.type === 'dirty') return '🥢';
    return '❓';
  };

  /* ================= v3.0 环境事件特效 ================= */
  KitchenUI.prototype._drawEnvEvent = function (ctx, sim) {
    var ev = sim.envEvent;
    if (!ev) return;
    var sc = this.scale;
    var p = this.toScreen(ev.x, ev.y);
    if (ev.type === 'rat') {
      var jitter = ev.phase === 'steal' ? Math.sin(Date.now() / 50) * 1.5 * sc : 0;
      // 身体
      ctx.beginPath();
      ctx.ellipse(p.x + jitter, p.y, 9 * sc, 5.5 * sc, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9775fa';
      ctx.fill();
      // 耳朵
      ctx.beginPath();
      ctx.arc(p.x - 6 * sc + jitter, p.y - 4 * sc, 2.5 * sc, 0, Math.PI * 2);
      ctx.fillStyle = '#b197fc';
      ctx.fill();
      // 尾巴
      ctx.strokeStyle = '#6741d9';
      ctx.lineWidth = 1.5 * sc;
      ctx.beginPath();
      ctx.moveTo(p.x + 8 * sc + jitter, p.y);
      ctx.quadraticCurveTo(p.x + 14 * sc, p.y - 4 * sc, p.x + 12 * sc, p.y - 8 * sc);
      ctx.stroke();
      // 眼睛
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x - 8 * sc + jitter, p.y - 1 * sc, 1.2 * sc, 0, Math.PI * 2);
      ctx.fill();
      // 偷取进度
      if (ev.phase === 'steal') {
        ctx.font = Math.floor(10 * sc) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e03131';
        ctx.fillText('偷吃中…', p.x, p.y - 14 * sc);
      }
    } else if (ev.type === 'leak') {
      var R = D.EVENTS.LEAK.radius * sc;
      var t = Date.now() / 400;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, R * (0.4 + 0.3 * i) + Math.sin(t + i) * 4 * sc, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(77,171,247,' + (0.5 - i * 0.13) + ')';
        ctx.lineWidth = 2.5 * sc;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(77,171,247,0.35)';
      ctx.fill();
      ctx.font = Math.floor(13 * sc) + 'px serif';
      ctx.textAlign = 'center';
      ctx.fillText('💧', p.x, p.y - R - 8 * sc);
    } else if (ev.type === 'fire') {
      var flick = Math.sin(Date.now() / 60) * 2 * sc;
      for (var f = 0; f < 3; f++) {
        ctx.beginPath();
        ctx.moveTo(p.x - (10 - f * 3) * sc, p.y + 6 * sc);
        ctx.quadraticCurveTo(p.x - (4 - f) * sc + flick, p.y - (8 + f * 5) * sc, p.x + (10 - f * 3) * sc, p.y + 6 * sc);
        ctx.closePath();
        ctx.fillStyle = ['#e8590c', '#f76707', '#ffd43b'][f];
        ctx.globalAlpha = 0.85;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };

  /* ================= v3.0 季节粒子 ================= */
  KitchenUI.prototype._updateSeasonParticles = function (sim, dt) {
    var want = sim.status === 'playing' ? 18 : 0;
    while (this.particles.length < want) {
      this.particles.push({
        x: Math.random() * 620, y: Math.random() * D.WORLD.h,
        vy: 18 + Math.random() * 22, sway: Math.random() * Math.PI * 2,
        r: 2 + Math.random() * 2.5
      });
    }
    if (this.particles.length > want) this.particles.length = want;
    for (var i = 0; i < this.particles.length; i++) {
      var pt = this.particles[i];
      pt.y += pt.vy * dt;
      pt.sway += dt * 2;
      pt.x += Math.sin(pt.sway) * 12 * dt;
      if (pt.y > D.WORLD.h + 10) { pt.y = -10; pt.x = Math.random() * 620; }
    }
  };

  KitchenUI.prototype._drawSeasonParticles = function (ctx) {
    if (!this.particles.length) return;
    var season = D.SEASONS[this._lastSeason || 0];
    var sc = this.scale;
    for (var i = 0; i < this.particles.length; i++) {
      var pt = this.particles[i];
      var p = this.toScreen(pt.x, pt.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, pt.r * sc, 0, Math.PI * 2);
      ctx.fillStyle = season.particle;
      ctx.globalAlpha = 0.7;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* ---------------- 粒子 / 飘字 ---------------- */
  KitchenUI.prototype._updateParticles = function (dt) {
    var i;
    for (i = this.sparks.length - 1; i >= 0; i--) {
      var sp = this.sparks[i];
      sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      sp.life -= dt * (sp.smoke ? 0.6 : 2);
      if (sp.life <= 0) this.sparks.splice(i, 1);
    }
    for (i = this.floats.length - 1; i >= 0; i--) {
      var f = this.floats[i];
      f.y -= 26 * dt;
      f.life -= dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
  };

  KitchenUI.prototype._drawParticles = function (ctx) {
    for (var i = 0; i < this.sparks.length; i++) {
      var sp = this.sparks[i];
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, (sp.r || 3) * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = sp.color || '#ffd43b';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (var j = 0; j < this.floats.length; j++) {
      var f = this.floats[j];
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  };

  KitchenUI.prototype._float = function (x, y, text, color) {
    if (this.floats.length > 14) this.floats.shift();
    this.floats.push({ x: x, y: y, text: text, color: color, life: 1.7 });
  };

  /* ---------------- 事件 → 音效/飘字/特效 ---------------- */
  KitchenUI.prototype._consumeEvents = function (sim) {
    for (var i = 0; i < sim.events.length; i++) {
      var ev = sim.events[i];
      var chefP = this.toScreen(sim.staff.chef.x, sim.staff.chef.y - 55);
      switch (ev.type) {
        case 'customerIn': Sound.customerIn(); break;
        case 'order': Sound.order(); break;
        case 'chopDone': Sound.chop(); break;
        case 'stir':
          Sound.stir();
          this._sparks();
          break;
        case 'takeDish':
          Sound.serve();
          this._float(chefP.x, chefP.y, ev.msg.indexOf('完美') >= 0 ? '完美出锅★' : '出锅', '#1971c2');
          break;
        case 'served':
          Sound.serve();
          var t = TABLES[ev.tableId] || TABLES[0];
          var tp = this.toScreen(t.x, t.y - 55);
          this._float(tp.x, tp.y, '+' + ev.gain, '#f08c00');
          break;
        case 'paid':
          Sound.paid();
          var dp = this.toScreen(D.DOOR.x + 40, D.DOOR.y - 30);
          this._float(dp.x, dp.y, '收入 +' + ev.gain, '#2b8a3e');
          break;
        case 'angry': Sound.angry(); break;
        case 'burnt': Sound.burnt(); break;
        case 'washed': Sound.washed(); break;
        case 'urge':
          Sound.urge();
          var st = sim.staff[ev.staff];
          if (st) {
            var up = this.toScreen(st.x, st.y - 50);
            this._float(up.x, up.y, '💢加油！', '#9775fa');
          }
          break;
        /* v3.0 */
        case 'envEvent':
          Sound.alertEvent();
          this._float(this.w / 2, 60, ev.msg, '#e8590c');
          break;
        case 'eventFixed':
          Sound.eventFixed();
          this._float(this.w / 2, 60, ev.msg, '#2b8a3e');
          break;
        case 'season': Sound.season(); break;
      }
    }
    sim.events.length = 0;
    this._lastSeason = sim.season;      // 季节粒子颜色跟随
  };

  KitchenUI.prototype._sparks = function () {
    var st = this.toScreen(ST.stove.x, ST.stove.y + 40);
    for (var i = 0; i < 5; i++) {
      this.sparks.push({
        x: st.x, y: st.y,
        vx: (Math.random() - 0.5) * 110, vy: -55 - Math.random() * 70,
        life: 0.45 + Math.random() * 0.25, color: Math.random() > 0.5 ? '#ffd43b' : '#ff922b'
      });
    }
  };

  window.KitchenUI = KitchenUI;
  window.KitchenSound = Sound;
})(window);
