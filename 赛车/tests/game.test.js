/* ============================================================
 * game.test.js —— 赛车逻辑引擎单元测试（Node 运行：node tests/game.test.js）
 *
 * 覆盖 require.md 第 6 节用例 T1~T14：
 * 赛道几何、车辆物理、路面判定、圈数判定（含防作弊）、
 * 碰撞、AI 冒烟、排名、持久化、暂停
 * ============================================================ */
'use strict';
var path = require('path');
var TrackMod = require(path.join(__dirname, '../js/track.js'));
var GameMod = require(path.join(__dirname, '../js/game.js'));
var AI = require(path.join(__dirname, '../js/ai.js'));
var Storage = require(path.join(__dirname, '../js/storage.js'));

var Track = TrackMod.Track;
var RaceGame = GameMod.RaceGame;
var PHYS = GameMod.PHYS;

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > (tol == null ? 1e-6 : tol)) {
    throw new Error((msg || 'near') + ': ' + a + ' vs ' + b + ' (tol ' + tol + ')');
  }
}

/* ---------------- 造数工具 ---------------- */
function makeGame(opts) {
  opts = opts || {};
  opts.countdownEnabled = false;          // 测试直接 playing
  var g = new RaceGame(opts);
  g.start();
  return g;
}

/** 把车摆到中心线 s 处、朝向切线、速度清零 */
function placeOnTrack(game, car, s) {
  var p = game.track.pointAtS(s);
  car.x = p.x; car.y = p.y; car.angle = p.angle;
  car.vx = 0; car.vy = 0;
  car.lastS = p.s; car.hintIdx = null;
  return car;
}

/** 用 AI 驱动玩家车跑 N 个 tick */
function runWithAI(game, ticks) {
  for (var i = 0; i < ticks; i++) {
    AI.drive(game, game.cars[0], PHYS.STEP);
    game.tick(PHYS.STEP);
  }
}

/* ================= T1 赛道生成 ================= */
test('T1: 赛道闭合、周长公式、等弧长采样', function () {
  var t = new Track({ width2: 260, height: 180, radius: 40, trackWidth: 16, samples: 512 });
  var expect = 2 * (260 - 80) + 2 * (180 - 80) + 2 * Math.PI * 40;
  near(t.length, expect, 0.01, '周长应为 2(W-2r)+2(H-2r)+2πr');
  // 首尾闭合：s=0 与 s=L-ε 的点重合
  var a = t.pointAtS(0), b = t.pointAtS(t.length - 0.001);
  near(a.x, b.x, 0.5, '闭合 x');
  near(a.y, b.y, 0.5, '闭合 y');
  // 等弧长：相邻采样点间距 ≈ L/n
  var gap = t.length / 512, maxErr = 0;
  for (var i = 0; i < 511; i++) {
    var p = t.pts[i], q = t.pts[i + 1];
    var d = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
    var err = Math.abs(d - gap);
    if (err > maxErr) maxErr = err;
  }
  assert(maxErr < 0.05, '采样应等弧长，最大误差 ' + maxErr);
  // 曲率：直道 0，圆弧 1/40
  assert(t.pointAtS(10).curv === 0, '下直道曲率应为 0');
  assert(t.pointAtS(300).curv === 0, '右直道曲率应为 0');
  near(Math.abs(t.pointAtS(210).curv), 1 / 40, 1e-6, '圆弧曲率 1/r');
  // 相邻段衔接：段边界两侧点距离应连续（无断链）
  var p1 = t.pointAtS(179.99), p2 = t.pointAtS(180.01);
  near(p1.x, p2.x, 0.5, '直道→圆弧衔接 x');
  near(p1.y, p2.y, 0.5, '直道→圆弧衔接 y');
});

/* ================= T2 初始状态 ================= */
test('T2: 发车位在起点线后、朝向切线、速度 0、状态 ready', function () {
  var g = new RaceGame({ countdownEnabled: false });
  assert(g.status === 'ready', '初始 ready');
  var c = g.cars[0];
  assert(g.cars.length === 5, '默认 1 玩家 + 4 AI');
  var startP = g.track.pointAtS(0);
  var carP = g.track.pointAtS(c.lastS);
  // 车在起点线后方（s 接近 L）
  var behind = g.track.wrapDelta(carP.s - startP.s);
  assert(behind < 0, '发车位应在起点线后方（s 略小于 L）');
  assert(behind > -15, '发车位距起点线不超过 2 格');
  near(c.angle, carP.angle, 0.01, '朝向应为中心线切线方向');
  assert(c.vx === 0 && c.vy === 0, '初速度为 0');
  assert(c.totalS === 0 && c.lap === 0, '进度清零');
});

/* ================= T3 油门加速 ================= */
test('T3: 油门加速：速度上升、位置沿切线前移', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 10);          // 下直道，切线朝 +x
  c.throttle = 1;
  var x0 = c.x;
  for (var i = 0; i < 120; i++) g.tick(PHYS.STEP);   // 2 秒
  assert(c.speed > 25, '2 秒全油门速度应 >25 m/s，实际 ' + c.speed.toFixed(1));
  assert(c.x > x0 + 20, '应沿 +x 前移，实际 Δx=' + (c.x - x0).toFixed(1));
  assert(c.onTrack, '直道加速不应离道');
});

/* ================= T4 自然减速 ================= */
test('T4: 无输入时速度指数衰减至近 0', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 10);
  c.throttle = 1;
  for (var i = 0; i < 90; i++) g.tick(PHYS.STEP);    // 1.5s 加速
  var v0 = c.speed;
  c.throttle = 0;
  for (i = 0; i < 240; i++) g.tick(PHYS.STEP);       // 4s 松油门
  assert(c.speed < v0 * 0.2, '4 秒后应衰减至 20% 以下：' + v0.toFixed(1) + ' -> ' + c.speed.toFixed(2));
  assert(c.speed >= 0, '速度非负');
});

/* ================= T5 刹车与倒车 ================= */
test('T5: 刹车降速、长按可倒车且有极速下限', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 10);
  c.throttle = 1;
  for (var i = 0; i < 90; i++) g.tick(PHYS.STEP);
  var v0 = c.speed;
  c.throttle = 0; c.brake = 1;
  for (i = 0; i < 30; i++) g.tick(PHYS.STEP);        // 0.5s 刹车
  assert(c.speed < v0 * 0.7, '刹车 0.5s 应明显减速');
  for (i = 0; i < 600; i++) g.tick(PHYS.STEP);       // 10s 持续刹车 → 倒车
  var vF = c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
  assert(vF < 0, '长按刹车应进入倒车');
  assert(vF >= -PHYS.V_REV_MAX - 1e-6, '倒车不应超过极速下限，实际 ' + vF.toFixed(1));
});

/* ================= T6 路面判定 ================= */
test('T6: 中心线 onTrack，偏移超半宽判离道', function () {
  var g = makeGame({ aiCount: 0 });
  var t = g.track;
  var p = t.pointAtS(50);           // 直道
  var n = t.nearest(p.x, p.y);
  assert(n.onTrack, '中心线应在赛道上');
  near(n.lateral, 0, 0.6, '中心线 lateral≈0');
  // 沿法线偏移 halfWidth + 5 → 草地
  var nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  var off = t.nearest(p.x + nx * (t.halfWidth + 5), p.y + ny * (t.halfWidth + 5));
  assert(!off.onTrack, '偏移超半宽应离道');
  near(Math.abs(off.lateral), t.halfWidth + 5, 0.5, 'lateral 应≈偏移量');
});

/* ================= T7 完整一圈（AI 驱动玩家车） ================= */
test('T7: AI 驱动完整跑一圈 → lap=1、圈速已记录', function () {
  var g = makeGame({ aiCount: 0, raceLaps: 1 });
  runWithAI(g, 3600);               // 60 秒模拟
  var c = g.cars[0];
  assert(c.lap >= 1, '60 秒内应完成至少 1 圈，实际 lap=' + c.lap);
  assert(c.lastLapMs > 0, '圈速应已记录');
  assert(c.finished, 'raceLaps=1 完赛');
  assert(c.finishTimeMs > 0, '完赛时间应记录');
});

/* ================= T8 抄近路防护 ================= */
test('T8: 弧长突变超过单步上限 → totalS 只加上限值', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 100);
  g.tick(PHYS.STEP);                // 先 tick 一次建立 hint
  var t = g.track;
  // 瞬移到赛道对面（约 L/2 之外）
  var far = t.pointAtS(c.lastS + t.length / 2);
  c.x = far.x; c.y = far.y; c.hintIdx = null;
  g.tick(PHYS.STEP);
  var cap = (PHYS.V_MAX * PHYS.NITRO_VMAX + 5) * PHYS.STEP;
  assert(c.totalS <= cap + 1e-6, 'totalS 单步增量不应超上限 ' + cap.toFixed(3) + '，实际 ' + c.totalS.toFixed(3));
});

/* ================= T9 倒车不刷圈 ================= */
test('T9: 过线后倒车再前进 → 不重复记圈', function () {
  var g = makeGame({ aiCount: 0, raceLaps: 3 });
  var c = g.cars[0];
  var L = g.track.length;
  // 手动推进到线前
  placeOnTrack(g, c, L - 2);
  c.totalS = L - 2;
  c.throttle = 1;
  for (var i = 0; i < 60 && c.lap === 0; i++) g.tick(PHYS.STEP);
  assert(c.lap === 1, '跨线应记 1 圈');
  var lapsRecorded = c.lastLapMs;
  assert(lapsRecorded > 0, '圈速已记录');
  // 继续前进一点后掉头倒车跨回起点线
  for (i = 0; i < 40; i++) g.tick(PHYS.STEP);
  c.throttle = 0; c.brake = 1; c.steer = 0.6;      // 刹车 + 打方向
  for (i = 0; i < 200 && c.lap === 1; i++) g.tick(PHYS.STEP);
  if (c.lap === 1) {
    // 车没倒回去（速度/位置原因），直接构造验证回退分支
    c.totalS = L - 1; c.lap = 1;
    var near1 = g.track.pointAtS(L - 1);
    c.x = near1.x; c.y = near1.y; c.angle = near1.angle + Math.PI;  // 掉头
    c.vx = 0; c.vy = 0; c.lastS = L - 1; c.hintIdx = null;
    c.brake = 1;
    for (i = 0; i < 120 && c.lap === 1; i++) g.tick(PHYS.STEP);
  }
  assert(c.lap === 0, '倒车跨线应回退圈数，实际 lap=' + c.lap);
  // 再前进跨线 → 恢复 lap=1，且 bestLap 不被更差的"圈"污染
  var bestBefore = c.bestLapMs;
  c.throttle = 1;
  for (i = 0; i < 120 && c.lap === 0; i++) g.tick(PHYS.STEP);
  assert(c.lap === 1, '再次跨线恢复 lap=1，实际 ' + c.lap);
  assert(c.bestLapMs === bestBefore, 'bestLapMs 不应被倒车反复过线污染');
});

/* ================= T10 车车碰撞 ================= */
test('T10: 两车重叠 → 被分离且速度改变', function () {
  var g = makeGame({ aiCount: 1 });
  var a = g.cars[0], b = g.cars[1];
  placeOnTrack(g, a, 100);
  placeOnTrack(g, b, 100);
  b.x = a.x + 1; b.y = a.y;         // 明显重叠（直径 3.6）
  b.hintIdx = null;
  a.vx = 10; a.vy = 0;              // a 全速撞向 b
  var relBefore = Math.abs(a.vx) + Math.abs(b.vx);
  g.tick(PHYS.STEP);
  var dx = b.x - a.x, dy = b.y - a.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  assert(dist >= PHYS.CAR_RADIUS * 2 - 0.01, '碰撞后应分离至不重叠，dist=' + dist.toFixed(3));
  assert(b.vx > 0.1, 'b 应被撞向前（vx>0），实际 ' + b.vx.toFixed(2));
  assert(a.vx < 10, 'a 应损失速度');
  assert(relBefore > 0, '前置条件');
});

/* ================= T11 AI 冒烟 ================= */
test('T11: AI 冒烟 3000 tick——稳定前进、不长时间离道', function () {
  var g = makeGame({ aiCount: 4 });
  var maxOff = 0, i, j;
  for (i = 0; i < 3000; i++) {
    AI.driveAll(g, PHYS.STEP);
    g.tick(PHYS.STEP);
    for (j = 1; j < g.cars.length; j++) {
      if (g.cars[j].offTrackTicks > maxOff) maxOff = g.cars[j].offTrackTicks;
    }
  }
  for (j = 1; j < g.cars.length; j++) {           // 车辆 0 是玩家（无输入，不参与断言）
    assert(g.cars[j].totalS > 200, 'AI 车 ' + j + ' 应累计前进 200m+，实际 ' + g.cars[j].totalS.toFixed(1));
  }
  assert(maxOff < 120, 'AI 不应长时间离道（连续 offTrack tick 峰值 ' + maxOff + '）');
});

/* ================= T12 排名 ================= */
test('T12: totalS 大者名次靠前，完赛者优先', function () {
  var g = makeGame({ aiCount: 2 });
  g.cars[0].totalS = 500;
  g.cars[1].totalS = 800;
  g.cars[2].totalS = 300;
  g._updateRanks();
  assert(g.cars[1].rank === 1, 'P1 应是 totalS 最大者');
  assert(g.cars[0].rank === 2, 'P2');
  assert(g.cars[2].rank === 3, 'P3');
  // 完赛者优先
  g.cars[2].finished = true; g.cars[2].finishTimeMs = 100;
  g._updateRanks();
  assert(g.cars[2].rank === 1, '完赛者应排 P1');
});

/* ================= T13 最佳圈速持久化 ================= */
test('T13: 破纪录才写入，读取返回历史最佳', function () {
  Storage.clearAll();
  assert(Storage.loadBest('ut_track', 3) === 0, '无记录返回 0');
  assert(Storage.saveBest('ut_track', 3, 40000) === true, '首写应成功');
  assert(Storage.loadBest('ut_track', 3) === 40000, '读回 40000');
  assert(Storage.saveBest('ut_track', 3, 50000) === false, '更慢的圈速不应写入');
  assert(Storage.loadBest('ut_track', 3) === 40000, '仍为 40000');
  assert(Storage.saveBest('ut_track', 3, 38000) === true, '破纪录写入');
  assert(Storage.loadBest('ut_track', 3) === 38000, '更新为 38000');
  assert(Storage.loadBest('ut_track', 5) === 0, '不同圈数档位独立');
  Storage.clearAll();
});

/* ================= T14 暂停 ================= */
test('T14: paused 状态 tick 不推进（时间与位置冻结）', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 10);
  c.throttle = 1;
  for (var i = 0; i < 60; i++) g.tick(PHYS.STEP);
  var t0 = g.timeMs, x0 = c.x, s0 = c.totalS;
  g.pause();
  assert(g.status === 'paused', '应进入 paused');
  for (i = 0; i < 120; i++) g.tick(PHYS.STEP);      // 暂停中 tick 应被忽略
  assert(g.timeMs === t0, '计时冻结');
  assert(c.x === x0 && c.totalS === s0, '位置与进度冻结');
  g.resume();
  assert(g.status === 'playing', '恢复 playing');
  g.tick(PHYS.STEP);
  assert(g.timeMs > t0, '恢复后计时继续');
});

/* ================= 附加：倒计时锁输入 ================= */
test('附加A: 发车倒计时期间油门无效，GO 后恢复', function () {
  var g = new RaceGame({ aiCount: 0, countdownEnabled: true });
  g.start();
  assert(g.status === 'countdown', '应处于倒计时');
  var c = g.cars[0];
  c.throttle = 1;
  for (var i = 0; i < 60; i++) g.tick(PHYS.STEP);   // 1 秒（倒计时 3 秒）
  assert(c.speed < 0.01, '倒计时内车辆不应移动');
  assert(g.status === 'countdown', '仍在倒计时');
  for (i = 0; i < 200 && g.status === 'countdown'; i++) g.tick(PHYS.STEP);
  assert(g.status === 'playing', '倒计时结束进入 playing');
  for (i = 0; i < 60; i++) g.tick(PHYS.STEP);
  assert(c.speed > 5, 'GO 后油门生效');
});

/* ================= 附加：漂移侧滑 ================= */
test('附加B: 高速满舵产生侧滑（vS 分量显著）', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 60);
  c.throttle = 1;
  for (var i = 0; i < 180; i++) g.tick(PHYS.STEP);  // 3s 加速到高速
  var v0 = c.speed;
  c.steer = 1;                                       // 入弯满舵
  var maxSlide = 0;
  for (i = 0; i < 90; i++) {
    g.tick(PHYS.STEP);
    if (c.slide > maxSlide) maxSlide = c.slide;
  }
  assert(v0 > 30, '前置：应已高速（' + v0.toFixed(1) + '）');
  assert(maxSlide > 3, '高速满舵应产生显著侧滑，峰值 ' + maxSlide.toFixed(2));
});

/* ================= 附加：氮气 ================= */
test('附加C: 氮气提升极速、槽量消耗与恢复', function () {
  var g = makeGame({ aiCount: 0 });
  var c = g.cars[0];
  placeOnTrack(g, c, 10);
  c.throttle = 1; c.nitroActive = true;
  for (var i = 0; i < 240; i++) g.tick(PHYS.STEP);  // 4s 持续氮气
  var vNitro = c.speed;
  assert(c.nitro < 100, '氮气应被消耗，剩 ' + c.nitro.toFixed(0));
  // 无氮气同条件下极速应更低
  var g2 = makeGame({ aiCount: 0 });
  var c2 = g2.cars[0];
  placeOnTrack(g2, c2, 10);
  c2.throttle = 1;
  for (i = 0; i < 240; i++) g2.tick(PHYS.STEP);
  assert(vNitro > c2.speed + 2, '氮气极速应显著更高：' + vNitro.toFixed(1) + ' vs ' + c2.speed.toFixed(1));
  // 松开后恢复
  c.nitroActive = false;
  for (i = 0; i < 120; i++) g.tick(PHYS.STEP);
  assert(c.nitro > 5, '氮气应随时间恢复至 ' + c.nitro.toFixed(1));
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('  通过 ' + passed + ' / 失败 ' + failed);
if (failed) {
  console.log('失败列表:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('全部测试通过 ✔');
