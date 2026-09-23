/**
 * ai.js —— 人工智能层（评估 + 搜索）
 *
 * 功能：
 *   - 候选点生成（仅考虑已有子切比雪夫距离 ≤2 的空点）
 *   - 着法评分（启发式，用于排序）
 *   - 杀棋快通道（一步成五 / 必堵）
 *   - Negamax + α-β 剪枝，支持三档难度
 *
 * 评分表（基于 run 分析 + 开口方向）：
 *   连五 ≥ 10,000,000 | 活四 1,000,000 | 冲四 100,000
 *   活三 10,000 | 眠三 1,000 | 活二 100 | 眠二 10
 */
(function (global) {
  'use strict';

  const Model = global.Gomoku.Model;
  const Rules = global.Gomoku.Rules;
  const EMPTY = Model.EMPTY;
  const BLACK = Model.BLACK;
  const WHITE = Model.WHITE;
  const SIZE = Model.SIZE;
  const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  /**
   * 根据 run 长度和两端开口情况给分
   */
  function scoreByRun(len, openL, openR) {
    if (len >= 5) return 10000000;
    if (len === 4) {
      if (openL && openR) return 1000000; // 活四
      if (openL || openR) return 100000;  // 冲四
      return 0;
    }
    if (len === 3) {
      if (openL && openR) return 10000; // 活三
      if (openL || openR) return 1000;  // 眠三
      return 0;
    }
    if (len === 2) {
      if (openL && openR) return 100; // 活二
      if (openL || openR) return 10;  // 眠二
      return 0;
    }
    if (len === 1) {
      if (openL && openR) return 5;
      if (openL || openR) return 2;
      return 0;
    }
    return 0;
  }

  /**
   * 获取 (r,c) 在 (dr,dc) 方向上的 run 评分
   * 包括连续 run 的评分 + 跳三/跳四的额外加分
   */
  function dirShapeScore(board, r, c, dr, dc, color) {
    const { line, idx } = Rules.getLine(board, r, c, dr, dc, SIZE);
    if (idx === -1) return 0;
    const ch = color === BLACK ? 'B' : 'W';
    const opp = color === BLACK ? 'W' : 'B';

    // 检查 line[idx] 是否等于 color（当前位置已落子）
    // 注意：此函数调用时，(r,c) 已放置 color 色棋子
    if (line[idx] !== ch) return 0;

    // 1. 连续 run 评分
    const { l, r: rr, len } = Rules.runAt(line, idx);
    const openL = l - 1 >= 0 ? line[l - 1] === '.' : false;
    const openR = rr + 1 < line.length ? line[rr + 1] === '.' : false;
    let score = scoreByRun(len, openL, openR);

    // 2. 跳三/跳四补充：检查长度为 5 的窗口（含 idx）中是否有跳形
    for (let w = Math.max(0, idx - 4); w <= idx && w + 4 < line.length; w++) {
      const win = line.slice(w, w + 5);
      let cnt = 0,
        empt = 0;
      for (const c2 of win) {
        if (c2 === ch) cnt++;
        else if (c2 === '.') empt++;
      }
      // 窗口内只能有本色子和空位（不能有对方棋子）
      if (cnt + empt < 5) continue;
      // 只用 cnt 在 3~4、且有跳形（非纯粹连续 run）时附加分
      if (cnt >= 3 && cnt <= 4 && empt > 0) {
        const openL2 = w - 1 >= 0 ? line[w - 1] === '.' : false;
        const openR2 = w + 5 < line.length ? line[w + 5] === '.' : false;
        const bonus = scoreByRun(cnt, openL2, openR2);
        if (bonus > score) score = bonus;
      }
    }
    return score;
  }

  /**
   * 对候选点 (r,c) 打分（攻防兼顾）
   * = 己方进攻分 + 对方防守分 × 0.9
   */
  function scoreMove(board, r, c, player) {
    const opp = 3 - player;
    // 进攻分
    board[r][c] = player;
    let atk = 0;
    for (const [dr, dc] of DIRS) atk += dirShapeScore(board, r, c, dr, dc, player);
    board[r][c] = EMPTY;
    // 防守分
    board[r][c] = opp;
    let def = 0;
    for (const [dr, dc] of DIRS) def += dirShapeScore(board, r, c, dr, dc, opp);
    board[r][c] = EMPTY;
    return atk + 0.9 * def;
  }

  /**
   * 生成候选点：所有与已有子切比雪夫距离 ≤2 的空点
   */
  function generateCandidates(board) {
    const set = new Set();
    let hasStone = false;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          hasStone = true;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const rr = r + dr,
                cc = c + dc;
              if (Model.inBoard(rr, cc) && board[rr][cc] === EMPTY) {
                set.add(rr * SIZE + cc);
              }
            }
          }
        }
      }
    }
    if (!hasStone) return [{ r: 7, c: 7 }]; // 空棋盘直接天元
    return Array.from(set).map((key) => ({ r: Math.floor(key / SIZE), c: key % SIZE }));
  }

  /**
   * 查找一步成五的着法（杀棋快通道）
   */
  function findWinMove(board, player) {
    const opp = 3 - player;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) continue;
        board[r][c] = player;
        if (Rules.checkWin(board, r, c, Rules.RULES.FREE).win) {
          board[r][c] = EMPTY;
          return { r, c };
        }
        board[r][c] = EMPTY;
      }
    }
    return null;
  }

  /**
   * 查找必须堵住的着法（对方一步成五）
   */
  function findBlockMove(board, opponent) {
    return findWinMove(board, opponent);
  }

  /**
   * 棋盘局面评估（通过扫描所有 5 连窗口）。
   * 返回从 player 视角看的总分：己方棋形加分，对方威胁按 0.9 权重减分（防守分）。
   */
  function evaluateBoard(board, player) {
    const opp = 3 - player;
    let score = 0;
    for (const [dr, dc] of DIRS) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          // 取 5 连窗口 [r,c] -> [r+4dr, c+4dc]
          let ok = true;
          const cells = [];
          for (let k = 0; k < 5; k++) {
            const rr = r + dr * k,
              cc = c + dc * k;
            if (!Model.inBoard(rr, cc)) {
              ok = false;
              break;
            }
            cells.push(board[rr][cc]);
          }
          if (!ok) continue;

          // 统计窗口内双方棋子数
          let cntP = 0,
            cntO = 0;
          for (const v of cells) {
            if (v === player) cntP++;
            else if (v === opp) cntO++;
          }
          if (cntP === 0 && cntO === 0) continue; // 空窗口无分
          if (cntP > 0 && cntO > 0) continue; // 混合窗口（双方都有）无分

          // 两端开口检测
          const re = r + 5 * dr,
            ce = c + 5 * dc;
          const openL = Model.inBoard(r - dr, c - dc) ? board[r - dr][c - dc] === EMPTY : false;
          const openR = Model.inBoard(re, ce) ? board[re][ce] === EMPTY : false;

          const cnt = Math.max(cntP, cntO);
          const val = scoreByRun(cnt, openL, openR);
          if (cntP > 0) {
            score += val; // 己方得分
          } else {
            score -= val * 0.9; // 对方威胁，减分（防守权重 0.9）
          }
        }
      }
    }
    return score;
  }

  /**
   * Negamax + α-β 剪枝
   * @param {Array} board 棋盘
   * @param {number} depth 剩余深度
   * @param {number} alpha
   * @param {number} beta
   * @param {number} player 当前走棋方
   * @param {number} aiPlayer AI 身份（固定视角）
   * @param {number} topN 每层扩展数
   * @returns {number} 从 aiPlayer 视角看的分数
   */
  function negamax(board, depth, alpha, beta, player, aiPlayer, topN) {
    if (depth === 0) return evaluateBoard(board, aiPlayer);

    const candidates = generateCandidates(board);
    if (candidates.length === 0) return 0;

    // 着法排序（按启发式评分降序）
    const scored = candidates.map((m) => ({
      r: m.r,
      c: m.c,
      score: scoreMove(board, m.r, m.c, player),
    }));
    scored.sort((a, b) => b.score - a.score);
    const moves = scored.slice(0, topN);

    let best = -Infinity;
    for (const m of moves) {
      board[m.r][m.c] = player;
      // 检查是否直接获胜
      let winResult = false;
      // 使用自由规则检查（因为胜负不管禁手都由 checkWin 判定）
      const wr = Rules.checkWin(board, m.r, m.c, Rules.RULES.FREE);
      if (wr.win) winResult = true;

      let score;
      if (winResult) {
        // 越早获胜分数越高
        score = 10000000 + depth;
      } else {
        score = -negamax(board, depth - 1, -beta, -alpha, 3 - player, aiPlayer, topN);
      }
      board[m.r][m.c] = EMPTY;

      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** 难度配置 */
  const DIFFICULTY = {
    easy: { depth: 1, topN: 5, label: '简单' },
    medium: { depth: 2, topN: 8, label: '中等' },
    hard: { depth: 4, topN: 10, label: '困难' },
  };

  const AI = {
    DIFFICULTY: DIFFICULTY,

    /**
     * 获取 AI 的最佳着法
     * @param {Array} board 棋盘
     * @param {number} aiPlayer AI 的棋子颜色（BLACK 或 WHITE）
     * @param {string} difficulty 难度键名 'easy' | 'medium' | 'hard'
     * @returns {{r:number, c:number}|null}
     */
    getMove(board, aiPlayer, difficulty) {
      const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
      const opp = 3 - aiPlayer;
      const candidates = generateCandidates(board);
      if (candidates.length === 0) return null;

      // 杀棋快通道
      const win = findWinMove(board, aiPlayer);
      if (win) return win;
      if (cfg.depth >= 1) {
        const block = findBlockMove(board, opp);
        if (block) return block;
      }

      // 简单模式：直接取启发式评分最高的着法（加随机扰动）
      if (cfg.depth === 1) {
        const scored = candidates.map((m) => ({
          r: m.r,
          c: m.c,
          score: scoreMove(board, m.r, m.c, aiPlayer),
        }));
        scored.sort((a, b) => b.score - a.score);
        // 取前 topN 中随机选一个（简单模式增加随机性）
        const top = scored.slice(0, cfg.topN);
        if (difficulty === 'easy') {
          // 在 top 中随机加扰动
          const idx = Math.floor(Math.random() * Math.min(top.length, 3));
          return { r: top[idx].r, c: top[idx].c };
        }
        return { r: top[0].r, c: top[0].c };
      }

      // 中等 / 困难：搜索
      const scored = candidates.map((m) => ({
        r: m.r,
        c: m.c,
        score: scoreMove(board, m.r, m.c, aiPlayer),
      }));
      scored.sort((a, b) => b.score - a.score);
      const moves = scored.slice(0, cfg.topN);

      let bestMove = moves[0];
      let bestScore = -Infinity;
      for (const m of moves) {
        board[m.r][m.c] = aiPlayer;
        const wr = Rules.checkWin(board, m.r, m.c, Rules.RULES.FREE);
        let score;
        if (wr.win) {
          score = 10000000 + cfg.depth;
        } else {
          score = -negamax(board, cfg.depth - 1, -Infinity, Infinity, opp, aiPlayer, cfg.topN);
        }
        board[m.r][m.c] = EMPTY;
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
      }
      return { r: bestMove.r, c: bestMove.c };
    },
  };

  global.Gomoku = global.Gomoku || {};
  global.Gomoku.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);