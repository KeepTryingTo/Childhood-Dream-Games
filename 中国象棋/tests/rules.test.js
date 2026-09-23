/* ============================================================
 * rules.test.js —— 规则引擎单元测试（Node 运行：node tests/rules.test.js）
 *
 * 覆盖需求文档第 6 节用例 T1~T10，另含：
 *   - isAttacked 反向扫描 与 暴力全量走法 交叉验证（随机对局抽样）
 *   - 随机对局冒烟测试（引擎不崩溃、终局判定正确）
 *   - AI 合法出招与耗时检查
 * ============================================================ */
'use strict';
var path = require('path');
var M = require(path.join(__dirname, '../js/model.js'));
var R = require(path.join(__dirname, '../js/rules.js'));
var G = require(path.join(__dirname, '../js/game.js'));
var AI = require(path.join(__dirname, '../js/ai.js'));

/* ---------------- 极简测试框架 ---------------- */
var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; failures.push(name + ' -> ' + e.message); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

function hasMove(moves, fr, fc, tr, tc) {
  return moves.some(function (m) { return m.fr === fr && m.fc === fc && m.tr === tr && m.tc === tc; });
}
function countFrom(moves, fr, fc) {
  return moves.filter(function (m) { return m.fr === fr && m.fc === fc; }).length;
}
/** 构造自定义局面：rows 为 10 行，每行 9 个数字（0 空 / 红正黑负） */
function boardOf(rows) {
  var b = [];
  for (var r = 0; r < 10; r++) {
    b.push(rows[r].split(/\s+/).filter(function (s) { return s !== ''; }).map(Number));
  }
  return b;
}

/* ================= 模型测试 ================= */

test('model: initBoard 与需求布局一致', function () {
  var b = M.initBoard();
  assert(b[0][0] === -5 && b[0][4] === -1 && b[0][8] === -5, '黑方底线错误');
  assert(b[2][1] === -6 && b[2][7] === -6, '黑炮位错误');
  assert(b[3][0] === -7 && b[3][8] === -7 && b[3][4] === -7, '黑卒位错误');
  assert(b[6][0] === 7 && b[6][4] === 7, '红兵位错误');
  assert(b[7][1] === 6 && b[7][7] === 6, '红炮位错误');
  assert(b[9][4] === 1 && b[9][0] === 5 && b[9][1] === 4, '红方底线错误');
  assert(b[4][4] === 0 && b[5][4] === 0, '河界应为空');
});

test('model: cloneBoard 深拷贝互不影响', function () {
  var b = M.initBoard(), c = M.cloneBoard(b);
  c[9][4] = 0;
  assert(b[9][4] === 1, '克隆修改不应影响原棋盘');
});

/* ================= T1 马腿 ================= */

test('T1: 马腿点有子 → 该方向走法不生成', function () {
  // 黑马 (2,1)；腿位 (3,1) 放黑卒 → (4,0),(4,2) 不可达；其余可达
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0 -4  0  0  0  0  0  0  0',
    ' 0 -7  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0']);
  var ms = R.getPseudoMoves(b, 2, 1);
  assert(!hasMove(ms, 2, 1, 4, 0), '腿(3,1)被塞 → (4,0) 不可达');
  assert(!hasMove(ms, 2, 1, 4, 2), '腿(3,1)被塞 → (4,2) 不可达');
  assert(hasMove(ms, 2, 1, 0, 0) && hasMove(ms, 2, 1, 0, 2), '腿(1,1)空 → 上方可达');
  assert(hasMove(ms, 2, 1, 3, 3) && hasMove(ms, 2, 1, 1, 3), '腿(2,2)空 → 右向可达');

  // 塞另一条腿 (2,2)
  b[3][1] = 0; b[2][2] = -7;
  ms = R.getPseudoMoves(b, 2, 1);
  assert(!hasMove(ms, 2, 1, 3, 3) && !hasMove(ms, 2, 1, 1, 3), '腿(2,2)被塞 → 右向不可达');
  assert(hasMove(ms, 2, 1, 4, 0) && hasMove(ms, 2, 1, 4, 2), '腿(3,1)已空 → 下方恢复可达');
});

/* ================= T2 象眼 / 过河 ================= */

test('T2: 象眼有子不能走；象不能过河', function () {
  // 红相 (9,2)：目标 (7,0) 眼(8,1)；目标 (7,4) 眼(8,3)
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  3  0  0  0  0  0  1']);
  var ms = R.getPseudoMoves(b, 9, 2);
  assert(hasMove(ms, 9, 2, 7, 0) && hasMove(ms, 9, 2, 7, 4), '正常田字可达');

  b[8][1] = 7; // 塞 (7,0) 的象眼
  ms = R.getPseudoMoves(b, 9, 2);
  assert(!hasMove(ms, 9, 2, 7, 0), '象眼(8,1)有子 → (7,0) 不可达');
  assert(hasMove(ms, 9, 2, 7, 4), '象眼(8,3)空 → (7,4) 仍可达');

  // 过河限制：红相 (5,2) 不得走到 row<=4
  b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  3  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  1']);
  ms = R.getPseudoMoves(b, 5, 2);
  assert(!hasMove(ms, 5, 2, 3, 0) && !hasMove(ms, 5, 2, 3, 4), '红相不能过河');
  assert(hasMove(ms, 5, 2, 7, 0) && hasMove(ms, 5, 2, 7, 4), '红相回撤可走');
});

/* ================= T3 士/将出九宫 ================= */

test('T3: 士/将不得出九宫', function () {
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  2  1  0  0  0  0']);
  var msA = R.getPseudoMoves(b, 9, 3); // 红仕
  assert(msA.length === 1 && hasMove(msA, 9, 3, 8, 4), '仕(9,3)只能走到(8,4)');
  var msK = R.getPseudoMoves(b, 9, 4); // 红帅
  assert(msK.length === 2, '帅(9,4)只有2个走法(己方仕占位不可走)，实际 ' + msK.length);
  assert(hasMove(msK, 9, 4, 9, 5) && hasMove(msK, 9, 4, 8, 4), '帅可走(9,5)(8,4)');
  assert(!hasMove(msK, 9, 4, 9, 3), '不能走到己方仕的位置');
  assert(!hasMove(msK, 9, 4, 9, 2) && !hasMove(msK, 9, 4, 10, 4), '不得出九宫/出界');
});

/* ================= T4 兵/卒 ================= */

test('T4: 未过河兵不能横走/后退；过河兵可横走但仍不可后退', function () {
  // 红兵 (6,0) 未过河；(4,0) 已过河；(5,0) 保持为空
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 7  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 7  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  1  0  0  0  0']);
  var ms1 = R.getPseudoMoves(b, 6, 0); // 未过河红兵（r=6>4）
  assert(ms1.length === 1 && hasMove(ms1, 6, 0, 5, 0), '未过河只能前进一格');
  var ms3 = R.getPseudoMoves(b, 4, 0); // 已过河红兵（r=4<=4）
  assert(ms3.length === 2 && hasMove(ms3, 4, 0, 3, 0) && hasMove(ms3, 4, 0, 4, 1),
         '过河后：前进 + 横走，不能后退');

  // 黑卒对称验证
  var b2 = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0 -7',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0 -7',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0']);
  var ms4 = R.getPseudoMoves(b2, 3, 8); // 黑卒未过河（r=3<5）
  assert(ms4.length === 1 && hasMove(ms4, 3, 8, 4, 8), '未过河黑卒只能下进');
  var ms5 = R.getPseudoMoves(b2, 5, 8); // 黑卒已过河（r=5>=5）
  assert(ms5.length === 2 && hasMove(ms5, 5, 8, 6, 8) && hasMove(ms5, 5, 8, 5, 7),
         '过河黑卒：下进 + 横走');
});

/* ================= T5 炮 ================= */

test('T5: 炮——无架不吃/隔两子不吃/越子移动不允许；隔一子吃允许', function () {
  // 场景1（无架不吃）：红炮 (5,4)，黑卒 (5,6)，中间 (5,5) 空
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  6  0 -7  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0']);
  var ms = R.getPseudoMoves(b, 5, 4);
  assert(hasMove(ms, 5, 4, 5, 5), '无阻挡可平移到(5,5)');
  assert(!hasMove(ms, 5, 4, 5, 6), '黑卒恰为第一个遭遇子（作架）→ 无架不能吃');

  // 场景2（隔一子吃）：加炮架 红兵(5,5)
  b[5][5] = 7;
  ms = R.getPseudoMoves(b, 5, 4);
  assert(!hasMove(ms, 5, 4, 5, 5), '不能落在炮架上');
  assert(hasMove(ms, 5, 4, 5, 6), '隔一子(炮架)吃黑卒允许');

  // 场景3（隔两子不吃）：炮(5,4) 架(5,5) 中阻(5,6) 目标(5,7)
  var b2 = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  6  7  7 -7  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0']);
  ms = R.getPseudoMoves(b2, 5, 4);
  assert(!hasMove(ms, 5, 4, 5, 7), '隔两个子不能吃');
  assert(!hasMove(ms, 5, 4, 5, 6), '越架后空位不能落子——(5,6)有子且为第二子，不可达');
});

/* ================= T6 牵制 ================= */

test('T6: 走子后己将被吃的着法被过滤（牵制子不能动）', function () {
  // 黑车 (5,4) 与红帅 (9,4) 同列，红马 (7,4) 为唯一遮挡；红车 (9,0) 不受影响
  var b = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0 -5  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  4  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 5  0  0  0  1  0  0  0  0']);
  var ms = R.getLegalMoves(b, M.RED);
  assert(countFrom(ms, 7, 4) === 0, '被牵制的红马无合法走法（挪开即失将）');
  assert(countFrom(ms, 9, 0) > 0, '其他子走法不受影响');

  // 试走验证：马离开后红帅暴露于黑车
  var cap = R.makeMove(b, { fr: 7, fc: 4, tr: 6, tc: 6 });
  assert(R.isChecked(b, M.RED), '马跳离后红帅暴露于黑车');
  R.undoMove(b, { fr: 7, fc: 4, tr: 6, tc: 6 }, cap);
});

/* ================= T7 飞将 ================= */

test('T7: 造成将帅照面的着法非法；开放线上可将飞吃敌将', function () {
  // a) 红马 (5,4) 挡在两将之间；马的所有走法都离开 col4 → 全部造成照面 → 被过滤
  var b = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  4  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  1  0  0  0  0']);
  var ms = R.getLegalMoves(b, M.RED);
  assert(countFrom(ms, 5, 4) === 0, '挡子马跳离 col4 将造成照面 → 全部被过滤');
  assert(!R.isChecked(b, M.RED) && !R.isChecked(b, M.BLACK), '当前马挡线，两将均不被将');

  // b) 已照面局面：将可沿开放线飞吃对方将
  var b2 = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  1  0  0  0  0']);
  var fly = R.getPseudoMoves(b2, 9, 4);
  assert(hasMove(fly, 9, 4, 0, 4), '照面时红帅可飞吃黑将');
  assert(R.isChecked(b2, M.BLACK) && R.isChecked(b2, M.RED), '照面双方均视为被将');
  assert(R.kingsFacing(b2), 'kingsFacing 判定正确');
});

/* ================= T8 将死 ================= */

test('T8: 构造将死局面 → 正确判负', function () {
  // 黑将(0,4)，黑士(2,3)(2,5)；红车(0,0) 将军、红车(1,7) 封锁 row1；红帅(9,4)
  var b = boardOf([
    ' 5  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  5  0',
    ' 0  0  0 -2  0 -2  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  1  0  0  0  0']);
  assert(R.isChecked(b, M.BLACK), '黑将被将军');
  assert(R.getLegalMoves(b, M.BLACK).length === 0, '黑方无合法着法');
  var j = R.judge(b, M.BLACK);
  assert(j && j.winner === M.RED && j.reason === 'checkmate', '红方胜（将死）');
  assert(R.isCheckmate(b, M.BLACK), 'isCheckmate = true');
  assert(!R.isStalemate(b, M.BLACK), '不是困毙');
});

/* ================= T9 困毙 ================= */

test('T9: 构造困毙局面 → 无着法方判负', function () {
  // 黑将(0,4) 三出口被两过河红兵控制；红帅(9,0) 避开同列照面
  var b = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  7  0  7  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 1  0  0  0  0  0  0  0  0']);
  assert(!R.isChecked(b, M.BLACK), '黑将未被将军');
  assert(R.getLegalMoves(b, M.BLACK).length === 0, '黑方无合法着法（三出口均被兵控制）');
  var j = R.judge(b, M.BLACK);
  assert(j && j.winner === M.RED && j.reason === 'stalemate', '红方胜（困毙——中国象棋规则）');
  assert(R.isStalemate(b, M.BLACK) && !R.isCheckmate(b, M.BLACK), 'isStalemate = true');
});

/* ================= T10 存档读档 ================= */

test('T10: 存档→读档往返，局面/回合/记录完全一致', function () {
  var g1 = new G.Game();
  // 走三步：炮二平五、马2进3、马二进三（均用真实合法走法）
  var moves = R.getLegalMoves(g1.board, g1.turn);
  g1.applyMove(moves.find(function (m) { return m.fr === 7 && m.fc === 7 && m.tr === 7 && m.tc === 4; })); // 炮二平五
  moves = R.getLegalMoves(g1.board, g1.turn);
  g1.applyMove(moves.find(function (m) { return m.fr === 0 && m.fc === 1 && m.tr === 2 && m.tc === 2; })); // 马2进3
  moves = R.getLegalMoves(g1.board, g1.turn);
  g1.applyMove(moves.find(function (m) { return m.fr === 9 && m.fc === 7 && m.tr === 7 && m.tc === 6; })); // 马二进三

  var data = JSON.parse(JSON.stringify(g1.serialize())); // 模拟 JSON 存档
  var g2 = new G.Game();
  assert(g2.deserialize(data), 'deserialize 成功');
  assert(JSON.stringify(g2.board) === JSON.stringify(g1.board), '局面一致');
  assert(g2.turn === g1.turn, '行棋方一致');
  assert(g2.history.length === g1.history.length && g2.history.length === 3, '记录条数一致');
  assert(g2.history[2].record === g1.history[2].record, '最后一步记谱一致');

  // 无效数据拒绝
  assert(!g2.deserialize({ v: 2 }), '版本不符应拒绝');
  assert(!g2.deserialize(null), 'null 应拒绝');
});

/* ================= 中文记谱 ================= */

test('记谱: 炮二平五 / 马8进7 / 兵五进一 风格正确', function () {
  var g = new G.Game();
  // 红炮二平五：(7,7)→(7,4) 红方视角 col7 → 二
  var rec = G.formatMoveCN(g.board, { fr: 7, fc: 7, tr: 7, tc: 4 });
  assert(rec === '炮二平五', '红炮平移记谱，实际: ' + rec);
  // 黑马8进7：(0,1)→(2,2) 黑方视角 col1 → 2
  rec = G.formatMoveCN(g.board, { fr: 0, fc: 1, tr: 2, tc: 2 });
  assert(rec === '马2进3', '黑马斜走记目标列，实际: ' + rec);
  // 红兵五进一：(6,4)→(5,4)
  rec = G.formatMoveCN(g.board, { fr: 6, fc: 4, tr: 5, tc: 4 });
  assert(rec === '兵五进一', '红兵直进记格数，实际: ' + rec);
  // 黑卒3进1：(3,2)→(4,2)
  rec = G.formatMoveCN(g.board, { fr: 3, fc: 2, tr: 4, tc: 2 });
  assert(rec === '卒3进1', '黑卒直进记格数，实际: ' + rec);
});

/* ================= isAttacked 双实现交叉验证 ================= */

/** 暴力版：遍历 bySide 全部棋子的伪走法（剔除"将飞吃"远距离着法） */
function isAttackedBrute(board, r, c, bySide) {
  for (var rr = 0; rr < 10; rr++) {
    for (var cc = 0; cc < 9; cc++) {
      if (M.sideOf(board[rr][cc]) !== bySide) continue;
      var ms = R.getPseudoMoves(board, rr, cc);
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        // 剔除将的飞将吃（目标为敌将的远距离着法），该情形由 kingsFacing 统一表达
        if (Math.abs(board[m.fr][m.fc]) === M.KING &&
            (Math.abs(m.tr - m.fr) + Math.abs(m.tc - m.fc)) > 1) continue;
        if (m.tr === r && m.tc === c) return true;
      }
    }
  }
  return false;
}

/** 统一语义比较（含飞将照面） */
function attackedConsistent(board, r, c, bySide) {
  var fast = R.isAttacked(board, r, c, bySide);
  var slow = isAttackedBrute(board, r, c, bySide);
  var k = R.findKing(board, M.opp(bySide));
  var facing = !!(k && k[0] === r && k[1] === c && R.kingsFacing(board));
  fast = fast || facing;
  slow = slow || facing;
  return fast === slow;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('交叉验证: 随机对局中 isAttacked 与暴力实现一致（200 局抽样）', function () {
  var rand = mulberry32(20250904);
  var checked = 0;
  for (var game = 0; game < 200; game++) {
    var b = M.initBoard();
    var side = M.RED;
    for (var step = 0; step < 60; step++) {
      var legal = R.getLegalMoves(b, side);
      if (legal.length === 0) break;
      var mv = legal[Math.floor(rand() * legal.length)];
      var cap = R.makeMove(b, mv);
      // 抽样 4 个点做双实现对照
      for (var s = 0; s < 4; s++) {
        var rr = Math.floor(rand() * 10), cc = Math.floor(rand() * 9);
        var sd = rand() < 0.5 ? M.RED : M.BLACK;
        assert(attackedConsistent(b, rr, cc, sd),
          '不一致: 局面步数' + step + ' 点(' + rr + ',' + cc + ') bySide=' + sd);
        checked++;
      }
      R.undoMove(b, mv, cap);

      R.makeMove(b, mv);
      if (R.getLegalMoves(b, M.opp(side)).length === 0) break; // 终局
      side = M.opp(side);
    }
  }
  console.log('        （共对照 ' + checked + ' 个点判定）');
  assert(checked > 3000, '抽样数量不足');
});

/* ================= 随机对局冒烟 ================= */

test('冒烟: 50 局随机合法对弈，引擎不崩溃且终局判定正确', function () {
  var rand = mulberry32(9527);
  var ended = 0, unfinished = 0;
  for (var g = 0; g < 50; g++) {
    var b = M.initBoard();
    var side = M.RED;
    var steps = 0;
    while (steps < 300) {
      var legal = R.getLegalMoves(b, side);
      if (legal.length === 0) {
        var j = R.judge(b, side);
        assert(j && (j.reason === 'checkmate' || j.reason === 'stalemate'), '终局原因合法');
        assert(R.isChecked(b, side) === (j.reason === 'checkmate'), '将死/困毙判定自洽');
        ended++;
        break;
      }
      var mv = legal[Math.floor(rand() * legal.length)];
      R.makeMove(b, mv);
      side = M.opp(side);
      steps++;
    }
    if (steps >= 300) unfinished++;
  }
  console.log('        （终局 ' + ended + ' 局，超步未分 ' + unfinished + ' 局）');
});

/* ================= 对局流程 Game ================= */

test('Game: 走子/悔棋/胜负状态正确', function () {
  var g = new G.Game();
  var ms = g.legalTargets(7, 7); // 红炮二的所有合法走法
  assert(ms.length === 12, '开局红炮(7,7)合法走法应为12，实际 ' + ms.length);

  // 炮二平五
  g.applyMove({ fr: 7, fc: 7, tr: 7, tc: 4 });
  assert(g.turn === M.BLACK, '走后轮黑');
  assert(g.history[0].record === '炮二平五', '记录为 炮二平五');
  assert(g.board[7][4] === 6 && g.board[7][7] === 0, '棋盘已更新');

  g.undo();
  assert(g.turn === M.RED && g.history.length === 0, '悔棋回到初始');
  assert(g.board[7][7] === 6 && g.board[7][4] === 0, '悔棋还原棋盘');

  // 构造红车直插黑方底线的攻击局面，验证将死状态字段
  g.reset();
  var data = g.serialize();
  data.board = boardOf([
    ' 0  0  0  0 -1  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 5  0  0  0  1  0  0  4  0']);
  assert(g.deserialize(data), '手工局面载入');
  // 红车 (9,0)→(0,0) 同列直进：将军黑将；黑将三出口被红马/车控制情况由引擎判定
  g.applyMove({ fr: 9, fc: 0, tr: 0, tc: 0 });
  assert(g.checkSide === M.BLACK || g.status !== 'playing', '车至(0,0)后黑方被将或终局');
});

/* ================= AI 冒烟 ================= */

test('AI: 三档难度均能 3 秒内给出合法着法', function () {
  var b = M.initBoard();
  ['easy', 'medium', 'hard'].forEach(function (d) {
    var t0 = Date.now();
    var mv = AI.findBestMove(b, M.RED, d);
    var dt = Date.now() - t0;
    assert(!!mv, d + ' 应返回着法');
    assert(R.getLegalMoves(b, M.RED).some(function (m) {
      return m.fr === mv.fr && m.fc === mv.fc && m.tr === mv.tr && m.tc === mv.tc;
    }), d + ' 着法必须合法');
    assert(dt <= 3200, d + ' 耗时 ' + dt + 'ms 超限');
    console.log('        ' + d + ': ' + G.formatMoveCN(b, mv) + ' (' + dt + 'ms)');
  });
});

test('AI: 会应将（被将军时走出解将着法）', function () {
  // 黑车 (4,4) 将军红帅 (9,4)？(4,4)-(9,4) 间 (5..8,4) 空 → 将军。红方必须应将。
  var b = boardOf([
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0 -5  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  0  0  0  0  0',
    ' 0  0  0  0  1  0  0  0  0']);
  assert(R.isChecked(b, M.RED), '红帅被将');
  var mv = AI.findBestMove(b, M.RED, 'medium');
  assert(!!mv, '应给出着法');
  var cap = R.makeMove(b, mv);
  assert(!R.isChecked(b, M.RED), 'AI 走后仍被将 → 未应将，着法: ' + JSON.stringify(mv));
  R.undoMove(b, mv, cap);
});

/* ================= 汇总 ================= */
console.log('\n========================================');
console.log('总计: ' + (passed + failed) + ' | 通过: ' + passed + ' | 失败: ' + failed);
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
