/* ============================================================
 * game.js —— RaceGame 纯逻辑引擎（无 DOM 依赖，可单元测试）
 *
 * 职责：
 *   - 车辆物理（前向驱动 / 侧向抓地分解 / 漂移 / 路面阻力）
 *   - 圈数判定（totalS 单调累计 + 单步上限，防抄近路刷圈）
 *   - 圈速计时、完赛判定、实时排名
 *   - 车车圆形碰撞（分离 + 法向冲量）
 *
 * 依赖：track.js（通过构造参数注入 Track 实例，便于测试替身）
 * 物理规则详见 require.md 第 3.2 节。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./track.js'));
  } else {
    root.RaceGame = factory(root.Track);
  }
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  var normAngle = T.normAngle;

  /* ---------------- 物理常量（require.md 3.1/3.2） ---------------- */
  var PHYS = {
    STEP: 1 / 60,          // 固定物理步长（s）
    V_MAX: 55,             // 极速 m/s（≈198 km/h）
    V_REV_MAX: 12,         // 倒车极速
    ENGINE: 26,            // 推进加速度 m/s²
    BRAKE: 34,             // 制动加速度
    DRAG: 0.45,            // 前向阻力系数（/s）
    GRASS_DRAG: 1.6,       // 草地阻力系数
    GRASS_ENGINE: 0.5,     // 草地动力效率
    GRIP: 6.5,             // 侧向抓地衰减系数（/s）—— 低于 DRAG×前向效果 → 漂移
    STEER_RATE: 2.7,       // 最大转向角速度 rad/s
    V_REF: 14,             // 转向效率参考速度（达到即满效）
    NITRO_ENGINE: 1.8,     // 氮气动力倍率
    NITRO_VMAX: 1.25,      // 氮气极速倍率
    NITRO_REGEN: 4.5,      // 氮气恢复 /s
    NITRO_DRAIN: 33,       // 氮气消耗 /s
    CAR_RADIUS: 1.8,       // 碰撞半径（m）
    BOUNCE: 0.4            // 碰撞弹性系数
  };

  var CAR_COLORS = ['#ff5252', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b'];
  var AI_NAMES = ['罗盘', '疾风', '猎影', '雷霆', '夜枭'];

  /* ---------------- 工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------------- RaceGame ---------------- */
  function RaceGame(opts) {
    opts = opts || {};
    this.track = opts.track || new T.Track(opts.trackOpts || {});
    this.raceLaps = opts.raceLaps || 3;
    this.aiCount = opts.aiCount == null ? 4 : opts.aiCount;
    this.aiSkills = opts.aiSkills || null;          // 可注入固定技能（测试用）
    this.countdownEnabled = opts.countdownEnabled !== false;
    this.phys = PHYS;

    // 状态机：ready → countdown → playing ⇄ paused → finished
    this.status = 'ready';
    this.timeMs = 0;                                // 比赛计时（不含倒计时）
    this.countdown = 0;
    this.cars = [];
    this._initCars();
    this._updateRanks();
  }

  /* ---------------- 发车格布置（require.md 3.4） ---------------- */
  RaceGame.prototype._initCars = function () {
    var track = this.track, total = this.cars.length;
    var n = 1 + this.aiCount;
    for (var i = 0; i < n; i++) {
      var isAI = i > 0;
      // 发车位：起点线后方 (i+1) 格，每格 7m，横向交错
      var s = track.length - (i + 1) * 7;
      var p = track.pointAtS(s);
      var lateral = (i % 2 === 0 ? -1 : 1) * track.halfWidth * 0.44;
      var nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
      var skill = isAI
        ? (this.aiSkills ? this.aiSkills[i - 1] : 0.88 + Math.random() * 0.18)
        : 1;
      var car = {
        idx: i,
        name: isAI ? AI_NAMES[(i - 1) % AI_NAMES.length] : '玩家',
        color: CAR_COLORS[i % CAR_COLORS.length],
        isAI: isAI,
        skill: skill,
        // 位姿与速度
        x: p.x + nx * lateral, y: p.y + ny * lateral,
        angle: p.angle,
        vx: 0, vy: 0,
        speed: 0, slide: 0,
        // 输入
        steer: 0, throttle: 0, brake: 0, nitroActive: false,
        nitro: 100,
        // 路面状态
        onTrack: true, lateral: lateral,
        s: s, totalS: 0, lastS: s, hintIdx: null,
        // 圈数与成绩
        lap: 0, lapStartMs: 0, lastLapMs: 0, bestLapMs: 0,
        finished: false, finishTimeMs: 0, rank: i + 1,
        offTrackTicks: 0
      };
      this.cars.push(car);
    }
    // 弧长校准：用投影结果初始化 lastS，避免首次 tick 因采样近似
    // 产生微负 totalS → 起步跨线记出"假圈速"
    for (var j = 0; j < this.cars.length; j++) {
      var cj = this.cars[j];
      var near = track.nearest(cj.x, cj.y);
      cj.lastS = near.s;
      cj.hintIdx = near.idx;
    }
  };

  /* ---------------- 外部输入接口 ---------------- */
  RaceGame.prototype.setPlayerInput = function (inp) {
    var c = this.cars[0];
    if (!c || c.finished) return;
    c.steer = clamp(inp.steer || 0, -1, 1);
    c.throttle = clamp(inp.throttle || 0, 0, 1);
    c.brake = clamp(inp.brake || 0, 0, 1);
    c.nitroActive = !!inp.nitro;
  };

  /* ---------------- 开始 / 暂停 / 重开 ---------------- */
  RaceGame.prototype.start = function () {
    if (this.status !== 'ready') return;
    this.status = this.countdownEnabled ? 'countdown' : 'playing';
    this.countdown = this.countdownEnabled ? 3 : 0;
  };
  RaceGame.prototype.pause = function () { if (this.status === 'playing' || this.status === 'countdown') this.status = 'paused'; };
  RaceGame.prototype.resume = function () {
    if (this.status === 'paused') this.status = this.countdown > 0 ? 'countdown' : 'playing';
  };
  RaceGame.prototype.togglePause = function () {
    if (this.status === 'playing' || this.status === 'countdown') this.pause();
    else if (this.status === 'paused') this.resume();
  };

  /* ---------------- 主 tick ---------------- */
  RaceGame.prototype.tick = function (dt) {
    if (this.status !== 'playing' && this.status !== 'countdown') return;
    dt = dt || PHYS.STEP;

    if (this.status === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.status = 'playing'; }
      // 倒计时期间物理照常（车辆静止），但输入被锁
    }

    var locked = this.status === 'countdown';
    for (var i = 0; i < this.cars.length; i++) {
      var c = this.cars[i];
      // 倒计时期间锁输入（物理照常，车辆静止）；完赛车辆自动刹车滑停
      this._physCar(c, dt, locked ? { steer: 0, throttle: 0, brake: 0, nitro: false } : c);
    }

    this._collide();
    this._updateRanks();

    if (this.status === 'playing') this.timeMs += dt * 1000;
  };

  /* ---------------- 单车物理（require.md 3.2） ---------------- */
  RaceGame.prototype._physCar = function (car, dt, inp) {
    var P = PHYS;
    var locked = this.status === 'countdown';
    var steer = locked ? 0 : clamp(inp.steer || 0, -1, 1);
    var throttle = locked ? 0 : clamp(inp.throttle || 0, 0, 1);
    var brake = locked ? 0 : clamp(inp.brake || 0, 0, 1);
    var nitroOn = !locked && !!inp.nitroActive && car.nitro > 0 && !car.finished;

    // 氮气
    if (nitroOn) car.nitro = Math.max(0, car.nitro - P.NITRO_DRAIN * dt);
    else car.nitro = Math.min(100, car.nitro + P.NITRO_REGEN * dt);
    car.nitroActive = nitroOn;   // 写回实际生效状态（渲染尾焰用）

    // 完赛车：停油轻刹滑停（不倒车），方向回正
    if (car.finished) {
      throttle = 0;
      steer = 0;
      nitroOn = false;
      car.nitroActive = false;
    }

    // 速度沿车身分解（记录分解时的基向量：合成时必须用同一组基，
    // 这样转向只改变车身朝向，速度矢量保持 —— 下一 tick 分解时自然出现
    // 侧向分量 vS，即"漂移"）
    var cosA = Math.cos(car.angle), sinA = Math.sin(car.angle);
    var vF = car.vx * cosA + car.vy * sinA;                    // 前向分量
    var vS = -car.vx * sinA + car.vy * cosA;                   // 侧向分量（左侧为正）

    // 1) 转向：效率与车速成正比，倒车反向
    var steerEff = clamp(vF / P.V_REF, -1, 1);
    car.angle += steer * P.STEER_RATE * steerEff * dt;

    // 2) 推进 / 3) 制动
    var engine = P.ENGINE * (car.onTrack ? 1 : P.GRASS_ENGINE) * (nitroOn ? P.NITRO_ENGINE : 1);
    vF += throttle * engine * dt;
    if (!car.finished || vF > 0.5) vF -= brake * P.BRAKE * dt;   // 停稳后不再加刹（防倒车巡游）
    var vmax = P.V_MAX * (car.onTrack ? 1 : 0.45) * (nitroOn ? P.NITRO_VMAX : 1) * (car.isAI ? car.skill : 1);
    vF = clamp(vF, car.isAI ? 0 : -P.V_REV_MAX, vmax);           // AI 不倒车（避免完赛掉头乱跑）

    // 4) 阻力 / 5) 抓地
    var drag = car.onTrack ? P.DRAG : P.GRASS_DRAG;
    vF -= vF * drag * dt;
    vS -= vS * P.GRIP * dt * (car.onTrack ? 1 : 0.55);

    // 6) 合成并积分（用分解时的基向量，见上）
    car.vx = vF * cosA - vS * sinA;
    car.vy = vF * sinA + vS * cosA;
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // 路面投影
    var near = this.track.nearest(car.x, car.y, car.hintIdx);
    car.hintIdx = near.idx;
    car.onTrack = near.onTrack;
    car.lateral = near.lateral;
    car.offTrackTicks = near.onTrack ? 0 : car.offTrackTicks + 1;
    car.slide = Math.abs(vS);          // 侧滑量（痕迹/漂移判定用）
    car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);

    // 圈数推进（require.md 3.3）
    var track = this.track;
    var ds = track.wrapDelta(near.s - car.lastS);
    var cap = (P.V_MAX * P.NITRO_VMAX + 5) * dt;      // 单步上限（防瞬移刷圈）
    if (ds > cap) ds = cap;
    if (ds < -cap) ds = -cap;
    car.totalS += ds;
    car.lastS = near.s;
    car.s = near.s;

    var newLap = Math.floor(car.totalS / track.length);
    if (newLap > car.lap && !car.finished) {
      var lapMs = this.timeMs - car.lapStartMs;
      if (car.lap >= 0 && lapMs > 0) {
        car.lastLapMs = lapMs;
        if (!car.bestLapMs || lapMs < car.bestLapMs) car.bestLapMs = lapMs;
      }
      car.lap = newLap;
      car.lapStartMs = this.timeMs;
      if (car.lap >= this.raceLaps) {
        car.finished = true;
        car.finishTimeMs = this.timeMs;
      }
    } else if (newLap < car.lap) {
      car.lap = newLap;   // 倒车跨线回退圈数（再前进会重新记，不刷圈）
    }
  };

  /* ---------------- 车车碰撞（require.md 步骤 4） ---------------- */
  RaceGame.prototype._collide = function () {
    var cars = this.cars, r = PHYS.CAR_RADIUS, d2Min = (r * 2) * (r * 2);
    for (var i = 0; i < cars.length; i++) {
      for (var j = i + 1; j < cars.length; j++) {
        var a = cars[i], b = cars[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 >= d2Min || d2 < 1e-9) continue;
        var d = Math.sqrt(d2);
        var nx = dx / d, ny = dy / d;
        var overlap = r * 2 - d;
        // 位置分离：各推开一半
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        // 法向速度分量交换（带弹性系数）
        var va = a.vx * nx + a.vy * ny;
        var vb = b.vx * nx + b.vy * ny;
        if (va - vb > 0) {   // 仅在相互接近时施加冲量
          var m = (va - vb) * (1 + PHYS.BOUNCE) / 2;
          a.vx -= m * nx; a.vy -= m * ny;
          b.vx += m * nx; b.vy += m * ny;
          a.hit = true; b.hit = true;
        }
      }
    }
  };

  /* ---------------- 排名（totalS 降序，完赛者按完赛时间优先） ---------------- */
  RaceGame.prototype._updateRanks = function () {
    var sorted = this.cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalS - a.totalS;
    });
    for (var i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
    this.ranking = sorted;
  };

  /* ---------------- 比赛是否结束（玩家完赛即定格） ---------------- */
  RaceGame.prototype.playerFinished = function () {
    return this.cars[0].finished;
  };

  return { RaceGame: RaceGame, PHYS: PHYS, clamp: clamp };
});
