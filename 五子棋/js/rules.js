/**
 * rules.js —— 规则引擎层（纯逻辑，无 DOM 依赖，可单元测试）
 *
 * 功能：
 *   - 自由规则（Free）：任意方向连五（含长连 ≥6）即胜
 *   - Renju 规则（Renju）：黑方恰五为胜，长连/双四/三三为禁手（成五优先）；
 *     白方连五（含长连）为胜
 *   - 胜负判定（checkWin）、和棋判定（isDraw）、禁手判定（checkForbidden）
 *
 * 坐标约定：所有 (r,c) 均为 0-based，范围 [0,14]。
 */
(function (global) {
  'use strict';

  const Model = global.Gomoku.Model;
  const EMPTY = Model.EMPTY;
  const BLACK = Model.BLACK;
  const WHITE = Model.WHITE;
  const SIZE = Model.SIZE;

  // 4 个扫描方向：水平、垂直、主对角线、副对角线
  const DIRS = [
    [0, 1],  // 水平 →
    [1, 0],  // 垂直 ↓
    [1, 1],  // 主对角线 ↘
    [1, -1], // 副对角线 ↙
  ];

  // 规则常量
  const RULES = { FREE: 'free', RENJU: 'renju' };

  const Rules = {
    RULES,

    /**
     * 获取棋盘上经过 (r,c) 点、沿 (dr,dc) 方向的整条线。
     * 返回 { line, idx, sr, sc }，其中：
     *   - line: 字符数组，'B'=黑子, 'W'=白子, '.'=空
     *   - idx:  (r,c) 在 line 中的索引
     *   - sr, sc: line 在棋盘上的起点坐标
     */
    getLine(board, r, c, dr, dc, size = SIZE) {
      // 走到该方向线的起点
      let sr = r, sc = c;
      while (Model.inBoard(sr - dr, sc - dc, size)) {
        sr -= dr;
        sc -= dc;
      }
      const line = [];
      let idx = -1;
      for (let rr = sr, cc = sc; Model.inBoard(rr, cc, size); rr += dr, cc += dc) {
        if (rr === r && cc === c) idx = line.length;
        const v = board[rr][cc];
        line.push(v === BLACK ? 'B' : v === WHITE ? 'W' : '.');
      }
      return { line, idx, sr, sc };
    },

    /**
     * 在 line 中，从下标 i 出发，计算连续相同字符的区间 [l, r] 及长度。
     */
    runAt(line, i) {
      const ch = line[i];
      let l = i, r = i;
      while (l - 1 >= 0 && line[l - 1] === ch) l--;
      while (r + 1 < line.length && line[r + 1] === ch) r++;
      return { l, r, len: r - l + 1 };
    },

    /**
     * 胜负判定：从最后一手 (r,c) 出发，检查 4 个方向。
     *
     * @param {Array} board 棋盘
     * @param {number} r 行
     * @param {number} c 列
     * @param {string} rule 规则 'free' | 'renju'
     * @returns {Object} { win, player, winLine, rule }
     *   win=false 表示未分出胜负；
     *   win=true 时，player 为胜方，winLine 为连五坐标数组（用于高亮）
     */
    checkWin(board, r, c, rule = RULES.FREE, size = SIZE) {
      if (!Model.inBoard(r, c, size)) return { win: false };
      const player = board[r][c];
      if (player === EMPTY) return { win: false };

      for (const [dr, dc] of DIRS) {
        const { line, idx, sr, sc } = this.getLine(board, r, c, dr, dc, size);
        const { l, r: rr, len } = this.runAt(line, idx);
        const ch = line[idx];

        // --- 判断是否满足获胜条件 ---
        let winLen = 0;
        if (rule === RULES.RENJU && ch === 'B') {
          // Renju 黑方：恰好 5 连为胜（长连算禁手，不由 checkWin 判定）
          if (len === 5) winLen = 5;
        } else {
          // 自由规则 / Renju 白方：≥5 连即胜
          if (len >= 5) winLen = 5;
        }

        if (winLen > 0) {
          // 收集连子坐标（最多 5 个，用于高亮）
          const winLine = [];
          for (let i = l; i < l + winLen; i++) {
            winLine.push({ r: sr + i * dr, c: sc + i * dc });
          }
          return { win: true, player: player, winLine: winLine, rule: rule };
        }
      }
      return { win: false };
    },

    /**
     * 和棋判定：当棋盘已满且无连五时判和。
     */
    isDraw(board, size = SIZE) {
      return Model.isFull(board);
    },

    // ================================================================
    //  禁手判定（仅 Renju 规则下黑方使用）
    // ================================================================

    /**
     * 统计：在 line 中，存在多少个空点 e，使得在 e 落黑子后
     * 能形成经过 idx 的"恰好 5 连"（即该方向上的"四"的补着点数量）。
     *
     * 对于活四（两端开口的 4 连），左右各有 1 个补着点，计 2 个四。
     * 冲四（一端开口的 4 连）计 1 个四。
     * 跳四（如 B.BBB / BB.BB 等空档四）通过缺口补着检测。
     *
     * 注意：若形成长连（≥6）则不计入四（应由长连禁手处理）。
     */
    countFours(line, idx) {
      const N = line.length;
      if (N === 0) return 0;
      let count = 0;
      // 枚举 idx 附近 ±4 范围内的空点 e
      for (let e = Math.max(0, idx - 4); e <= Math.min(N - 1, idx + 4); e++) {
        if (line[e] !== '.') continue;
        // 模拟落子
        const sim = line.slice();
        sim[e] = 'B';
        const { l, r, len } = this.runAt(sim, idx);
        // 恰好 5 连才算四。若形成 6 连及以上，那是长连禁手，不计入四数
        if (len === 5) count++;
      }
      return count;
    },

    /**
     * 统计：line 中经过 idx 的不同"活三"棋形数量。
     *
     * 活三定义：3 枚黑子（可含一个空档，即跳三），跨幅 ≤ 5，
     * 且左右两端均为空（开口），并且中间的空档位置均为 '.'。
     *
     * 每个活三棋形由其 3 个石头坐标唯一标识，经 Set 去重。
     */
    countLiveThrees(line, idx) {
      const N = line.length;
      // 三种棋形模板（相对于左端 p 的偏移量）
      // 分别对应：连续三子 BBB、隔一子 BB.B、隔一子 B.BB
      const patterns = [
        [0, 1, 2], // BBB
        [0, 1, 3], // BB.B
        [0, 2, 3], // B.BB
      ];
      const shapes = new Set();

      // 枚举左端起点 p，使得 idx 在棋形中
      for (let p = idx - 3; p <= idx; p++) {
        for (const pat of patterns) {
          const pos = pat.map((o) => p + o);
          // 必须包含 idx
          if (!pos.includes(idx)) continue;
          // 检查石头位置是否合法且均为 'B'
          let ok = true;
          for (const q of pos) {
            if (q < 0 || q >= N || line[q] !== 'B') {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          // 跨幅内的非石头位置必须为 '.'（不能有对方棋子阻挡）
          const spanEnd = p + pat[pat.length - 1];
          for (let q = p; q <= spanEnd; q++) {
            if (pos.includes(q)) continue;
            if (line[q] !== '.') {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          // 两端必须开口：左邻 p-1 和右邻 spanEnd+1 必须为 '.'（越界则视为封闭）
          if (p - 1 < 0 || line[p - 1] !== '.') continue;
          if (spanEnd + 1 >= N || line[spanEnd + 1] !== '.') continue;
          // 去重：用石头位置集合作为签名
          shapes.add(pos.join(','));
        }
      }
      return shapes.size;
    },

    /**
     * 检查黑方在 (r,c) 落子是否构成禁手（仅 Renju 规则下调用）。
     *
     * 禁手类型：
     *   - long:         长连（≥6 连）
     *   - double-four:  双四（四数 ≥ 2）
     *   - double-three: 三三（活三数 ≥ 2）
     *   - win:          成五（形成恰好 5 连，成五优先，非禁手）
     *   - null:         非禁手
     *
     * 成五优先：若该手同时形成连五与禁手型，判胜不判禁。
     *
     * @param {Array} board 棋盘
     * @param {number} r 行
     * @param {number} c 列
     * @returns {Object} { forbidden: boolean, type: string|null }
     */
    checkForbidden(board, r, c, size = SIZE) {
      if (!Model.inBoard(r, c, size)) return { forbidden: false, type: null };
      if (board[r][c] !== EMPTY) return { forbidden: false, type: null };

      // 试落子
      board[r][c] = BLACK;
      try {
        let hasFive = false;
        let hasOverline = false;
        let fourCount = 0;
        let threeCount = 0;

        for (const [dr, dc] of DIRS) {
          const { line, idx } = this.getLine(board, r, c, dr, dc, size);
          if (idx === -1) continue;
          const { len } = this.runAt(line, idx);

          if (len >= 6) hasOverline = true;
          if (len === 5) hasFive = true;

          // 仅在非长连/非五连时才统计四和活三（避免已经判定的情况重复计算）
          if (len < 5) {
            fourCount += this.countFours(line, idx);
            threeCount += this.countLiveThrees(line, idx);
          }
        }

        // 长连禁手
        if (hasOverline) return { forbidden: true, type: 'long' };
        // 成五优先 —— 形成恰好 5 连则判胜，不判禁手
        if (hasFive) return { forbidden: false, type: 'win' };
        // 双四禁手
        if (fourCount >= 2) return { forbidden: true, type: 'double-four' };
        // 三三禁手
        if (threeCount >= 2) return { forbidden: true, type: 'double-three' };
        // 非禁手
        return { forbidden: false, type: null };
      } finally {
        board[r][c] = EMPTY; // 恢复棋盘
      }
    },
  };

  global.Gomoku = global.Gomoku || {};
  global.Gomoku.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);