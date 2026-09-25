/* ============================================================
 * achievements.js —— 成就与图鉴（纯逻辑，无 DOM 依赖，可单元测试）
 *
 * 成就分两类：
 *   session（单局）：只看本局 stats
 *   lifetime（累计）：看跨局累计 history（storage 持久化）
 * 检查器输入 { session, lifetime, seasonsMask }，输出新达成列表
 * （不在 lifetime.achieved 中的）。图鉴计数由 lifetime 提供。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenAch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 成就定义 ---------------- */
  var ACHIEVEMENTS = [
    { id: 'first_dish',  icon: '🍳', name: '开张大吉',   desc: '完成第一份菜',
      type: 'lifetime', check: function (c) { return c.lifetime.totalDishes >= 1; } },
    { id: 'dishes_100',  icon: '🍱', name: '百炼成厨',   desc: '累计上菜 100 份',
      type: 'lifetime', check: function (c) { return c.lifetime.totalDishes >= 100; } },
    { id: 'dishes_500',  icon: '🏆', name: '镇店之宝',   desc: '累计上菜 500 份',
      type: 'lifetime', check: function (c) { return c.lifetime.totalDishes >= 500; } },
    { id: 'perfect_20',  icon: '⭐', name: '完美主义',   desc: '单局 20 份完美菜品',
      type: 'session',  check: function (c) { return c.session.perfects >= 20; } },
    { id: 'rich_10k',    icon: '💰', name: '财源广进',   desc: '单局营业额达到 10000',
      type: 'session',  check: function (c) { return c.session.revenue >= 10000; } },
    { id: 'full_house',  icon: '👏', name: '满堂彩',     desc: '单局服务 20 位顾客且好评率 100%',
      type: 'session',  check: function (c) {
        return c.session.customersServed >= 20 && c.session.customersLost === 0; } },
    { id: 'rat_hero',    icon: '🐭', name: '灭鼠英雄',   desc: '累计驱赶 10 只老鼠',
      type: 'lifetime', check: function (c) { return (c.lifetime.ratsChased || 0) >= 10; } },
    { id: 'fire_fighter',icon: '🧯', name: '消防队员',   desc: '累计扑灭 5 次灶火',
      type: 'lifetime', check: function (c) { return (c.lifetime.firesOut || 0) >= 5; } },
    { id: 'cleaner',     icon: '🧽', name: '勤劳双手',   desc: '累计洗净 100 只盘子',
      type: 'lifetime', check: function (c) { return (c.lifetime.totalWashed || 0) >= 100; } },
    { id: 'vip_10',      icon: '👑', name: '贵客盈门',   desc: '累计服务 10 位 VIP',
      type: 'lifetime', check: function (c) { return (c.lifetime.vipServed || 0) >= 10; } },
    { id: 'glutton_5',   icon: '😋', name: '大胃克星',   desc: '累计服务 5 位大胃王',
      type: 'lifetime', check: function (c) { return (c.lifetime.gluttonServed || 0) >= 5; } },
    { id: 'menu_master', icon: '📖', name: '全菜谱大师', desc: '三种菜品各累计出品 20 次',
      type: 'lifetime', check: function (c) {
        var r = c.lifetime.recipeCounts || {};
        return (r.cabbage || 0) >= 20 && (r.potato || 0) >= 20 && (r.tomato_egg || 0) >= 20; } },
    { id: 'four_seasons',icon: '🎡', name: '四季餐馆',   desc: '经历春夏秋冬完整一轮',
      type: 'lifetime', check: function (c) { return (c.seasonsMask & 15) === 15; } }
  ];

  /* ---------------- 检查 ---------------- */
  /**
   * @param ctx { session: 本局 stats, lifetime: 累计 history（含 achieved 表）, seasonsMask }
   * @returns 新达成的成就数组（调用方负责写入 achieved 并展示 toast）
   */
  function checkNew(ctx) {
    var out = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      if (ctx.lifetime.achieved && ctx.lifetime.achieved[a.id]) continue;
      var ok = false;
      try { ok = !!a.check(ctx); } catch (e) { ok = false; }
      if (ok) out.push(a);
    }
    return out;
  }

  /** 单局 stats 合并进 lifetime history（结算时调用，返回新 history） */
  function mergeHistory(lifetime, session, seasonsMask) {
    var h = lifetime || {};
    h.totalDishes = (h.totalDishes || 0) + (session.dishes || 0);
    h.totalPerfect = (h.totalPerfect || 0) + (session.perfects || 0);
    h.totalWashed = (h.totalWashed || 0) + (session.washed || 0);
    h.totalRevenue = (h.totalRevenue || 0) + (session.revenue || 0);
    h.ratsChased = (h.ratsChased || 0) + (session.ratsChased || 0);
    h.firesOut = (h.firesOut || 0) + (session.firesOut || 0);
    h.vipServed = (h.vipServed || 0) + (session.vipServed || 0);
    h.gluttonServed = (h.gluttonServed || 0) + (session.gluttonServed || 0);
    h.seasonsMask = ((h.seasonsMask || 0) | (seasonsMask || 0)) & 15;
    var rc = h.recipeCounts || {};
    var pr = session.perRecipe || {};
    for (var k in pr) rc[k] = (rc[k] || 0) + pr[k];
    h.recipeCounts = rc;
    var cm = h.customerMet || {};
    var mm = session.customerMet || {};
    for (var k2 in mm) cm[k2] = (cm[k2] || 0) + mm[k2];
    h.customerMet = cm;
    h.achieved = h.achieved || {};
    return h;
  }

  /** 图鉴视图：菜品/顾客点亮状态 */
  function codexView(lifetime, recipes, customers) {
    var rc = (lifetime && lifetime.recipeCounts) || {};
    var cm = (lifetime && lifetime.customerMet) || {};
    return {
      recipes: recipes.map(function (r) {
        return { id: r.id, name: r.name, emoji: r.emoji, count: rc[r.id] || 0, lit: (rc[r.id] || 0) > 0 };
      }),
      customers: Object.keys(customers).map(function (k) {
        return { id: k, name: customers[k].name, emoji: customers[k].emoji, count: cm[k] || 0, lit: (cm[k] || 0) > 0 };
      })
    };
  }

  /** 成就视图（含已达成状态） */
  function achView(lifetime) {
    var got = (lifetime && lifetime.achieved) || {};
    return ACHIEVEMENTS.map(function (a) {
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, done: !!got[a.id] };
    });
  }

  return {
    ACHIEVEMENTS: ACHIEVEMENTS,
    checkNew: checkNew,
    mergeHistory: mergeHistory,
    codexView: codexView,
    achView: achView
  };
});
