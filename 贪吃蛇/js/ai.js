/* ============================================================
 * ai.js —— 贪吃蛇自动寻路（BFS + 安全性检查，纯逻辑无 DOM 依赖）
 *
 * 策略（对应 require.md 步骤 7 / 风险 8.6）：
 *   1. 对每个候选方向虚拟走一步，排除立即死亡（墙/障碍/蛇身）
 *   2. 安全第一：走后蛇头必须仍能 BFS 追到蛇尾（尾随可达 = 不会立刻被困死）
 *   3. 在安全候选中优先：到食物最短路最短者
 *   4. 若无"既安全又能到食物"的方向，退而求其次：选走后可达空间（flood fill）最大者
 *   5. 全部死路时返回 null（认命）
 *   支持：穿墙模式（BFS 邻居取模）、双人模式（对指定玩家寻路）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'));
  } else {
    root.SnakeAI = factory(root.SnakeGame);
  }
})(typeof self !== 'undefined' ? self : this, function (SG) {
  'use strict';

  var DIR_LIST = [
    { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }
  ];

  function key(r, c) { return r + ',' + c; }

  /** BFS：从 start 到 goal 的最短步数；blocked 为 key 集合；支持穿墙 */
  function bfsDist(game, start, goal, blocked) {
    if (start.r === goal.r && start.c === goal.c) return 0;
    var visited = new Set([key(start.r, start.c)]);
    var queue = [{ r: start.r, c: start.c, d: 0 }];
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      for (var i = 0; i < 4; i++) {
        var nr = cur.r + DIR_LIST[i].r, nc = cur.c + DIR_LIST[i].c;
        if (game.wrapMode) {
          nr = (nr + game.rows) % game.rows;
          nc = (nc + game.cols) % game.cols;
        } else if (nr < 0 || nr >= game.rows || nc < 0 || nc >= game.cols) {
          continue;
        }
        var k = key(nr, nc);
        if (visited.has(k) || blocked.has(k)) continue;
        if (nr === goal.r && nc === goal.c) return cur.d + 1;
        visited.add(k);
        queue.push({ r: nr, c: nc, d: cur.d + 1 });
      }
    }
    return -1; // 不可达
  }

  /** flood fill：从 start 出发的可达空间大小（上限剪枝） */
  function floodFill(game, start, blocked, cap) {
    var visited = new Set([key(start.r, start.c)]);
    var queue = [start];
    var head = 0, area = 0;
    while (head < queue.length && area < cap) {
      var cur = queue[head++];
      area++;
      for (var i = 0; i < 4; i++) {
        var nr = cur.r + DIR_LIST[i].r, nc = cur.c + DIR_LIST[i].c;
        if (game.wrapMode) {
          nr = (nr + game.rows) % game.rows;
          nc = (nc + game.cols) % game.cols;
        } else if (nr < 0 || nr >= game.rows || nc < 0 || nc >= game.cols) {
          continue;
        }
        var k = key(nr, nc);
        if (visited.has(k) || blocked.has(k)) continue;
        visited.add(k);
        queue.push({ r: nr, c: nc });
      }
    }
    return area;
  }

  /** 虚拟走一步后的蛇身（不修改真实棋局） */
  function simulatedBody(snake, dir, willEat) {
    var h = snake.body[0];
    var nh = { r: h.r + dir.r, c: h.c + dir.c };
    var body = [nh];
    var keep = willEat ? snake.body.length : snake.body.length - 1;
    for (var i = 0; i < keep; i++) body.push(snake.body[i]);
    return body;
  }

  /**
   * 为 playerIdx 选择下一步方向。
   * @returns 方向对象 {r,c}；无路可走返回 null
   */
  function chooseDirection(game, playerIdx) {
    playerIdx = playerIdx || 0;
    var s = game.snakes[playerIdx];
    if (!s || !s.alive) return null;
    var head = s.body[0];

    // 阻挡集合：障碍 + 所有蛇身（近似：忽略"尾节让位"，由下方模拟精确处理自身）
    var i, j;
    var bodyKeys = new Set(game.obstacles);
    for (i = 0; i < game.snakes.length; i++) {
      var b = game.snakes[i].body;
      for (j = 0; j < b.length; j++) bodyKeys.add(key(b[j].r, b[j].c));
    }

    var best = null, bestScore = -Infinity;

    for (i = 0; i < 4; i++) {
      var dir = DIR_LIST[i];
      if (dir.r === -s.dir.r && dir.c === -s.dir.c) continue; // 禁止 180°

      var nr = head.r + dir.r, nc = head.c + dir.c;
      if (game.wrapMode) {
        nr = (nr + game.rows) % game.rows;
        nc = (nc + game.cols) % game.cols;
      } else if (nr < 0 || nr >= game.rows || nc < 0 || nc >= game.cols) {
        continue;
      }
      if (game.obstacles.has(key(nr, nc))) continue;

      var willEat = !!(game.food && game.food.r === nr && game.food.c === nc);

      // 虚拟身体（吃食物不移尾）
      var vBody = simulatedBody(s, dir, willEat);
      var vKeys = new Set();
      for (j = 0; j < vBody.length; j++) vKeys.add(key(vBody[j].r, vBody[j].c));
      // 虚拟身体不能含自身头以外的重复格（即撞自身）——除尾节让位已处理
      var dead = false;
      for (j = 1; j < vBody.length; j++) {
        if (vBody[j].r === nr && vBody[j].c === nc) { dead = true; break; }
      }
      if (dead) continue;

      // 撞对方（双人）：对方身体（近似含尾）
      var hitOther = false;
      for (j = 0; j < game.snakes.length; j++) {
        if (j === playerIdx) continue;
        var ob = game.snakes[j].body;
        for (var k2 = 0; k2 < ob.length; k2++) {
          if (ob[k2].r === nr && ob[k2].c === nc) { hitOther = true; break; }
        }
        if (hitOther) break;
      }
      if (hitOther) continue;

      // 评分
      var score = 0;
      var vBlocked = new Set(game.obstacles);
      for (j = 0; j < game.snakes.length; j++) {
        if (j === playerIdx) continue;
        var ob2 = game.snakes[j].body;
        for (var k3 = 0; k3 < ob2.length; k3++) vBlocked.add(key(ob2[k3].r, ob2[k3].c));
      }
      // 阻挡 = 对方身体 + 自己虚拟身体（去掉尾节：尾会继续让出）
      var simBlocked = new Set(vBlocked);
      for (j = 0; j < vBody.length - 1; j++) simBlocked.add(key(vBody[j].r, vBody[j].c));
      var tail = vBody[vBody.length - 1];

      // 安全性：新头能否追到（虚拟）尾
      var dTail = bfsDist(game, { r: nr, c: nc }, tail, simBlocked);
      if (dTail >= 0) score += 500; else score -= 300;

      // 到食物最短路
      if (game.food) {
        var dFood = bfsDist(game, { r: nr, c: nc }, game.food, simBlocked);
        if (dFood >= 0) score += 1000 - dFood; else score -= 100;
      }

      // 可达空间（防困死）
      score += floodFill(game, { r: nr, c: nc }, simBlocked, 400) * 0.1;

      if (score > bestScore) { bestScore = score; best = dir; }
    }
    return best;
  }

  return { chooseDirection: chooseDirection, bfsDist: bfsDist, floodFill: floodFill };
});
