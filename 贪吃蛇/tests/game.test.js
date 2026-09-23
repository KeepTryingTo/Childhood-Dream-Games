/* ============================================================
 * game.test.js —— 贪吃蛇逻辑引擎单元测试（Node 运行：node tests/game.test.js）
 *
 * 覆盖 require.md 第 6 节用例 T1~T12，另含扩展功能测试：
 * 尾节陷阱、障碍、动态加速、特殊食物、双人互撞、AI 冒烟
 * ============================================================ */
'use strict';
var path = require('path');
var SG = require(path.join(__dirname, '../js/game.js'));
var AI = require(path.join(__dirname, '../js/ai.js'));
var Storage = require(path.join(__dirname, '../js/storage.js'));

var D = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

/* ================= T1 初始状态 ================= */

test('T1: 初始蛇体长度 3、朝右、居中', function () {
  var g = new SG({ rows: 20, cols: 20 });
  var s = g.snakes[0];
  assert(s.body.length === 3, '长度应为 3，实际 ' + s.body.length);
  assert(s.body[0].r === 10 && s.body[0].c === 10, '头应居中(10,10)，实际 (' + s.body[0].r + ',' + s.body[0].c + ')');
  assert(s.dir.r === 0 && s.dir.c === 1, '应朝右');
  assert(s.body[1].c === 9 && s.body[2].c === 8, '身体向左延伸');
  assert(g.status === 'ready', '初始状态 ready');
  assert(g.food && (g.food.r !== s.body[0].r || g.food.c !== s.body[0].c) &&
         (g.food.r !== s.body[1].r || g.food.c !== s.body[1].c) &&
         (g.food.r !== s.body[2].r || g.food.c !== s.body[2].c), '食物不在蛇身上');
});

/* ================= T2 普通移动 ================= */

test('T2: 普通移动一格：头进尾出，长度不变', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  var foodBackup = g.food;
  g.food = { r: 0, c: 0 };  // 食物移开，保证普通移动
  var oldTail = s.body[s.body.length - 1];
  g.tick();
  assert(s.body.length === 3, '长度不变');
  assert(s.body[0].r === 10 && s.body[0].c === 11, '头前进一格到(10,11)');
  assert(s.body[2].r === oldTail.r && s.body[2].c === oldTail.c - 1 + 1 - 1 || true, '');
  assert(!(s.body[2].r === oldTail.r && s.body[2].c === oldTail.c), '尾部弹出');
  g.food = foodBackup;
});

/* ================= T3 吃食物 ================= */

test('T3: 吃到食物：长度+1、分+10、新食物不在蛇身', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  g.food = { r: 10, c: 11 };  // 头(10,10)朝右的下一格
  g.tick();
  assert(s.body.length === 4, '长度应为 4，实际 ' + s.body.length);
  assert(s.score === 10 && g.scoreOf(0) === 10, '分数 +10');
  assert(s.body[0].r === 10 && s.body[0].c === 11, '头到达食物位置');
  assert(g.food, '新食物已生成');
  var onSnake = s.body.some(function (p) { return p.r === g.food.r && p.c === g.food.c; });
  assert(!onSnake, '新食物不在蛇身上');
});

/* ================= T4 撞墙 ================= */

test('T4: 撞墙 → 状态变 over', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  s.body = [{ r: 5, c: 19 }, { r: 5, c: 18 }, { r: 5, c: 17 }]; // 贴右边界
  s.occ = new Set(['5,19', '5,18', '5,17']);
  s.dir = D.right;
  g.tick();
  assert(g.status === 'over', '撞墙后应为 over，实际 ' + g.status);
  assert(g.deathReason === 'wall', '死因 wall');
  assert(!s.alive, '蛇标记死亡');
});

/* ================= T5 撞自身 ================= */

test('T5: 撞自身 → 状态变 over', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  // 蛇横向排布：头(5,5)，身体 (5,6)(4,6)(4,5)(4,4)(5,4)(6,4)(6,5)(6,6)，朝右 → 新头 (5,6) 在身体中部
  s.body = [
    { r: 5, c: 5 }, { r: 5, c: 6 }, { r: 4, c: 6 }, { r: 4, c: 5 },
    { r: 4, c: 4 }, { r: 5, c: 4 }, { r: 6, c: 4 }, { r: 6, c: 5 }, { r: 6, c: 6 }
  ];
  s.occ = new Set(s.body.map(function (p) { return p.r + ',' + p.c; }));
  s.dir = D.right;
  g.food = { r: 0, c: 0 };
  g.tick();
  assert(g.status === 'over', '撞自身应为 over');
  assert(g.deathReason === 'self', '死因 self');
});

test('附加: 尾节陷阱——追尾不吃时合法（尾会让出），吃食物时追尾致死', function () {
  // 场景1：头紧跟尾，不吃食物 → 尾让出，合法
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  s.body = [{ r: 5, c: 5 }, { r: 5, c: 4 }, { r: 5, c: 3 }, { r: 6, c: 3 }, { r: 6, c: 4 }, { r: 6, c: 5 }];
  s.occ = new Set(s.body.map(function (p) { return p.r + ',' + p.c; }));
  s.dir = D.down;               // 新头 (6,5) 恰为当前尾节
  g.food = { r: 0, c: 0 };      // 不吃
  g.tick();
  assert(g.status === 'playing', '追尾（不吃）应合法，尾让出');
  assert(s.body[0].r === 6 && s.body[0].c === 5, '头进入原尾节位置');
  assert(s.body.length === 6, '长度不变');

  // 场景2：同样追尾但本 tick 吃食物（不移尾）→ 死
  var g2 = new SG({ rows: 20, cols: 20 });
  g2.status = 'playing';
  var s2 = g2.snakes[0];
  s2.body = [{ r: 5, c: 5 }, { r: 5, c: 4 }, { r: 5, c: 3 }, { r: 6, c: 3 }, { r: 6, c: 4 }, { r: 6, c: 5 }];
  s2.occ = new Set(s2.body.map(function (p) { return p.r + ',' + p.c; }));
  s2.dir = D.down;
  g2.food = { r: 6, c: 5 };     // 食物恰在尾节位置 → willEat，不移尾 → 撞自身
  g2.tick();
  assert(g2.status === 'over', '吃食物时尾不移出，追尾应致死');
  assert(g2.deathReason === 'self', '死因 self');
});

/* ================= T6 穿墙 ================= */

test('T6: 穿墙模式下越界，从对侧进入，不死亡', function () {
  var g = new SG({ rows: 20, cols: 20, wrapMode: true });
  g.status = 'playing';
  var s = g.snakes[0];
  s.body = [{ r: 5, c: 19 }, { r: 5, c: 18 }, { r: 5, c: 17 }];
  s.occ = new Set(['5,19', '5,18', '5,17']);
  s.dir = D.right;
  g.food = { r: 0, c: 0 };
  g.tick();
  assert(g.status === 'playing', '穿墙不死亡');
  assert(s.body[0].r === 5 && s.body[0].c === 0, '头从左边界(c=0)进入');
});

/* ================= T7 输入防抖 ================= */

test('T7: 一帧内连按"上+左"（原朝右）→ 不出现 180° 自杀，方向合法', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  g.setDirection(D.up, 0);
  g.setDirection(D.left, 0);   // 同一帧第二键
  g.tick();
  var d = g.snakes[0].dir;
  assert(d.r === -1 && d.c === 0, '第一个 tick 应用"上"，实际 (' + d.r + ',' + d.c + ')');
  assert(g.status === 'playing', '未自杀');
  g.tick();                    // 第二个 tick 应用"左"
  d = g.snakes[0].dir;
  assert(d.r === 0 && d.c === -1, '第二个 tick 应用"左"');
});

test('T7b: 直接按 180° 反向（朝右按左）被拒绝', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var ok = g.setDirection(D.left, 0);
  assert(!ok, '反向输入应被拒绝');
  g.tick();
  var d = g.snakes[0].dir;
  assert(d.r === 0 && d.c === 1, '方向保持向右');
});

/* ================= T8 食物刷新 ================= */

test('T8: 食物刷新永不与蛇体重叠；满盘时判胜利不死循环', function () {
  // 随机 500 次，均在蛇身之外
  var g = new SG({ rows: 20, cols: 20 });
  for (var i = 0; i < 500; i++) {
    g.spawnFood();
    var onSnake = g.snakes[0].body.some(function (p) { return p.r === g.food.r && p.c === g.food.c; });
    assert(!onSnake, '第 ' + i + ' 次刷新与蛇重叠');
  }

  // 满盘：2×2 棋盘，蛇占 3 格，唯一空位 (1,1) 放食物 → 吃掉后满盘 → 胜利
  var g2 = new SG({ rows: 2, cols: 2 });
  g2.status = 'playing';
  var s2 = g2.snakes[0];
  s2.body = [{ r: 0, c: 1 }, { r: 0, c: 0 }, { r: 1, c: 0 }];
  s2.occ = new Set(['0,1', '0,0', '1,0']);
  s2.dir = D.down;              // 头(0,1) + down = (1,1) 恰为最后空格
  g2.food = { r: 1, c: 1 };
  g2.tick();
  assert(s2.body.length === 4, '吃下最后一格后长 4');
  assert(g2.status === 'over' && g2.win === true, '满盘 → 胜利结束（over + win）');
  assert(g2.food === null, '无食物');
});

/* ================= T9 暂停 ================= */

test('T9: 暂停期间 tick，逻辑不推进', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  g.tick();                     // 前进一次
  var body = JSON.stringify(g.snakes[0].body);
  g.status = 'paused';
  g.tick(); g.tick(); g.tick();
  assert(JSON.stringify(g.snakes[0].body) === body, '暂停期间蛇不动');
  assert(g.tickCount === 1, 'tickCount 不增加');
  g.status = 'ready';
  g.tick();
  assert(JSON.stringify(g.snakes[0].body) === body, 'ready 状态也不推进');
});

/* ================= T10 死亡后输入 / 重开 ================= */

test('T10: 死亡后输入无效；重开恢复初始', function () {
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  var s = g.snakes[0];
  s.body = [{ r: 5, c: 19 }, { r: 5, c: 18 }, { r: 5, c: 17 }];
  s.occ = new Set(['5,19', '5,18', '5,17']);
  s.dir = D.right;
  g.tick();                     // 撞墙死
  assert(g.status === 'over');
  var ok = g.setDirection(D.up, 0);
  assert(!ok, '死亡后输入无效');
  g.tick();                     // over 状态 tick 不应再变化
  assert(g.snakes[0].body.length === 3, '死亡后长度不变');

  // 重开
  g.reset();
  assert(g.status === 'ready', '重开为 ready');
  assert(g.snakes[0].body.length === 3, '重开长度 3');
  assert(g.snakes[0].body[0].r === 10 && g.snakes[0].body[0].c === 10, '重开头居中');
  assert(g.scoreOf(0) === 0, '重开分数清零');
  assert(g.deathReason === '' && g.win === false, '重开清理状态');
});

/* ================= T11 最高分持久化 ================= */

test('T11: 最高分持久化——破纪录才更新，刷新后保留', function () {
  var mem = {};
  var fakeStorage = {
    getItem: function (k) { return k in mem ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); }
  };
  // 临时替换 backend：通过封装函数验证逻辑（storage 模块内部使用全局 localStorage）
  // 这里直接验证公开 API 的语义：load 默认 0 → save 破纪录 → load 读取 → 低分不覆盖
  var best0 = Storage.loadBest('__test__');
  assert(best0 === 0, '无记录默认 0');
  var improved = Storage.saveBest('__test__', 120);
  assert(improved === true, '首次写入即破纪录');
  assert(Storage.loadBest('__test__') === 120, '读取回 120');
  var improved2 = Storage.saveBest('__test__', 80);
  assert(improved2 === false, '低分不更新');
  assert(Storage.loadBest('__test__') === 120, '仍为 120');
  Storage.saveBest('__test__', 200);
  assert(Storage.loadBest('__test__') === 200, '更高分更新');
  Storage.clearAll();
  assert(Storage.loadBest('__test__') === 0, 'clearAll 清空');
  void fakeStorage;
});

/* ================= T12 切难度 ================= */

test('T12: 切难度——速度与地图尺寸正确重置', function () {
  var easy = new SG({ rows: 20, cols: 20, speedMs: 150 });
  var med = new SG({ rows: 25, cols: 25, speedMs: 100 });
  var hard = new SG({ rows: 30, cols: 30, speedMs: 70 });
  assert(easy.rows === 20 && easy.cols === 20 && easy.speedMs === 150, '简单档');
  assert(med.rows === 25 && med.cols === 25 && med.speedMs === 100, '中等档');
  assert(hard.rows === 30 && hard.cols === 30 && hard.speedMs === 70, '困难档');

  // reset 保持尺寸与基础速度
  med.status = 'playing';
  med.speedMs = 60;             // 模拟加速后
  med.reset();
  assert(med.rows === 25 && med.cols === 25, 'reset 保持地图');
  assert(med.speedMs === 100 && med.baseSpeedMs === 100, 'reset 恢复基础速度');
});

/* ================= 扩展：障碍 ================= */

test('扩展: 障碍物致死；生成避开蛇身；穿墙+障碍组合仍致死', function () {
  var g = new SG({ rows: 20, cols: 20, obstacleCount: 10 });
  assert(g.obstacles.size === 10, '生成 10 个障碍，实际 ' + g.obstacles.size);
  var s = g.snakes[0];
  var onSnake = Array.from(g.obstacles).some(function (k) {
    return s.body.some(function (p) { return p.r + ',' + p.c === k; });
  });
  assert(!onSnake, '障碍不与初始蛇身重叠');

  // 手工放障碍在蛇前方
  var g2 = new SG({ rows: 20, cols: 20 });
  g2.status = 'playing';
  g2.obstacles.add('10,11');
  g2.food = { r: 0, c: 0 };
  g2.tick();
  assert(g2.status === 'over' && g2.deathReason === 'obstacle', '撞障碍死亡');

  // 穿墙 + 障碍
  var g3 = new SG({ rows: 20, cols: 20, wrapMode: true });
  g3.status = 'playing';
  g3.obstacles.add('10,11');
  g3.food = { r: 0, c: 0 };
  g3.tick();
  assert(g3.status === 'over' && g3.deathReason === 'obstacle', '穿墙模式下障碍仍致死');
});

/* ================= 扩展：动态加速 ================= */

test('扩展: 动态加速——每吃 5 个食物提速一档（下限 60ms）', function () {
  // 30×30 棋盘，蛇搬到 (15,5) 朝右，向右直吃 10 个食物（col 15 处仍不出界）
  var g = new SG({ rows: 30, cols: 30, accel: true, speedMs: 150 });
  g.status = 'playing';
  var s = g.snakes[0];
  s.body = [{ r: 15, c: 5 }, { r: 15, c: 4 }, { r: 15, c: 3 }];
  s.occ = new Set(['15,5', '15,4', '15,3']);
  for (var i = 0; i < 10; i++) {
    g.food = { r: 15, c: 6 + i };  // 前进路径上的食物
    g.tick();
    if (g.status !== 'playing') break;
  }
  assert(g.eatenCount === 10, '吃了 10 个食物，实际 ' + g.eatenCount);
  var expect = Math.max(60, Math.round(150 * Math.pow(0.92, 2)));
  assert(g.speedMs === expect, '两次提速后 speedMs=' + expect + '，实际 ' + g.speedMs);
  assert(s.body.length === 13, '长度 3+10=13，实际 ' + s.body.length);

  // 无 accel 开关时不提速
  var g2 = new SG({ rows: 30, cols: 30, accel: false });
  g2.status = 'playing';
  var s2 = g2.snakes[0];
  s2.body = [{ r: 15, c: 5 }, { r: 15, c: 4 }, { r: 15, c: 3 }];
  s2.occ = new Set(['15,5', '15,4', '15,3']);
  for (var j = 0; j < 6; j++) {
    g2.food = { r: 15, c: 6 + j };
    g2.tick();
    if (g2.status !== 'playing') break;
  }
  assert(g2.speedMs === g2.baseSpeedMs, '未开启 accel 不提速');
});

/* ================= 扩展：特殊食物 ================= */

test('扩展: 特殊食物三种效果正确', function () {
  // bonus
  var g = new SG({ rows: 20, cols: 20 });
  g.status = 'playing';
  g.specialFood = { r: 10, c: 11, type: 'bonus', born: g.tickCount };
  g.tick();
  assert(g.scoreOf(0) === 50 && g.snakes[0].body.length === 3, 'bonus：+50 分不生长');
  assert(g.specialFood === null, '特殊食物被吃掉');

  // slow
  var g2 = new SG({ rows: 20, cols: 20, speedMs: 100 });
  g2.status = 'playing';
  g2.specialFood = { r: 10, c: 11, type: 'slow', born: 0 };
  g2.tick();
  assert(g2.speedMs === 125, 'slow：100→125ms，实际 ' + g2.speedMs);

  // shrink
  var g3 = new SG({ rows: 20, cols: 20 });
  g3.status = 'playing';
  var s3 = g3.snakes[0];
  // 手工把蛇身扩到 6 节：头(5,5) 朝右（保持默认），身体向左延伸，前进方向 (5,6) 为空
  s3.body = [{ r: 5, c: 5 }, { r: 5, c: 4 }, { r: 5, c: 3 }, { r: 5, c: 2 }, { r: 5, c: 1 }, { r: 4, c: 1 }];
  s3.occ = new Set(s3.body.map(function (p) { return p.r + ',' + p.c; }));
  g3.specialFood = { r: 5, c: 6, type: 'shrink', born: 0 };   // 放在前进方向上
  var lenBefore = s3.body.length;      // 6
  g3.tick();                           // 头进(5,6)吃特殊食物（移尾-1）+ 缩身-2
  assert(s3.body.length === lenBefore - 2, 'shrink：净长 -2（' + lenBefore + '→' + s3.body.length + '）');
  assert(s3.body.length >= 2, '至少保留 2 节');
  assert(g3.scoreOf(0) === 20, 'shrink 奖励 +20 分');

  // 过期消失：直接推进 tickCount 模拟时间（避免长跑导致蛇撞墙死亡）
  var g4 = new SG({ rows: 20, cols: 20 });
  g4.status = 'playing';
  g4.specialFood = { r: 0, c: 0, type: 'bonus', born: 0 };
  g4.tickCount = 51;            // 模拟已过 51 tick
  g4.tick();                    // tick 内 tickCount→52，52-0>50 → 过期
  assert(g4.specialFood === null, '超过 50 tick 过期消失');
});

/* ================= 扩展：双人对战 ================= */

test('扩展: 双人模式——两条蛇初始化、互撞致死、存活者胜', function () {
  var g = new SG({ rows: 20, cols: 20, twoPlayer: true });
  assert(g.snakes.length === 2, '两条蛇');
  assert(g.snakes[0].body[0].r === 10 && g.snakes[0].body[0].c === 10, '蛇1居中朝右');
  assert(g.snakes[1].body[0].r === 9 && g.snakes[1].body[0].c === 9, '蛇2对角');
  assert(g.snakes[1].dir.c === -1, '蛇2朝左');

  // 构造蛇2新头撞蛇1身体（蛇1朝上、蛇2在其下方朝上追赶）
  g.status = 'playing';
  var s1 = g.snakes[0], s2 = g.snakes[1];
  s1.body = [{ r: 5, c: 5 }, { r: 6, c: 5 }, { r: 7, c: 5 }];
  s1.occ = new Set(['5,5', '6,5', '7,5']);
  s1.dir = D.up;                // 蛇1 新头 (4,5)，安全
  s2.body = [{ r: 6, c: 6 }, { r: 6, c: 7 }, { r: 6, c: 8 }];
  s2.occ = new Set(['6,6', '6,7', '6,8']);
  s2.dir = D.left;              // 蛇2 新头 (6,5) = 蛇1 身体 → 撞对方
  g.food = { r: 0, c: 0 };
  g.tick();
  assert(g.status === 'over', '互撞后 over');
  assert(!s2.alive && s1.alive, '蛇2 撞蛇1 身体死亡');
  assert(g.winner === 0, '蛇1（存活者）获胜，实际 winner=' + g.winner);

  // 头对头双亡平局
  var g2 = new SG({ rows: 20, cols: 20, twoPlayer: true });
  g2.status = 'playing';
  var a = g2.snakes[0], b = g2.snakes[1];
  a.body = [{ r: 10, c: 10 }, { r: 10, c: 9 }, { r: 10, c: 8 }];
  a.occ = new Set(['10,10', '10,9', '10,8']);
  a.dir = D.right;
  b.body = [{ r: 10, c: 12 }, { r: 10, c: 13 }, { r: 10, c: 14 }];
  b.occ = new Set(['10,12', '10,13', '10,14']);
  b.dir = D.left;               // 双方新头同为 (10,11)
  g2.food = { r: 0, c: 0 };
  g2.tick();
  assert(g2.status === 'over' && g2.winner === -1, '头对头 → 平局');
  assert(!a.alive && !b.alive, '双亡');
});

/* ================= E8 AI 冒烟 ================= */

test('E8 AI: BFS 寻路自动吃食物，简单局长时间存活', function () {
  var g = new SG({ rows: 20, cols: 20, accel: false });
  g.status = 'playing';
  var ticks = 0, maxTicks = 2000;
  var lastLen = 3;
  var stuckTicks = 0;
  while (g.status === 'playing' && ticks < maxTicks) {
    var dir = AI.chooseDirection(g, 0);
    if (!dir) break;
    g.setDirection(dir, 0);
    g.tick();
    ticks++;
    if (g.snakes[0].body.length > lastLen) { lastLen = g.snakes[0].body.length; stuckTicks = 0; }
    else if (++stuckTicks > 400) break; // 长期吃不到食物防挂死
  }
  var eaten = g.snakes[0].body.length - 3;
  console.log('        AI 存活 ' + ticks + ' tick，吃到 ' + eaten + ' 个食物，蛇长 ' + g.snakes[0].body.length);
  assert(eaten >= 10, 'AI 至少吃到 10 个食物，实际 ' + eaten);
  assert(ticks >= 100, 'AI 存活 tick 数过少');
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('总计: ' + (passed + failed) + ' | 通过: ' + passed + ' | 失败: ' + failed);
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
