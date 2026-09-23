/* ============================================================
 * rules.js —— 规则引擎（纯逻辑、无 DOM/Canvas 依赖，可单元测试）
 *
 * 内容：
 *   - 伪合法走法生成 getPseudoMoves / getAllPseudoMoves
 *     （满足走子规则，暂不考虑将军；含"飞将吃"特殊着法）
 *   - 试走/回退 makeMove / undoMove
 *   - 攻击判定 isAttacked（反向扫描，O(1) 级，供 AI 与合法性过滤使用）
 *   - 飞将（将帅照面）检测 kingsFacing
 *   - 合法走法 getLegalMoves（过滤走后己将被攻/将帅照面）
 *   - 将军 isChecked、将死/困毙判定 isCheckmate / isStalemate
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.XQRules = factory(root.XQModel);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var RED = M.RED, BLACK = M.BLACK;

  // 方向偏移表
  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];                 // 横竖（将/车/炮共用）
  var DIAG  = [[1, 1], [1, -1], [-1, 1], [-1, -1]];               // 斜向（士）
  var ELE    = [[2, 2], [2, -2], [-2, 2], [-2, -2]];              // 象：田字
  // 马：日字八向 + 对应马腿（腿 = 主方向上紧邻马位的点）
  var HORSE = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  var HORSE_LEG = [[1, 0], [1, 0], [-1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];

  /* ---------------- 走法生成 ---------------- */

  /**
   * 生成 (r,c) 处棋子的伪合法走法（含"将沿开放线飞吃敌将"）
   * @returns [{fr,fc,tr,tc}, ...]
   */
  function getPseudoMoves(board, r, c) {
    var piece = board[r][c];
    if (!piece) return [];
    var side = M.sideOf(piece);
    var type = Math.abs(piece);
    var moves = [];

    function push(tr, tc) {
      var t = board[tr][tc];
      if (t === 0 || M.sideOf(t) !== side) moves.push({ fr: r, fc: c, tr: tr, tc: tc });
    }

    switch (type) {
      case M.KING: { // 将/帅：九宫内横竖一格
        for (var i = 0; i < 4; i++) {
          var tr = r + ORTHO[i][0], tc = c + ORTHO[i][1];
          if (M.inBoard(tr, tc) && M.inPalace(tr, tc, side)) push(tr, tc);
        }
        // 飞将：将与对方将同列且中间无子时，可沿开放线直飞吃对方将
        var dir = side === RED ? -1 : 1;
        var kr = r + dir;
        while (M.inBoard(kr, c)) {
          var t = board[kr][c];
          if (t !== 0) {
            if (Math.abs(t) === M.KING && M.sideOf(t) !== side) {
              moves.push({ fr: r, fc: c, tr: kr, tc: c });
            }
            break;
          }
          kr += dir;
        }
        break;
      }
      case M.ADVISOR: { // 士：九宫内斜一格
        for (var i2 = 0; i2 < 4; i2++) {
          var tr2 = r + DIAG[i2][0], tc2 = c + DIAG[i2][1];
          if (M.inBoard(tr2, tc2) && M.inPalace(tr2, tc2, side)) push(tr2, tc2);
        }
        break;
      }
      case M.ELEPHANT: { // 象：斜两格（田字），不能过河，塞象眼
        for (var i3 = 0; i3 < 4; i3++) {
          var dr = ELE[i3][0], dc = ELE[i3][1];
          var tr3 = r + dr, tc3 = c + dc;
          if (!M.inBoard(tr3, tc3)) continue;
          if (side === RED && tr3 < 5) continue;   // 红象不得过河
          if (side === BLACK && tr3 > 4) continue; // 黑象不得过河
          if (board[r + dr / 2][c + dc / 2] !== 0) continue; // 塞象眼
          push(tr3, tc3);
        }
        break;
      }
      case M.HORSE: { // 马：日字，蹩马腿
        for (var i4 = 0; i4 < 8; i4++) {
          var dr4 = HORSE[i4][0], dc4 = HORSE[i4][1];
          var tr4 = r + dr4, tc4 = c + dc4;
          if (!M.inBoard(tr4, tc4)) continue;
          if (board[r + HORSE_LEG[i4][0]][c + HORSE_LEG[i4][1]] !== 0) continue; // 蹩腿
          push(tr4, tc4);
        }
        break;
      }
      case M.CHARIOT: { // 车：横竖直线扫描，不可越子
        for (var i5 = 0; i5 < 4; i5++) {
          var dr5 = ORTHO[i5][0], dc5 = ORTHO[i5][1];
          var tr5 = r + dr5, tc5 = c + dc5;
          while (M.inBoard(tr5, tc5)) {
            var t5 = board[tr5][tc5];
            if (t5 === 0) moves.push({ fr: r, fc: c, tr: tr5, tc: tc5 });
            else {
              if (M.sideOf(t5) !== side) moves.push({ fr: r, fc: c, tr: tr5, tc: tc5 });
              break;
            }
            tr5 += dr5; tc5 += dc5;
          }
        }
        break;
      }
      case M.CANNON: { // 炮：移动同车；吃子须恰好隔一个炮架
        for (var i6 = 0; i6 < 4; i6++) {
          var dr6 = ORTHO[i6][0], dc6 = ORTHO[i6][1];
          var tr6 = r + dr6, tc6 = c + dc6, jumped = false;
          while (M.inBoard(tr6, tc6)) {
            var t6 = board[tr6][tc6];
            if (!jumped) {
              if (t6 === 0) moves.push({ fr: r, fc: c, tr: tr6, tc: tc6 });
              else jumped = true;               // 遇到第一个子 → 成为炮架
            } else if (t6 !== 0) {              // 炮架后的第一个子
              if (M.sideOf(t6) !== side) moves.push({ fr: r, fc: c, tr: tr6, tc: tc6 });
              break;
            }
            tr6 += dr6; tc6 += dc6;
          }
        }
        break;
      }
      case M.PAWN: { // 兵/卒：前进一格；过河后可横走；永不后退
        var fwd = side === RED ? -1 : 1;
        if (M.inBoard(r + fwd, c)) push(r + fwd, c);
        if (M.crossedRiver(r, side)) {
          if (c - 1 >= 0) push(r, c - 1);
          if (c + 1 < M.COLS) push(r, c + 1);
        }
        break;
      }
    }
    return moves;
  }

  /** 生成 side 全部伪合法走法（capturesOnly=true 时仅吃子着法，供静态搜索） */
  function getAllPseudoMoves(board, side, capturesOnly) {
    var all = [];
    for (var r = 0; r < M.ROWS; r++) {
      for (var c = 0; c < M.COLS; c++) {
        var p = board[r][c];
        if (!p) continue;
        if (M.sideOf(p) !== side) continue;
        var ms = getPseudoMoves(board, r, c);
        for (var i = 0; i < ms.length; i++) {
          if (capturesOnly && board[ms[i].tr][ms[i].tc] === 0) continue;
          all.push(ms[i]);
        }
      }
    }
    return all;
  }

  /* ---------------- 试走 / 回退 ---------------- */

  function makeMove(board, mv) {
    var captured = board[mv.tr][mv.tc];
    board[mv.tr][mv.tc] = board[mv.fr][mv.fc];
    board[mv.fr][mv.fc] = 0;
    return captured;
  }

  function undoMove(board, mv, captured) {
    board[mv.fr][mv.fc] = board[mv.tr][mv.tc];
    board[mv.tr][mv.tc] = captured;
  }

  /* ---------------- 攻击 / 将军 ---------------- */

  /**
   * (r,c) 是否被 bySide 攻击（反向扫描实现，不含"飞将"——照面由 kingsFacing 判定）
   * 覆盖：车（直线）、炮（隔一子）、马（含蹩腿）、兵（正面与过河侧向）、将（一格）
   */
  function isAttacked(board, r, c, bySide) {
    var i, dr, dc, tr, tc, t, met;
    var target = board[r][c];
    if (target !== 0 && M.sideOf(target) === bySide) return false; // 不能攻击己方子
    var targetEmpty = target === 0; // 空点：炮可像车一样直接移动到达

    // ---- 直线类：车 / 将(一格) / 兵(正前与过河侧向) / 炮(移动或隔一子吃) ----
    for (i = 0; i < 4; i++) {
      dr = ORTHO[i][0]; dc = ORTHO[i][1];
      tr = r + dr; tc = c + dc; met = 0;
      while (M.inBoard(tr, tc)) {
        t = board[tr][tc];
        if (t !== 0) {
          met++;
          if (met === 1) {
            if (M.sideOf(t) === bySide) {
              var at = Math.abs(t);
              if (at === M.CHARIOT) return true; // 车
              // 炮：不吃子时移动同车 → 可直达空点
              if (at === M.CANNON && targetEmpty) return true;
              // 将：仅攻击相邻一格，且目标点必须仍在将方九宫内
              if (at === M.KING && (dr === 0 || dc === 0) &&
                  Math.abs(tr - r) + Math.abs(tc - c) === 1 &&
                  M.inPalace(r, c, bySide)) return true;
              // 兵：正面相邻一格，或过河后侧向相邻一格
              if (at === M.PAWN) {
                var fwd = bySide === RED ? -1 : 1;
                if (dc === 0 && tr === r - fwd) return true;
                if (dc !== 0 && Math.abs(tc - c) === 1 && M.crossedRiver(tr, bySide)) return true;
              }
            }
          } else { // met === 2：越过恰好一个炮架后的第一个子 → 炮吃（仅对有子点）
            if (!targetEmpty && M.sideOf(t) === bySide && Math.abs(t) === M.CANNON) return true;
            break;
          }
        }
        tr += dr; tc += dc;
      }
    }

    // ---- 士：4 个斜向相邻位（士不出九宫 → 目标点必须在本方九宫内） ----
    if (M.inPalace(r, c, bySide)) {
      for (i = 0; i < 4; i++) {
        var adr = DIAG[i][0], adc = DIAG[i][1];
        var ar = r + adr, ac = c + adc;
        if (!M.inBoard(ar, ac)) continue;
        t = board[ar][ac];
        if (M.sideOf(t) === bySide && Math.abs(t) === M.ADVISOR) return true;
      }
    }

    // ---- 象：4 个田字位 + 象眼检查（象不过河 → 攻击目标必在己方半场） ----
    for (i = 0; i < 4; i++) {
      var edr = ELE[i][0], edc = ELE[i][1];
      var er = r + edr, ec = c + edc;
      if (!M.inBoard(er, ec)) continue;
      if (bySide === RED && r < 5) continue;
      if (bySide === BLACK && r > 4) continue;
      t = board[er][ec];
      if (M.sideOf(t) === bySide && Math.abs(t) === M.ELEPHANT) {
        if (board[r + edr / 2][c + edc / 2] === 0) return true; // 象眼不被塞
      }
    }

    // ---- 马：8 个马位 + 蹩腿检查 ----
    for (i = 0; i < 8; i++) {
      var hdr = HORSE[i][0], hdc = HORSE[i][1];
      var mr = r + hdr, mc = c + hdc;
      if (!M.inBoard(mr, mc)) continue;
      t = board[mr][mc];
      if (M.sideOf(t) === bySide && Math.abs(t) === M.HORSE) {
        // 马腿：马位朝目标的主方向退一步
        var lr = mr - (Math.abs(hdr) === 2 ? Math.sign(hdr) : 0);
        var lc = mc - (Math.abs(hdc) === 2 ? Math.sign(hdc) : 0);
        if (board[lr][lc] === 0) return true;
      }
    }
    return false;
  }

  /** 查找 side 的将/帅位置，返回 [r,c] 或 null */
  function findKing(board, side) {
    var target = side === RED ? 1 : -1;
    var rows = side === RED ? [7, 8, 9] : [0, 1, 2];
    for (var i = 0; i < 3; i++) {
      var r = rows[i];
      for (var c = 3; c <= 5; c++) {
        if (board[r][c] === target) return [r, c];
      }
    }
    return null;
  }

  /** 将帅是否在同一列且中间无子（飞将/照面） */
  function kingsFacing(board) {
    var rk = findKing(board, RED), bk = findKing(board, BLACK);
    if (!rk || !bk || rk[1] !== bk[1]) return false;
    var top = Math.min(rk[0], bk[0]), bottom = Math.max(rk[0], bk[0]);
    for (var r = top + 1; r < bottom; r++) {
      if (board[r][rk[1]] !== 0) return false;
    }
    return true;
  }

  /** side 的将/帅是否被攻击（含飞将照面视为被将） */
  function isChecked(board, side) {
    var k = findKing(board, side);
    if (!k) return true; // 将不在（已被吃，视为被将）
    if (isAttacked(board, k[0], k[1], M.opp(side))) return true;
    if (kingsFacing(board)) return true; // 将帅照面
    return false;
  }

  /* ---------------- 合法走法与胜负 ---------------- */

  /**
   * side 的全部合法走法：
   * 对伪合法着法逐一试走，过滤走完后己将被攻击（含照面）的着法
   */
  function getLegalMoves(board, side) {
    var legal = [];
    for (var r = 0; r < M.ROWS; r++) {
      for (var c = 0; c < M.COLS; c++) {
        if (M.sideOf(board[r][c]) !== side) continue;
        var ms = getPseudoMoves(board, r, c);
        for (var i = 0; i < ms.length; i++) {
          var cap = makeMove(board, ms[i]);
          var ok = !isChecked(board, side);
          undoMove(board, ms[i], cap);
          if (ok) legal.push(ms[i]);
        }
      }
    }
    return legal;
  }

  /** side 是否被将死（被将军且无合法着法） */
  function isCheckmate(board, side) {
    return isChecked(board, side) && getLegalMoves(board, side).length === 0;
  }

  /** side 是否被困毙（未被将军但无合法着法，判负——中国象棋规则） */
  function isStalemate(board, side) {
    return !isChecked(board, side) && getLegalMoves(board, side).length === 0;
  }

  /** 局面是否终局：返回 null 或 {winner, reason} reason: 'checkmate'|'stalemate' */
  function judge(board, side) {
    if (getLegalMoves(board, side).length > 0) return null;
    return {
      winner: M.opp(side),
      reason: isChecked(board, side) ? 'checkmate' : 'stalemate'
    };
  }

  return {
    getPseudoMoves: getPseudoMoves,
    getAllPseudoMoves: getAllPseudoMoves,
    makeMove: makeMove,
    undoMove: undoMove,
    isAttacked: isAttacked,
    findKing: findKing,
    kingsFacing: kingsFacing,
    isChecked: isChecked,
    getLegalMoves: getLegalMoves,
    isCheckmate: isCheckmate,
    isStalemate: isStalemate,
    judge: judge
  };
});
