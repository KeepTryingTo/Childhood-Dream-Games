/* ============================================================
 * browser-smoke.js —— 浏览器端冒烟测试（Node 运行：node tests/browser-smoke.js）
 *
 * 背景：逻辑单元测试无法覆盖"浏览器全局环境下的模块装配"。
 * 本脚本用 mock DOM + Canvas + rAF 构造近似浏览器环境，
 * 按 index.html 的顺序加载全部 6 个脚本，端到端验证：
 *   S1 全部脚本加载无异常（导出契约 / id 引用正确）
 *   S2 渲染循环工作（canvas 2D 调用发生）
 *   S3 倒计时结束自动进入 playing
 *   S4 玩家（AI 代驾）能完成整场比赛
 *   S5 完赛后结算覆盖层弹出、名次表渲染
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

/* ---------------- mock canvas 2d（记录关键调用次数） ---------------- */
var calls = { save: 0, restore: 0, translate: 0, fillRect: 0, stroke: 0, fill: 0, arc: 0, setTransform: 0 };
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
    id: id, textContent: '', innerHTML: '', style: {}, checked: false,
    value: (id === 'difficulty') ? 'normal' : (id === 'laps' ? '3' : ''),
    _handlers: {},
    classList: {
      _set: {}, hidden: true,
      add: function (c) { this._set[c] = true; },
      remove: function (c) { delete this._set[c]; },
      contains: function (c) { return !!this._set[c]; }
    },
    addEventListener: function (t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    getBoundingClientRect: function () { return { width: 900, height: 620, left: 0, top: 0 }; },
    getContext: function () { return ctx2d; },
    parentElement: null
  };
  if (id === 'board') {
    el.parentElement = { getBoundingClientRect: function () { return { width: 900, height: 620, left: 0, top: 0 }; } };
  }
  return el;
}

var elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeElement(id); return elements[id]; }
// overlay 默认 hidden（模拟 index.html 的 class="hidden"）
getEl('overlay').classList.add('hidden');

var documentMock = {
  getElementById: getEl,
  body: {
    appendChild: function () {},
    getBoundingClientRect: function () { return { width: 900, height: 620 }; }
  }
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
windowMock.RACE_DEMO = true;      // 演示模式：AI 代驾玩家（等价 ?demo）

var sandbox = {
  window: windowMock, document: documentMock, self: windowMock,
  console: console, Math: Math,
  setTimeout: function (fn) { fn(); },          // 音效 beep 立即执行（不等待）
  setInterval: function () { return 0; },
  requestAnimationFrame: windowMock.requestAnimationFrame
};
vm.createContext(sandbox);

/* ---------------- S1 脚本加载 ---------------- */
var loadErrors = [];
['track.js', 'game.js', 'ai.js', 'storage.js', 'ui.js', 'main.js'].forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
  } catch (e) { loadErrors.push(f + ': ' + e.message); }
});

test('S1: 6 个脚本按 index.html 顺序加载无异常（导出契约正确）', function () {
  assert(loadErrors.length === 0, '加载失败 -> ' + loadErrors.join(' | '));
  assert(typeof windowMock.Track.Track === 'function', 'window.Track.Track 应为构造函数');
  assert(typeof windowMock.RaceGame.RaceGame === 'function', 'window.RaceGame.RaceGame 应为构造函数');
  assert(typeof windowMock.RaceAI.driveAll === 'function', 'window.RaceAI.driveAll 应为函数');
  assert(typeof windowMock.RaceUI === 'function', 'window.RaceUI 应为构造函数');
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
function pressKey(code, down) {
  (listeners[down ? 'keydown' : 'keyup'] || []).forEach(function (fn) {
    fn({ code: code, preventDefault: function () {} });
  });
}

/* ---------------- S2/S3 渲染与倒计时 ---------------- */
pump(240);   // 4 秒：3s 倒计时 + 1s 比赛

test('S2: 渲染循环工作（canvas 车辆绘制调用 > 0）', function () {
  assert(calls.save > 100, 'save 调用应 >100，实际 ' + calls.save);
  assert(calls.translate > 100, 'translate 调用应 >100');
  assert(calls.fillRect > 100, '背景填充应 >100');
});

test('S3: 倒计时结束自动进入竞速（HUD 更新、状态非倒计时）', function () {
  var status = getEl('status').textContent;
  assert(status !== '', '状态栏应有内容');
  var speed = getEl('speed').textContent;
  assert(speed !== 'NaN' && speed !== '', '速度不应为 NaN/空，实际 "' + speed + '"');
  assert(getEl('rank-list').innerHTML.indexOf('rank-row') >= 0, '名次表应已渲染');
});

/* ---------------- S4 玩家完赛（演示模式：AI 代驾） ---------------- */
var gameRef = windowMock.__raceGame;   // main.js 暴露的引用
test('S4 前置: main.js 暴露 __raceGame 调试引用', function () {
  assert(gameRef && typeof gameRef.tick === 'function', 'window.__raceGame 应为 RaceGame 实例');
});

var finished = false, smokeError = null;
try {
  var frames = 0;
  while (!gameRef.cars[0].finished && frames < 30000) {
    pump(1);      // loop 内部：demo 模式下 AI 驱动玩家 + AI 车队 + tick + render + HUD
    frames++;
  }
  finished = gameRef.cars[0].finished;
} catch (e) { smokeError = e.message; }

test('S4: 玩家（AI 代驾）完成 3 圈比赛，无运行时异常', function () {
  assert(!smokeError, '循环抛错: ' + smokeError);
  assert(finished, '30000 帧内应完赛');
  var p = gameRef.cars[0];
  assert(p.lap >= 3, '圈数应 ≥3，实际 ' + p.lap);
  assert(p.bestLapMs > 0, '最佳圈速已记录');
});

/* ---------------- S5 结算 ---------------- */
test('S5: 完赛结算弹出（overlay 显示 + 名次 + 圈速）', function () {
  pump(5);
  assert(!getEl('overlay').classList.contains('hidden'), 'overlay 应可见');
  assert(getEl('overlay-title').textContent !== '', '结算标题应有内容');
  assert(getEl('overlay-body').innerHTML.indexOf('玩家') >= 0, '结算应包含玩家名次行');
  var best = getEl('best-lap').textContent;
  assert(best !== '' && best !== '—', '侧栏最佳圈速应已刷新，实际 "' + best + '"');
});

/* ---------------- 汇总 ---------------- */
console.log('\n========================================');
console.log('  通过 ' + passed + ' / 失败 ' + failed);
if (failed) {
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('浏览器端冒烟测试全部通过 ✔');
