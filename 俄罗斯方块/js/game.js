/* ============================================================
 * game.js —— TetrisGame 主引擎（纯逻辑，无 DOM 依赖，可单元测试）
 * UMD：浏览器(挂 window.TetrisGame) / Node(require) 双端可用
 *
 * 状态机：ready →(start)→ playing ⇄ paused
 *                playing →(spawn 即碰撞)→ over →(start)→ playing
 *
 * 两阶段锁定（消行动画与逻辑解耦）：
 *   lockPiece() 写入网格并检测满行：
 *     - 有满行 → 挂起 clearingRows（UI 可渲染闪烁），由 updateClearing(dt)
 *       倒计时后调用 finishClear()：真正移除行 + 计分 + 升级 + spawn；
 *     - 无满行 → 立即计分完成并 spawn。
 *
 * 计分（require.md 3.4，硬降按经典 NES 语义实现为"每格 2×等级"）：
 *   消行 [0,100,300,500,800]×等级；软降每格 1×等级；硬降每格 2×等级。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./rules.js'));
  } else {
    root.TetrisGame = factory(root.TetrisModel, root.TetrisRules);
  }
})(typeof self !== 'undefined' ? self : this, function (M, R) {
  'use strict';

  function TetrisGame(opts) {
    opts = opts || {};
    this.rows = opts.rows || 20;
    this.cols = opts.cols || 10;
    this.rng = opts.rng || Math.random;              // 可注入随机源（测试确定性）
    this.clearingMs = opts.clearingMs !== undefined ? opts.clearingMs : 320;

    this.grid = R.createEmptyGrid(this.rows, this.cols);
    this.queue = [];                                  // 方块类型队列（7-bag 补充）
    this.current = null;                              // {type, rotation, row, col}
    this.hold = null;                                 // 暂存方块类型
    this.holdUsed = false;                            // 每轮锁定仅允许一次 Hold
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.status = 'ready';                            // ready|playing|paused|over
    this.clearingRows = [];                           // 待消除行（闪烁动画中）
    this.clearingTimer = 0;
    this.pieceCount = 0;
    this.lastLockLines = 0;                           // 最近一次锁定的消行数（UI 提示用）

    this._fillQueue();
  }

  /** 队列保持至少 5 个（当前取 1 + 预览 3 + 冗余），空则补充新的 7-bag */
  TetrisGame.prototype._fillQueue = function () {
    while (this.queue.length < 5) {
      var bag = M.createBagWith(this.rng);
      for (var i = 0; i < bag.length; i++) this.queue.push(bag[i]);
    }
  };

  /** 重开：恢复到初始状态（T13） */
  TetrisGame.prototype.reset = function () {
    this.grid = R.createEmptyGrid(this.rows, this.cols);
    this.queue = [];
    this.current = null;
    this.hold = null;
    this.holdUsed = false;
    this.score = 0;
    this.level = 1;
    this.lines = 0;
    this.status = 'ready';
    this.clearingRows = [];
    this.clearingTimer = 0;
    this.pieceCount = 0;
    this.lastLockLines = 0;
    this._fillQueue();
  };

  /** 开始游戏（从 ready / over 均可） */
  TetrisGame.prototype.start = function () {
    this.reset();
    this.status = 'playing';
    this.spawn();
    return this.current;
  };

  TetrisGame.prototype.pause = function () {
    if (this.status === 'playing') this.status = 'paused';
  };

  TetrisGame.prototype.resume = function () {
    if (this.status === 'paused') this.status = 'playing';
  };

  /** 按当前等级的自然下落间隔（毫秒） */
  TetrisGame.prototype.getFallInterval = function () {
    return R.fallInterval(this.level);
  };

  /** 从队列生成新方块（7-bag 消耗）；生成即碰撞 → 游戏结束（风险 5） */
  TetrisGame.prototype.spawn = function (type) {
    this._fillQueue();
    var t = type || this.queue.shift();
    this.pieceCount++;
    this.holdUsed = false;                            // 新一轮解锁 Hold
    this.current = {
      type: t,
      rotation: 0,
      row: 0,
      col: M.spawnCol(this.cols, t)
    };
    this.lastLockLines = 0;
    var shape = M.shapeOf(t, 0);
    if (!R.isValid(this.grid, shape, this.current.row, this.current.col)) {
      this.status = 'over';                           // 顶部被堵死 → 游戏结束
    }
    return this.current;
  };

  /** 是否可执行动作（播放中、非消行闪烁中、当前块存在） */
  TetrisGame.prototype._canAct = function () {
    return this.status === 'playing' && this.current && this.clearingRows.length === 0;
  };

  /** 左移 / 右移（T2）：不越界、不与锁定块重叠时生效 */
  TetrisGame.prototype.move = function (dCol) {
    if (!this._canAct()) return false;
    var p = this.current;
    var shape = M.shapeOf(p.type, p.rotation);
    if (R.isValid(this.grid, shape, p.row, p.col + dCol)) {
      p.col += dCol;
      return true;
    }
    return false;
  };

  TetrisGame.prototype.moveLeft = function () { return this.move(-1); };
  TetrisGame.prototype.moveRight = function () { return this.move(1); };

  /**
   * 软降一格（T3）：可下移则下移并计 1×等级；触底则锁定。
   * @returns {'moved'|'locked'|'idle'}
   */
  TetrisGame.prototype.softDrop = function () {
    if (!this._canAct()) return 'idle';
    var p = this.current;
    var shape = M.shapeOf(p.type, p.rotation);
    if (R.isValid(this.grid, shape, p.row + 1, p.col)) {
      p.row++;
      this.score += this.level;                       // 软降每格 1×等级
      return 'moved';
    }
    this.lockPiece();
    return 'locked';
  };

  /** 自然下落一格（不计分）；触底则锁定 */
  TetrisGame.prototype.tick = function () {
    if (!this._canAct()) return 'idle';
    var p = this.current;
    var shape = M.shapeOf(p.type, p.rotation);
    if (R.isValid(this.grid, shape, p.row + 1, p.col)) {
      p.row++;
      return 'moved';
    }
    this.lockPiece();
    return 'locked';
  };

  /** 硬降（T4）：瞬间落到底并锁定，每格计 2×等级 */
  TetrisGame.prototype.hardDrop = function () {
    if (!this._canAct()) return 'idle';
    var p = this.current;
    var shape = M.shapeOf(p.type, p.rotation);
    var dist = 0;
    while (R.isValid(this.grid, shape, p.row + 1, p.col)) {
      p.row++;
      dist++;
    }
    if (dist > 0) this.score += dist * 2 * this.level; // 硬降每格 2×等级（NES）
    this.lockPiece();
    return 'locked';
  };

  /** 幽灵方块落点行（E1，供渲染半透明投影） */
  TetrisGame.prototype.ghostRow = function () {
    if (!this.current) return -1;
    var p = this.current;
    var shape = M.shapeOf(p.type, p.rotation);
    var row = p.row;
    while (R.isValid(this.grid, shape, row + 1, p.col)) row++;
    return row;
  };

  /** 顺时针旋转（T5/T6：SRS 踢墙） */
  TetrisGame.prototype.rotateCW = function () {
    if (!this._canAct()) return false;
    var res = R.rotateCWWithKick(this.grid, this.current);
    if (res.ok) {
      this.current.rotation = res.rotation;
      this.current.row = res.row;
      this.current.col = res.col;
    }
    return res.ok;
  };

  /** 逆时针旋转（扩展） */
  TetrisGame.prototype.rotateCCW = function () {
    if (!this._canAct()) return false;
    var res = R.rotateCCWWithKick(this.grid, this.current);
    if (res.ok) {
      this.current.rotation = res.rotation;
      this.current.row = res.row;
      this.current.col = res.col;
    }
    return res.ok;
  };

  /**
   * 锁定当前方块到网格（T7）→ 检测满行：
   *   有满行：挂起消行动画（clearingRows），等待 updateClearing 推进；
   *   无满行：直接 spawn 下一块。
   */
  TetrisGame.prototype.lockPiece = function () {
    var p = this.current;
    if (!p) return { cleared: 0, pendingClear: false };
    var shape = M.shapeOf(p.type, p.rotation);

    var overflow = false;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        var gr = p.row + r, gc = p.col + c;
        if (gr < 0) { overflow = true; continue; }   // 锁定在顶部隐藏区 → 结束
        this.grid[gr][gc] = M.TYPES.indexOf(p.type) + 1;
      }
    }
    this.current = null;

    if (overflow) {
      this.status = 'over';
      return { cleared: 0, pendingClear: false, overflow: true };
    }

    var fullRows = R.findFullRows(this.grid);
    if (fullRows.length > 0) {
      this.clearingRows = fullRows;
      this.clearingTimer = this.clearingMs;
      return { cleared: fullRows.length, pendingClear: true };
    }
    this.lastLockLines = 0;
    this.spawn();
    return { cleared: 0, pendingClear: false };
  };

  /** 消行动画倒计时；到时执行真正消行 + 计分 + 升级 + spawn */
  TetrisGame.prototype.updateClearing = function (dtMs) {
    if (!this.clearingRows.length) return 0;
    this.clearingTimer -= dtMs;
    if (this.clearingTimer > 0) return -1;            // 仍在闪烁
    return this.finishClear();
  };

  /** 执行消行：移除满行 → 计分 → 每 10 行升级（T8/T9/T11）→ spawn（T10） */
  TetrisGame.prototype.finishClear = function () {
    var rows = this.clearingRows;
    this.clearingRows = [];
    this.clearingTimer = 0;
    var n = rows.length;

    R.removeRows(this.grid, rows);
    this.lines += n;
    this.score += R.scoreForLines(n, this.level);
    this.level = Math.floor(this.lines / 10) + 1;     // 每 10 行升 1 级（T11）
    this.lastLockLines = n;

    this.spawn();
    return n;
  };

  /**
   * Hold 储存（T14）：每轮锁定仅可切换一次。
   * 首次：当前入 Hold，生成新块；已有暂存：交换，位置重置到 spawn。
   */
  TetrisGame.prototype.holdSwap = function () {
    if (!this._canAct() || this.holdUsed) return false;
    var curType = this.current.type;

    if (this.hold) {
      var swap = this.hold;
      this.hold = curType;
      this.current = {
        type: swap,
        rotation: 0,
        row: 0,
        col: M.spawnCol(this.cols, swap)
      };
      var shape = M.shapeOf(swap, 0);
      if (!R.isValid(this.grid, shape, this.current.row, this.current.col)) {
        this.status = 'over';
      }
    } else {
      this.hold = curType;
      this.spawn();                                   // spawn 内部重置 holdUsed
    }
    this.holdUsed = true;
    return true;
  };

  return TetrisGame;
});
