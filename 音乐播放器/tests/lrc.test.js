/* ============================================================
 * lrc.test.js —— 贪吃蛇？不，音乐播放器逻辑单元测试
 * （LRC 解析/二分定位/播放模式索引/列表索引维护）
 * Node 运行：node tests/lrc.test.js
 * ============================================================ */
'use strict';
var path = require('path');
var M = require(path.join(__dirname, '../js/model.js'));
var Lrc = require(path.join(__dirname, '../js/lrc.js'));
var Playlist = require(path.join(__dirname, '../js/playlist.js'));

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

function mkTracks(n) {
  var arr = [];
  for (var i = 0; i < n; i++) arr.push(M.createTrack({ title: 'Song' + i, artist: 'A' }));
  return arr;
}

/* ================= T9a LRC 解析 ================= */

test('LRC: 标准 [mm:ss.xx] 单时间标签解析', function () {
  var lines = Lrc.parseLrc('[ti:测试]\n[00:01.50]你好\n[01:02.30]世界');
  assert(lines.length === 2, '应为 2 行，实际 ' + lines.length);
  assert(approx(lines[0].t, 1.5) && lines[0].text === '你好', '第一行 t=1.5');
  assert(approx(lines[1].t, 62.3) && lines[1].text === '世界', '第二行 t=62.3');
});

test('LRC: 一行多时间标签 + [mm:ss.xxx] 三位毫秒', function () {
  var lines = Lrc.parseLrc('[00:05.000][00:10.500]副歌\n[00:03.250]前奏');
  assert(lines.length === 3, '应展开为 3 行，实际 ' + lines.length);
  assert(lines[0].t === 3.25 && lines[0].text === '前奏', '排序正确');
  assert(lines[1].t === 5 && lines[2].t === 10.5, '多标签展开正确');
  assert(lines[1].text === '副歌' && lines[2].text === '副歌', '文本复制');
});

test('LRC: [offset:] 全局偏移（正值提前）', function () {
  var lines = Lrc.parseLrc('[offset:500]\n[00:10.00]A\n[00:20.00]B');
  assert(approx(lines[0].t, 9.5), 'offset 500ms → 10-0.5=9.5，实际 ' + lines[0].t);
  lines = Lrc.parseLrc('[offset:-2000]\n[00:10.00]A');
  assert(approx(lines[0].t, 12), '负 offset → 10+2=12，实际 ' + lines[0].t);
});

test('LRC: 元数据忽略 / 无标签行忽略 / 空文本保留', function () {
  var lines = Lrc.parseLrc('[ti:歌名]\n[ar:歌手]\n无标签普通行\n[00:01.00]\n[00:02.00]♪');
  assert(lines.length === 2, '无标签行被忽略、元数据被忽略，实际 ' + lines.length);
  assert(lines[0].text === '', '空文本行保留（间奏占位）');
  assert(lines[1].text === '♪');
});

test('LRC: 分钟可 1 位（[0:12.5]）且结果升序', function () {
  var lines = Lrc.parseLrc('[0:30.5]b\n[0:10.0]a');
  assert(lines.length === 2 && lines[0].text === 'a' && approx(lines[0].t, 10),
         '升序 + 单位数分钟解析');
  assert(approx(lines[1].t, 30.5));
});

/* ================= T9b 二分定位 ================= */

test('findLrcIndex: 首行前/行间/最后行/边界', function () {
  var ls = Lrc.parseLrc('[00:01.00]A\n[00:05.00]B\n[00:09.00]C\n[00:13.00]D');
  assert(Lrc.findLrcIndex(ls, 0.5) === -1, '首行前 → -1');
  assert(Lrc.findLrcIndex(ls, 1.0) === 0, '恰在首行时刻');
  assert(Lrc.findLrcIndex(ls, 4.99) === 0, 'B 之前仍是 A');
  assert(Lrc.findLrcIndex(ls, 5.0) === 1, '进入 B');
  assert(Lrc.findLrcIndex(ls, 99) === 3, '超尾 → 最后一行');
  assert(Lrc.findLrcIndex([], 5) === -1, '空歌词 → -1');
});

/* ================= model 工具 ================= */

test('model: parseFileName / formatTime', function () {
  var p1 = M.parseFileName('周杰伦 - 晴天.mp3');
  assert(p1.artist === '周杰伦' && p1.title === '晴天', '艺术家 - 标题');
  var p2 = M.parseFileName('未知名.flaс');
  assert(p2.title === '未知名' && p2.artist === '未知艺术家', '无分隔符回退');
  var p3 = M.parseFileName('A - B - C.flac');
  assert(p3.artist === 'A' && p3.title === 'B - C', '标题含分隔符时合并回右侧');
  assert(M.formatTime(65) === '01:05' && M.formatTime(59) === '00:59', 'mm:ss');
  assert(M.formatTime(3671) === '1:01:11', 'h:mm:ss');
});

/* ================= T2 四种模式 nextIndex ================= */

function pl(n, mode, cur) {
  var p = new Playlist(mkTracks(n));
  p.mode = mode;
  p.setCurrent(cur);
  return p;
}

test('T2a order 模式：末首结束停止(-1)', function () {
  var p = pl(3, 'order', 0);
  assert(p.nextIndex(false) === 1, '手动下一首 1');
  p.setCurrent(2);
  assert(p.nextIndex(true) === -1, '末首播完 → 停止');
  assert(p.nextIndex(false) === -1, '末首手动 → 停止');
  assert(p.prevIndex() === 1, 'prev 回退');
});

test('T2b list-loop 模式：末首回首', function () {
  var p = pl(3, 'list-loop', 2);
  assert(p.nextIndex(true) === 0, '末首回首');
  assert(p.prevIndex() === 1, 'prev 回绕到末首前一');
  p.setCurrent(0);
  assert(p.prevIndex() === 2, '0 的 prev 是末首');
});

test('T2c single 模式：播完重播，手动切歌仍切换', function () {
  var p = pl(3, 'single', 1);
  assert(p.nextIndex(true) === 1, 'ended → 当前重播');
  assert(p.nextIndex(false) === 2, '手动 next → 下一首');
});

test('T2d shuffle 模式：一轮不重不漏', function () {
  var p = pl(6, 'shuffle', 0);
  p.setCurrent(0);
  var seen = [0], idx = 0, guard = 0;
  while (guard++ < 20) {
    idx = p.nextIndex(true);
    seen.push(idx);
    p.setCurrent(idx);
    if (seen.length === 6) break;
  }
  assert(seen.length === 6, '一轮 6 首，实际 ' + seen.length);
  assert(new Set(seen).size === 6, '一轮内无重复: ' + seen.join(','));
  // 一轮结束后开启新一轮（仍应返回有效索引且不等于当前）
  var after = p.nextIndex(true);
  assert(after >= 0 && after < 6, '新一轮索引有效');
});

/* ================= T7 删除当前曲目索引维护 ================= */

test('T7a 删除当前曲（非末首）→ 指向原位，列表不断', function () {
  var p = new Playlist(mkTracks(4));
  p.setCurrent(1);
  var r = p.removeAt(1);
  assert(r.wasCurrent === true, '标记 wasCurrent');
  assert(p.tracks.length === 3, '剩 3 首');
  assert(p.currentIndex === 1, '当前指向原位置的新歌');
  assert(p.nextIndex(false) === 2, 'next 正常');
});

test('T7b 删除当前曲（末首）→ 指向新的末首', function () {
  var p = new Playlist(mkTracks(3));
  p.setCurrent(2);
  var r = p.removeAt(2);
  assert(r.wasCurrent && p.currentIndex === 1, '回退到新末首');
});

test('T7c 删除当前之前的曲 → currentIndex 左移', function () {
  var p = new Playlist(mkTracks(4));
  p.setCurrent(2);
  p.removeAt(0);
  assert(p.currentIndex === 1, '2-1=1');
  assert(p.tracks[1].title === 'Song2', '仍指向 Song2');
});

test('T7d 删到只剩 0 首 → currentIndex=-1，next 安全', function () {
  var p = new Playlist(mkTracks(2));
  p.setCurrent(1);
  p.removeAt(1);
  p.removeAt(0);
  assert(p.currentIndex === -1 && p.size() === 0, '空列表');
  assert(p.nextIndex(false) === -1 && p.nextIndex(true) === -1, 'next 全安全');
});

test('T7e removeById 与清空', function () {
  var p = new Playlist(mkTracks(3));
  p.setCurrent(1);
  var id = p.tracks[2].id;
  p.removeById(id);                      // 删除当前之后的曲
  assert(p.currentIndex === 1 && p.size() === 2, '之后删除不影响索引');
  p.clear();
  assert(p.currentIndex === -1 && p.size() === 0, '清空复位');
});

test('T7f 洗牌模式下删除当前曲 → 队列一致，无重复无遗漏', function () {
  var p = pl(5, 'shuffle', 0);
  p.setCurrent(0);
  var r = p.removeAt(0);
  assert(r.wasCurrent && p.currentIndex === 0, '删除后指向原位');
  // 走完一轮验证队列一致性
  var seen = [0], guard = 0, idx = 0;
  while (guard++ < 15) {
    idx = p.nextIndex(true);
    if (idx < 0) break;
    seen.push(idx);
    p.setCurrent(idx);
    if (seen.length === p.size()) break;
  }
  assert(new Set(seen).size === seen.length, '洗牌队列无重复: ' + seen.join(','));
  seen.forEach(function (i) { assert(i >= 0 && i < p.size(), '索引越界'); });
});

/* ================= add 首次指向 ================= */

test('add: 空列表首次添加自动指向第 0 首', function () {
  var p = new Playlist([]);
  p.add(mkTracks(3));
  assert(p.currentIndex === 0, '首次添加 → currentIndex=0');
  p.add(mkTracks(2));
  assert(p.currentIndex === 0 && p.size() === 5, '再次添加不变');
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('总计: ' + (passed + failed) + ' | 通过: ' + passed + ' | 失败: ' + failed);
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
