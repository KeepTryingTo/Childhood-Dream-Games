/* ============================================================
 * game.test.js —— 全自动模拟引擎单元测试（Node：node tests/game.test.js）
 *
 * 覆盖 require.md 10.5 节用例 U1~U12：
 * 顾客 FSM、四员工 FSM（配菜/主厨/跑堂/经理）、火候自动控制、
 * 盘子闭环、超时差评、营业额结算、长时稳定性
 * ============================================================ */
'use strict';
var path = require('path');
var Data = require(path.join(__dirname, '../js/data.js'));
var SimMod = require(path.join(__dirname, '../js/game.js'));

var KitchenSim = SimMod.KitchenSim;
var ST = Data.STATIONS;

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

/* ---------------- 工具 ---------------- */
function makeSim() {
  Data.TABLES.forEach(function (t) { t.dirty = false; });   // TABLES 跨测试共享，先清理
  return new KitchenSim({ random: function () { return 0.5; } });  // normal 顾客 + potato 菜谱
}
function ff(sim, ms) {
  var steps = Math.ceil(ms / (1000 / 60));
  for (var i = 0; i < steps; i++) sim.tick(1 / 60);
}
/** 条件等待：每 250ms 检查一次 fn()，超时（ms）抛错 */
function waitUntil(sim, fn, timeoutMs, what) {
  var waited = 0;
  while (!fn()) {
    ff(sim, 250);
    waited += 250;
    if (waited >= (timeoutMs || 30000)) throw new Error('等待超时: ' + (what || 'condition'));
  }
}

/* ================= U1 初始状态 ================= */
test('U1: 初始状态：4 员工就位、4 桌空、盘 6、无顾客、playing', function () {
  var sim = makeSim();
  assert(sim.status === 'playing', 'playing');
  assert(Object.keys(sim.staff).length === 4, '4 名员工');
  assert(Object.keys(sim.staff).every(function (k) { return sim.staff[k].state === 'idle'; }), '全部待命');
  assert(sim.plates === 6, '初始盘 6');
  assert(sim.customers.length === 0, '无顾客');
  assert(Data.TABLES.every(function (t) { return !t.dirty; }), '桌子干净');
  assert(sim.stats.revenue === 0, '零收入');
});

/* ================= U2 顾客全流程 ================= */
test('U2: 顾客全流程：进门→坐椅→点单→用餐→付款→离开，留脏盘', function () {
  var sim = makeSim();
  ff(sim, 2000);                          // 首客 1.5s 进门
  sim.customerTimerMs = 999999;           // 冻结后续新客，保证单顾客场景
  var c = sim.customers[0];
  assert(c.type === 'normal', '0.5 随机 → 普通顾客');
  waitUntil(sim, function () { return c.state === 'waiting'; }, 15000, 'waiting');
  assert(sim.orders.length === 1, '订单已生成');
  assert(sim.orders[0].recipeId === 'potato', '0.5 随机 → 酸辣土豆丝');
  // 手动标记已上菜 → 验证 waiting→eating→paying→leaving 状态机
  var order = sim.orders[0];
  order.state = 'served';
  ff(sim, 100);
  assert(c.state === 'eating', '上齐进入用餐，实际 ' + c.state);
  waitUntil(sim, function () { return c.state === 'paying'; }, 15000, 'paying');
  waitUntil(sim, function () { return c.state === 'leaving'; }, 5000, 'leaving');
  waitUntil(sim, function () { return sim.customers.indexOf(c) < 0; }, 15000, '顾客离场');
  assert(sim.stats.customersServed === 1, '满意计数 +1');
  assert(Data.TABLES[order.tableId].dirty === true, '桌上留脏盘');
});

/* ================= U3 配菜师补货 ================= */
test('U3: 配菜师：订单缺料→冰箱取→切→备菜台库存+1', function () {
  var sim = makeSim();
  ff(sim, 10000);                         // 顾客点单
  var prep = sim.staff.prep;
  assert(prep.state !== 'idle', '配菜师开始工作：' + prep.state);
  waitUntil(sim, function () { return sim.prepStock.potato >= 1; }, 30000, '备菜入库');
  assert(sim.prepStock.potato >= 1, '备菜台土豆 +1');
});

/* ================= U4+U5 主厨全流程与完美出锅 ================= */
test('U4/U5: 主厨全流程：备菜齐→下锅→翻炒→完美窗口出锅→装盘→取餐台', function () {
  var sim = makeSim();
  ff(sim, 22000);                         // 顾客点单 + 配菜完成 + 主厨取料下锅
  var chef = sim.staff.chef;
  var pot = sim.pot;
  // 主厨应在炒或已进入出锅流程
  assert(['cooking', 'waitPerfect', 'toPlating', 'toPass', 'idle'].indexOf(chef.state) >= 0,
    '主厨工作中：' + chef.state);
  // 等到取餐台出现菜
  var waited = 0;
  while (sim.readyDishes.length === 0 && waited < 30000) { ff(sim, 500); waited += 500; }
  assert(sim.readyDishes.length >= 1, '菜已放到取餐台');
  assert(sim.readyDishes[0].quality === 'perfect', '主厨自动在完美窗口出锅，实际 ' + sim.readyDishes[0].quality);
  assert(sim.plates === 5, '装盘消耗 1 盘（6→5），实际 ' + sim.plates);
});

/* ================= U6 跑堂上菜 ================= */
test('U6: 跑堂：取餐台端菜→送到对应桌→顾客进入用餐', function () {
  var sim = makeSim();
  var runner = sim.staff.runner;
  waitUntil(sim, function () { return sim.readyDishes.length > 0; }, 60000, '菜到取餐台');
  assert(runner.state !== 'idle', '跑堂动起来：' + runner.state);
  waitUntil(sim, function () {
    return sim.customers.some(function (c) { return c.state === 'eating'; });
  }, 30000, '顾客用餐');
  assert(sim.stats.dishes >= 1, '上菜计数 +1');
  assert(sim.stats.revenue > 0, '营业额已结算');
});

/* ================= U7+U8 收盘洗盘与盘子闭环 ================= */
test('U7/U8: 跑堂收盘→水槽洗净；盘子总数守恒（闭环）', function () {
  var sim = makeSim();
  var START = sim.cfg.START_PLATES;
  // 全局守恒：干净栈 + 取餐台 + 待洗/洗涤 + 用餐顾客 + 手持装盘/脏盘 ≤ 初始盘数
  var conservationHeld = true;
  waitUntil(sim, function () {
    // 每 250ms 检查守恒
    var eating = sim.customers.filter(function (c) { return c.state === 'eating'; }).length;
    var hold = 0;
    if (sim.staff.chef.hold && sim.staff.chef.hold.type === 'plated') hold++;
    if (sim.staff.runner.hold) hold++;
    var total = sim.plates + sim.readyDishes.length + sim.sink.queue + eating + hold;
    if (total > START) conservationHeld = false;
    return sim.stats.washed >= 1;         // 至少洗净过一只
  }, 120000, '洗净事件');
  assert(sim.stats.washed >= 1, '发生过洗净（闭环运转）');
  assert(conservationHeld, '盘子总数守恒（≤ ' + START + '）');
});

/* ================= U9 顾客超时 ================= */
test('U9: 顾客超时：生气离开、差评计数、订单取消', function () {
  var sim = makeSim();
  ff(sim, 2000);
  sim.customerTimerMs = 999999;           // 冻结新客
  waitUntil(sim, function () { return sim.customers[0] && sim.customers[0].state === 'waiting'; }, 15000, 'waiting');
  var c = sim.customers[0];
  var orderCount = sim.orders.length;
  assert(orderCount >= 1, '有订单');
  c.patienceMs = 1;
  ff(sim, 200);
  assert(sim.stats.customersLost === 1, '差评 +1');
  assert(c.state === 'angry' || c.state === 'leaving', '生气离场：' + c.state);
  waitUntil(sim, function () { return sim.customers.indexOf(c) < 0; }, 20000, '顾客离场');
  assert(sim.orders.every(function (o) { return o.state === 'cancelled'; }) || sim.orders.length === 0, '订单已取消/清理');
});

/* ================= U10 经理催促 ================= */
test('U10: 经理巡逻 + 周期性催促（速度增益生效）', function () {
  var sim = makeSim();
  var mgr = sim.staff.manager;
  ff(sim, 1000);
  assert(mgr.state === 'patrol' || mgr.state === 'pause', '经理巡逻中：' + mgr.state);
  // 等员工忙碌（配菜师补货中）再触发催促
  waitUntil(sim, function () { return sim.staff.prep.state !== 'idle'; }, 20000, '员工忙碌');
  sim.urgeTimerMs = 1;
  waitUntil(sim, function () {
    return ['prep', 'chef', 'runner'].some(function (k) { return sim.staff[k].buffUntilMs > sim.timeMs; });
  }, 5000, '催促生效');
  assert(true, '有员工被催促（buff 生效）');
});

/* ================= U11 营业额结算 ================= */
test('U11: 结算公式：菜价 × 完美1.5 + 小费（耐心比例）', function () {
  var sim = makeSim();
  // 跑完整一单
  var waited = 0;
  while (sim.stats.dishes < 1 && waited < 90000) { ff(sim, 1000); waited += 1000; }
  assert(sim.stats.dishes >= 1, '至少上一份菜');
  // potato 120 × perfect 1.5 = 180 + tip(120×0.5×ratio)
  assert(sim.stats.revenue >= 180, '收入 ≥180（perfect 土豆丝），实际 ' + sim.stats.revenue);
  assert(sim.stats.perfects >= 1, '完美计数');
});

/* ================= U12 长时稳定 ================= */
test('U12: 5 分钟长时模拟：无卡死、无 NaN、订单数组有界', function () {
  var sim = makeSim();
  ff(sim, 300000);                        // 5 分钟
  assert(isFinite(sim.stats.revenue) && sim.stats.revenue > 0, '营业额有限且为正：' + sim.stats.revenue);
  assert(sim.customers.length <= 4, '顾客数有界');
  assert(sim.orders.length < 20, '订单数组有界：' + sim.orders.length);
  assert(sim.plates >= 0 && sim.plates <= 10, '盘子数有界：' + sim.plates);
  var staffOk = Object.keys(sim.staff).every(function (k) { return sim.staff[k].state; });
  assert(staffOk, '员工状态合法');
  // 大部分顾客满意
  var total = sim.stats.customersServed + sim.stats.customersLost;
  assert(total >= 5, '服务足够多顾客：' + total);
});

/* ================= 附加：暂停 ================= */
test('附加A: 暂停时全场冻结', function () {
  var sim = makeSim();
  ff(sim, 5000);
  var t = sim.timeMs, rev = sim.stats.revenue;
  sim.pause();
  ff(sim, 3000);
  assert(sim.timeMs === t && sim.stats.revenue === rev, '时间与收入冻结');
  sim.resume();
  ff(sim, 100);
  assert(sim.timeMs > t, '恢复推进');
});

/* ================= v3.1 W1~W4 场景规则 ================= */

/** 全程监测器：跨墙时 y 必须在门缺口内；员工不得进入台面/墙碰撞体 */
function monitor(sim, log) {
  var WALL = Data.WALL;
  sim.customers.concat([sim.staff.prep, sim.staff.chef, sim.staff.runner, sim.staff.manager])
    .forEach(function (e) {
      // 过墙检查：x 在墙区间时 y 必须落在缺口
      if (e.x > WALL.x - 1 && e.x < WALL.x + WALL.w + 1) {
        var ok = WALL.gaps.some(function (g) { return e.y > g.from && e.y < g.to; });
        if (!ok) log.push('穿墙@(' + (e.x | 0) + ',' + (e.y | 0) + ') ' + (e.name || e.type || 'cust'));
      }
      // 台面/桌碰撞检查（顾客只查墙与桌；员工查全部）
      for (var i = 0; i < sim.obstacles.length; i++) {
        var b = sim.obstacles[i];
        if (e.tableId !== undefined && b.station) continue;    // 顾客不进厨房，跳过台面
        var cx = Math.max(b.x, Math.min(e.x, b.x + b.w));
        var cy = Math.max(b.y, Math.min(e.y, b.y + b.h));
        var d2 = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
        if (d2 < 6.5 * 6.5) {   // 容差 6.5（碰撞半径 9，允许贴边抖动）
          log.push('入障:' + (b.station || 'table' + b.table || 'wall') + '@(' + (e.x | 0) + ',' + (e.y | 0) + ') ' + (e.name || 'cust'));
        }
      }
    });
}

test('W1: 顾客坐在椅子上（不站桌心）', function () {
  var sim = makeSim();
  ff(sim, 2000);
  sim.customerTimerMs = 999999;
  waitUntil(sim, function () { return sim.customers[0] && sim.customers[0].state === 'waiting'; }, 15000, 'waiting');
  var c = sim.customers[0];
  var t = Data.TABLES[c.tableId];
  var seat = Data.SEAT_OFFSETS[c.seatIdx];
  var distToCenter = Math.sqrt((c.x - t.x) * (c.x - t.x) + (c.y - t.y) * (c.y - t.y));
  assert(distToCenter > 40, '顾客应距桌心 >40px（在椅子上），实际 ' + distToCenter.toFixed(1));
  assert(Math.abs(c.x - (t.x + seat.dx)) < 2 && Math.abs(c.y - (t.y + seat.dy)) < 2,
    '位置应为分配的椅子 (' + (t.x + seat.dx) + ',' + (t.y + seat.dy) + ')，实际 (' + c.x.toFixed(0) + ',' + c.y.toFixed(0) + ')');
});

test('W2: 跨区只走门（穿墙监测全程零违规）', function () {
  var sim = makeSim();
  var log = [];
  for (var i = 0; i < 60 * 150; i++) {
    sim.tick(1 / 60);
    if (i % 6 === 0) monitor(sim, log);
    if (log.length > 5) break;
  }
  assert(log.length === 0, '150 秒内不应穿墙/入障：\n    ' + log.slice(0, 6).join('\n    '));
});

test('W3: 员工不穿台面（长时监测）', function () {
  var sim = makeSim();
  var log = [];
  for (var i = 0; i < 60 * 300; i++) {     // 5 分钟
    sim.tick(1 / 60);
    if (i % 6 === 0) {
      ['prep', 'chef', 'runner', 'manager'].forEach(function (k) {
        var e = sim.staff[k];
        for (var j = 0; j < sim.obstacles.length; j++) {
          var b = sim.obstacles[j];
          var cx = Math.max(b.x, Math.min(e.x, b.x + b.w));
          var cy = Math.max(b.y, Math.min(e.y, b.y + b.h));
          var d2 = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
          if (d2 < 6.5 * 6.5) log.push(k + ' 入障 ' + (b.station || 'table' + b.table || 'wall') + '@(' + (e.x | 0) + ',' + (e.y | 0) + ')');
        }
      });
    }
    if (log.length > 5) break;
  }
  assert(log.length === 0, '5 分钟员工不应穿台面/墙：\n    ' + log.slice(0, 6).join('\n    '));
  assert(sim.stats.dishes >= 3, '业务正常推进（上菜 ≥3），实际 ' + sim.stats.dishes);
});

test('W4: 门/座位/障碍数据完整性', function () {
  assert(Data.WALL.segments.length === 3, '墙应分 3 段（两门），实际 ' + Data.WALL.segments.length);
  var total = Data.WALL.segments.reduce(function (s, seg) { return s + seg.h; }, 0);
  assert(total === 680 - 200, '墙总长 = 680 - 两门 200，实际 ' + total);
  Data.WALL.gaps.forEach(function (g) {
    assert(g.to - g.from === 100, '门宽 100');
  });
  assert(Data.SEAT_OFFSETS.length === 4, '每桌 4 座');
  // 座位必须在桌障碍（±38）之外
  Data.SEAT_OFFSETS.forEach(function (o) {
    assert(Math.abs(o.dx) === 0 ? Math.abs(o.dy) === 58 : Math.abs(o.dx) === 58, '座位偏移 58');
  });
  // 交互站位距所属台面 ≥ 12px（可达性）
  var ST = Data.STATIONS;
  var stands = [
    ['fridge', ST.fridge.x, ST.fridge.y + 70],
    ['board', ST.board.x, ST.board.y + 65],
    ['stove', ST.stove.x, ST.stove.y + 70],
    ['plating', ST.plating.x, ST.plating.y + 65]
  ];
  stands.forEach(function (s) {
    var st = ST[s[0]];
    var cx = Math.max(st.x - st.w / 2, Math.min(s[1], st.x + st.w / 2));
    var cy = Math.max(st.y - st.h / 2, Math.min(s[2], st.y + st.h / 2));
    var d = Math.sqrt((s[1] - cx) * (s[1] - cx) + (s[2] - cy) * (s[2] - cy));
    assert(d >= 12, s[0] + ' 站位距台面应 ≥12px，实际 ' + d.toFixed(1));
  });
});

/* ================= v3.0 V1 老鼠事件 ================= */
test('V1: 老鼠事件：潜入→偷/被驱赶→逃离，全程闭环', function () {
  var sim = makeSim();
  sim.prepStock.cabbage = 2;              // 备菜台有料（否则空手而归不计分）
  sim.envEvent = { type: 'rat', x: 1165, y: 320, phase: 'sneak', timerMs: 0 };
  // 老鼠走向备菜台；经理自动追击
  waitUntil(sim, function () { return !sim.envEvent || sim.envEvent.phase === 'flee'; }, 40000, '老鼠触发结局');
  assert(sim.stats.ratsChased + sim.stats.ratsStolen >= 1, '驱赶或偷窃计数（赶' + sim.stats.ratsChased + ' 偷' + sim.stats.ratsStolen + '）');
  waitUntil(sim, function () { return !sim.envEvent; }, 15000, '老鼠离场');
});

/* ================= v3.0 V2 漏水事件 ================= */
test('V2: 漏水：区域内员工减速 + 经理修复', function () {
  var sim = makeSim();
  sim.envEvent = { type: 'leak', x: 900, y: 400 };
  // 减速验证：配菜师从漏水中心出发
  var prep = sim.staff.prep;
  prep.x = 900; prep.y = 400;
  var x0 = prep.x;
  sim._move(prep, 1100, 400, 0.5);       // 0.5s 向右（漏水半径 75 内减速）
  var moved = prep.x - x0;
  assert(Math.abs(moved - 150 * 0.55 * 0.5) < 6, '漏水减速 55%：移动 ' + moved.toFixed(1) + '（期望 ~41）');
  // 经理自动修复
  waitUntil(sim, function () { return !sim.envEvent; }, 40000, '漏水修复');
  assert(sim.stats.leaksFixed === 1, '修复计数 +1');
});

/* ================= v3.0 V3 起火事件 ================= */
test('V3: 起火：主厨避让不接单 + 经理扑灭后复工', function () {
  var sim = makeSim();
  // 制造一个料齐的订单（主厨本可立即接单）
  sim.orders.push({ id: 9001, recipeId: 'cabbage', tableId: 0, customerId: 1,
    state: 'pending', quality: null, createdAt: sim.timeMs, waitStartMs: sim.timeMs });
  sim.prepStock.cabbage = 1;
  sim.envEvent = { type: 'fire', x: 1015, y: 265 };
  ff(sim, 1000);
  assert(sim.staff.chef.state === 'idle', '起火时主厨避让不接单，实际 ' + sim.staff.chef.state);
  // 经理扑灭
  waitUntil(sim, function () { return !sim.envEvent; }, 40000, '灶火扑灭');
  assert(sim.stats.firesOut === 1, '灭火计数');
  // 复工
  waitUntil(sim, function () { return sim.staff.chef.state !== 'idle'; }, 20000, '主厨复工接单');
});

/* ================= v3.0 V4 季节轮换 ================= */
test('V4: 季节自动轮换 + 手动切换 + 四季 mask', function () {
  var sim = new KitchenSim({ random: function () { return 0.5; }, seasonMs: 3000 });
  assert(sim.season === 0 && sim.stats.seasonsMask === 1, '初始春季');
  ff(sim, 3200);
  assert(sim.season === 1, '3 秒后自动入夏，实际 ' + sim.season);
  sim.setSeason(3);
  assert(sim.season === 3, '手动切冬');
  ff(sim, 3200);
  assert(sim.season === 0, '冬→春循环');
  sim.setSeason(1); sim.setSeason(2);
  assert(sim.stats.seasonsMask === 15, '四季全见 mask=15，实际 ' + sim.stats.seasonsMask);
});

/* ================= v3.0 V5 成就检查 ================= */
test('V5: 成就：合并累计→检查→去重；session/lifetime 分类正确', function () {
  var Ach = require(path.join(__dirname, '../js/achievements.js'));
  var h1 = Ach.mergeHistory({}, { dishes: 1, perfects: 1, revenue: 500, perRecipe: { cabbage: 1 } }, 0);
  var news = Ach.checkNew({ session: {}, lifetime: h1, seasonsMask: 0 });
  assert(news.some(function (a) { return a.id === 'first_dish'; }), '累计首菜成就');
  h1.achieved = { first_dish: true };
  var news2 = Ach.checkNew({ session: {}, lifetime: h1, seasonsMask: 0 });
  assert(!news2.some(function (a) { return a.id === 'first_dish'; }), '已达成不重复');
  var news3 = Ach.checkNew({ session: { perfects: 20 }, lifetime: h1, seasonsMask: 0 });
  assert(news3.some(function (a) { return a.id === 'perfect_20'; }), '单局 20 完美');
  var news4 = Ach.checkNew({ session: {}, lifetime: h1, seasonsMask: 15 });
  assert(news4.some(function (a) { return a.id === 'four_seasons'; }), '四季成就');
  // 图鉴视图
  var view = Ach.codexView({ recipeCounts: { cabbage: 3 }, customerMet: { vip: 2 } }, Data.RECIPES, Data.CUSTOMERS);
  assert(view.recipes[0].lit && view.recipes[0].count === 3, '菜品图鉴点亮');
  assert(!view.recipes[1].lit, '未出品未点亮');
  assert(view.customers.some(function (c) { return c.id === 'vip' && c.lit; }), '顾客图鉴');
});

/* ================= v3.0 V6 存储扩展 ================= */
test('V6: 排行榜排序 / 累计历史 / 装扮 / 昵称 / 引导标记', function () {
  var ST = require(path.join(__dirname, '../js/storage.js'));
  ST.clearAll();
  assert(ST.addBoardEntry({ name: '阿香', revenue: 3000, dishes: 10 }) === 1, '首条第 1 名');
  ST.addBoardEntry({ name: '阿波', revenue: 5000, dishes: 20 });
  var b = ST.loadBoard();
  assert(b.length === 2 && b[0].revenue === 5000, '榜单按营业额降序');
  ST.saveSkin({ theme: 'neon' });
  assert(ST.loadSkin().theme === 'neon', '装扮持久化');
  ST.saveName('大厨张三');
  assert(ST.loadName() === '大厨张三', '昵称持久化');
  ST.saveGuideSeen(true);
  assert(ST.loadGuideSeen() === true, '引导标记持久化');
  var h = ST.loadHistory();
  h.totalDishes = 42; ST.saveHistory(h);
  assert(ST.loadHistory().totalDishes === 42, '累计历史持久化');
  ST.clearAll();
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('  通过 ' + passed + ' / 失败 ' + failed);
if (failed) {
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('全部测试通过 ✔');
