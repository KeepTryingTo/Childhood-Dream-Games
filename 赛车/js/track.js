/* ============================================================
 * track.js —— 赛道几何模块（纯逻辑，无 DOM 依赖，可单元测试）
 *
 * 圆角矩形闭合赛道：4 段直道 + 4 段圆弧，按弧长拼接；
 * 中心线等弧长采样 SAMPLES 点，构建弧长表：
 *   pts[i] = { x, y, s, tangent, curv }
 *
 * 核心查询：
 *   pointAtS(s)      -> { x, y, angle, curv }     按弧长取中心线点
 *   nearest(x, y)    -> { s, lateral, onTrack, angle, idx }
 *                       任意点到中心线的投影（粗扫 + 线段精化）
 *
 * 行进方向：顺时针（下直道向右、右直道向上……y 轴向下）。
 * 曲率符号：左转为正、右转为负（沿行进方向）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Track = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;

  /* ---------- 角度工具 ---------- */
  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* ---------- 圆角矩形分段构造 ----------
   * 返回段数组，每段提供 len() 与 point(t)（t∈[0,1] 沿段弧长参数）
   * 以顺时针构造，起点 = 下直道左端（左下圆弧与下直道的切点）
   * 直道位于包围盒外边（y=±hh / x=±hw），圆弧与直道在切点处相接
   */
  function buildSegments(W, H, R) {
    var hw = W / 2, hh = H / 2;
    var sx = hw - R, sy = hh - R;            // 圆角圆心到中心的偏移
    var arc = Math.PI * R / 2;               // 四分之一圆弧长
    // 圆角圆心
    var cBR = { x: sx, y: sy };              // 右下
    var cTR = { x: sx, y: -sy };             // 右上
    var cTL = { x: -sx, y: -sy };            // 左上
    var cBL = { x: -sx, y: sy };             // 左下

    function line(x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
      return {
        len: len,
        point: function (t) {
          return {
            x: x0 + dx * t, y: y0 + dy * t,
            angle: Math.atan2(dy, dx),
            curv: 0
          };
        }
      };
    }
    // 圆弧：圆心 c，起始角 a0，扫到 a1（角度为数学角，y 向下时视觉为镜像）
    // leftTurn：沿行进方向该弧是左转（+1）还是右转（-1）
    function arcSeg(cx, cy, r, a0, a1, leftTurn) {
      var sweep = a1 - a0;
      return {
        len: Math.abs(sweep) * r,
        point: function (t) {
          var a = a0 + sweep * t;
          return {
            x: cx + r * Math.cos(a), y: cy + r * Math.sin(a),
            angle: a + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2),
            curv: leftTurn / r
          };
        }
      };
    }

    // 顺时针（y 向下视角）：下直道右行 → 右下弧 → 右直道上行 → 右上弧
    // → 上直道左行 → 左上弧 → 左直道下行 → 左下弧 → 回到起点
    var segs = [
      line(-sx, hh, sx, hh),                                   // 下直道（沿 y=+hh 向右）
      arcSeg(cBR.x, cBR.y, R, Math.PI / 2, 0, -1),             // 右下弧：右转
      line(hw, sy, hw, -sy),                                   // 右直道（沿 x=+hw 向上）
      arcSeg(cTR.x, cTR.y, R, 0, -Math.PI / 2, -1),            // 右上弧：右转
      line(sx, -hh, -sx, -hh),                                 // 上直道（沿 y=-hh 向左）
      arcSeg(cTL.x, cTL.y, R, -Math.PI / 2, -Math.PI, +1),     // 左上弧：左转
      line(-hw, -sy, -hw, sy),                                 // 左直道（沿 x=-hw 向下）
      arcSeg(cBL.x, cBL.y, R, Math.PI, Math.PI / 2, +1)        // 左下弧：左转
    ];
    return segs;
  }

  /* ---------- Track 构造器 ---------- */
  function Track(opts) {
    opts = opts || {};
    this.W = opts.width2 || 260;        // 包围盒宽（米）——避免与赛道宽 width 冲突
    this.H = opts.height || 180;        // 包围盒高（米）
    this.R = opts.radius || 40;         // 圆角半径
    this.width = opts.trackWidth || 16; // 赛道宽（米）
    this.samples = opts.samples || 512;

    if (this.R * 2 >= Math.min(this.W, this.H)) throw new Error('圆角半径过大');

    var segs = buildSegments(this.W, this.H, this.R);
    var total = 0, i;
    for (i = 0; i < segs.length; i++) total += segs[i].len;
    this.length = total;
    this.halfWidth = this.width / 2;

    // 等弧长采样
    var pts = [], acc = 0, idx = 0, n = this.samples;
    for (i = 0; i < n; i++) {
      var s = total * i / n;
      while (idx < segs.length - 1 && s > acc + segs[idx].len) { acc += segs[idx].len; idx++; }
      var p = segs[idx].point((s - acc) / segs[idx].len);
      p.s = s;
      pts.push(p);
    }
    this.pts = pts;
  }

  /* ---------- 环形弧长差（处理 wrap，返回带符号短差） ---------- */
  Track.prototype.wrapDelta = function (ds) {
    var L = this.length;
    ds = ds % L;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    return ds;
  };

  /* ---------- 按弧长取中心线点（线性插值） ---------- */
  Track.prototype.pointAtS = function (s) {
    var L = this.length;
    s = ((s % L) + L) % L;
    var n = this.samples;
    var f = s / L * n;
    var i = Math.floor(f);
    if (i >= n) i = n - 1;
    var j = (i + 1) % n;
    var t = f - i;
    var a = this.pts[i], b = this.pts[j];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: a.angle + normAngle(b.angle - a.angle) * t,
      curv: a.curv + (b.curv - a.curv) * t,
      s: s
    };
  };

  /* ---------- 点到中心线最近投影 ----------
   * hint（可选）：上次命中索引，先在 ±window 窗口内搜索加速连续查询。
   * 返回 { s, lateral, onTrack, angle, curv, idx }
   * lateral 符号：沿切线方向的左侧为正
   */
  Track.prototype.nearest = function (x, y, hint) {
    var pts = this.pts, n = pts.length;
    var i, bestD2 = Infinity, bestI = 0;

    function scan(from, to) {
      for (var k = from; k <= to; k++) {
        var i2 = ((k % n) + n) % n;
        var dx = pts[i2].x - x, dy = pts[i2].y - y;
        var d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestI = i2; }
      }
    }

    if (typeof hint === 'number' && hint >= 0) {
      bestD2 = Infinity;
      var w = 24;
      scan(hint - w, hint + w);
      // 窗口内命中足够近（< 半宽的 4 倍）即认为有效，否则全量扫描
      if (bestD2 > (this.width * 4) * (this.width * 4)) { bestD2 = Infinity; scan(0, n - 1); }
    } else {
      scan(0, n - 1);
    }

    // 在 bestI 邻域用点到线段投影精化（检查前后各 2 段）
    var bestS2 = Infinity, best = null;
    for (i = bestI - 2; i <= bestI + 2; i++) {
      var i0 = ((i % n) + n) % n;
      var i1 = (i0 + 1) % n;
      var a = pts[i0], b = pts[i1];
      var abx = b.x - a.x, aby = b.y - a.y;
      var len2 = abx * abx + aby * aby;
      if (len2 < EPS) continue;
      var t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var px = a.x + abx * t, py = a.y + aby * t;
      var dx = x - px, dy = y - py;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestS2) {
        bestS2 = d2;
        // 段起点弧长 + 段内比例 × 段长（采样等弧长）
        var segLen = this.length / n;
        var s = a.s + t * segLen;
        if (s >= this.length) s -= this.length;
        var angle = a.angle + normAngle(b.angle - a.angle) * t;
        var curv = a.curv + (b.curv - a.curv) * t;
        // lateral：切线左侧为正（y 向下系，法线 = 切线逆时针转 90°）
        var nx = -Math.sin(angle), ny = Math.cos(angle);
        var lateral = dx * nx + dy * ny;
        best = {
          s: s, lateral: lateral,
          onTrack: Math.abs(lateral) <= this.halfWidth,
          angle: angle, curv: curv, idx: i0
        };
      }
    }
    return best;
  };

  /* ---------- 是否在赛道内 ---------- */
  Track.prototype.insideTrack = function (x, y) {
    return this.nearest(x, y).onTrack;
  };

  return { Track: Track, normAngle: normAngle };
});
