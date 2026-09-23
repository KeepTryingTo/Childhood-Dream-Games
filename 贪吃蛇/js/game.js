/* ============================================================
 * game.js —— SnakeGame 纯逻辑引擎（无 DOM/Canvas 依赖，可单元测试）
 *
 * 支持：
 *   - 单人 / 双人（twoPlayer）
 *   - 穿墙模式（wrapMode）
 *   - 静态障碍物（obstacleCount > 0）
 *   - 动态加速（accel：每吃 5 个食物 speedMs *= 0.92，下限 60ms）
 *   - 特殊食物（bonus 加分 / slow 减速 / shrink 缩身，限时消失）
 *
 * 规则要点（对应 require.md 第 3 节）：
 *   - 每个 tick：应用方向缓冲 → 新头 = 旧头 + 方向
 *   - 吃到食物：不移除尾部（蛇长 +1），否则移除尾部
 *   - 先判碰撞再移动；普通移动时"尾节会让出位置"，不算撞自身；
 *     吃食物（不移尾）时尾节仍算障碍
 *   - 输入缓冲：dirQueue 最多缓存 2 个方向，禁止 180° 反向与同向重复
 *   - 食物生成：收集全部空格随机选取，空格为 0 时判满盘胜利
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeGame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- 常量与工具 ----------------
  var DIRS = {
    up:    { r: -1, c: 0 },
    down:  { r: 1,  c: 0 },
    left:  { r: 0,  c: -1 },
    right: { r: 0,  c: 1 }
  };
  var DIR_LIST = [DIRS.up, DIRS.down, DIRS.left, DIRS.right];
  var SPECIAL_TYPES = ['bonus', 'slow', 'shrink'];
  var SPECIAL_LIFETIME = 50;   // 特殊食物存活 tick 数
  var MIN_SPEED = 60;          // 动态加速下限
  var MAX_SLOW = 250;          // 减速上限

  function key(r, c) { return r + ',' + c; }
  function opposite(a, b) { return a.r === -b.r && a.c === -b.c; }
  function same(a, b) { return a.r === b.r && a.c === b.c; }
  function inBoard(rows, cols, r, c) { return r >= 0 && r < rows && c >= 0 && c < cols; }

  function SnakeGame(opts) {
    opts = opts || {};
    this.rows = opts.rows || 20;
    this.cols = opts.cols || 20;
    this.wrapMode = !!opts.wrapMode;
    this.accel = !!opts.accel;
    this.twoPlayer = !!opts.twoPlayer;
    this.speedMs = opts.speedMs || 150;
    this.baseSpeedMs = this.speedMs;
    this.obstacleCount = opts.obstacleCount || 0;

    this.status = 'ready';      // ready | playing | paused | over
    this.win = false;
    this.deathReason = '';      // wall | obstacle | self | other | headon
    this.winner = -1;           // 双人模式：0/1 胜者；-1 平局；单人无意义
    this.eatenCount = 0;
    this.tickCount = 0;
    this.food = null;
    this.specialFood = null;
    this.obstacles = new Set(); // key(r,c)

    this._init();
  }

  SnakeGame.prototype._init = function () {
    var mr = Math.floor(this.rows / 2), mc = Math.floor(this.cols / 2);

    // 蛇体：有序坐标队列，头在队首；初始长度 3、朝右、居中
    this.snakes = [this._makeSnake(mr, mc, DIRS.right)];
    if (this.twoPlayer) {
      this.snakes.push(this._makeSnake(this.rows - 1 - mr, this.cols - 1 - mc, DIRS.left));
    }

    this._genObstacles();
    this.spawnFood();
  };

  SnakeGame.prototype._makeSnake = function (r, c, dir) {
    var body = [
      { r: r, c: c },
      { r: r - dir.r, c: c - dir.c },
      { r: r - 2 * dir.r, c: c - 2 * dir.c }
    ];
    var occ = new Set();
    for (var i = 0; i < body.length; i++) occ.add(key(body[i].r, body[i].c));
    return { body: body, occ: occ, dir: dir, dirQueue: [], alive: true, score: 0 };
  };

  /** 随机生成障碍：避开两蛇初始身体及其前方 3 格 */
  SnakeGame.prototype._genObstacles = function () {
    if (this.obstacleCount <= 0) return;
    var protectedKeys = new Set();
    var self = this;
    this.snakes.forEach(function (s) {
      var h = s.body[0];
      // 蛇身 + 前方 3 格 + 周围一圈
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          protectedKeys.add(key(h.r + dr, h.c + dc));
        }
      }
      for (var i = 1; i <= 3; i++) {
        protectedKeys.add(key(h.r + s.dir.r * i, h.c + s.dir.c * i));
      }
    });

    var tries = 0;
    var placed = 0;
    while (placed < this.obstacleCount && tries < this.obstacleCount * 50) {
      tries++;
      var r = Math.floor(Math.random() * this.rows);
      var c = Math.floor(Math.random() * this.cols);
      var k = key(r, c);
      if (protectedKeys.has(k) || this.obstacles.has(k)) continue;
      this.obstacles.add(k);
      placed++;
    }
  };

  /** 收集全部空格 key（排除所有蛇身、障碍、食物、特殊食物） */
  SnakeGame.prototype._freeCells = function () {
    var occ = new Set(this.obstacles);
    var i, j, s;
    for (i = 0; i < this.snakes.length; i++) {
      s = this.snakes[i];
      for (j = 0; j < s.body.length; j++) occ.add(key(s.body[j].r, s.body[j].c));
    }
    if (this.food) occ.add(key(this.food.r, this.food.c));
    if (this.specialFood) occ.add(key(this.specialFood.r, this.specialFood.c));

    var free = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (!occ.has(key(r, c))) free.push({ r: r, c: c });
      }
    }
    return free;
  };

  /**
   * 在空格中随机生成普通食物。
   * @returns false 表示无空格（满盘胜利情形），不进入死循环
   */
  SnakeGame.prototype.spawnFood = function () {
    var free = this._freeCells();
    if (free.length === 0) { this.food = null; return false; }
    var p = free[Math.floor(Math.random() * free.length)];
    this.food = { r: p.r, c: p.c };
    return true;
  };

  SnakeGame.prototype._spawnSpecial = function () {
    var free = this._freeCells();
    if (free.length === 0) return;
    var p = free[Math.floor(Math.random() * free.length)];
    this.specialFood = {
      r: p.r, c: p.c,
      type: SPECIAL_TYPES[Math.floor(Math.random() * SPECIAL_TYPES.length)],
      born: this.tickCount
    };
  };

  /**
   * 设置某玩家下一步方向（写入缓冲队列，队列长度上限 2）。
   * 过滤：与"队列末尾方向或当前方向"相同（重复）或相反（180°）的方向不入队。
   */
  SnakeGame.prototype.setDirection = function (dir, playerIdx) {
    var s = this.snakes[playerIdx || 0];
    if (!s || !s.alive || !dir) return false;
    var ref = s.dirQueue.length ? s.dirQueue[s.dirQueue.length - 1] : s.dir;
    if (same(dir, ref) || opposite(dir, ref)) return false;
    if (s.dirQueue.length < 2) { s.dirQueue.push(dir); return true; }
    return false;
  };

  /** 应用方向缓冲：取第一个合法（非反向、非同向）方向 */
  SnakeGame.prototype._applyDir = function (s) {
    while (s.dirQueue.length) {
      var d = s.dirQueue.shift();
      if (!opposite(d, s.dir) && !same(d, s.dir)) { s.dir = d; break; }
    }
  };

  /** 撞自身判定：普通移动时尾节会让出，不计入障碍；吃食物（不移尾）时计入 */
  SnakeGame.prototype._hitsSelf = function (s, nr, nc, willEat) {
    var k = key(nr, nc);
    if (!s.occ.has(k)) return false;
    if (!willEat) {
      var tail = s.body[s.body.length - 1];
      if (tail.r === nr && tail.c === nc) return false; // 尾节将让出
    }
    return true;
  };

  /** 主逻辑步进 */
  SnakeGame.prototype.tick = function () {
    if (this.status !== 'playing') return; // T9：暂停/未开始时逻辑不推进
    this.tickCount++;

    // 特殊食物过期
    if (this.specialFood && this.tickCount - this.specialFood.born > SPECIAL_LIFETIME) {
      this.specialFood = null;
    }

    // 1. 应用方向缓冲
    for (var i = 0; i < this.snakes.length; i++) {
      if (this.snakes[i].alive) this._applyDir(this.snakes[i]);
    }

    // 2. 各蛇计算新头 + 撞墙（含穿墙）+ 障碍
    var moves = [];
    for (i = 0; i < this.snakes.length; i++) {
      var s = this.snakes[i];
      if (!s.alive) { moves.push(null); continue; }
      var h = s.body[0];
      var nr = h.r + s.dir.r, nc = h.c + s.dir.c;
      if (!inBoard(this.rows, this.cols, nr, nc)) {
        if (this.wrapMode) {                       // 穿墙：取模绕回
          nr = (nr + this.rows) % this.rows;
          nc = (nc + this.cols) % this.cols;
        } else {
          moves.push({ dead: 'wall' });
          continue;
        }
      }
      if (this.obstacles.has(key(nr, nc))) {       // 穿墙模式下障碍仍致死
        moves.push({ dead: 'obstacle' });
        continue;
      }
      moves.push({ nr: nr, nc: nc });
    }

    // 3. 吃食判定
    var willEat = [];
    for (i = 0; i < this.snakes.length; i++) {
      var m = moves[i];
      willEat[i] = m && !m.dead && this.food &&
                   m.nr === this.food.r && m.nc === this.food.c;
    }
    var specialEater = -1, specialType = null;
    for (i = 0; i < this.snakes.length; i++) {
      var m2 = moves[i];
      if (m2 && !m2.dead && !willEat[i] && this.specialFood &&
          m2.nr === this.specialFood.r && m2.nc === this.specialFood.c) {
        specialEater = i; specialType = this.specialFood.type;
        break; // 先到先得
      }
    }

    // 4. 死亡判定：自身 / 对方身体 / 头对头
    for (i = 0; i < this.snakes.length; i++) {
      if (moves[i] && !moves[i].dead) {
        var me = this.snakes[i];
        if (this._hitsSelf(me, moves[i].nr, moves[i].nc, willEat[i])) {
          moves[i] = { dead: 'self' };
        }
      }
    }
    if (this.twoPlayer) {
      var a = 0, b = 1;
      // 头对头
      if (moves[a] && !moves[a].dead && moves[b] && !moves[b].dead &&
          moves[a].nr === moves[b].nr && moves[a].nc === moves[b].nc) {
        moves[a] = { dead: 'headon' };
        moves[b] = { dead: 'headon' };
      } else {
        // 撞对方身体（保守规则：含对方尾节，即使对方不吃食）
        if (moves[a] && !moves[a].dead &&
            this.snakes[b].occ.has(key(moves[a].nr, moves[a].nc))) {
          moves[a] = { dead: 'other' };
        }
        if (moves[b] && !moves[b].dead &&
            this.snakes[a].occ.has(key(moves[b].nr, moves[b].nc))) {
          moves[b] = { dead: 'other' };
        }
      }
    }

    // 5. 死亡处理（先判死，不移动死者）
    var deaths = [];
    for (i = 0; i < this.snakes.length; i++) {
      if (moves[i] && moves[i].dead) deaths.push({ idx: i, reason: moves[i].dead });
    }
    if (deaths.length > 0) {
      deaths.forEach(function (d) { this.snakes[d.idx].alive = false; }, this);
      this.status = 'over';
      this.deathReason = deaths[0].reason;
      if (this.twoPlayer) {
        this.winner = deaths.length === 2 ? -1 : (deaths[0].idx === 0 ? 1 : 0);
      }
      return;
    }

    // 6. 应用移动：头入队；吃到食物不移尾（长 +1），否则移尾
    for (i = 0; i < this.snakes.length; i++) {
      var s2 = this.snakes[i];
      var mv = moves[i];
      s2.body.unshift({ r: mv.nr, c: mv.nc });
      s2.occ.add(key(mv.nr, mv.nc));
      if (!willEat[i]) {
        var tail = s2.body.pop();
        s2.occ.delete(key(tail.r, tail.c));
      } else {
        // 吃到普通食物：加分、计数、刷新食物、加速、特殊食物
        s2.score += 10;
        this.eatenCount++;
        if (this.accel && this.eatenCount % 5 === 0) {
          this.speedMs = Math.max(MIN_SPEED, Math.round(this.speedMs * 0.92));
        }
        if (!this.specialFood && this.eatenCount % 5 === 0 && Math.random() < 0.6) {
          this._spawnSpecial();
        }
        var ok = this.spawnFood();
        if (!ok) {                               // 满盘 → 胜利结束
          this.status = 'over';
          this.win = true;
          return;
        }
      }
    }

    // 7. 吃特殊食物效果
    if (specialEater >= 0) {
      this._applySpecial(specialEater, specialType);
      this.specialFood = null;
    }
  };

  SnakeGame.prototype._applySpecial = function (idx, type) {
    var s = this.snakes[idx];
    if (type === 'bonus') {
      s.score += 50;
    } else if (type === 'slow') {
      this.speedMs = Math.min(MAX_SLOW, Math.round(this.speedMs * 1.25));
    } else if (type === 'shrink') {
      var cut = Math.min(2, s.body.length - 2);   // 至少保留 2 节
      for (var i = 0; i < cut; i++) {
        var t = s.body.pop();
        s.occ.delete(key(t.r, t.c));
      }
      s.score += 20;
    }
  };

  /** 单人分数快捷读取（双人请读 snakes[i].score） */
  SnakeGame.prototype.scoreOf = function (idx) {
    return this.snakes[idx || 0].score;
  };

  /** 重开（保持构造参数） */
  SnakeGame.prototype.reset = function () {
    SnakeGame.call(this, {
      rows: this.rows, cols: this.cols,
      wrapMode: this.wrapMode, accel: this.accel,
      twoPlayer: this.twoPlayer, speedMs: this.baseSpeedMs,
      obstacleCount: this.obstacleCount
    });
  };

  return SnakeGame;
});
