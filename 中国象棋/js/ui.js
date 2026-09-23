/* ============================================================
 * ui.js —— Canvas 渲染与交互（棋盘绘制、棋子绘制、高亮、动画、音效）
 * 依赖：model.js / game.js（浏览器全局 XQModel / XQGame）
 * ============================================================ */
(function (window) {
  'use strict';
  var M = window.XQModel;

  // ---- 逻辑坐标系（缩放/高分屏只影响最终绘制矩阵） ----
  var CELL = 58, MARGIN = 44;
  var W = MARGIN * 2 + CELL * 8;   // 552
  var H = MARGIN * 2 + CELL * 9;   // 610
  var R_PIECE = 25;

  // 炮位/兵位（星位点）
  var MARKS = [
    [2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
  ];

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function px(c) { return MARGIN + c * CELL; }   // 逻辑 x（列）
  function py(r) { return MARGIN + r * CELL; }   // 逻辑 y（行）

  /* ---------------- WebAudio 简易音效 ---------------- */
  var Sound = {
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, vol, delay) {
      var ac = this.ensure();
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol || 0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    move: function ()    { this.tone(220, 0.08, 'triangle', 0.3); this.tone(110, 0.10, 'sine', 0.35, 0.01); },
    capture: function () { this.tone(160, 0.10, 'square', 0.22); this.tone(90, 0.14, 'sine', 0.4, 0.03); },
    check: function ()   { this.tone(660, 0.12, 'sawtooth', 0.18); this.tone(660, 0.12, 'sawtooth', 0.18, 0.16); },
    win: function ()     { var self = this; [523, 659, 784, 1046].forEach(function (f, i) { self.tone(f, 0.18, 'triangle', 0.25, i * 0.14); }); }
  };

  /* ---------------- 棋盘 UI ---------------- */

  function BoardUI(canvas, handlers) {
    var self = this;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCellClick = handlers.onCellClick || function () {};
    this.onAnimDone = handlers.onAnimDone || function () {};

    this.selected = null;        // {r,c}
    this.targets = [];           // 合法落点 [{fr,fc,tr,tc}]
    this.lastMove = null;        // {fr,fc,tr,tc}
    this.checkedKing = null;     // 被将军的将位置 {r,c}
    this.anim = null;            // {mv, piece, t0, dur}

    var dpr = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = dpr;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvas.addEventListener('click', function (e) { self.handleClick(e); });
    canvas.addEventListener('touchend', function (e) {
      e.preventDefault(); self.handleTouch(e);
    });
  }

  /** 屏幕坐标 → 逻辑坐标 */
  BoardUI.prototype.toLogic = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * W / rect.width,
      y: (clientY - rect.top) * H / rect.height
    };
  };

  BoardUI.prototype.nearestCell = function (x, y) {
    var c = Math.round((x - MARGIN) / CELL);
    var r = Math.round((y - MARGIN) / CELL);
    if (!M.inBoard(r, c)) return null;
    var dx = x - px(c), dy = y - py(r);
    if (dx * dx + dy * dy > (R_PIECE + 14) * (R_PIECE + 14)) return null;
    return { r: r, c: c };
  };

  BoardUI.prototype.handleClick = function (e) {
    var p = this.toLogic(e.clientX, e.clientY);
    var cell = this.nearestCell(p.x, p.y);
    if (cell) this.onCellClick(cell.r, cell.c);
  };

  BoardUI.prototype.handleTouch = function (e) {
    var t = e.changedTouches[0];
    if (!t) return;
    var p = this.toLogic(t.clientX, t.clientY);
    var cell = this.nearestCell(p.x, p.y);
    if (cell) this.onCellClick(cell.r, cell.c);
  };

  /* ---------------- 绘制 ---------------- */

  BoardUI.prototype.render = function (board) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.drawBoardBase(ctx);
    this.drawLastMoveMark(ctx);

    // 棋子（动画中的目标位暂时跳过）
    var anim = this.anim;
    for (var r = 0; r < M.ROWS; r++) {
      for (var c = 0; c < M.COLS; c++) {
        var p = board[r][c];
        if (!p) continue;
        if (anim && r === anim.mv.tr && c === anim.mv.tc) continue;
        this.drawPiece(ctx, r, c, p, false);
      }
    }

    // 选中光圈 + 可落点
    if (this.selected) this.drawSelect(ctx, this.selected.r, this.selected.c);
    for (var i = 0; i < this.targets.length; i++) {
      this.drawTarget(ctx, this.targets[i], board);
    }

    // 动画中的棋子
    if (anim) {
      var t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
      var ease = 1 - Math.pow(1 - t, 3);   // easeOutCubic
      var x = px(anim.mv.fc) + (px(anim.mv.tc) - px(anim.mv.fc)) * ease;
      var y = py(anim.mv.fr) + (py(anim.mv.tr) - py(anim.mv.fr)) * ease;
      this.drawPieceAt(ctx, x, y, anim.piece, true);
    }

    // 被将军的将 → 红色警示圈
    if (this.checkedKing) {
      ctx.save();
      ctx.strokeStyle = 'rgba(229, 57, 53, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(px(this.checkedKing.c), py(this.checkedKing.r), R_PIECE + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  BoardUI.prototype.drawBoardBase = function (ctx) {
    var i, r, c;
    // 棋盘底
    ctx.fillStyle = '#f3e2c0';
    ctx.fillRect(MARGIN - 30, MARGIN - 30, W - (MARGIN - 30) * 2, H - (MARGIN - 30) * 2);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN - 30, MARGIN - 30, W - (MARGIN - 30) * 2, H - (MARGIN - 30) * 2);

    // 横线（10 条）
    for (r = 0; r < M.ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(px(0), py(r));
      ctx.lineTo(px(8), py(r));
      ctx.stroke();
    }
    // 竖线：边线贯通，中间竖线在河界断开
    for (c = 0; c < M.COLS; c++) {
      if (c === 0 || c === 8) {
        ctx.beginPath();
        ctx.moveTo(px(c), py(0));
        ctx.lineTo(px(c), py(9));
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(px(c), py(0)); ctx.lineTo(px(c), py(4));
        ctx.moveTo(px(c), py(5)); ctx.lineTo(px(c), py(9));
        ctx.stroke();
      }
    }

    // 外框加粗
    ctx.lineWidth = 3;
    ctx.strokeRect(px(0) - 6, py(0) - 6, CELL * 8 + 12, CELL * 9 + 12);
    ctx.lineWidth = 1;

    // 九宫斜线
    ctx.beginPath();
    ctx.moveTo(px(3), py(0)); ctx.lineTo(px(5), py(2));
    ctx.moveTo(px(5), py(0)); ctx.lineTo(px(3), py(2));
    ctx.moveTo(px(3), py(7)); ctx.lineTo(px(5), py(9));
    ctx.moveTo(px(5), py(7)); ctx.lineTo(px(3), py(9));
    ctx.stroke();

    // 炮位/兵位星标
    for (i = 0; i < MARKS.length; i++) this.drawMark(ctx, MARKS[i][0], MARKS[i][1]);

    // 楚河汉界
    ctx.save();
    ctx.fillStyle = '#8d6e63';
    ctx.font = '26px KaiTi, STKaiti, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var midY = (py(4) + py(5)) / 2;
    ctx.fillText('楚', px(1.7), midY);
    ctx.fillText('河', px(2.9), midY);
    ctx.fillText('漢', px(5.1), midY);
    ctx.fillText('界', px(6.3), midY);
    ctx.restore();

    // 底部/顶部列坐标
    ctx.save();
    ctx.fillStyle = '#8d6e63';
    ctx.font = '13px KaiTi, STKaiti, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < 9; i++) {
      ctx.fillText(CN_NUM[8 - i], px(i), py(9) + 24);   // 红方：一~九（右→左）
      ctx.fillText(String(i + 1), px(i), py(0) - 22);   // 黑方：1~9（黑方右→左）
    }
    ctx.restore();
  };

  /** 炮/兵位角标 */
  BoardUI.prototype.drawMark = function (ctx, r, c) {
    var x = px(c), y = py(r), s = 5, g = 3;
    ctx.beginPath();
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
      var sx = d[0], sy = d[1];
      // 边线上的点只画内侧半边
      if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) return;
      ctx.moveTo(x + sx * g, y + sy * g);
      ctx.lineTo(x + sx * g, y + sy * (g + s));
      ctx.moveTo(x + sx * g, y + sy * g);
      ctx.lineTo(x + sx * (g + s), y + sy * g);
    });
    ctx.stroke();
  };

  BoardUI.prototype.drawLastMoveMark = function (ctx) {
    if (!this.lastMove) return;
    [[this.lastMove.fr, this.lastMove.fc], [this.lastMove.tr, this.lastMove.tc]]
      .forEach(function (rc) {
        var x = px(rc[1]), y = py(rc[0]), s = 9, L = 7;
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 126, 34, 0.95)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
          var cx = x + d[0] * s, cy = y + d[1] * s;
          ctx.moveTo(cx, cy - d[1] * L);   // 竖边
          ctx.lineTo(cx, cy);              // 角
          ctx.lineTo(cx - d[0] * L, cy);   // 横边
        });
        ctx.stroke();
        ctx.restore();
      });
  };

  BoardUI.prototype.drawSelect = function (ctx, r, c) {
    ctx.save();
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(px(c), py(r), R_PIECE + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  BoardUI.prototype.drawTarget = function (ctx, mv, board) {
    var x = px(mv.tc), y = py(mv.tr);
    var hasEnemy = board[mv.tr][mv.tc] !== 0;
    ctx.save();
    if (hasEnemy) {          // 吃子：红色圆环
      ctx.strokeStyle = 'rgba(229, 57, 53, 0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, R_PIECE + 3, 0, Math.PI * 2);
      ctx.stroke();
    } else {                 // 空点：实心小圆
      ctx.fillStyle = 'rgba(46, 125, 50, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  BoardUI.prototype.drawPiece = function (ctx, r, c, piece, lifting) {
    this.drawPieceAt(ctx, px(c), py(r), piece, lifting);
  };

  BoardUI.prototype.drawPieceAt = function (ctx, x, y, piece, lifting) {
    var isRed = piece > 0;
    var type = Math.abs(piece);
    var ch = M.PIECE_CHAR[isRed ? M.RED : M.BLACK][type];

    ctx.save();
    if (lifting) ctx.shadowColor = 'rgba(0,0,0,0.35)', ctx.shadowBlur = 12;

    // 棋子底面
    var grad = ctx.createRadialGradient(x - 6, y - 8, 4, x, y, R_PIECE);
    grad.addColorStop(0, '#fdf3dd');
    grad.addColorStop(1, '#e8d3a8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, R_PIECE, 0, Math.PI * 2);
    ctx.fill();

    // 外圈
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = isRed ? '#c0392b' : '#263238';
    ctx.stroke();

    // 内细环
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, R_PIECE - 5, 0, Math.PI * 2);
    ctx.stroke();

    // 文字
    ctx.fillStyle = isRed ? '#c0392b' : '#263238';
    ctx.font = 'bold 26px KaiTi, STKaiti, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + 1.5);
    ctx.restore();
  };

  /* ---------------- 走子动画 ---------------- */

  BoardUI.prototype.startAnim = function (mv, piece, onDone) {
    var self = this;
    this.anim = { mv: mv, piece: piece, t0: performance.now(), dur: 200 };
    var done = onDone || this.onAnimDone;
    (function tick() {
      if (!self.anim) return;
      var t = (performance.now() - self.anim.t0) / self.anim.dur;
      if (t >= 1) {
        self.anim = null;
        done();
      } else {
        requestAnimationFrame(tick);
      }
    })();
  };

  window.XQUI = { BoardUI: BoardUI, Sound: Sound, W: W, H: H, CELL: CELL, MARGIN: MARGIN };
})(window);
