/* ============================================================
 * ui.js —— Canvas 渲染（棋盘 / 方块 / 幽灵 / 消行闪烁 / 预览 / Hold）
 * 浏览器专用 IIFE
 *
 * 渲染内容：
 *   - 主棋盘：网格线 + 已锁定块 + 幽灵方块(E1) + 当前方块 + 消行白闪(E4)
 *   - 预览面板：NEXT 3 个（F12）与 HOLD（E2）
 *   - 高分屏适配（devicePixelRatio）
 * ============================================================ */
(function (window, document) {
  'use strict';
  var M = window.TetrisModel;

  var CELL = 30;                     // 主棋盘格宽（逻辑像素）
  var PREVIEW_CELL = 18;             // 预览格宽

  function drawCell(ctx, px, py, size, color, alpha, stroke) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    // 顶部高光 + 底部阴影，营造立体感
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(px + 1, py + 1, size - 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 1, py + size - 4, size - 2, 3);
    if (stroke !== false) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
    }
    ctx.globalAlpha = 1;
  }

  function BoardUI(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rows = 20;
    this.cols = 10;
    this._setup();
  }

  BoardUI.prototype._setup = function () {
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = this.cols * CELL * dpr;
    this.canvas.height = this.rows * CELL * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** 渲染主棋盘（clearingRows 中的行渲染为白闪） */
  BoardUI.prototype.render = function (game) {
    var ctx = this.ctx;
    var W = this.cols * CELL, H = this.rows * CELL;
    ctx.clearRect(0, 0, W, H);

    // 背景
    ctx.fillStyle = 'rgba(8, 12, 24, 0.92)';
    ctx.fillRect(0, 0, W, H);

    // 网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var c = 1; c < this.cols; c++) {
      ctx.moveTo(c * CELL + 0.5, 0); ctx.lineTo(c * CELL + 0.5, H);
    }
    for (var r = 1; r < this.rows; r++) {
      ctx.moveTo(0, r * CELL + 0.5); ctx.lineTo(W, r * CELL + 0.5);
    }
    ctx.stroke();

    // 已锁定方块
    for (r = 0; r < this.rows; r++) {
      for (c = 0; c < this.cols; c++) {
        var v = game.grid[r][c];
        if (!v) continue;
        var isClearing = game.clearingRows.indexOf(r) >= 0;
        if (isClearing) {
          // 消行闪烁：按剩余时间做白→透明的脉动
          var t = game.clearingMs > 0 ? game.clearingTimer / game.clearingMs : 0;
          drawCell(ctx, c * CELL, r * CELL, CELL, '#ffffff', 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 60)));
          ctx.globalAlpha = 1;
        } else {
          drawCell(ctx, c * CELL, r * CELL, CELL, M.COLORS[M.TYPES[v - 1]] || '#888');
        }
      }
    }

    // 幽灵方块（E1）
    var p = game.current;
    if (p && game.status === 'playing') {
      var shape = M.shapeOf(p.type, p.rotation);
      var gr = game.ghostRow();
      if (gr !== p.row) {
        for (var sr = 0; sr < shape.length; sr++) {
          for (var sc = 0; sc < shape[sr].length; sc++) {
            if (!shape[sr][sc]) continue;
            var gy = gr + sr;
            if (gy < 0) continue;
            drawCell(ctx, (p.col + sc) * CELL, gy * CELL, CELL, M.COLORS[p.type], 0.22, false);
          }
        }
      }
      // 当前方块
      for (sr = 0; sr < shape.length; sr++) {
        for (sc = 0; sc < shape[sr].length; sc++) {
          if (!shape[sr][sc]) continue;
          var py = p.row + sr;
          if (py < 0) continue;
          drawCell(ctx, (p.col + sc) * CELL, py * CELL, CELL, M.COLORS[p.type]);
        }
      }
    }
  };

  /** 小面板绘制（NEXT / HOLD）：居中显示方块形状 */
  BoardUI.renderMini = function (canvas, type) {
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || 96, cssH = canvas.clientHeight || 72;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!type) return;
    var shape = M.SHAPES[type];
    // 计算有效包围盒（忽略空行空列）
    var minR = 4, maxR = -1, minC = 4, maxC = -1;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    var bw = (maxC - minC + 1), bh = (maxR - minR + 1);
    var cell = Math.min(PREVIEW_CELL, (cssW - 12) / bw, (cssH - 12) / bh);
    var ox = (cssW - bw * cell) / 2 - minC * cell;
    var oy = (cssH - bh * cell) / 2 - minR * cell;
    for (r = 0; r < shape.length; r++) {
      for (c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) drawCell(ctx, ox + c * cell, oy + r * cell, cell, M.COLORS[type], 1, false);
      }
    }
  };

  window.TetrisUI = { BoardUI: BoardUI, drawCell: drawCell };
})(window, document);
