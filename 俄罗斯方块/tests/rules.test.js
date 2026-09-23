/* ============================================================
 * rules.test.js —— 俄罗斯方块逻辑引擎单元测试
 * （7-bag / 碰撞移动 / 旋转踢墙 / 消行计分 / 等级 / Hold / 状态机）
 * Node 运行：node tests/rules.test.js
 * ============================================================ */
'use strict';
var path = require('path');
var M = require(path.join(__dirname, '../js/model.js'));
var R = require(path.join(__dirname, '../js/rules.js'));
var TetrisGame = require(path.join(__dirname, '../js/game.js'));

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function assertEq(a, b, msg) { assert(a === b, (msg || 'assertEq') + ` (实际 ${a}，期望 ${b})`); }

/** 确定性随机源：恒 0 → bag 固定为 [O,T,S,Z,J,L,I] */
function zeroRng() { return 0; }

function newGame(opts) {
  return new TetrisGame(Object.assign({ rng: zeroRng, clearingMs: 100 }, opts || {}));
}

/** 在网格中把指定行铺满（用 1 填充） */
function fillRow(grid, r, val) {
  for (var c = 0; c < grid[r].length; c++) grid[r][c] = val || 1;
}

/* ================= T1 / T15：7-bag ================= */

test('T1: 7-bag 保证每组 7 块中每种恰好出现一次', function () {
  var g = newGame();
  var all = [];
  for (var i = 0; i < 3; i++) all = all.concat(M.createBagWith(zeroRng));
  var counts = {};
  all.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  assertEq(Object.keys(counts).length, 7, '七种都出现');
  M.TYPES.forEach(function (t) { assertEq(counts[t], 3, t + ' 每 bag 一次×3'); });
});

test('T15: 队列空时无缝补充新 bag（消耗 30 块不丢块）', function () {
  var g = newGame();
  g.start();
  var seen = [];
  for (var i = 0; i < 30; i++) {
    g.spawn();
    seen.push(g.current.type);
    // 每次锁定处理：无消行直接 spawn（铺底防溢出 over）
    if (g.status === 'over') { g.grid = R.createEmptyGrid(g.rows, g.cols); g.spawn(); }
  }
  assertEq(seen.length, 30, '持续生成 30 块');
  var counts = {};
  seen.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  M.TYPES.forEach(function (t) {
    assert(counts[t] >= 4 && counts[t] <= 5, t + ' 分布均匀(30块≈4~5个)，实际 ' + counts[t]);
  });
});

test('model: 每种方块旋转 4 次回到初始状态', function () {
  M.TYPES.forEach(function (t) {
    var s = M.SHAPES[t];
    var r1 = M.rotateCW(s), r2 = M.rotateCW(r1), r3 = M.rotateCW(r2), r4 = M.rotateCW(r3);
    assert(JSON.stringify(r4) === JSON.stringify(s), t + ' 旋转 4 次复原');
    assert(M.shapeOf(t, 2) && M.shapeOf(t, 3), '缓存接口可用');
  });
});

/* ================= T2 移动 ================= */

test('T2: 方块左移/右移不越界、不与锁定块重叠', function () {
  var g = newGame();
  g.start();
  g.spawn('O');                       // O 占 col 4~5
  assertEq(g.current.col, 4, 'O spawn 居中 col=4');
  for (var i = 0; i < 4; i++) assert(g.moveLeft() === true, '左移×4');
  assertEq(g.current.col, 0);
  assert(g.moveLeft() === false, '贴左墙不可再移');
  for (var j = 0; j < 8; j++) g.moveRight();
  assertEq(g.current.col, 8, '右移到贴墙 col=8');
  assert(g.moveRight() === false, '贴右墙不可再移');

  // 与锁定块重叠：O 贴地（row17，占 17~18），两侧 18 行有锁定块
  g.grid = R.createEmptyGrid(20, 10);
  fillRow(g.grid, 19);                // 地面
  g.grid[18][3] = 1;                  // 左侧阻挡（新位置 (18,3) 冲突）
  g.grid[18][6] = 1;                  // 右侧阻挡
  g.current = { type: 'O', rotation: 0, row: 17, col: 4 };
  assert(g.moveLeft() === false, '被锁定块挡住不能左移');
  assert(g.moveRight() === false, '被锁定块挡住不能右移');
  assert(g.softDrop() === 'locked', '正下方是地面 → 软降即锁定');
});

/* ================= T3 软降 / T4 硬降 ================= */

test('T3: 软降每格计 1×等级，触底锁定', function () {
  var g = newGame();
  g.start();
  g.spawn('O');
  var before = g.score;
  assert(g.softDrop() === 'moved', '下移成功');
  assertEq(g.current.row, 1);
  assertEq(g.score, before + g.level, '软降 +1×level');

  g.current.row = 18;                 // O 占 19 → 再软降即锁定
  var r = g.softDrop();
  assert(r === 'locked', '触底锁定');
  assertEq(g.grid[19][4], M.TYPES.indexOf('O') + 1, 'O 已写入网格');
});

test('T4: 硬降瞬间落底并锁定，每格计 2×等级', function () {
  var g = newGame();
  g.start();
  g.spawn('O');
  var before = g.score;
  var curType = g.current.type;
  g.hardDrop();
  // 硬降锁定后自动 spawn 新块（无消行），当前块是新类型且位于顶部
  assert(g.current !== null && g.current.type !== curType, '锁定后已生成新方块');
  assertEq(g.current.row, 0, '新方块在顶部');
  assertEq(g.grid[19][4] !== 0 && g.grid[18][4] !== 0, true, 'O 落到最底两行');
  assertEq(g.score, before + 18 * 2 * g.level, '下移 18 格 × 2×level（row0→row18）');
});

/* ================= T5 / T6 旋转与踢墙 ================= */

test('T5: 旋转（无踢墙）不越界不重叠；密闭空间旋转被拒绝', function () {
  var g = newGame();
  g.start();
  g.spawn('T');                        // 3×3，col 3
  assert(g.rotateCW() === true, '开阔区旋转成功');
  assertEq(g.current.rotation, 1, 'rotation 0→1');

  // 全满网格：任何踢墙位置都与锁定块重叠 → 旋转必然被拒绝
  var g2 = newGame();
  g2.start();
  g2.spawn('T');
  for (var r = 0; r < 20; r++) fillRow(g2.grid, r);
  g2.current = { type: 'T', rotation: 0, row: 0, col: 3 };
  var before = JSON.stringify(g2.current);
  assert(g2.rotateCW() === false, '全满网格旋转被拒绝');
  assert(JSON.stringify(g2.current) === before, '状态不变');
});
test('T6: SRS 踢墙——T 块贴地上踢容纳旋转', function () {
  var g = newGame();
  g.start();
  g.spawn('T');
  g.grid = R.createEmptyGrid(20, 10);
  fillRow(g.grid, 19);                 // 地面
  g.current = { type: 'T', rotation: 0, row: 17, col: 3 };
  // 0→1 新形状占 3 行：row17~19 与地面重叠
  // SRS 0→1 第三项 (x=-1, y=+1) → (dCol=-1, dRow=-1)：上移左移后占 row16~18 成功
  var ok = g.rotateCW();
  assert(ok === true, '踢墙后旋转成功');
  assertEq(g.current.rotation, 1);
  assertEq(g.current.row, 16, '上踢 1 格');
  assertEq(g.current.col, 2, '左踢 1 格');
});

test('T6b: SRS 踢墙——I 块竖井中水平 +2 踢', function () {
  var g = newGame();
  g.start();
  g.spawn('I');
  g.grid = R.createEmptyGrid(20, 10);
  // 左侧 col0/1 筑墙，col2~9 留空
  for (var r = 0; r < 20; r++) { g.grid[r][0] = 1; g.grid[r][1] = 1; }
  // I 竖直（rotation 1，有效列 = 锚点+2），锚点 col0 → 有效列 2，紧贴墙
  g.current = { type: 'I', rotation: 1, row: 10, col: 0 };
  // 1→2 水平形状占 4 列：[0,0] 与 [-1,0] 都撞墙，[+2,0] → 锚点 col2，占 col2~5 成功
  var ok = g.rotateCW();
  assert(ok === true, 'I 踢墙旋转成功');
  assertEq(g.current.col, 2, '右踢 2 格');
  assertEq(g.current.rotation, 2);
});

/* ================= T7 锁定 / T10 游戏结束 ================= */

test('T7: 下移被锁定块挡住 → 正确锁定在上方', function () {
  var g = newGame();
  g.start();
  g.spawn('O');
  g.current.row = 16;                  // O 占 16~17
  fillRow(g.grid, 19);                 // 地面在 19
  assert(g.softDrop() === 'moved', '第一次软降：占 17~18，地面在 19 不碰撞');
  assert(g.softDrop() === 'locked', '第二次软降：占 18~19 与地面冲突 → 锁定');
  assertEq(g.grid[18][4] !== 0, true, 'O 下半写入 row18');
  assertEq(g.grid[17][4] !== 0, true, 'O 上半写入 row17');
  assertEq(g.grid[19][4], 1, '地面未被覆盖');
});

test('T10: 新方块生成即碰撞 → 游戏结束', function () {
  var g = newGame();
  g.start();
  // 顶部两行填满：O(2×2) spawn col4 占 row0~1 → 必碰撞
  fillRow(g.grid, 0);
  fillRow(g.grid, 1);
  g.spawn('O');
  assertEq(g.status, 'over', '生成即碰撞 → over');
});

/* ================= T8 / T9 / T11 消行 / 计分 / 等级 ================= */

test('T8: 消行后上方整体下移（含中间空行场景）', function () {
  // 场景：row17 与 row19 满，row18 为空行（中间空行），row16 放标记块
  var grid = R.createEmptyGrid(20, 10);
  grid[16][5] = 1;                     // row16 标记块
  fillRow(grid, 17);                   // 满
  grid[18][3] = 1;                     // row18 孤立块（中间空行场景）
  fillRow(grid, 19);                   // 满
  var full = R.findFullRows(grid);
  assertEq(full.length, 2, '检测到 2 个满行');
  assertEq(full[0], 17, '行号升序');
  assertEq(full[1], 19);
  R.removeRows(grid, full);
  // 消除后：next = [空,空, 原 row0..16, 原 row18]
  assertEq(grid[19][3], 1, '原 row18 孤立块下移到 19（保持相对顺序）');
  assertEq(grid[18][5], 1, '原 row16 标记块下移到 18');
  assert(grid[17].every(function (v) { return v === 0; }), '顶部补入空行');
  assert(grid[16].every(function (v) { return v === 0; }), '顶部补入空行');
});

test('T8b: 单行消除计分 100×等级（game 完整流程）', function () {
  var g = newGame();
  g.start();
  g.spawn('I');
  g.grid = R.createEmptyGrid(20, 10);
  fillRow(g.grid, 19);                 // 底行已满
  g.current = { type: 'I', rotation: 0, row: 18, col: 0 };  // I 水平占 row18 col0~3
  var res = g.lockPiece();             // I 锁入 row18（不满）→ 只消已满的 row19
  assertEq(res.cleared, 1, '消 1 行');
  var n = g.updateClearing(1000);
  assertEq(n, 1, '完成单行消除');
  assertEq(g.score, 100, '100×等级1');
  assertEq(g.lines, 1);
  assert(R.scoreForLines(1, 2) === 200 && R.scoreForLines(3, 2) === 1000 &&
         R.scoreForLines(4, 3) === 2400, '计分表核验');
});

test('T9: 消四行（Tetris）计分 800×等级', function () {
  var g = newGame();
  g.start();
  g.spawn('I');
  g.grid = R.createEmptyGrid(20, 10);
  // 底部 4 行各留一列空位（col0 空），其余铺满
  for (var r = 16; r <= 19; r++) {
    for (var c = 1; c < 10; c++) g.grid[r][c] = 1;
  }
  g.current = { type: 'I', rotation: 1, row: 16, col: -2 };  // I 竖直有效列 = 锚点+2 = 0
  g.lockPiece();                        // I 竖直填满 col0 的 row16~19 → 4 行全满
  var n = g.updateClearing(1000);
  assertEq(n, 4, '一次消 4 行');
  assertEq(g.score, 800, '800×等级1');
  assertEq(g.lines, 4);
  assertEq(g.grid[19].every(function (v) { return v === 0; }), true, '底部清空');
});

test('T11: 每 10 行升 1 级，速度加快', function () {
  var g = newGame();
  g.start();
  assertEq(g.level, 1);
  assert(R.fallInterval(1) === 800 && R.fallInterval(2) === 750, '间隔公式');
  assert(R.fallInterval(15) === 100, '最低 100ms');
  // 模拟消行累计
  g.lines = 9;
  g.score += R.scoreForLines(1, g.level);
  g.grid = R.createEmptyGrid(20, 10);
  fillRow(g.grid, 19);
  g.current = { type: 'I', rotation: 0, row: 18, col: 0 };
  g.grid[18] = new Array(10).fill(0);
  for (var c = 0; c < 4; c++) g.grid[18][c] = 1;
  g.current = { type: 'I', rotation: 0, row: 18, col: 0 };
  g2_null(g);
  // 直接走 finishClear 验证升级（row19 满 → 1 行？row18 有 4 格不满 → 消 1 行）
  var full = R.findFullRows(g.grid);
  g.clearingRows = full;
  var n = g.finishClear();
  assertEq(n, 1, '消 1 行');
  assertEq(g.lines, 10, '累计 10 行');
  assertEq(g.level, 2, '升到 2 级');
  assert(g.getFallInterval() < 800, '速度加快');
});

// 辅助：消除误用变量告警
function g2_null() { /* noop */ }

/* ================= T12 / T13 暂停 / 重开 ================= */

test('T12: 暂停期间逻辑不推进，恢复后状态一致', function () {
  var g = newGame();
  g.start();
  g.spawn('T');
  var snapshot = JSON.stringify({ grid: g.grid, cur: g.current, score: g.score });
  g.pause();
  assertEq(g.status, 'paused');
  assert(g.tick() === 'idle', '暂停时 tick 无效');
  assert(g.moveLeft() === false, '暂停时移动无效');
  assert(g.rotateCW() === false, '暂停时旋转无效');
  assert(g.hardDrop() === 'idle', '暂停时硬降无效');
  assert(JSON.stringify({ grid: g.grid, cur: g.current, score: g.score }) === snapshot,
         '状态完全一致');
  g.resume();
  assertEq(g.status, 'playing', '恢复播放');
  assert(g.moveLeft() === true, '恢复后可操作');
});

test('T13: 重开恢复初始状态', function () {
  var g = newGame();
  g.start();
  g.spawn('T');
  g.hardDrop();
  g.holdSwap();
  g.score = 12345;
  g.lines = 25;
  g.level = 3;
  g.reset();
  assertEq(g.status, 'ready');
  assertEq(g.score, 0);
  assertEq(g.lines, 0);
  assertEq(g.level, 1);
  assertEq(g.hold, null);
  assertEq(g.current, null);
  assert(g.grid.every(function (row) { return row.every(function (v) { return v === 0; }); }),
         '网格清空');
  g.start();
  assertEq(g.status, 'playing');
  assert(g.current !== null, '重开后重新生成方块');
});

/* ================= T14 Hold ================= */

test('T14: Hold 切换正确，每轮仅一次', function () {
  var g = newGame();
  g.start();
  g.spawn('T');                         // rng=0 → 队列头为 O
  var nextType = g.queue[0];            // O
  assert(g.holdSwap() === true, '首次 Hold 成功');
  assertEq(g.hold, 'T', 'T 被暂存');
  assertEq(g.current.type, nextType, '队列下一块成为当前');
  assert(g.holdSwap() === false, '同一轮二次 Hold 被拒绝');

  // 锁定当前块（无消行）→ 新块解锁 Hold
  g.hardDrop();
  assertEq(g.holdUsed, false, '新块解锁 Hold');
  var curType = g.current.type;
  var held = g.hold;                    // 'T'
  assert(g.holdSwap() === true, '换回暂存块');
  assertEq(g.current.type, held, '当前变为暂存的 T');
  assertEq(g.hold, curType, '原当前块进入 Hold');
  assertEq(g.current.row, 0, '换回后位置重置到顶部');
});

/* ================= 幽灵方块 ================= */

test('E1: ghostRow 计算硬降落点', function () {
  var g = newGame();
  g.start();
  g.spawn('O');                          // row0
  assertEq(g.ghostRow(), 18, 'O 竖直落点锚点 row18（占 18~19）');
  fillRow(g.grid, 19);
  g.current.row = 17;
  assertEq(g.ghostRow(), 17, '底部有物时贴在其上');
});

/* ================= 消行动画两阶段 ================= */

test('E4: 两阶段锁定——先闪烁挂起，倒计时后完成消行', function () {
  var g = newGame({ clearingMs: 300 });
  g.start();
  g.spawn('I');
  g.grid = R.createEmptyGrid(20, 10);
  for (var r = 16; r <= 19; r++) {
    for (var c = 1; c < 10; c++) g.grid[r][c] = 1;
  }
  g.current = { type: 'I', rotation: 1, row: 16, col: -2 };
  var res = g.lockPiece();
  assertEq(res.pendingClear, true, '挂起消行动画');
  assertEq(g.clearingRows.length, 4, '4 行闪烁中');
  assert(g.tick() === 'idle', '闪烁期间下落不推进');
  assertEq(g.updateClearing(150), -1, '未到时不消行');
  assert(g.clearingRows.length === 4, '仍在闪烁');
  var n = g.updateClearing(200);         // 累计 350ms > 300ms
  assertEq(n, 4, '到时完成 4 行消除');
  assertEq(g.clearingRows.length, 0, '动画结束');
  assert(g.current !== null, '消行后生成新方块');
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('总计: ' + (passed + failed) + ' | 通过: ' + passed + ' | 失败: ' + failed);
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
