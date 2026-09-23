/* ============================================================
 * ai.js —— AI 层：局面评估 + Negamax α-β 搜索 + MVV-LVA 排序
 *            + 迭代加深（时限控制 ≤3 秒）+ 简易静态搜索
 * 依赖 model.js / rules.js（纯逻辑，无 DOM 依赖，可在 Worker 中运行）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./rules.js'));
  } else {
    root.XQAI = factory(root.XQModel, root.XQRules);
  }
})(typeof self !== 'undefined' ? self : this, function (M, R) {
  'use strict';

  var RED = M.RED, BLACK = M.BLACK;
  var INF = 1e9;
  var MATE = 100000;          // 绝对分：将死
  var TIME_LIMIT_MS = 2500;   // 单步思考硬时限（需求 ≤3 秒）

  /* ---------------- 评估 ---------------- */

  // 基础子力值
  var PIECE_VALUE = { 1: 10000, 2: 200, 3: 200, 4: 400, 5: 900, 6: 450, 7: 100 };

  // 位置价值表（PST，红方视角 [r][c]，黑方按 (9-r, 8-c) 镜像查询）
  var PST_PAWN = [
    [  0,  3,  6,  9, 12,  9,  6,  3,  0],
    [ 18, 36, 56, 80,120, 80, 56, 36, 18],
    [ 18, 36, 56, 80,120, 80, 56, 36, 18],
    [ 18, 36, 56, 80,120, 80, 56, 36, 18],
    [  6, 12, 18, 24, 24, 24, 18, 12,  6],
    [  2,  4,  6,  8,  8,  8,  6,  4,  2],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0]
  ];
  var PST_HORSE = [
    [  4,  8, 16, 12,  4, 12, 16,  8,  4],
    [  4, 10, 28, 16,  8, 16, 28, 10,  4],
    [ 12, 14, 16, 20, 18, 20, 16, 14, 12],
    [  8, 24, 18, 24, 20, 24, 18, 24,  8],
    [  6, 16, 14, 18, 16, 18, 14, 16,  6],
    [  4, 12, 16, 14, 12, 14, 16, 12,  4],
    [  2,  6,  8,  6, 10,  6,  8,  6,  2],
    [  4,  2,  8,  8,  4,  8,  8,  2,  4],
    [  0,  2,  4,  4, -2,  4,  4,  2,  0],
    [  0, -4,  0,  0,  0,  0,  0, -4,  0]
  ];
  var PST_CHARIOT = [
    [  6,  6, 10, 12, 12, 12, 10,  6,  6],
    [  6, 10, 16, 12,  6, 12, 16, 10,  6],
    [ 10, 16,  6, 10, 16, 10,  6, 16, 10],
    [ 12, 12, 12, 12, 12, 12, 12, 12, 12],
    [ 12, 14, 14, 14, 14, 14, 14, 14, 12],
    [ 12, 14, 14, 14, 14, 14, 14, 14, 12],
    [  6, 10,  8, 14, 14, 14,  8, 10,  6],
    [  4,  8,  6, 14, 12, 14,  6,  8,  4],
    [  8,  4,  8, 16,  8, 16,  8,  4,  8],
    [ -2, 10,  6, 14, 12, 14,  6, 10, -2]
  ];
  var PST_CANNON = [
    [  4,  4,  0,-10,-12,-10,  0,  4,  4],
    [  2,  2,  0, -4,-14, -4,  0,  2,  2],
    [  2,  2,  0,-10, -8,-10,  0,  2,  2],
    [  0,  0, -2,  4, 10,  4, -2,  0,  0],
    [  0,  0,  0,  2,  8,  2,  0,  0,  0],
    [ -2,  0,  4,  2,  6,  2,  4,  0, -2],
    [  0,  0,  0,  2,  4,  2,  0,  0,  0],
    [  4,  0,  8,  6, 10,  6,  8,  0,  4],
    [  0,  2,  4,  6,  6,  6,  4,  2,  0],
    [  0,  0,  2,  6,  6,  6,  2,  0,  0]
  ];

  function pstOf(type, r, c) {
    switch (type) {
      case M.PAWN:    return PST_PAWN[r][c];
      case M.HORSE:   return PST_HORSE[r][c];
      case M.CHARIOT: return PST_CHARIOT[r][c];
      case M.CANNON:  return PST_CANNON[r][c];
      default:        return 0;   // 士/象/将
    }
  }

  /** 红方视角局面分 */
  function evaluate(board) {
    var score = 0;
    for (var r = 0; r < M.ROWS; r++) {
      for (var c = 0; c < M.COLS; c++) {
        var p = board[r][c];
        if (p === 0) continue;
        var type = Math.abs(p);
        var base = PIECE_VALUE[type];
        var pst = p > 0 ? pstOf(type, r, c) : pstOf(type, 9 - r, 8 - c);
        score += p > 0 ? (base + pst) : -(base + pst);
      }
    }
    return score;
  }

  /* ---------------- 搜索 ---------------- */

  var searchCtx = { deadline: 0, aborted: false };

  /** MVV-LVA 吃子排序得分 */
  function moveScore(board, mv) {
    var victim = board[mv.tr][mv.tc];
    if (victim === 0) return 0;
    var attacker = Math.abs(board[mv.fr][mv.fc]);
    return PIECE_VALUE[Math.abs(victim)] * 10 - PIECE_VALUE[attacker];
  }

  function orderMoves(board, moves) {
    var scored = moves.map(function (m) {
      return { m: m, s: moveScore(board, m) };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    for (var i = 0; i < scored.length; i++) moves[i] = scored[i].m;
    return moves;
  }

  /** 静态搜索：只展开吃子，缓解水平线效应 */
  function quiescence(board, side, alpha, beta, qdepth) {
    var stand = evaluate(board) * (side === RED ? 1 : -1);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return alpha;

    var caps = R.getAllPseudoMoves(board, side, true);
    orderMoves(board, caps);
    for (var i = 0; i < caps.length; i++) {
      var mv = caps[i];
      var cap = R.makeMove(board, mv);
      var illegal = R.isChecked(board, side);
      if (illegal) { R.undoMove(board, mv, cap); continue; }
      var score = -quiescence(board, M.opp(side), -beta, -alpha, qdepth - 1);
      R.undoMove(board, mv, cap);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  /** Negamax + α-β：返回 side 视角分 */
  function negamax(board, side, depth, alpha, beta, ply) {
    if (depth <= 0) return quiescence(board, side, alpha, beta, 8);

    var moves = R.getAllPseudoMoves(board, side);
    orderMoves(board, moves);

    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      var cap = R.makeMove(board, mv);
      if (R.isChecked(board, side)) {          // 走后己将被攻/照面 → 非法
        R.undoMove(board, mv, cap);
        continue;
      }
      var score = -negamax(board, M.opp(side), depth - 1, -beta, -alpha, ply + 1);
      R.undoMove(board, mv, cap);

      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                // β 剪枝

      if ((searchCtx.nodes++ & 1023) === 0 && Date.now() > searchCtx.deadline) {
        searchCtx.aborted = true;
        break;
      }
    }

    if (best === -INF) {
      // 无任何合法着法：将死/困毙均判负； ply 越小(更快被杀)分越低 → 优先快杀
      return -(MATE - ply);
    }
    return best;
  }

  /* ---------------- 对外接口 ---------------- */

  var DIFFICULTY = {
    easy:   { depth: 1, noise: 60,  timeLimit: 300 },
    medium: { depth: 3, noise: 0,   timeLimit: 1500 },
    hard:   { depth: 4, noise: 0,   timeLimit: TIME_LIMIT_MS }
  };

  /**
   * 为 side 寻找最佳着法（根节点做完整合法性过滤，保证 AI 永不出非法着法）
   * @param difficulty 'easy' | 'medium' | 'hard'
   * @returns move | null（无合法着法时）
   */
  function findBestMove(board, side, difficulty, opts) {
    opts = opts || {};
    var conf = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    var rootMoves = R.getLegalMoves(board, side);
    if (rootMoves.length === 0) return null;

    var timeLimit = opts.timeLimit || conf.timeLimit;
    searchCtx.deadline = Date.now() + timeLimit;
    searchCtx.aborted = false;
    searchCtx.nodes = 0;

    var scored = rootMoves.map(function (m) { return { m: m, s: 0 }; });
    var bestResult = scored[0].m;

    for (var depth = 1; depth <= conf.depth; depth++) {
      var alpha = -INF;
      var localBest = null, localScore = -INF;

      orderMoves(board, rootMoves);
      for (var i = 0; i < rootMoves.length; i++) {
        var mv = rootMoves[i];
        var cap = R.makeMove(board, mv);
        var s = -negamax(board, M.opp(side), depth - 1, -INF, -alpha, 1);
        R.undoMove(board, mv, cap);

        if (conf.noise > 0) s += (Math.random() * 2 - 1) * conf.noise; // 简单档随机扰动
        if (s > localScore) { localScore = s; localBest = mv; }
        if (s > alpha) alpha = s;

        if (searchCtx.aborted) break;
      }

      if (localBest) {
        bestResult = localBest;
        // 完整走完一层才更新；把最好着法提到最前加速下层剪枝
        var idx = rootMoves.indexOf(localBest);
        if (idx > 0) { rootMoves.splice(idx, 1); rootMoves.unshift(localBest); }
      }
      if (searchCtx.aborted ||
          Math.abs(localScore) >= MATE - 100 ||
          Date.now() > searchCtx.deadline) break;
    }
    return bestResult;
  }

  return {
    evaluate: evaluate,
    findBestMove: findBestMove,
    DIFFICULTY: DIFFICULTY
  };
});
