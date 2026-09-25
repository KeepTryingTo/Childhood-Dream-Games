/* ============================================================
 * game.js —— KitchenSim 全自动协作模拟引擎
 *            （无 DOM 依赖，可单元测试；v2.0 重写）
 *
 * 世界：左餐厅（4 桌 + 门）右厨房（冰箱/砧板/备菜台/灶台/装盘台/
 *       取餐台/水槽/垃圾桶），顾客与四名员工全部自动运转。
 *
 * 员工 FSM（require.md 10.2）：
 *   配菜师：补缺食材 —— 冰箱取 → 砧板切 → 备菜台
 *   主厨：  备菜齐的最早订单 —— 取料 → 下锅 → 翻炒 → 完美窗口出锅
 *           → 装盘 → 取餐台
 *   跑堂：  上菜优先，其次收脏盘洗 —— 取餐台 ↔ 顾客桌 ↔ 水槽
 *   经理：  巡逻 + 周期性催促在岗员工（速度增益）
 * 顾客 FSM（10.3）：进门→坐桌→点单→等菜(耐心)→用餐→付款→离开→留脏盘
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'));
  } else {
    root.KitchenSim = factory(root.KitchenData);
  }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  var C = D.CONFIG;
  var ST = D.STATIONS;
  var TABLES = D.TABLES;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ================= KitchenSim ================= */
  function KitchenSim(opts) {
    opts = opts || {};
    var self = this;
    this.cfg = opts.config || C;
    this.random = opts.random || Math.random;
    this.status = 'playing';               // playing | paused（观赏模式无 over）
    this.timeMs = 0;
    this.speed = 1;                        // 由 main 控制帧步进，这里只存逻辑

    // ---- 营业统计 ----
    this.stats = {
      revenue: 0, dishes: 0, perfects: 0, tips: 0,
      customersServed: 0, customersLost: 0,
      waitTotalMs: 0, waitCount: 0,        // 平均等菜
      washed: 0,                            // 洗净盘数（闭环统计）
      // v3.0 环境事件与顾客类型统计（成就用）
      ratsChased: 0, ratsStolen: 0, leaksFixed: 0, firesOut: 0,
      vipServed: 0, gluttonServed: 0,
      customerMet: {},                      // 顾客类型见面计数（图鉴）
      perRecipe: {}                         // 菜品销量
    };

    // ---- v3.0 季节 ----
    this.season = 0;                        // 0春 1夏 2秋 3冬
    this.seasonTimerMs = opts.seasonMs != null ? opts.seasonMs : 180000;
    this.seasonMs = this.seasonTimerMs;
    this.stats.seasonsMask = 1;             // 已见春季

    // ---- v3.0 动态环境事件 ----
    this.envEvent = null;                   // {type, x, y, phase, timerMs, ...}
    this.eventTimerMs = D.EVENTS.FIRST_MS;

    // ---- v3.1 障碍物（台面 AABB + 隔断墙段 + 餐桌），实体不可穿越 ----
    this.obstacles = [];
    Object.keys(ST).forEach(function (k) {
      var s = ST[k];
      self.obstacles.push({ x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h, station: k });
    });
    D.WALL.segments.forEach(function (seg) { self.obstacles.push(seg); });
    TABLES.forEach(function (t) { self.obstacles.push({ x: t.x - 38, y: t.y - 38, w: 76, h: 76, table: t.id }); });

    // ---- 设施状态 ----
    this.board = { phase: 'idle', ing: null, progressMs: 0 };   // idle|chopping
    this.pot = { phase: 'empty', ings: [], cookMs: 0, doneMs: 0, stirTimerMs: 0 };
    this.prepStock = {};                    // 备菜台：食材 -> 切好数量
    D.INGREDIENTS.forEach(function (i) { this.prepStock[i.id] = 0; }, this);
    this.readyDishes = [];                  // 取餐台 [{orderId, recipeId, quality}]
    this.plates = this.cfg.START_PLATES;
    this.sink = { queue: 0, remainMs: 0 };  // 待洗队列（洗完 plates++）

    // ---- 订单 / 顾客 ----
    this.orders = [];                       // {id, recipeId, tableId, customerId, state, quality, createdAt, waitStartMs}
    this.orderSeq = 1;
    this.customers = [];
    this.customerSeq = 1;
    this.customerTimerMs = 1500;            // 首位顾客 1.5s 后进门

    // ---- 员工 ----
    this.staff = {};
    ['prep', 'chef', 'runner', 'manager'].forEach(function (role) {
      var conf = D.STAFF[role];
      self.staff[role] = {
        role: role, name: conf.name, tag: conf.tag, color: conf.color,
        x: self._homePos(role).x, y: self._homePos(role).y,
        speed: conf.speed, state: 'idle', hold: null,
        target: null, timerMs: 0,
        buffUntilMs: 0, urgeFx: 0,
        orderId: null, ingId: null, tableId: null, dirty: false
      };
    });
    this.urgeTimerMs = this.cfg.URGE_MIN_MS;
    this.events = [];                       // 事件流（UI 消费）：{type, msg, ...}
  }

  KitchenSim.prototype._homePos = function (role) {
    switch (role) {
      case 'prep':   return { x: ST.board.x, y: ST.board.y + 80 };
      case 'chef':   return { x: ST.stove.x, y: ST.stove.y + 90 };
      case 'runner': return { x: 700, y: 455 };              // v3.1 厨房侧南门旁待命
      default:       return { x: 275, y: 300 };   // 经理餐厅中央
    }
  };

  /* ---------------- 事件 ---------------- */
  KitchenSim.prototype._emit = function (type, msg, extra) {
    var ev = { type: type, msg: msg, at: this.timeMs };
    if (extra) for (var k in extra) ev[k] = extra[k];
    this.events.push(ev);
    if (this.events.length > 40) this.events.shift();
  };

  /* ---------------- 生命周期 ---------------- */
  KitchenSim.prototype.pause = function () { if (this.status === 'playing') this.status = 'paused'; };
  KitchenSim.prototype.resume = function () { if (this.status === 'paused') this.status = 'playing'; };
  KitchenSim.prototype.togglePause = function () {
    if (this.status === 'playing') this.pause(); else this.resume();
  };

  /* ================= 主 tick（固定步长 dt 秒） ================= */
  KitchenSim.prototype.tick = function (dt) {
    if (this.status !== 'playing') return;
    var ms = dt * 1000;
    this.timeMs += ms;

    this._updateSink(ms);
    this._updateBoard(ms);
    this._updatePot(ms);
    this._updateSeason(ms);
    this._updateEnvEvent(ms);
    this._spawnCustomer(ms);
    for (var i = this.customers.length - 1; i >= 0; i--) this._updateCustomer(this.customers[i], ms);
    this._updatePrep(this.staff.prep, ms);
    this._updateChef(this.staff.chef, ms);
    this._updateRunner(this.staff.runner, ms);
    this._updateManager(this.staff.manager, ms);
  };

  /* ---------------- v3.0 季节轮换 ---------------- */
  KitchenSim.prototype.setSeason = function (id) {
    this.season = ((id % 4) + 4) % 4;
    this.seasonTimerMs = this.seasonMs;
    this.stats.seasonsMask |= (1 << this.season);
    this._emit('season', '季节更替：' + D.SEASONS[this.season].name + ' ' + D.SEASONS[this.season].emoji);
  };

  KitchenSim.prototype._updateSeason = function (ms) {
    this.seasonTimerMs -= ms;
    if (this.seasonTimerMs <= 0) this.setSeason(this.season + 1);
  };

  /* ---------------- 通用移动（v3.1：路点队列 + 跨区走门 + 碰撞推离 + 卡死逃逸） ----------------
   * e.path：FSM 预设的绕行路点队列（先走完再奔目标）
   * 隔断墙 x∈[600,614] 开两扇门（缺口 y[160,260] 与 y[440,540]），跨区经门厅路点导航
   * 台面/墙体用圆-AABB 推离（滑移绕行）；卡死（位移停滞 1.2s）时侧向逃逸
   */
  KitchenSim.prototype._move = function (e, tx, ty, dt) {
    // 0) 预设路点队列
    if (e.path && e.path.length) {
      var pw = e.path[0];
      this._moveStep(e, pw.x, pw.y, dt);
      if (Math.abs(e.x - pw.x) < 6 && Math.abs(e.y - pw.y) < 6) e.path.shift();
      this._collide(e);
      this._stuckCheck(e, tx, ty, dt);
      return false;
    }
    var WALL_X = 607;
    // 1) 跨区检测 → 生成过门路点
    if (!e.gateWay) {
      var inDoorZone = Math.abs(e.x - WALL_X) < 18;
      var fromKitchen = e.x >= WALL_X, toKitchen = tx >= WALL_X;
      if (!inDoorZone && fromKitchen !== toKitchen) {
        var g0 = D.GATES[0], g1 = D.GATES[1];
        var cost0 = Math.abs(e.y - g0.gateY) + Math.abs(ty - g0.gateY);
        var cost1 = Math.abs(e.y - g1.gateY) + Math.abs(ty - g1.gateY);
        var g = cost0 <= cost1 ? g0 : g1;
        e.gateWay = fromKitchen
          ? [{ x: g.kitchenSide.x, y: g.kitchenSide.y }, { x: g.diningSide.x, y: g.diningSide.y }]
          : [{ x: g.diningSide.x, y: g.diningSide.y }, { x: g.kitchenSide.x, y: g.kitchenSide.y }];
      }
    }
    // 2) 卡死逃逸（优先于正常移动）
    var detour = this._stuckCheck(e, tx, ty, dt);
    if (detour) {
      this._moveStep(e, detour.x, detour.y, dt);
      this._collide(e);
      return false;
    }
    // 3) 沿门路点 / 直线
    var arrived;
    if (e.gateWay && e.gateWay.length) {
      var wp = e.gateWay[0];
      this._moveStep(e, wp.x, wp.y, dt);
      if (Math.abs(e.x - wp.x) < 5 && Math.abs(e.y - wp.y) < 5) {
        e.gateWay.shift();
        if (!e.gateWay.length) e.gateWay = null;
      }
      arrived = false;
    } else {
      arrived = this._moveStep(e, tx, ty, dt);
    }
    // 4) 碰撞推离（墙 + 台面 + 桌）
    this._collide(e);
    return arrived;
  };

  /** 卡死检测与侧向逃逸：有目标却停滞 1.2s → 左右交替侧向绕行点 */
  KitchenSim.prototype._stuckCheck = function (e, tx, ty, dt) {
    if (!e._st) e._st = { x: e.x, y: e.y, ms: 0, side: 1, detour: null, detourMs: 0 };
    var st = e._st;
    var movedSq = (e.x - st.x) * (e.x - st.x) + (e.y - st.y) * (e.y - st.y);
    if (movedSq > 16) { st.x = e.x; st.y = e.y; st.ms = 0; }
    else st.ms += dt * 1000;

    if (st.detour) {
      st.detourMs += dt * 1000;
      if (st.detourMs > 2200) { st.detour = null; st.detourMs = 0; st.ms = 0; return null; }   // 超时换边
      if (Math.abs(e.x - st.detour.x) < 7 && Math.abs(e.y - st.detour.y) < 7) { st.detour = null; st.detourMs = 0; }
      return st.detour;
    }
    if (st.ms > 1200) {
      var dx = tx - e.x, dy = ty - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / d, uy = dy / d;
      var px = -uy * st.side, py = ux * st.side;
      st.detour = {
        x: clamp(e.x + px * 80 + ux * 35, 20, D.WORLD.w - 20),
        y: clamp(e.y + py * 80 + uy * 35, 20, D.WORLD.h - 20)
      };
      st.side = -st.side;
      st.ms = 0;
      st.detourMs = 0;
      return st.detour;
    }
    return null;
  };

  /** 直线步进（不含碰撞） */
  KitchenSim.prototype._moveStep = function (e, tx, ty, dt) {
    var sp = e.speed * (this.timeMs < e.buffUntilMs ? this.cfg.BUFF_MUL : 1);
    // v3.0 漏水区域减速（经理处理事件时不减速）
    var ev = this.envEvent;
    if (ev && ev.type === 'leak' && e.role !== 'manager') {
      var ld = Math.sqrt((e.x - ev.x) * (e.x - ev.x) + (e.y - ev.y) * (e.y - ev.y));
      if (ld < D.EVENTS.LEAK.radius) sp *= D.EVENTS.LEAK.slowMul;
    }
    var dx = tx - e.x, dy = ty - e.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 4) { e.x = tx; e.y = ty; return true; }
    var step = Math.min(d, sp * dt);
    e.x += dx / d * step;
    e.y += dy / d * step;
    return false;
  };

  /** 圆-AABB 推离：实体圆心进入障碍则推到最近表面外（滑移绕行） */
  KitchenSim.prototype._collide = function (e, r) {
    r = r || 9;
    var obs = this.obstacles;
    for (var i = 0; i < obs.length; i++) {
      var b = obs[i];
      var cx = clamp(e.x, b.x, b.x + b.w);
      var cy = clamp(e.y, b.y, b.y + b.h);
      var dx = e.x - cx, dy = e.y - cy;
      var d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        var d = Math.sqrt(d2);
        e.x = cx + dx / d * r;
        e.y = cy + dy / d * r;
      } else {
        // 圆心陷入盒内：推向最近的边
        var left = e.x - b.x, right = b.x + b.w - e.x;
        var top = e.y - b.y, bottom = b.y + b.h - e.y;
        var m = Math.min(left, right, top, bottom);
        if (m === left) e.x = b.x - r;
        else if (m === right) e.x = b.x + b.w + r;
        else if (m === top) e.y = b.y - r;
        else e.y = b.y + b.h + r;
      }
    }
  };

  /* ================= 设施更新 ================= */
  KitchenSim.prototype._updateBoard = function (ms) {
    if (this.board.phase === 'chopping') {
      this.board.progressMs += ms;
      if (this.board.progressMs >= D.ingById(this.board.ing).chopMs) {
        this.board.phase = 'idle';
        this.board.progressMs = 0;
        this._emit('chopDone', '配菜师切好了' + D.ingById(this.board.ing).name);
      }
    }
  };

  KitchenSim.prototype._updatePot = function (ms) {
    var pot = this.pot;
    if (pot.phase === 'cooking') {
      pot.cookMs += ms;
      if (pot.cookMs >= this.cfg.COOK_MS) { pot.phase = 'done'; pot.doneMs = 0; }
    } else if (pot.phase === 'done') {
      pot.doneMs += ms;
      if (pot.doneMs > this.cfg.BURN_MS) {
        pot.phase = 'burnt';
        this._emit('burnt', '锅里的菜烧焦了！');
      }
    }
  };

  KitchenSim.prototype._updateSink = function (ms) {
    var s = this.sink;
    if (s.queue > 0) {
      s.remainMs -= ms;
      if (s.remainMs <= 0) {
        s.queue--;
        this.plates++;
        this.stats.washed++;
        this._emit('washed', '盘子洗好了');
        s.remainMs = s.queue > 0 ? this.cfg.WASH_MS : 0;
      }
    }
  };

  /** 当前出锅品质 */
  KitchenSim.prototype.qualityNow = function () {
    if (this.pot.phase !== 'done') return null;
    var o = this.pot.doneMs;
    return (o >= this.cfg.PERFECT_FROM && o <= this.cfg.PERFECT_TO) ? 'perfect' : 'good';
  };

  /* ================= 顾客 ================= */
  KitchenSim.prototype._spawnCustomer = function (ms) {
    this.customerTimerMs -= ms;
    if (this.customerTimerMs > 0) return;
    var gap = Math.max(this.cfg.CUSTOMER_GAP_MIN,
      this.cfg.CUSTOMER_GAP - this.timeMs / this.cfg.CUSTOMER_GAP_DECAY / 1000 * 1000);
    this.customerTimerMs = gap * (0.75 + this.random() * 0.5);
    if (this.customers.length >= TABLES.length) return;    // 无空桌不进客

    var free = TABLES.filter(function (t) {
      return !this.customers.some(function (c) { return c.tableId === t.id; });
    }, this);
    if (!free.length) return;
    var table = free[Math.floor(this.random() * free.length)];

    var roll = this.random(), type = 'normal';
    if (roll < this.cfg.VIP_RATE) type = 'vip';
    else if (roll < this.cfg.VIP_RATE + this.cfg.GLUTTON_RATE) type = 'glutton';
    var info = D.CUSTOMERS[type];

    var c = {
      id: this.customerSeq++, type: type, tableId: table.id,
      seatIdx: Math.floor(this.random() * D.SEAT_OFFSETS.length),   // v3.1 分配椅子
      x: D.DOOR.x, y: D.DOOR.y,
      speed: this.cfg.CUSTOMER_SPEED,
      state: 'entering', timerMs: 0,
      patienceMs: this.cfg.BASE_PATIENCE * info.patience,
      maxPatienceMs: this.cfg.BASE_PATIENCE * info.patience,
      orderIds: [], paid: 0, eatCount: 0
    };
    this.customers.push(c);
    this.stats.customerMet[type] = (this.stats.customerMet[type] || 0) + 1;   // v3.0 图鉴
    this._emit('customerIn', info.name + ' 进店（' + (table.id + 1) + ' 号桌）', { customerId: c.id });
  };

  KitchenSim.prototype._table = function (id) {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].id === id) return TABLES[i];
    return null;
  };

  /** v3.1 顾客座位坐标（桌旁椅子，非桌心） */
  KitchenSim.prototype._seatPos = function (tableId, seatIdx) {
    var t = this._table(tableId);
    var off = D.SEAT_OFFSETS[seatIdx % D.SEAT_OFFSETS.length];
    return { x: t.x + off.dx, y: t.y + off.dy };
  };

  /** v3.1 跑堂服务位（桌右侧、避开椅子） */
  KitchenSim.prototype._servePos = function (tableId) {
    var t = this._table(tableId);
    return { x: t.x + D.SERVE_OFFSET.dx, y: t.y + D.SERVE_OFFSET.dy };
  };

  KitchenSim.prototype._updateCustomer = function (c, ms) {
    var t = this._table(c.tableId);
    var dt = ms / 1000;
    switch (c.state) {
      case 'entering':                       // v3.1 走向自己的椅子（不再站桌心）
        var seat = this._seatPos(c.tableId, c.seatIdx);
        if (this._move(c, seat.x, seat.y, dt)) {
          c.state = 'seated';
          c.timerMs = this.cfg.SIT_MS;
        }
        break;
      case 'seated':                       // 坐下 → 点单
        c.timerMs -= ms;
        if (c.timerMs <= 0) {
          var info = D.CUSTOMERS[c.type];
          for (var i = 0; i < info.dishes; i++) {
            var r = D.RECIPES[Math.floor(this.random() * D.RECIPES.length)];
            var o = {
              id: this.orderSeq++, recipeId: r.id, tableId: c.tableId, customerId: c.id,
              state: 'pending', quality: null, createdAt: this.timeMs, waitStartMs: this.timeMs
            };
            this.orders.push(o);
            c.orderIds.push(o.id);
          }
          c.state = 'waiting';
          this._emit('order', info.name + ' 点了 ' + (info.dishes > 1 ? '两道菜' : D.recipeById(this.orders[this.orders.length - 1].recipeId).name));
        }
        break;
      case 'waiting':
        c.patienceMs -= ms;
        if (c.patienceMs <= 0) {
          this._customerLeave(c, true);
        } else if (this._allDishesDelivered(c)) {
          c.state = 'eating';
          c.timerMs = this.cfg.EAT_MS * (c.type === 'glutton' ? 1.6 : 1);
          this.stats.waitTotalMs += this.timeMs - (c.orderIds.length ? this._orderById(c.orderIds[0]).waitStartMs : this.timeMs);
          this.stats.waitCount += c.orderIds.length;
        }
        break;
      case 'eating':
        c.timerMs -= ms;
        if (c.timerMs <= 0) { c.state = 'paying'; c.timerMs = this.cfg.PAY_MS; }
        break;
      case 'paying':
        c.timerMs -= ms;
        if (c.timerMs <= 0) { this._customerLeave(c, false); }
        break;
      case 'leaving':
        if (this._move(c, D.DOOR.x, D.DOOR.y, dt)) {
          this.customers.splice(this.customers.indexOf(c), 1);
          this._table(c.tableId).dirty = true;     // 桌上留脏盘
          // 清理该顾客的已完成/已取消订单（防数组无限增长）
          for (var k = this.orders.length - 1; k >= 0; k--) {
            if (c.orderIds.indexOf(this.orders[k].id) >= 0) this.orders.splice(k, 1);
          }
        }
        break;
      case 'angry':                         // 超时短暂红脸 → 离开
        c.timerMs -= ms;
        if (c.timerMs <= 0) {
          c.state = 'leaving';
          this._table(c.tableId).dirty = true;
        }
        break;
    }
  };

  KitchenSim.prototype._orderById = function (id) {
    for (var i = 0; i < this.orders.length; i++) if (this.orders[i].id === id) return this.orders[i];
    return null;
  };

  KitchenSim.prototype._allDishesDelivered = function (c) {
    for (var i = 0; i < c.orderIds.length; i++) {
      var o = this._orderById(c.orderIds[i]);
      if (!o || o.state !== 'served') return false;
    }
    return true;
  };

  /** 顾客离店：正常（付钱）或生气（差评） */
  KitchenSim.prototype._customerLeave = function (c, angry) {
    // 清理未完成的订单
    for (var i = 0; i < c.orderIds.length; i++) {
      var o = this._orderById(c.orderIds[i]);
      if (o && o.state !== 'served') o.state = 'cancelled';
    }
    if (angry) {
      c.state = 'angry';
      c.timerMs = 1200;
      this.stats.customersLost++;
      this._emit('angry', D.CUSTOMERS[c.type].name + ' 等太久，生气走了！');
    } else {
      c.state = 'leaving';
      this.stats.customersServed++;
      this._emit('paid', D.CUSTOMERS[c.type].name + ' 付款 ' + c.paid + ' 元，满意离开', { gain: c.paid });
    }
  };

  /** 跑堂上菜结算：单份收入 = 菜价 × 品质 × VIP + 小费 */
  KitchenSim.prototype._settle = function (order, c) {
    var r = D.recipeById(order.recipeId);
    var info = D.CUSTOMERS[c.type];
    var ratio = clamp(c.patienceMs / c.maxPatienceMs, 0, 1);
    var tip = Math.round(r.score * 0.5 * ratio * info.payMul);
    var gain = Math.round(r.score * (order.quality === 'perfect' ? 1.5 : 1) * info.payMul) + tip;
    c.paid += gain;
    this.stats.revenue += gain;
    this.stats.dishes++;
    this.stats.tips += tip;
    if (order.quality === 'perfect') this.stats.perfects++;
    this.stats.perRecipe[order.recipeId] = (this.stats.perRecipe[order.recipeId] || 0) + 1;
    // v3.0 顾客类型服务统计（成就）
    if (c.type === 'vip') this.stats.vipServed++;
    if (c.type === 'glutton') this.stats.gluttonServed++;
    this._emit('served', r.name + ' 上桌 +' + gain, { gain: gain, tableId: order.tableId });
  };

  /* ================= v3.0 动态环境事件 ================= */
  KitchenSim.prototype._updateEnvEvent = function (ms) {
    var dt = ms / 1000;
    if (!this.envEvent) {
      this.eventTimerMs -= ms;
      if (this.eventTimerMs <= 0) {
        this.eventTimerMs = D.EVENTS.GAP_MIN + this.random() * (D.EVENTS.GAP_MAX - D.EVENTS.GAP_MIN);
        this._spawnEnvEvent();
      }
      return;
    }
    var ev = this.envEvent;
    if (ev.type === 'rat') {
      var R = D.EVENTS.RAT;
      if (ev.phase === 'sneak') {
        var tx = ST.prepTable.x, ty = ST.prepTable.y + 60;
        var dx = tx - ev.x, dy = ty - ev.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 6) { ev.phase = 'steal'; ev.timerMs = R.stealMs; }
        else {
          ev.x += dx / d * R.sneakSpeed * dt;
          ev.y += dy / d * R.sneakSpeed * dt;
        }
      } else if (ev.phase === 'steal') {
        ev.timerMs -= ms;
        if (ev.timerMs <= 0) {
          var has = [];
          for (var k in this.prepStock) if (this.prepStock[k] > 0) has.push(k);
          if (has.length) {
            var pick = has[Math.floor(this.random() * has.length)];
            this.prepStock[pick]--;
            this.stats.ratsStolen++;
            this._emit('envEvent', '🐭 老鼠偷走了一份' + D.ingById(pick).name + '！');
          }
          ev.phase = 'flee';
        }
      } else if (ev.phase === 'flee') {
        var dx2 = R.spawn.x - ev.x, dy2 = R.spawn.y - ev.y;
        var d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (d2 < 12) { this.envEvent = null; return; }
        ev.x += dx2 / d2 * R.fleeSpeed * dt;
        ev.y += dy2 / d2 * R.fleeSpeed * dt;
      }
      // 经理驱赶检查（老鼠未逃时靠近即驱散）
      if (this.envEvent && ev.phase !== 'flee') {
        var mgr = this.staff.manager;
        var md = Math.sqrt((mgr.x - ev.x) * (mgr.x - ev.x) + (mgr.y - ev.y) * (mgr.y - ev.y));
        if (md < R.chaseDist) {
          ev.phase = 'flee';
          this.stats.ratsChased++;
          this._emit('envEvent', '👔 经理驱赶了老鼠！');
        }
      }
    }
    // leak / fire 无自身演化，等待经理处理（_updateManager）
  };

  KitchenSim.prototype._spawnEnvEvent = function () {
    if (this.random() < D.EVENTS.SKIP_RATE) return;
    var roll = this.random();
    if (roll < 0.45) {
      var R = D.EVENTS.RAT;
      this.envEvent = { type: 'rat', x: R.spawn.x, y: R.spawn.y, phase: 'sneak', timerMs: 0 };
      this._emit('envEvent', '🐭 有老鼠溜进厨房！');
    } else if (roll < 0.75) {
      // v3.1 漏水点采样避开台面障碍（防经理目标不可达）
      var A = D.EVENTS.LEAK.area;
      var lx, ly, tries = 0, bad;
      do {
        lx = A.x + this.random() * A.w;
        ly = A.y + this.random() * A.h;
        bad = false;
        for (var oi = 0; oi < this.obstacles.length; oi++) {
          var ob = this.obstacles[oi];
          if (lx > ob.x - 20 && lx < ob.x + ob.w + 20 && ly > ob.y - 20 && ly < ob.y + ob.h + 20) { bad = true; break; }
        }
        tries++;
      } while (bad && tries < 40);
      if (bad) return;    // 采不到就放弃本次事件
      this.envEvent = { type: 'leak', x: lx, y: ly };
      this._emit('envEvent', '💧 厨房地板漏水了，经过会打滑！');
    } else {
      if (this.pot.phase !== 'empty') return;    // 灶台占用时不着火
      var F = D.EVENTS.FIRE;
      this.envEvent = { type: 'fire', x: F.pos.x, y: F.pos.y };
      this._emit('envEvent', '🔥 灶台蹿出了火苗，主厨暂避！');
    }
  };

  /* ================= 配菜师：补缺食材 =================
   * v3.1 绕行路点（砧板/水槽间的下走廊 x∈[884,916] 与右侧走廊）：
   *   砧板→冰箱：右侧下走廊；冰箱→砧板：同走廊反向；砧板→备菜台：缝隙走廊上行
   */
  KitchenSim.prototype._updatePrep = function (s, ms) {
    var dt = ms / 1000;
    switch (s.state) {
      case 'idle':
        var need = this._missingIngredient();
        if (need) {
          s.ingId = need;
          s.state = 'toFridge';
          s.target = ST.fridge;
          s.path = [{ x: 980, y: 655 }, { x: 1090, y: 655 }];   // 下走廊绕开砧板/水槽
        }
        break;
      case 'toFridge':
        if (this._move(s, ST.fridge.x, ST.fridge.y + 70, dt)) {
          s.path = null;
          s.state = 'takeIng';
          s.timerMs = this.cfg.TAKE_MS;
        }
        break;
      case 'takeIng':
        s.timerMs -= ms;
        if (s.timerMs <= 0) {
          s.hold = { type: 'ing', id: s.ingId, state: 'raw' };
          s.state = 'toBoard';
          s.path = [{ x: 1090, y: 655 }, { x: 980, y: 655 }];   // 原路返回
        }
        break;
      case 'toBoard':
        if (this._move(s, ST.board.x, ST.board.y + 65, dt)) {
          s.path = null;
          // 到砧板：放下开始切（板空闲时立即切）
          if (this.board.phase === 'idle') {
            this.board.phase = 'chopping';
            this.board.ing = s.hold.id;
            this.board.progressMs = 0;
            s.hold = null;
            s.state = 'chopping';
            s.timerMs = D.ingById(this.board.ing).chopMs;
          } else { s.state = 'idle'; }     // 被占（理论不会），回 idle 重试
        }
        break;
      case 'chopping':
        s.timerMs -= ms;
        if (this.board.phase === 'idle') { // 切完了
          s.hold = { type: 'ing', id: this.board.ing, state: 'chopped' };
          this.board.ing = null;
          s.state = 'toPrep';
          s.path = [{ x: 890, y: 655 }, { x: 890, y: 400 }];    // 缝隙走廊上行
        }
        break;
      case 'toPrep':
        if (this._move(s, ST.prepTable.x, ST.prepTable.y + 60, dt)) {
          s.path = null;
          if (this.prepStock[s.hold.id] < this.cfg.PREP_STOCK_MAX) {
            this.prepStock[s.hold.id]++;
            this._emit('prepped', '备菜台 +' + D.ingById(s.hold.id).name);
          }
          s.hold = null;
          s.state = 'idle';
        }
        break;
    }
  };

  /** 找 pending 订单中备菜台缺的第一种食材 */
  KitchenSim.prototype._missingIngredient = function () {
    for (var i = 0; i < this.orders.length; i++) {
      var o = this.orders[i];
      if (o.state !== 'pending') continue;
      var need = D.recipeById(o.recipeId).need;
      for (var j = 0; j < need.length; j++) {
        if (this.prepStock[need[j]] <= 0) return need[j];
      }
    }
    return null;
  };

  /* ================= 主厨：取料 → 炒 → 装盘 → 取餐台 ================= */
  KitchenSim.prototype._updateChef = function (s, ms) {
    var dt = ms / 1000;
    var pot = this.pot;
    switch (s.state) {
      case 'idle':
        // v3.0 灶台着火时暂避，不接新单
        if (this.envEvent && this.envEvent.type === 'fire') break;
        if (pot.phase === 'done') { s.state = 'waitPerfect'; break; }
        var o = this._nextCookableOrder();
        if (o) {
          s.orderId = o.id;
          o.state = 'cooking';
          s.state = 'toPrep';
        }
        break;
      case 'waitPerfect':                   // 站灶台前等完美窗口
        if (pot.phase !== 'done') { s.state = 'idle'; break; }
        if (pot.doneMs >= this.cfg.PERFECT_FROM) {
          // 出锅
          var order = this._orderById(s.orderId);
          var q = this.qualityNow();
          var ings = pot.ings.slice();
          pot.phase = 'empty'; pot.ings = []; pot.cookMs = 0; pot.doneMs = 0;
          if (!order || order.state === 'cancelled') {
            s.hold = { type: 'dish', recipeId: 'unknown', quality: q, ings: ings };
            s.state = 'toTrash';
            break;
          }
          s.hold = { type: 'dish', recipeId: order.recipeId, quality: q };
          order.quality = q;
          s.state = 'toPlating';
          this._emit('takeDish', q === 'perfect' ? '主厨完美出锅！' : '主厨出锅');
        }
        break;
      case 'toPrep':                        // 去备菜台取本单食材
        if (this._move(s, ST.prepTable.x, ST.prepTable.y - 60, dt)) {
          var o2 = this._orderById(s.orderId);
          if (!o2 || o2.state === 'cancelled') { s.orderId = null; s.state = 'idle'; break; }
          var need = D.recipeById(o2.recipeId).need;
          var ok = true;
          for (var i = 0; i < need.length; i++) if (this.prepStock[need[i]] <= 0) ok = false;
          if (!ok) { o2.state = 'pending'; s.orderId = null; s.state = 'idle'; break; }
          for (i = 0; i < need.length; i++) this.prepStock[need[i]]--;
          s.hold = { type: 'ings', ids: need.slice() };
          s.state = 'toStove';
        }
        break;
      case 'toStove':
        if (this._move(s, ST.stove.x, ST.stove.y + 70, dt)) {
          var o3 = this._orderById(s.orderId);
          var hold = s.hold;
          s.hold = null;
          if (!o3 || o3.state === 'cancelled') {
            s.hold = { type: 'ings', ids: hold ? hold.ids : [] };
            s.state = 'toTrash';
            break;
          }
          pot.ings = hold.ids;
          pot.phase = 'cooking';
          pot.cookMs = 0; pot.doneMs = 0; pot.stirTimerMs = 0;
          s.state = 'cooking';
          this._emit('stirIn', '主厨下锅：' + D.recipeById(o3.recipeId).name);
        }
        break;
      case 'cooking':                       // 翻炒（每 STIR_INTERVAL 一铲加速）
        pot.stirTimerMs += ms;
        if (pot.stirTimerMs >= this.cfg.STIR_INTERVAL && pot.phase === 'cooking') {
          pot.stirTimerMs = 0;
          pot.cookMs += this.cfg.STIR_MS;
          this._emit('stir', '翻炒！');
          if (pot.cookMs >= this.cfg.COOK_MS) { pot.phase = 'done'; pot.doneMs = 0; }
        }
        if (pot.phase === 'done') s.state = 'waitPerfect';
        else if (pot.phase === 'burnt') {   // 理论不发生（主厨守着），兜底
          s.state = 'toTrashBurnt';
          s.hold = { type: 'dish', recipeId: 'unknown', quality: 'burnt' };
        }
        break;
      case 'toPlating':
        if (this._move(s, ST.plating.x, ST.plating.y + 65, dt)) {
          if (this.plates <= 0) break;      // 站着等盘（跑堂会补）
          this.plates--;
          s.hold = { type: 'plated', recipeId: s.hold.recipeId, quality: s.hold.quality };
          s.state = 'toPass';
        }
        break;
      case 'toPass':                        // 放取餐台
        if (this._move(s, ST.pass.x + 60, ST.pass.y, dt)) {
          var o4 = this._orderById(s.orderId);
          if (o4 && o4.state !== 'cancelled') {
            o4.state = 'ready';
            this.readyDishes.push({ orderId: o4.id, recipeId: o4.recipeId, quality: s.hold.quality });
          } else {
            this.sink.queue++;              // 无人认领：脏盘入洗，菜倒掉
            this.sink.remainMs = this.sink.remainMs || this.cfg.WASH_MS;
          }
          s.hold = null;
          s.orderId = null;
          s.state = 'idle';
        }
        break;
      case 'toTrash':
        if (this._move(s, ST.trash.x - 55, ST.trash.y, dt)) {
          s.hold = null;
          s.orderId = null;
          s.state = 'idle';
          this._emit('trash', '倒掉一锅菜');
        }
        break;
      case 'toTrashBurnt':
        if (this._move(s, ST.trash.x - 55, ST.trash.y, dt)) {
          this.pot.phase = 'empty'; this.pot.ings = [];
          s.hold = null; s.state = 'idle';
          this._emit('trash', '烧焦的菜倒掉了');
        }
        break;
    }
  };

  /** 备菜台料齐的最早 pending 订单 */
  KitchenSim.prototype._nextCookableOrder = function () {
    if (this.pot.phase !== 'empty') return null;
    for (var i = 0; i < this.orders.length; i++) {
      var o = this.orders[i];
      if (o.state !== 'pending') continue;
      var need = D.recipeById(o.recipeId).need;
      var ok = true;
      for (var j = 0; j < need.length; j++) if (this.prepStock[need[j]] <= 0) ok = false;
      if (ok) return o;
    }
    return null;
  };

  /* ================= 跑堂：上菜优先 → 收脏盘 → 待命 ================= */
  KitchenSim.prototype._updateRunner = function (s, ms) {
    var dt = ms / 1000;
    switch (s.state) {
      case 'idle':
        if (this.readyDishes.length) {
          s.orderId = this.readyDishes[0].orderId;
          s.state = 'toPass';
        } else {
          var dirtyTable = this._dirtyTable();
          if (dirtyTable != null) {
            s.tableId = dirtyTable;
            s.state = 'toTableDirty';
          } else {
            this._move(s, 700, 455, dt);                      // 回待命点（厨房侧南门旁）
          }
        }
        break;
      case 'toPass':                        // 取餐台端菜
        if (this._move(s, ST.pass.x, ST.pass.y + 70, dt)) {
          var idx = -1;
          for (var i = 0; i < this.readyDishes.length; i++) {
            if (this.readyDishes[i].orderId === s.orderId) { idx = i; break; }
          }
          if (idx < 0) { s.orderId = null; s.state = 'idle'; break; }
          var d = this.readyDishes.splice(idx, 1)[0];
          s.hold = { type: 'plated', recipeId: d.recipeId, quality: d.quality };
          var o = this._orderById(s.orderId);
          s.tableId = o ? o.tableId : null;
          s.state = 'toTable';
        }
        break;
      case 'toTable':                       // 端菜到顾客桌旁服务位
        var oT = this._orderById(s.orderId);
        if (!oT || oT.state === 'cancelled') {
          // 顾客已走：菜倒掉，盘入洗
          this.sink.queue++;
          if (this.sink.queue === 1) this.sink.remainMs = this.cfg.WASH_MS;
          s.hold = null; s.orderId = null; s.state = 'idle';
          this._emit('trash', '顾客已走，菜倒了');
          break;
        }
        var sv = this._servePos(s.tableId);
        if (this._move(s, sv.x, sv.y, dt)) {
          var c = this._customerById(oT.customerId);
          if (c && c.state === 'waiting') {
            oT.state = 'served';
            this._settle(oT, c);
          } else {
            // 顾客已走：盘入洗
            this.sink.queue++;
            this.sink.remainMs = this.sink.remainMs || this.cfg.WASH_MS;
            this._emit('trash', '顾客已走，菜倒了');
          }
          s.hold = null; s.orderId = null; s.state = 'idle';
        }
        break;
      case 'toTableDirty':                  // 收脏盘（服务位）
        var sv2 = this._servePos(s.tableId);
        if (this._move(s, sv2.x, sv2.y, dt)) {
          var t2 = this._table(s.tableId);
          t2.dirty = false;
          s.hold = { type: 'dirty' };
          s.state = 'toSink';
        }
        break;
      case 'toSink':                        // 脏盘送水槽
        if (this._move(s, ST.sink.x - 70, ST.sink.y, dt)) {
          this.sink.queue++;
          if (this.sink.queue === 1) this.sink.remainMs = this.cfg.WASH_MS;
          s.hold = null;
          s.state = 'idle';
          this._emit('washStart', '跑堂送去洗盘子');
        }
        break;
    }
  };

  KitchenSim.prototype._dirtyTable = function () {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].dirty) return TABLES[i].id;
    return null;
  };

  KitchenSim.prototype._customerById = function (id) {
    for (var i = 0; i < this.customers.length; i++) if (this.customers[i].id === id) return this.customers[i];
    return null;
  };

  /* ================= 经理：事件处理优先 → 巡逻 + 催促 ================= */
  KitchenSim.prototype._updateManager = function (s, ms) {
    var dt = ms / 1000;
    // 催促计时
    this.urgeTimerMs -= ms;
    if (this.urgeTimerMs <= 0) {
      this.urgeTimerMs = this.cfg.URGE_MIN_MS + this.random() * (this.cfg.URGE_MAX_MS - this.cfg.URGE_MIN_MS);
      var busy = ['prep', 'chef', 'runner'].map(function (r) { return this.staff[r]; }, this)
        .filter(function (e) { return e.state !== 'idle'; });
      if (busy.length) {
        var target = busy[Math.floor(this.random() * busy.length)];
        target.buffUntilMs = this.timeMs + this.cfg.BUFF_MS;
        target.urgeFx = 1;                 // UI 特效标记（消费后清零）
        this._emit('urge', '经理催促 ' + target.name + '：加油！', { staff: target.role });
      }
    }
    // v3.0 事件优先：有空闲巡逻状态时发现事件 → 前往处理
    if (this.envEvent && ['idle', 'patrol', 'pause'].indexOf(s.state) >= 0) {
      s.state = 'toEvent';
    }
    switch (s.state) {
      case 'toEvent':
        if (!this.envEvent) { s.state = 'idle'; break; }
        var ev = this.envEvent;
        if (this._move(s, ev.x, ev.y, dt)) {
          if (ev.type === 'rat') {
            s.state = 'idle';              // 驱赶由 _updateEnvEvent 的接近检查完成
          } else {
            s.state = 'fixing';
            s.timerMs = ev.type === 'leak' ? D.EVENTS.LEAK.fixMs : D.EVENTS.FIRE.fixMs;
          }
        }
        break;
      case 'fixing':
        if (!this.envEvent) { s.state = 'idle'; break; }
        s.timerMs -= ms;
        if (s.timerMs <= 0) {
          var ev2 = this.envEvent;
          if (ev2.type === 'leak') {
            this.stats.leaksFixed++;
            this._emit('eventFixed', '🔧 经理修好了漏水');
          } else {
            this.stats.firesOut++;
            this._emit('eventFixed', '🧯 经理扑灭了灶火');
          }
          this.envEvent = null;
          s.state = 'idle';
        }
        break;
      case 'idle':
        s.state = 'patrol';
        s.target = D.PATROL_POINTS[Math.floor(this.random() * D.PATROL_POINTS.length)];
        break;
      case 'patrol':
        if (this._move(s, s.target.x, s.target.y, dt)) {
          s.state = 'pause';
          s.timerMs = 1000 + this.random() * 1500;
        }
        break;
      case 'pause':
        s.timerMs -= ms;
        if (s.timerMs <= 0) s.state = 'idle';
        break;
    }
  };

  return { KitchenSim: KitchenSim, clamp: clamp };
});
