/* ============================================================
 * ai.js —— AI 驾驶模块（纯逻辑，无 DOM 依赖，可单元测试）
 *
 * 策略（require.md 步骤 5）：
 *   1. 前瞻点追踪：目标点 = 中心线上 s + lookahead(speed)，
 *      转向 = 角误差 × 增益，限幅 [-1, 1]
 *   2. 弯道限速：前瞻窗口 [s+la, s+2.2la] 内最大 |曲率| →
 *      vTarget = sqrt(GRIP_AI / curv)，并受极速 × skill 约束
 *   3. 简易避让：正前方近距离（同向夹角小 + 横向差小）有车 → 收油
 *   4. 直道氮气：曲率小且速度接近目标 → 视技能概率释放
 *
 * 接口：RaceAI.drive(game, car, dt) —— 只写 car 的输入字段
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./track.js'));
  } else {
    root.RaceAI = factory(root.Track);
  }
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  var normAngle = T ? T.normAngle : null;

  var AI = {
    // 侧向抓地上限（用于弯道限速 v = sqrt(a / κ)）
    GRIP_AI: 30,
    // 前瞻距离系数
    LOOK_BASE: 7,
    LOOK_SPEED: 0.58,
    LOOK_MIN: 9,
    LOOK_MAX: 48,
    // 转向增益
    STEER_GAIN: 2.4,
    // 避让参数（阈值需大于碰撞直径 3.6m，否则巡线车会硬挤外侧车道车）
    AVOID_DIST: 18,
    AVOID_LATERAL: 4.5
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * 计算弯道安全速度。
   * @param track 赛道
   * @param s 当前弧长
   * @param windowLen 前瞻窗口长度（米）
   * @returns 允许的最大速度 m/s
   */
  AI.curveSpeed = function (track, s, windowLen) {
    var maxCurv = 0, i;
    var steps = 8;
    for (i = 1; i <= steps; i++) {
      var p = track.pointAtS(s + windowLen * i / steps);
      var c = Math.abs(p.curv);
      if (c > maxCurv) maxCurv = c;
    }
    if (maxCurv < 1e-4) return Infinity;
    return Math.sqrt(AI.GRIP_AI / maxCurv);
  };

  /**
   * 为一辆 AI 车生成控制输入。
   */
  AI.drive = function (game, car, dt) {
    var track = game.track;
    var speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);

    // 1) 前瞻目标点
    var look = clamp(AI.LOOK_BASE + speed * AI.LOOK_SPEED, AI.LOOK_MIN, AI.LOOK_MAX);
    var target = track.pointAtS(car.lastS + look);
    var desired = Math.atan2(target.y - car.y, target.x - car.x);
    var err = normAngle(desired - car.angle);
    var steer = clamp(err * AI.STEER_GAIN, -1, 1);

    // 2) 弯道限速
    var vCurve = AI.curveSpeed(track, car.lastS, look * 2.2);
    var vMax = game.phys.V_MAX * car.skill * (car.onTrack ? 1 : 0.5);
    var vTarget = Math.min(vMax, vCurve);

    var throttle = 0, brake = 0;
    if (speed < vTarget) throttle = 1;
    else if (speed > vTarget * 1.15) brake = 1;
    // 低速不再刹车：AI 的刹车只用于弯前减速，防止刹成倒车
    if (speed < 4) brake = 0;

    // 3) 简易避让：正前方近距离有车且横向差小 → 收油
    var i, cars = game.cars;
    for (i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car) continue;
      var dx = o.x - car.x, dy = o.y - car.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > AI.AVOID_DIST || dist < 1e-6) continue;
      var dir = Math.atan2(dy, dx);
      var rel = normAngle(dir - car.angle);
      // 目标在正前方 ±30° 内
      if (Math.abs(rel) < Math.PI / 6) {
        // 与赛道行进方向的横向差小（同车道）才避让
        if (Math.abs(o.lateral - car.lateral) < AI.AVOID_LATERAL) {
          throttle = Math.min(throttle, 0.2);
          // 轻微向外避让
          steer = clamp(steer + (car.lateral > o.lateral ? 0.35 : -0.35), -1, 1);
        }
      }
    }

    // 4) 直道氮气（技能高的 AI 更爱用）
    var nitro = false;
    if (car.nitro > 35 && speed > vTarget * 0.8 && vCurve > vMax * 0.95) {
      nitro = car.skill > 0.95;
    }

    car.steer = steer;
    car.throttle = throttle;
    car.brake = brake;
    if (car.finished) {   // 完赛：松油滑停（物理层负责刹车），不追线不氮气
      car.throttle = 0;
      car.brake = 0;
      car.steer = 0;
      car.nitroActive = false;
      return;
    }
    car.nitroActive = nitro;
  };

  /** 给所有 AI 车辆生成输入（main 每 tick 调一次） */
  AI.driveAll = function (game, dt) {
    for (var i = 1; i < game.cars.length; i++) {
      AI.drive(game, game.cars[i], dt);
    }
  };

  return AI;
});
