/**
 * game.js —— 对局流程层
 *
 * 职责：
 *   - 管理对局状态（棋盘、回合、历史、状态）
 *   - 落子校验（空点、禁手）、胜负/和棋判定调用
 *   - 悔棋（双人 1 手；人机 2 手）、重新开局
 *   - 存档 / 读档（localStorage）
 *   - 人机对战：人类固定执黑，AI 执白并自动调度
 */
(function (global) {
  'use strict';

  const Model = global.Gomoku.Model;
  const Rules = global.Gomoku.Rules;
  const AI = global.Gomoku.AI;
  const EMPTY = Model.EMPTY;
  const BLACK = Model.BLACK;
  const WHITE = Model.WHITE;

  const SAVE_KEY = 'gomoku_save_v1';

  /** 禁手类型 -> 中文提示 */
  const FORBIDDEN_LABEL = {
    long: '长连（≥6 连）',
    'double-four': '双四',
    'double-three': '三三',
  };

  class Game {
    /**
     * @param {Object} options
     * @param {Function} options.onStateChange 状态变化回调（用于重绘 UI）
     * @param {Function} options.onMessage     提示信息回调（Toast）
     */
    constructor(options = {}) {
      this.onStateChange = options.onStateChange || function () {};
      this.onMessage = options.onMessage || function () {};
      this.mode = 'pvp'; // 'pvp' 双人对战 | 'pve' 人机对战
      this.rule = Rules.RULES.FREE; // 'free' 自由规则 | 'renju' Renju 规则
      this.difficulty = 'medium'; // 'easy' | 'medium' | 'hard'
      this.aiThinking = false;
      this.newGame();
    }

    /** 重新开局 */
    newGame() {
      this.board = Model.initBoard();
      this.turn = BLACK; // 黑先
      this.history = [];
      this.status = 'playing';
      this.winLine = [];
      this.aiThinking = false;
      this.emit();
    }

    // ---------------- 设置项 ----------------

    setMode(mode) {
      if (mode !== 'pvp' && mode !== 'pve') return;
      this.mode = mode;
      this.newGame();
    }

    setRule(rule) {
      if (rule !== Rules.RULES.FREE && rule !== Rules.RULES.RENJU) return;
      this.rule = rule;
      this.newGame();
    }

    setDifficulty(d) {
      if (AI.DIFFICULTY[d]) this.difficulty = d;
    }

    // ---------------- 落子 ----------------

    /**
     * 点击处理入口（由 UI 调用）
     */
    handleCellClick(r, c) {
      if (this.status !== 'playing') return;
      if (this.aiThinking) return;
      // 人机模式下人类固定执黑
      if (this.mode === 'pve' && this.turn !== BLACK) return;
      this.tryMove(r, c);
    }

    /**
     * 尝试落子：校验空点、禁手后执行
     */
    tryMove(r, c) {
      if (this.status !== 'playing') return;
      if (!Model.inBoard(r, c) || this.board[r][c] !== EMPTY) return;

      // Renju 规则下，黑方落子前检查禁手（禁手禁止落子）
      if (this.rule === Rules.RULES.RENJU && this.turn === BLACK) {
        const fb = Rules.checkForbidden(this.board, r, c);
        if (fb.forbidden) {
          this.onMessage('黑方禁手，禁止落子：' + (FORBIDDEN_LABEL[fb.type] || fb.type));
          return;
        }
      }
      this.doMove(r, c);
    }

    /**
     * 执行落子并推进对局
     */
    doMove(r, c) {
      const player = this.turn;
      Model.place(this.board, r, c, player);
      const move = { r, c, player, index: this.history.length + 1 };
      this.history.push(move);

      // 胜负判定
      const wr = Rules.checkWin(this.board, r, c, this.rule);
      if (wr.win) {
        this.status = player === BLACK ? 'black_win' : 'white_win';
        this.winLine = wr.winLine;
        this.emit();
        return;
      }
      // 和棋判定
      if (Rules.isDraw(this.board)) {
        this.status = 'draw';
        this.emit();
        return;
      }

      // 切换回合
      this.turn = 3 - player;
      this.emit();

      // 人机模式：轮到 AI 时自动调度
      if (this.mode === 'pve' && this.status === 'playing' && this.turn === WHITE) {
        this.scheduleAI();
      }
    }

    /**
     * 调度 AI 落子（延迟执行，让 UI 先刷新，显示"思考中"）
     */
    scheduleAI() {
      this.aiThinking = true;
      this.emit();
      const self = this;
      setTimeout(function () {
        if (self.status !== 'playing') {
          self.aiThinking = false;
          self.emit();
          return;
        }
        const mv = AI.getMove(self.board, WHITE, self.difficulty);
        self.aiThinking = false;
        if (mv) {
          self.doMove(mv.r, mv.c);
        } else {
          self.emit();
        }
      }, 80);
    }

    // ---------------- 悔棋 ----------------

    /**
     * 悔棋：双人回退 1 手；人机回退 2 手（AI + 人类）
     */
    undo() {
      if (this.aiThinking) return;
      if (this.history.length === 0) return;

      if (this.mode === 'pve') {
        // 回退 2 手（AI 一手 + 人类一手）
        for (let i = 0; i < 2; i++) {
          const mv = this.history.pop();
          if (!mv) break;
          Model.remove(this.board, mv.r, mv.c);
        }
        this.turn = BLACK; // 回到人类回合
      } else {
        const mv = this.history.pop();
        Model.remove(this.board, mv.r, mv.c);
        this.turn = mv.player;
      }
      this.status = 'playing';
      this.winLine = [];
      this.emit();
    }

    // ---------------- 存档 / 读档 ----------------

    save() {
      const data = {
        board: this.board,
        turn: this.turn,
        history: this.history,
        status: this.status,
        winLine: this.winLine,
        mode: this.mode,
        rule: this.rule,
        difficulty: this.difficulty,
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        this.onMessage('已保存');
      } catch (e) {
        this.onMessage('保存失败：' + e.message);
      }
    }

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) {
          this.onMessage('没有存档');
          return;
        }
        const data = JSON.parse(raw);
        this.board = data.board;
        this.turn = data.turn;
        this.history = data.history;
        this.status = data.status;
        this.winLine = data.winLine || [];
        this.mode = data.mode || 'pvp';
        this.rule = data.rule || Rules.RULES.FREE;
        this.difficulty = data.difficulty || 'medium';
        this.aiThinking = false;
        this.emit();
        this.onMessage('已读档');
      } catch (e) {
        this.onMessage('读档失败：' + e.message);
      }
    }

    // ---------------- 记谱 ----------------

    /**
     * 着法记谱：如 "#12 黑 H8"
     */
    notation(move) {
      const col = String.fromCharCode(65 + move.c); // A-O
      const row = move.r + 1; // 1-15
      const name = move.player === BLACK ? '黑' : '白';
      return '#' + move.index + ' ' + name + ' ' + col + row;
    }

    // ---------------- 对外状态 ----------------

    getState() {
      return {
        board: this.board,
        turn: this.turn,
        history: this.history,
        status: this.status,
        winLine: this.winLine,
        mode: this.mode,
        rule: this.rule,
        difficulty: this.difficulty,
        aiThinking: this.aiThinking,
        aiPlayer: this.mode === 'pve' ? WHITE : null,
      };
    }

    emit() {
      this.onStateChange(this.getState());
    }
  }

  global.Gomoku = global.Gomoku || {};
  global.Gomoku.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
