/**
 * model.js —— 数据模型层
 *
 * 说明：纯逻辑模块，不依赖任何 DOM / Canvas，可独立运行与单元测试。
 * 职责：
 *   - 棋盘数据结构的创建、克隆、读写
 *   - 坐标换算工具（像素 ↔ 交叉点），注意吸附到最近交叉点
 *
 * 数据约定：
 *   board = 15x15 二维数组，0=空(EMPTY)，1=黑(BLACK)，2=白(WHITE)
 *   move  = { r, c, player, index }
 */
(function (global) {
  'use strict';

  // 棋盘常量
  const SIZE = 15;   // 15×15 交叉点
  const EMPTY = 0;   // 空
  const BLACK = 1;   // 黑
  const WHITE = 2;   // 白

  const Model = {
    SIZE: SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,

    /**
     * 初始化一个全 0 的棋盘（size × size）
     * @param {number} size 棋盘边长，默认 15
     * @returns {Array<Array<number>>} 二维数组
     */
    initBoard(size = SIZE) {
      return Array.from({ length: size }, () => new Array(size).fill(EMPTY));
    },

    /**
     * 深拷贝棋盘（克隆互不影响）
     * @param {Array<Array<number>>} board
     * @returns {Array<Array<number>>}
     */
    cloneBoard(board) {
      return board.map((row) => row.slice());
    },

    /**
     * 判断坐标 (r,c) 是否在棋盘内
     */
    inBoard(r, c, size = SIZE) {
      return r >= 0 && r < size && c >= 0 && c < size;
    },

    /**
     * 在 (r,c) 落子。仅当坐标合法且该点为空时成功。
     * 原地修改 board 并返回是否成功。
     */
    place(board, r, c, player, size = SIZE) {
      if (!this.inBoard(r, c, size) || board[r][c] !== EMPTY) return false;
      board[r][c] = player;
      return true;
    },

    /**
     * 移除 (r,c) 的棋子（悔棋用）
     */
    remove(board, r, c, size = SIZE) {
      if (!this.inBoard(r, c, size)) return false;
      board[r][c] = EMPTY;
      return true;
    },

    /**
     * 坐标换算：像素坐标 -> 交叉点坐标（吸附到最近交叉点）
     * @param {number} x 画布像素 x
     * @param {number} y 画布像素 y
     * @param {number} cellSize 每格像素尺寸
     * @param {number} margin 棋盘边距（放坐标标签）
     * @returns {{r:number, c:number}|null} 不在棋盘内返回 null
     */
    pixelToCell(x, y, cellSize, margin, size = SIZE) {
      const c = Math.round((x - margin) / cellSize);
      const r = Math.round((y - margin) / cellSize);
      return this.inBoard(r, c, size) ? { r, c } : null;
    },

    /**
     * 坐标换算：交叉点 -> 像素坐标（交叉点中心）
     */
    cellToPixel(r, c, cellSize, margin) {
      return { x: margin + c * cellSize, y: margin + r * cellSize };
    },

    /**
     * 判断棋盘是否已满（和棋条件之一）
     */
    isFull(board) {
      for (const row of board) {
        if (row.includes(EMPTY)) return false;
      }
      return true;
    },
  };

  // 挂载到全局 Gomoku 命名空间（普通 script，避免 file:// 下 ES Module 跨域问题）
  global.Gomoku = global.Gomoku || {};
  global.Gomoku.Model = Model;
})(typeof window !== 'undefined' ? window : globalThis);
