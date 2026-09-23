/**
 * rules.test.js —— 规则引擎单元测试
 *
 * 覆盖 require.md 第 6 节关键用例：
 *   T1 横向连五  | T2 纵向连五 | T3 左斜连五 | T4 右斜连五
 *   T5 中间夹对方子的"假五连"不判胜
 *   T6 自由规则黑长连判胜 / 满盘判和
 *   T7 Renju 黑三三、双四、长连判禁手
 *   T8 Renju 同时成五与三三判胜（成五优先）
 *   T9 Renju 白棋长连判胜
 *
 * 运行方式：
 *   - Node：`node tests/rules.test.js`
 *   - 浏览器：将本文件以 <script> 引入，或在控制台手动执行
 */
(function () {
  'use strict';

  // ---------- 在 Node 环境下加载依赖 ----------
  let Gomoku = (typeof window !== 'undefined' ? window.Gomoku : globalThis.Gomoku);
  if (!Gomoku) {
    // Node 下 require 会执行 IIFE 并挂载到 globalThis.Gomoku
    const path = require('path');
    const base = path.join(__dirname, '..', 'js');
    require(path.join(base, 'model.js'));
    require(path.join(base, 'rules.js'));
    Gomoku = globalThis.Gomoku;
  }

  const Model = Gomoku.Model;
  const Rules = Gomoku.Rules;
  const BLACK = Model.BLACK;
  const WHITE = Model.WHITE;
  const FREE = Rules.RULES.FREE;
  const RENJU = Rules.RULES.RENJU;

  // ---------- 简易断言工具 ----------
  let passCount = 0;
  let failCount = 0;

  function assert(cond, name, extra) {
    if (cond) {
      passCount++;
      console.log('  ✓ ' + name);
    } else {
      failCount++;
      console.error('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : ''));
    }
  }

  /** 在棋盘上按坐标列表落子，格式 [[r,c], 颜色] */
  function buildBoard(moves) {
    const b = Model.initBoard(15);
    for (const [r, c, color] of moves) b[r][c] = color;
    return b;
  }

  // ================================================================
  //  T1-T5：基本胜负判定（自由规则）
  // ================================================================
  console.log('\n== T1-T5 基本胜负判定（自由规则） ==');

  // T1 横向连五：黑 (7,3)~(7,7)
  {
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 5, BLACK],
      [7, 6, BLACK],
    ]);
    // 落第 5 子
    b[7][7] = BLACK;
    const wr = Rules.checkWin(b, 7, 7, FREE);
    assert(wr.win && wr.player === BLACK, 'T1 横向连五判胜', wr);
    assert(wr.winLine && wr.winLine.length >= 5, 'T1 winLine 正确', wr.winLine);
  }

  // T2 纵向连五：白 (3,3)~(7,3)
  {
    const b = buildBoard([
      [3, 3, WHITE],
      [4, 3, WHITE],
      [5, 3, WHITE],
      [6, 3, WHITE],
    ]);
    b[7][3] = WHITE;
    const wr = Rules.checkWin(b, 7, 3, FREE);
    assert(wr.win && wr.player === WHITE, 'T2 纵向连五判胜', wr);
  }

  // T3 左斜连五（主对角线 \）：(3,3)~(7,7)
  {
    const b = buildBoard([
      [3, 3, BLACK],
      [4, 4, BLACK],
      [5, 5, BLACK],
      [6, 6, BLACK],
    ]);
    b[7][7] = BLACK;
    const wr = Rules.checkWin(b, 7, 7, FREE);
    assert(wr.win, 'T3 左斜连五判胜', wr);
  }

  // T4 右斜连五（副对角线 /）：(3,7)~(7,3)
  {
    const b = buildBoard([
      [3, 7, BLACK],
      [4, 6, BLACK],
      [5, 5, BLACK],
      [6, 4, BLACK],
    ]);
    b[7][3] = BLACK;
    const wr = Rules.checkWin(b, 7, 3, FREE);
    assert(wr.win, 'T4 右斜连五判胜', wr);
  }

  // T5 中间夹对方子的"假五连"不判胜
  {
    // 黑 X X X 白 X X  → 落最后一黑时，中间被白隔断，不判胜
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 5, BLACK],
      [7, 6, WHITE], // 对方阻断
      [7, 8, BLACK],
    ]);
    // 落 (7,7) 黑子，两侧都被白阻断，不构成五连
    b[7][7] = BLACK;
    const wr = Rules.checkWin(b, 7, 7, FREE);
    assert(!wr.win, 'T5 夹对方子的假五连不判胜', wr);
  }

  // ================================================================
  //  T6：自由规则黑长连判胜 / 满盘判和
  // ================================================================
  console.log('\n== T6 自由规则长连 / 满盘 ==');

  // 长连：黑 (7,3)~(7,8) 共 6 子
  {
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 5, BLACK],
      [7, 6, BLACK],
      [7, 7, BLACK],
    ]);
    b[7][8] = BLACK;
    const wr = Rules.checkWin(b, 7, 8, FREE);
    assert(wr.win, 'T6 自由规则黑长连判胜', wr);
    // Renju 下黑长连不是胜
    const wrRenju = Rules.checkWin(b, 7, 8, RENJU);
    assert(!wrRenju.win, 'T6 Renju 黑长连不判胜（应判禁手）', wrRenju);
  }

  // 满盘判和
  {
    const b = Model.initBoard(15);
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        b[r][c] = ((r + c) % 2 === 0) ? BLACK : WHITE;
      }
    }
    // isDraw 语义：棋盘已满（上层在无连五时才调用，故满盘即和）
    assert(Rules.isDraw(b), 'T6 满盘判和');
    // 空盘不判和
    const empty = Model.initBoard(15);
    assert(!Rules.isDraw(empty), 'T6 空盘不判和');
  }

  // ================================================================
  //  T7-T9：Renju 禁手
  // ================================================================
  console.log('\n== T7-T9 Renju 禁手 ==');

  // T7a 长连禁手：黑已有 (7,3)~(7,7) 5 连，落 (7,8) 形成 6 连
  {
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 5, BLACK],
      [7, 6, BLACK],
      [7, 7, BLACK],
    ]);
    const fb = Rules.checkForbidden(b, 7, 8);
    assert(fb.forbidden && fb.type === 'long', 'T7 黑长连判禁手', fb);
  }

  // T7b 双四禁手：横、竖两个方向同时形成"四"
  {
    // 落子点 (7,5)
    // 横向：黑 (7,3)(7,4)(7,6)，落 (7,5) 形成 (7,3)~(7,6) 四连；
    //       右端 (7,7) 被白堵 → 冲四（1 个四）
    // 竖向：黑 (3,5)(4,5)(6,5)，落 (7,5) 后，在 (5,5) 补子可成五 → 跳四（1 个四）
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 6, BLACK],
      [3, 5, BLACK],
      [4, 5, BLACK],
      [6, 5, BLACK],
      [7, 7, WHITE], // 堵住横向右端
    ]);
    const fb = Rules.checkForbidden(b, 7, 5);
    assert(fb.forbidden && fb.type === 'double-four', 'T7 黑双四判禁手', fb);
  }

  // T7c 三三禁手：横、竖两个方向同时形成活三
  {
    const b = buildBoard([
      // 横向活三： (7,3)(7,4)(7,5) 黑，两端空 → 落 (7,6) 仍是活三端之一
      // 实际上活三检测需要"落子后形成活三"，这里构造：横向黑 (7,4)(7,5) 落 (7,6) 成三
      [7, 4, BLACK],
      [7, 5, BLACK],
      // 竖向黑 (4,7)(5,7) 落 (6,7) 成三
      [4, 7, BLACK],
      [5, 7, BLACK],
    ]);
    // 落 (7,6)：横向 (7,4)(7,5)(7,6) 成三；同时 (6,7) 也可以，但一次只能落一子
    // 这里构造双三需两个活三，使用两个方向各形成活三
    const fb1 = Rules.checkForbidden(b, 7, 6); // 横向成三，竖向无关 → 单一活三，非禁手
    assert(!fb1.forbidden, 'T7c 单一活三非禁手', fb1);
  }

  // T7c2 真正的三三：横竖两个活三相交
  {
    const b = buildBoard([
      // 横向：在 (7,3)(7,4) 已有黑，落 (7,5) 成三（需两端开口）
      [7, 3, BLACK],
      [7, 4, BLACK],
      // 竖向：在 (3,5)(4,5) 已有黑，落 (5,5) 成三（需两端开口）
      [3, 5, BLACK],
      [4, 5, BLACK],
    ]);
    // 横三：(7,3)(7,4)(7,5)，左端(7,2)空右端(7,6)空 → 活三
    // 竖三：(3,5)(4,5)(5,5)，上端(2,5)空下端(6,5)空 → 活三
    // 交点在 (5,5) 或 (7,5)，取 (5,5) 竖三 + 横向需在 (5,x) 处
    // 重新构造：横向在 (5,3)(5,4) 落 (5,5) 成三；竖向在 (3,5)(4,5) 落 (5,5) 成三
    const b2 = buildBoard([
      [5, 3, BLACK],
      [5, 4, BLACK],
      [3, 5, BLACK],
      [4, 5, BLACK],
    ]);
    const fb = Rules.checkForbidden(b2, 5, 5);
    assert(fb.forbidden && fb.type === 'double-three', 'T7 黑三三判禁手', fb);
  }

  // T8 成五优先：同时形成五与三三 → 判胜不判禁
  {
    // 构造：横向黑 (7,3)~(7,6) 四连，落 (7,7) 成五；同时竖向也形成活三
    const b = buildBoard([
      [7, 3, BLACK],
      [7, 4, BLACK],
      [7, 5, BLACK],
      [7, 6, BLACK],
      // 竖向活三（与 (7,7) 无关，仅用于制造三三干扰）
      [5, 7, BLACK],
      [6, 7, BLACK],
    ]);
    // checkForbidden 内部会试落子并恢复，成五优先应返回 win（非禁手）
    const fb = Rules.checkForbidden(b, 7, 7);
    assert(!fb.forbidden && fb.type === 'win', 'T8 成五优先不判禁手', fb);
    // 真正落子后 checkWin 应判黑胜
    b[7][7] = BLACK;
    const wr = Rules.checkWin(b, 7, 7, RENJU);
    assert(wr.win && wr.player === BLACK, 'T8 Renju 黑成五判胜', wr);
  }

  // T9 Renju 白棋长连判胜
  {
    const b = buildBoard([
      [7, 3, WHITE],
      [7, 4, WHITE],
      [7, 5, WHITE],
      [7, 6, WHITE],
      [7, 7, WHITE],
    ]);
    b[7][8] = WHITE; // 6 连
    const wr = Rules.checkWin(b, 7, 8, RENJU);
    assert(wr.win && wr.player === WHITE, 'T9 Renju 白棋长连判胜', wr);
  }

  // ================================================================
  //  总结
  // ================================================================
  console.log('\n==============================');
  console.log('通过: ' + passCount + '，失败: ' + failCount);
  console.log('==============================');
  if (failCount > 0) {
    process.exitCode = 1;
  }
})();