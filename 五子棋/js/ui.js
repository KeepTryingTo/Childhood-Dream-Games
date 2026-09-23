/**
 * ui.js —— Canvas 渲染与交互层
 *
 * 职责：
 *   - 绘制棋盘（木纹底色、网格线、星位、坐标标签）
 *   - 绘制棋子（径向渐变 + 阴影）
 *   - 绘制标记（最后一手红点、悬停虚影、终局连五高亮）
 *   - 像素 ↔ 交叉点换算与点击/悬停事件
 *   - 高分屏适配（devicePixelRatio）
 */
(function (global) {
  'use strict';

  const Model = global.Gomoku.Model;
  const SIZE = Model.SIZE;
  const EMPTY = Model.EMPTY;
  const BLACK = Model.BLACK;
  const WHITE = Model.WHITE;

  const UI = {
    canvas: null,
    ctx: null,
    size: 0, // 画布逻辑尺寸（CSS 像素）
    margin: 30, // 边距（放坐标标签）
    cellSize: 0, // 每格像素
    hover: null, // {r, c} 悬停的交叉点
    state: null, // 当前对局状态
    onCellClick: null, // 回调：点击交叉点
    statusEl: null, // 状态文本元素
    moveListEl: null, // 走子记录元素
    forbiddenHintEl: null, // 禁手提示元素

    /**
     * 初始化：绑定画布、事件监听、自适应尺寸
     */
    init(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onCellClick = options.onCellClick || function () {};
      this.statusEl = options.statusEl || null;
      this.moveListEl = options.moveListEl || null;
      this.forbiddenHintEl = options.forbiddenHintEl || null;

      this.resize();
      window.addEventListener('resize', () => this.resize());

      // 点击落子
      canvas.addEventListener('click', (e) => {
        const pos = this.getMousePos(e);
        if (!pos) return;
        const cell = Model.pixelToCell(pos.x, pos.y, this.cellSize, this.margin, SIZE);
        if (cell) this.onCellClick(cell.r, cell.c);
      });

      // 悬停虚影
      canvas.addEventListener('mousemove', (e) => {
        const pos = this.getMousePos(e);
        const cell = pos
          ? Model.pixelToCell(pos.x, pos.y, this.cellSize, this.margin, SIZE)
          : null;
        const prev = this.hover;
        this.hover = cell;
        if (prev && cell && prev.r === cell.r && prev.c === cell.c) return;
        this.render(this.state);
      });

      canvas.addEventListener('mouseleave', () => {
        if (this.hover) {
          this.hover = null;
          this.render(this.state);
        }
      });
    },

    /**
     * 计算画布逻辑尺寸并适配高分屏
     */
    resize() {
      // 取容器宽度，正方形画布
      const container = this.canvas.parentElement;
      const w = container ? container.clientWidth : 620;
      const px = Math.max(360, Math.min(w, 680));
      const dpr = window.devicePixelRatio || 1;

      this.canvas.style.width = px + 'px';
      this.canvas.style.height = px + 'px';
      this.canvas.width = Math.round(px * dpr);
      this.canvas.height = Math.round(px * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.size = px;
      this.margin = Math.round(px * 0.05);
      // 交叉点间距 = (画布 - 2*边距) / (格数-1)
      this.cellSize = (px - 2 * this.margin) / (SIZE - 1);
      this.render(this.state);
    },

    /**
     * 获取鼠标在逻辑坐标系中的位置
     */
    getMousePos(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      return { x, y };
    },

    /**
     * 主渲染入口
     */
    render(state) {
      this.state = state;
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.size, this.size);

      this.drawBoard(ctx);
      if (state) {
        this.drawStones(ctx, state.board);
        this.drawLastMoveMarker(ctx, state.history);
        this.drawWinLine(ctx, state.winLine);
        this.drawHover(ctx, state);
      }
      this.updatePanel(state);
    },

    // ================================================================
    //  棋盘绘制
    // ================================================================

    drawBoard(ctx) {
      const size = this.size,
        m = this.margin,
        cs = this.cellSize;

      // 木纹底色
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#d9a05b');
      grad.addColorStop(1, '#c48a45');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // 网格线
      ctx.strokeStyle = '#5a3d1d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < SIZE; i++) {
        const p = m + i * cs;
        // 水平线
        ctx.moveTo(m, p);
        ctx.lineTo(m + (SIZE - 1) * cs, p);
        // 垂直线
        ctx.moveTo(p, m);
        ctx.lineTo(p, m + (SIZE - 1) * cs);
      }
      ctx.stroke();

      // 星位（天元 + 四星）
      const stars = [
        [7, 7],
        [3, 3],
        [3, 11],
        [11, 3],
        [11, 11],
      ];
      ctx.fillStyle = '#5a3d1d';
      for (const [r, c] of stars) {
        const p = this.cellToPixel(r, c);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(3, cs * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }

      // 坐标标签：列 A-O（下侧），行 1-15（左侧）
      ctx.fillStyle = '#5a3d1d';
      ctx.font = Math.max(10, Math.round(cs * 0.32)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < SIZE; i++) {
        const p = m + i * cs;
        const col = String.fromCharCode(65 + i); // A-O
        ctx.fillText(col, p, m + (SIZE - 1) * cs + this.margin * 0.6);
        ctx.fillText(String(i + 1), m - this.margin * 0.6, p);
      }
    },

    // ================================================================
    //  棋子绘制
    // ================================================================

    drawStones(ctx, board) {
      const cs = this.cellSize;
      const radius = cs * 0.44;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = board[r][c];
          if (v === EMPTY) continue;
          const p = this.cellToPixel(r, c);
          // 阴影
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = cs * 0.15;
          ctx.shadowOffsetY = cs * 0.05;
          this.drawStone(ctx, p.x, p.y, radius, v === BLACK ? '#111' : '#f5f5f5', v === BLACK ? '#000' : '#cfcfcf');
          ctx.restore();
        }
      }
    },

    /**
     * 绘制单颗棋子（径向渐变）
     */
    drawStone(ctx, x, y, r, color, dark) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, color === '#111' ? '#4a4a4a' : '#ffffff');
      g.addColorStop(1, color);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    },

    // ================================================================
    //  标记绘制
    // ================================================================

    /** 最后一手红点标记 */
    drawLastMoveMarker(ctx, history) {
      if (!history || history.length === 0) return;
      const last = history[history.length - 1];
      const p = this.cellToPixel(last.r, last.c);
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.cellSize * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#e33';
      ctx.fill();
    },

    /** 终局连五高亮（连线 + 放大标记） */
    drawWinLine(ctx, winLine) {
      if (!winLine || winLine.length < 2) return;
      const cs = this.cellSize;
      // 画一条连接首尾的粗线
      const p0 = this.cellToPixel(winLine[0].r, winLine[0].c);
      const p1 = this.cellToPixel(winLine[winLine.length - 1].r, winLine[winLine.length - 1].c);
      ctx.save();
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = cs * 0.18;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.restore();
      // 在每颗胜子周围画圈
      ctx.save();
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      for (const cell of winLine) {
        const p = this.cellToPixel(cell.r, cell.c);
        ctx.beginPath();
        ctx.arc(p.x, p.y, cs * 0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    },

    /** 悬停虚影（当前玩家颜色的半透明棋子） */
    drawHover(ctx, state) {
      if (!this.hover) return;
      const { r, c } = this.hover;
      if (state.status !== 'playing') return;
      const v = state.board[r][c];
      if (v !== EMPTY) return;
      // 人机模式下，人类执黑才显示虚影
      if (state.mode === 'pve' && state.turn !== BLACK) return;

      const p = this.cellToPixel(r, c);
      const isBlack = state.turn === BLACK;
      ctx.save();
      ctx.globalAlpha = 0.35;
      this.drawStone(ctx, p.x, p.y, this.cellSize * 0.44, isBlack ? '#333' : '#f0f0f0', isBlack ? '#000' : '#ccc');
      ctx.restore();
    },

    // ================================================================
    //  辅助面板更新
    // ================================================================

    updatePanel(state) {
      if (!state) return;
      // 状态文本
      if (this.statusEl) {
        let text = '';
        if (state.status === 'playing') {
          const who = state.turn === BLACK ? '黑方' : '白方';
          text = '轮到 ' + who;
          if (state.mode === 'pve' && state.turn === WHITE) text = 'AI 思考中…';
        } else if (state.status === 'black_win') {
          text = state.mode === 'pve' ? '🎉 你（黑方）获胜！' : '黑方获胜！';
        } else if (state.status === 'white_win') {
          text = state.mode === 'pve' ? '🤖 AI（白方）获胜！' : '白方获胜！';
        } else if (state.status === 'draw') {
          text = '平局（棋盘已满）';
        }
        this.statusEl.textContent = text;
        this.statusEl.className = 'status ' + (state.status === 'playing' ? '' : 'done');
      }

      // 走子记录
      if (this.moveListEl && state.history) {
        this.moveListEl.innerHTML = '';
        for (const mv of state.history) {
          const li = document.createElement('li');
          li.textContent = this.gameNotation(mv);
          this.moveListEl.appendChild(li);
        }
        this.moveListEl.scrollTop = this.moveListEl.scrollHeight;
      }
    },

    /** 着法记谱（由 Game 生成，但 UI 无依赖时用本地实现） */
    gameNotation(move) {
      const col = String.fromCharCode(65 + move.c);
      const row = move.r + 1;
      const name = move.player === BLACK ? '黑' : '白';
      return '#' + move.index + ' ' + name + ' ' + col + row;
    },

    /** 交叉点 -> 像素 */
    cellToPixel(r, c) {
      return Model.cellToPixel(r, c, this.cellSize, this.margin);
    },
  };

  global.Gomoku = global.Gomoku || {};
  global.Gomoku.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
