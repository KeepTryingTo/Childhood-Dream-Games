/* ============================================================
 * data.js —— 游戏静态数据：食材、菜谱、场景点位、员工配置
 * （v2.0 全自动模拟：左餐厅右厨房，世界 1180×680）
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 食材 ---------------- */
  var INGREDIENTS = [
    { id: 'cabbage', name: '白菜',   emoji: '🥬', chopMs: 1500 },
    { id: 'potato',  name: '土豆',   emoji: '🥔', chopMs: 1500 },
    { id: 'tomato',  name: '西红柿', emoji: '🍅', chopMs: 1500 },
    { id: 'egg',     name: '鸡蛋',   emoji: '🥚', chopMs: 1300 }
  ];

  /* ---------------- 菜谱 ---------------- */
  var RECIPES = [
    { id: 'cabbage',    name: '清炒白菜',   emoji: '🥬', need: ['cabbage'],      score: 100 },
    { id: 'potato',     name: '酸辣土豆丝', emoji: '🍟', need: ['potato'],       score: 120 },
    { id: 'tomato_egg', name: '番茄炒蛋',   emoji: '🍳', need: ['tomato', 'egg'], score: 150 }
  ];

  /* ---------------- 顾客类型（v2.0：挑剔客移除） ---------------- */
  var CUSTOMERS = {
    normal:  { name: '顾客',   patience: 1.0, payMul: 1, dishes: 1, emoji: '🙂' },
    vip:     { name: 'VIP',    patience: 0.6, payMul: 2, dishes: 1, emoji: '👑' },
    glutton: { name: '大胃王', patience: 1.5, payMul: 1, dishes: 2, emoji: '😋' }
  };

  /* ---------------- 世界与场景点位 ---------------- */
  var WORLD = { w: 1180, h: 680 };

  /** 厨房设施（x,y 中心；w×h 尺寸） */
  var STATIONS = {
    fridge:     { x: 1090, y: 480, w: 110, h: 110, name: '冰箱',   emoji: '🧊' },
    board:      { x: 820,  y: 560, w: 110, h: 100, name: '砧板',   emoji: '🔪' },
    prepTable:  { x: 820,  y: 320, w: 120, h: 90,  name: '备菜台', emoji: '🧺' },
    stove:      { x: 1090, y: 200, w: 130, h: 110, name: '灶台',   emoji: '🍲' },
    plating:    { x: 820,  y: 110, w: 130, h: 100, name: '装盘台', emoji: '🍽️' },
    pass:       { x: 640,  y: 340, w: 90,  h: 110, name: '取餐台', emoji: '🔔' },
    sink:       { x: 980,  y: 560, w: 110, h: 100, name: '水槽',   emoji: '🚰' },
    trash:      { x: 1150, y: 350, w: 80,  h: 90,  name: '垃圾桶', emoji: '🗑️' }
  };

  /** 餐厅餐桌（顾客 1 人 1 桌） */
  var TABLES = [
    { id: 0, x: 150, y: 170 },
    { id: 1, x: 150, y: 440 },
    { id: 2, x: 400, y: 170 },
    { id: 3, x: 400, y: 440 }
  ];

  var DOOR = { x: 70, y: 600 };          // 顾客出入口（餐厅左下）

  /** v3.1 隔断墙：x=600..614，开两扇门（缺口），墙体分段作碰撞体 */
  var WALL = {
    x: 600, w: 14,
    gaps: [
      { from: 160, to: 260, y: 210, name: '传菜口', emoji: '🚪' },
      { from: 440, to: 540, y: 490, name: '员工通道', emoji: '🚪' }
    ],
    /** 墙段 AABB 列表（y 从 0 到世界高，挖去缺口） */
    segments: null
  };
  (function buildSegs() {
    var segs = [], y = 0;
    var H = 680;
    WALL.gaps.forEach(function (g) {
      if (g.from > y) segs.push({ x: WALL.x, y: y, w: WALL.w, h: g.from - y });
      y = g.to;
    });
    if (y < H) segs.push({ x: WALL.x, y: y, w: WALL.w, h: H - y });
    WALL.segments = segs;
  })();

  /** v3.1 过门导航点（厨房侧 / 餐厅侧，正对门中心；北门厨房侧偏右避开取餐台） */
  var GATES = [
    { gateY: 210, kitchenSide: { x: 725, y: 210 }, diningSide: { x: 550, y: 210 } },
    { gateY: 490, kitchenSide: { x: 665, y: 490 }, diningSide: { x: 550, y: 490 } }
  ];

  /** v3.1 座位：每桌 4 把椅子（相对桌心偏移）与跑堂服务位 */
  var SEAT_OFFSETS = [
    { dx: 0, dy: -58 }, { dx: 0, dy: 58 }, { dx: -58, dy: 0 }, { dx: 58, dy: 0 }
  ];
  var SERVE_OFFSET = { dx: 80, dy: 0 };   // 跑堂送菜/收盘站位（桌右侧，避椅）

  /** 经理巡逻点（餐厅 2 + 厨房 3） */
  var PATROL_POINTS = [
    { x: 275, y: 300 }, { x: 150, y: 600 },
    { x: 720, y: 430 }, { x: 950, y: 300 }, { x: 1090, y: 350 }
  ];

  /* ---------------- 员工配置 ---------------- */
  var STAFF = {
    prep:    { role: 'prep',    name: '配菜师', tag: '🔪', color: '#8ce99a', speed: 150 },
    chef:    { role: 'chef',    name: '主厨',   tag: '🍳', color: '#ffd43b', speed: 140 },
    runner:  { role: 'runner',  name: '跑堂',   tag: '🏃', color: '#74c0fc', speed: 190 },
    manager: { role: 'manager', name: '经理',   tag: '👔', color: '#b197fc', speed: 120 }
  };

  /* ---------------- 厨房装修主题（v3.0 装扮系统） ---------------- */
  var THEMES = {
    warm:    { id: 'warm',    name: '暖木小馆', floorA: '#f5e3c8', floorB: '#eed6b4', kitchenA: '#dde3e8', kitchenB: '#e8edf1',
               wall: '#8d6e4f', table: '#e9d4ac', tableEdge: '#a0784f', accent: '#f59f00' },
    celadon: { id: 'celadon', name: '青花雅苑', floorA: '#e8f0ec', floorB: '#dce9e3', kitchenA: '#dfe7ea', kitchenB: '#eaf1f4',
               wall: '#7ba88f', table: '#cfe4d8', tableEdge: '#5f8f75', accent: '#38a169' },
    neon:    { id: 'neon',    name: '夜市霓虹', floorA: '#2b2536', floorB: '#241f2e', kitchenA: '#2e2a3a', kitchenB: '#272333',
               wall: '#4a3b63', table: '#3d3450', tableEdge: '#7950f2', accent: '#e599f7' },
    macaron: { id: 'macaron', name: '马卡龙屋', floorA: '#fdeff4', floorB: '#fae3ee', kitchenA: '#e6f4f7', kitchenB: '#f0f9fb',
               wall: '#f7a8c4', table: '#ffe0ec', tableEdge: '#e6809e', accent: '#f06595' }
  };

  /* ---------------- 季节（v3.0，每 3 分钟轮换，可手动切换） ---------------- */
  var SEASONS = [
    { id: 0, name: '春',    emoji: '🌸', floorA: '#f2e8d5', floorB: '#ecdfc8', particle: '#fbb5d0', label: '樱花纷飞' },
    { id: 1, name: '夏',    emoji: '🌞', floorA: '#f5ecd2', floorB: '#efe5c6', particle: '#8ee08e', label: '绿意盎然' },
    { id: 2, name: '秋',    emoji: '🍂', floorA: '#f5e3c8', floorB: '#eed6b4', particle: '#f5a623', label: '落叶满堂' },
    { id: 3, name: '冬',    emoji: '❄️', floorA: '#eef2f5', floorB: '#e4eaef', particle: '#cfe6ff', label: '瑞雪兆丰' }
  ];

  /* ---------------- 节日（按系统日期匹配，附加装饰横幅） ---------------- */
  var FESTIVALS = [
    { name: '元旦',    emoji: '🎊', match: function (m, d) { return m === 1 && d <= 3; } },
    { name: '劳动节',  emoji: '🚩', match: function (m, d) { return m === 5 && d <= 5; } },
    { name: '国庆节',  emoji: '🇨🇳', match: function (m, d) { return m === 10 && d <= 7; } },
    { name: '圣诞节',  emoji: '🎄', match: function (m, d) { return m === 12 && d >= 24 && d <= 26; } }
  ];

  /* ---------------- 动态环境事件配置（v3.0） ---------------- */
  var EVENTS = {
    FIRST_MS: 50000,             // 首个事件最早出现时间
    GAP_MIN: 45000, GAP_MAX: 80000,
    SKIP_RATE: 0.35,             // 不触发概率
    RAT: {
      spawn: { x: 1165, y: 320 },
      sneakSpeed: 120, fleeSpeed: 260,
      stealMs: 2500,
      chaseDist: 55
    },
    LEAK: {
      area: { x: 700, y: 250, w: 400, h: 300 },   // 漏水随机区域（厨房）
      radius: 75,          // 减速影响半径
      slowMul: 0.55,
      fixMs: 2500
    },
    FIRE: {
      pos: { x: 1015, y: 265 },   // 灶台旁
      fixMs: 2500
    }
  };

  /* ---------------- 数值配置 ---------------- */
  var CONFIG = {
    CUSTOMER_SPEED: 110,
    CUSTOMER_GAP: 11000,        // 顾客到达基准间隔
    CUSTOMER_GAP_MIN: 6000,
    CUSTOMER_GAP_DECAY: 45,     // 每 45s 间隔 -1s
    TAKE_MS: 400,               // 取放物品动作时长
    SIT_MS: 1000,               // 顾客坐下到点单
    PAY_MS: 1500,               // 付款
    EAT_MS: 10000,              // 用餐
    COOK_MS: 3500,              // 自然烹饪时长
    STIR_MS: 450,               // 主厨每铲额外推进（每 0.9s 一铲 → 约 2.3s 炒熟）
    STIR_INTERVAL: 900,
    PERFECT_FROM: 1200,         // 完美窗口（出锅后计时）
    PERFECT_TO: 3000,
    BURN_MS: 7000,
    WASH_MS: 3000,
    START_PLATES: 6,            // 初始干净盘
    PREP_STOCK_MAX: 4,          // 备菜台每种食材上限
    BASE_PATIENCE: 85000,
    VIP_RATE: 0.10,
    GLUTTON_RATE: 0.08,
    BUFF_MUL: 1.35,             // 经理催促增益
    BUFF_MS: 4000,
    URGE_MIN_MS: 7000,          // 催促间隔
    URGE_MAX_MS: 12000
  };

  function ingById(id) {
    for (var i = 0; i < INGREDIENTS.length; i++) if (INGREDIENTS[i].id === id) return INGREDIENTS[i];
    return null;
  }
  function recipeById(id) {
    for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === id) return RECIPES[i];
    return null;
  }
  function matchRecipe(ids) {
    var sorted = ids.slice().sort();
    for (var i = 0; i < RECIPES.length; i++) {
      var need = RECIPES[i].need.slice().sort();
      if (need.length !== sorted.length) continue;
      var ok = true;
      for (var j = 0; j < need.length; j++) if (need[j] !== sorted[j]) { ok = false; break; }
      if (ok) return RECIPES[i];
    }
    return null;
  }

  return {
    INGREDIENTS: INGREDIENTS, RECIPES: RECIPES, CUSTOMERS: CUSTOMERS,
    WORLD: WORLD, STATIONS: STATIONS, TABLES: TABLES, DOOR: DOOR,
    WALL: WALL, GATES: GATES, SEAT_OFFSETS: SEAT_OFFSETS, SERVE_OFFSET: SERVE_OFFSET,
    PATROL_POINTS: PATROL_POINTS, STAFF: STAFF,
    THEMES: THEMES, SEASONS: SEASONS, FESTIVALS: FESTIVALS, EVENTS: EVENTS,
    CONFIG: CONFIG,
    ingById: ingById, recipeById: recipeById, matchRecipe: matchRecipe
  };
});
