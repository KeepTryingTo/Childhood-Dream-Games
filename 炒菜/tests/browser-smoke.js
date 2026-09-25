/* ============================================================
 * browser-smoke.js —— 浏览器端冒烟测试（Node：node tests/browser-smoke.js）
 *
 * mock DOM/Canvas/rAF 按 index.html 顺序装配全部脚本，端到端验证：
 *   S1 装配契约（v2.0 导出结构，防"单测全过、页面白屏"）
 *   S2 渲染循环工作
 *   S3 顾客自动进门、订单生成
 *   S4 全自动流水线完成一单上桌（取→切→炒→装→送）
 *   S5 统计 HUD 实时更新（营业额/上菜/满意）
 * ============================================================ */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

/* ---------------- mock canvas 2d ---------------- */
var calls = { fillRect: 0, arc: 0, fillText: 0, beginPath: 0, fill: 0, stroke: 0, moveTo: 0, lineTo: 0, ellipse: 0 };
var ctx2d = new Proxy({}, {
  get: function (t, prop) {
    if (prop in t) return t[prop];
    if (prop in calls) return function () { calls[prop]++; };
    return function () {};
  },
  set: function (t, prop, v) { t[prop] = v; return true; }
});

/* ---------------- mock DOM ---------------- */
function makeElement(id) {
  var el = {
    id: id, textContent: '', innerHTML: '', style: {}, value: '', checked: false,
    _handlers: {},
    classList: {
      _set: {},
      add: function (c) { this._set[c] = true; },
      remove: function (c) { delete this._set[c]; },
      contains: function (c) { return !!this._set[c]; },
      toggle: function (c, on) { if (on) this._set[c] = true; else delete this._set[c]; }
    },
    addEventListener: function (t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    getBoundingClientRect: function () { return { width: 900, height: 620, left: 0, top: 0 }; },
    getContext: function () { return ctx2d; },
    createElement: function () { return makeElement('div'); },
    appendChild: function (n) { this._children = this._children || []; this._children.push(n); return n; },
    insertBefore: function (n) { this._children = this._children || []; this._children.unshift(n); return n; },
    removeChild: function (n) {
      if (this._children && this._children.indexOf(n) >= 0) this._children.splice(this._children.indexOf(n), 1);
      return n;
    },
    closest: function () { return null; },
    get firstChild() { return (this._children && this._children[0]) || null; },
    get lastChild() { return (this._children && this._children[this._children.length - 1]) || null; },
    get children() { return this._children || []; },
    querySelectorAll: function () { return []; },
    parentElement: null
  };
  if (id === 'board') {
    el.parentElement = { getBoundingClientRect: function () { return { width: 900, height: 620 }; } };
  }
  return el;
}

var elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeElement(id); return elements[id]; }
getEl('overlay').classList.add('hidden');
getEl('log')._children = [];

var documentMock = {
  getElementById: getEl,
  createElement: function (tag) { return makeElement(tag); },
  body: { getBoundingClientRect: function () { return { width: 900, height: 620 }; } }
};

var rafQueue = [];
var listeners = {};
var windowMock = {
  document: documentMock,
  devicePixelRatio: 1,
  addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
  requestAnimationFrame: function (cb) { rafQueue.push(cb); return rafQueue.length; }
};
windowMock.self = windowMock;

var sandbox = {
  window: windowMock, document: documentMock, self: windowMock,
  console: console, Math: Math, Date: Date,
  setTimeout: function (fn) { fn(); },
  clearTimeout: function () {},
  setInterval: function () { return 0; },
  requestAnimationFrame: windowMock.requestAnimationFrame
};
vm.createContext(sandbox);

/* ---------------- S1 脚本装配 ---------------- */
var loadErrors = [];
['data.js', 'game.js', 'storage.js', 'achievements.js', 'ui.js', 'main.js'].forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
  } catch (e) { loadErrors.push(f + ': ' + e.message); }
});

test('S1: 6 个脚本按 index.html 顺序加载无异常（v3.0 导出契约）', function () {
  assert(loadErrors.length === 0, '加载失败 -> ' + loadErrors.join(' | '));
  assert(typeof windowMock.KitchenData === 'object' && Array.isArray(windowMock.KitchenData.RECIPES), 'KitchenData');
  assert(typeof windowMock.KitchenSim.KitchenSim === 'function', 'KitchenSim.KitchenSim 应为构造函数');
  assert(typeof windowMock.KitchenAch === 'object' && typeof windowMock.KitchenAch.checkNew === 'function', 'KitchenAch');
  assert(typeof windowMock.KitchenUI === 'function', 'KitchenUI');
  assert(typeof windowMock.KitchenSound === 'object', 'KitchenSound');
});

/* ---------------- rAF 泵 ---------------- */
var now = 0;
function pump(frames) {
  for (var i = 0; i < frames; i++) {
    now += 16.7;
    var cbs = rafQueue; rafQueue = [];
    cbs.forEach(function (cb) { cb(now); });
  }
}

var sim = windowMock.__kitchenSim;

test('S1b: main.js 暴露 __kitchenSim 引用且已营业', function () {
  assert(sim && typeof sim.tick === 'function', '__kitchenSim 应为实例');
  assert(sim.status === 'playing', 'playing');
});

pump(180);   // 3 秒

test('S2: 渲染循环工作（地板/设施/角色绘制调用 > 0）', function () {
  assert(calls.fillRect > 100, 'fillRect 应 >100，实际 ' + calls.fillRect);
  assert(calls.arc > 50, 'arc 应 >50，实际 ' + calls.arc);
  assert(calls.fillText > 30, 'fillText 应 >30，实际 ' + calls.fillText);
  assert(calls.ellipse > 20, '角色阴影 ellipse 应 >20，实际 ' + calls.ellipse);
});

test('S3: 顾客自动进门、订单生成', function () {
  assert(sim.customers.length >= 1, '3 秒内应有顾客进门，实际 ' + sim.customers.length);
  var revenue = getEl('revenue').textContent;
  assert(revenue !== 'NaN' && revenue !== '', '营业额不应 NaN/空');
});

/* ---------------- S4 全自动流水线（条件等待） ---------------- */
var smokes = { served: false, err: null };
try {
  var deadline = now + 16.7 * 60 * 120;    // 最多再跑 120 秒模拟时间
  while (now < deadline && sim.stats.dishes < 1) pump(30);
  smokes.served = sim.stats.dishes >= 1;
} catch (e) { smokes.err = e.message; }

test('S4: 全自动流水线完成一单（取→切→炒→装→送桌上）', function () {
  assert(!smokes.err, '运行异常: ' + smokes.err);
  assert(smokes.served, '120 秒内应自动完成至少一单上桌，实际 dishes=' + sim.stats.dishes);
  assert(sim.stats.revenue > 0, '营业额 > 0');
});

/* ---------------- S5 统计 HUD + 面板 ---------------- */
test('S5: 统计 HUD 实时更新', function () {
  pump(10);
  var revenue = getEl('revenue').textContent;
  assert(parseInt(revenue, 10) > 0, '营业额 HUD 应 >0，实际 "' + revenue + '"');
  assert(parseInt(getEl('served').textContent, 10) >= 1, '上菜 HUD ≥1');
  assert(getEl('time').textContent !== '', '时间 HUD 有值');
  assert(getEl('log').children.length >= 1, '事件日志有记录');
});

/* ---------------- S6 v3.0 新功能渲染 ---------------- */
test('S6: 环境事件渲染 + 季节切换 + 成就面板数据', function () {
  // 触发一个漏水事件（渲染不应崩溃）
  sim.envEvent = { type: 'leak', x: 900, y: 400 };
  pump(30);
  assert(sim.envEvent !== null || sim.stats.leaksFixed >= 0, '事件渲染存活');
  // 季节切换
  sim.setSeason(2);
  pump(10);
  assert(sim.season === 2, '切秋');
  // 手动触发打烊结算路径的成就面板渲染
  var Ach = windowMock.KitchenAch;
  var list = Ach.achView({ achieved: { first_dish: true } });
  assert(list.length >= 12 && list[0].done === true, '成就视图渲染数据');
  var codex = Ach.codexView({ recipeCounts: { cabbage: 1 } }, windowMock.KitchenData.RECIPES, windowMock.KitchenData.CUSTOMERS);
  assert(codex.recipes.length === 3 && codex.recipes[0].lit, '图鉴视图渲染数据');
  pump(30);   // 再跑一段确保事件被经理处理掉也不崩
});

/* ---------------- 汇总 ---------------- */
console.log('\n========================================');
console.log('  通过 ' + passed + ' / 失败 ' + failed);
if (failed) {
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('浏览器端冒烟测试全部通过 ✔');
