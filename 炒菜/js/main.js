/* ============================================================
 * main.js —— 入口 / 循环 / 速度控制 / 统计 / 打烊结算 /
 *            成就·图鉴·榜单面板 / 装扮与季节切换 / 新手引导（v3.0）
 * 依赖：data.js / game.js / storage.js / achievements.js / ui.js
 * ============================================================ */
(function (window, document) {
  'use strict';

  var D = window.KitchenData;
  var KitchenSim = window.KitchenSim.KitchenSim;
  var ST = window.KitchenStorage, UI = window.KitchenUI, Sound = window.KitchenSound;
  var Ach = window.KitchenAch;

  var STEP = 1000 / 60;
  var SPEEDS = [1, 2, 4];

  /* ---------------- DOM ---------------- */
  function $(id) { return document.getElementById(id); }
  var canvas = $('board');
  var revenueEl = $('revenue'), servedEl = $('served'), perfectEl = $('perfect');
  var custServedEl = $('cust-served'), custLostEl = $('cust-lost');
  var ratingEl = $('rating'), waitEl = $('avg-wait'), timeEl = $('time'), statusEl = $('status');
  var logEl = $('log');
  var overlayEl = $('overlay'), overlayTitleEl = $('overlay-title'), overlayBodyEl = $('overlay-body'), overlayBtnEl = $('overlay-btn');
  var btnPause = $('btn-pause'), btnNew = $('btn-new'), btnSound = $('btn-sound'), btnClose = $('btn-close');
  var speedBtns = [$('btn-sp1'), $('btn-sp2'), $('btn-sp4')];
  var tabBtns = { stats: $('tab-stats'), ach: $('tab-ach'), codex: $('tab-codex'), board: $('tab-board'), skin: $('tab-skin') };
  var tabPanes = { stats: $('pane-stats'), ach: $('pane-ach'), codex: $('pane-codex'), board: $('pane-board'), skin: $('pane-skin') };
  var achListEl = $('ach-list'), codexRecipesEl = $('codex-recipes'), codexCustEl = $('codex-cust');
  var boardListEl = $('board-list'), seasonRowEl = $('season-row'), themeRowEl = $('theme-row');
  var nameInput = $('name-input'), btnGuide = $('btn-guide');
  var toastBoxEl = $('toast-box'), guideEl = $('guide-bar'), guideTextEl = $('guide-text'), guideSkipEl = $('guide-skip');

  /* ---------------- 状态 ---------------- */
  var sim = null;
  var ui = new UI(canvas);
  var acc = 0, lastTs = 0;
  var speed = 1;
  var lastHUD = {};               // 数字动效检测
  var achCheckTimer = 0;
  var skin = ST.loadSkin();
  var festival = detectFestival();

  /* ---------------- 节日检测（系统日期） ---------------- */
  function detectFestival() {
    var now = new Date(), m = now.getMonth() + 1, d = now.getDate();
    for (var i = 0; i < D.FESTIVALS.length; i++) {
      if (D.FESTIVALS[i].match(m, d)) return { name: D.FESTIVALS[i].name, emoji: D.FESTIVALS[i].emoji };
    }
    return null;
  }

  /* ---------------- 生命周期 ---------------- */
  function newGame() {
    sim = new KitchenSim();
    sim.skin = skin;                     // 装扮（ui 读取）
    sim.festival = festival;             // 节日（ui 读取）
    window.__kitchenSim = sim;
    acc = 0;
    achCheckTimer = 0;
    overlayEl.classList.add('hidden');
    btnPause.textContent = '暂停';
    logEl.innerHTML = '';
    setSpeed(speed);
    updateHUD();
    renderAchPane();
  }

  /* ---------------- 速度控制 ---------------- */
  function setSpeed(i) {
    if (i < 1 || i > SPEEDS.length) return;
    speed = SPEEDS[i - 1];
    speedBtns.forEach(function (b, k) { if (b) b.classList.toggle('active', k === i - 1); });
  }

  /* ---------------- HUD（带数字弹跳动效） ---------------- */
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s -= m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setVal(el, v) {
    var key = el.id, prev = lastHUD[key];
    if (prev !== v) {
      lastHUD[key] = v;
      el.textContent = v;
      el.classList.remove('bump');
      void el.offsetWidth;                // 重置动画
      el.classList.add('bump');
    }
  }

  function updateHUD() {
    var st = sim.stats;
    setVal(revenueEl, st.revenue);
    setVal(servedEl, st.dishes);
    setVal(perfectEl, st.perfects);
    setVal(custServedEl, st.customersServed);
    setVal(custLostEl, st.customersLost);
    var totalCust = st.customersServed + st.customersLost;
    setVal(ratingEl, totalCust ? Math.round(st.customersServed / totalCust * 100) + '%' : '—');
    setVal(waitEl, st.waitCount ? (st.waitTotalMs / st.waitCount / 1000).toFixed(0) + 's' : '—');
    setVal(timeEl, fmtTime(sim.timeMs));
    statusEl.textContent = sim.status === 'paused' ? '⏸ 已暂停' : '自动营业中';
  }

  function appendLog(events) {
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var cls = (ev.type === 'angry' || ev.type === 'burnt' || ev.type === 'envEvent') ? 'log-bad'
        : (ev.type === 'paid' || ev.type === 'eventFixed') ? 'log-good' : '';
      var div = document.createElement('div');
      div.className = 'log-line ' + cls;
      div.textContent = '[' + fmtTime(sim.timeMs) + '] ' + ev.msg;
      logEl.insertBefore(div, logEl.firstChild);
    }
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
  }

  /* ---------------- Toast ---------------- */
  function showToast(title, body, cls) {
    var t = document.createElement('div');
    t.className = 'toast ' + (cls || '');
    t.innerHTML = '<div class="toast-title">' + title + '</div><div class="toast-body">' + body + '</div>';
    toastBoxEl.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 4200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4800);
  }

  /* ---------------- 成就检查（每 8s + 打烊） ---------------- */
  function checkAchievements(silent) {
    var lifetime = ST.loadHistory();
    var news = Ach.checkNew({ session: sim.stats, lifetime: lifetime, seasonsMask: sim.stats.seasonsMask });
    if (news.length) {
      lifetime.achieved = lifetime.achieved || {};
      news.forEach(function (a) {
        lifetime.achieved[a.id] = true;
        if (!silent) {
          Sound.achievement();
          showToast('🏅 成就达成', a.icon + ' <b>' + a.name + '</b> — ' + a.desc, 'toast-ach');
        }
      });
      ST.saveHistory(lifetime);
      renderAchPane();
    }
    return news;
  }

  /* ---------------- 打烊结算 ---------------- */
  function closeDay() {
    if (sim.status === 'over') return;
    sim.pause();
    Sound.closeDay();
    var st = sim.stats;
    // 合并累计
    var lifetime = Ach.mergeHistory(ST.loadHistory(), st, st.seasonsMask);
    ST.saveHistory(lifetime);
    var news = Ach.checkNew({ session: st, lifetime: lifetime, seasonsMask: st.seasonsMask });
    news.forEach(function (a) { lifetime.achieved[a.id] = true; });
    ST.saveHistory(lifetime);
    var best = ST.saveBest(st.revenue);
    var totalCust = st.customersServed + st.customersLost;
    var rating = totalCust ? Math.round(st.customersServed / totalCust * 100) : 100;
    var rank = ST.addBoardEntry({
      name: ST.loadName(), revenue: st.revenue, dishes: st.dishes,
      rating: rating, date: new Date().toLocaleDateString()
    });
    overlayTitleEl.textContent = '🌙 今日打烊';
    var html =
      '<div class="overlay-rows">' +
      '营业额 <b>' + st.revenue + '</b>' + (best ? ' 🎉 创历史新高！' : '') + '<br>' +
      '上菜 ' + st.dishes + ' 份（完美★' + st.perfects + '）· 好评率 ' + rating + '%<br>' +
      '顾客 满意 ' + st.customersServed + ' / 流失 ' + st.customersLost +
      ' · 洗盘 ' + st.washed + ' 次<br>' +
      '驱鼠 ' + st.ratsChased + ' · 修漏 ' + st.leaksFixed + ' · 灭火 ' + st.firesOut +
      '</div>';
    if (news.length) {
      html += '<div class="ach-gain">🏅 本局新成就：' +
        news.map(function (a) { return a.icon + a.name; }).join('、') + '</div>';
    }
    if (rank > 0) html += '<div class="ach-gain">🏆 荣誉榜第 ' + rank + ' 名！</div>';
    overlayBodyEl.innerHTML = html;
    overlayBtnEl.textContent = '再开一天';
    overlayEl.classList.remove('hidden');
    renderAchPane();
    renderBoardPane();
    renderCodexPane();
  }

  /* ---------------- 面板：tabs ---------------- */
  function switchTab(name) {
    Object.keys(tabBtns).forEach(function (k) {
      if (tabBtns[k]) tabBtns[k].classList.toggle('active', k === name);
      if (tabPanes[k]) tabPanes[k].classList.toggle('hidden', k !== name);
    });
    if (name === 'ach') renderAchPane();
    if (name === 'codex') renderCodexPane();
    if (name === 'board') renderBoardPane();
  }

  function renderAchPane() {
    if (!achListEl) return;
    var list = Ach.achView(ST.loadHistory());
    achListEl.innerHTML = list.map(function (a) {
      return '<div class="ach-item' + (a.done ? ' done' : '') + '">' +
        '<span class="ach-ic">' + a.icon + '</span>' +
        '<span class="ach-tx"><b>' + a.name + '</b><i>' + a.desc + '</i></span>' +
        '<span class="ach-st">' + (a.done ? '✓' : '…') + '</span></div>';
    }).join('');
  }

  function renderCodexPane() {
    if (!codexRecipesEl) return;
    var view = Ach.codexView(ST.loadHistory(), D.RECIPES, D.CUSTOMERS);
    codexRecipesEl.innerHTML = view.recipes.map(function (r) {
      return '<div class="codex-item' + (r.lit ? ' lit' : '') + '">' +
        '<span class="cx-ic">' + r.emoji + '</span><span>' + r.name + '</span>' +
        '<i>' + (r.lit ? '出品 ' + r.count + ' 次' : '未解锁') + '</i></div>';
    }).join('');
    codexCustEl.innerHTML = view.customers.map(function (c) {
      return '<div class="codex-item' + (c.lit ? ' lit' : '') + '">' +
        '<span class="cx-ic">' + c.emoji + '</span><span>' + c.name + '</span>' +
        '<i>' + (c.lit ? '接待 ' + c.count + ' 位' : '未解锁') + '</i></div>';
    }).join('');
  }

  function renderBoardPane() {
    if (!boardListEl) return;
    var board = ST.loadBoard();
    boardListEl.innerHTML = board.length ? board.map(function (e, i) {
      return '<div class="board-row"><span class="rk">' + (i + 1) + '</span>' +
        '<span class="nm">' + e.name + '</span>' +
        '<span class="rv">' + e.revenue + '</span>' +
        '<span class="dt">' + (e.dishes || 0) + '份 · ' + (e.date || '') + '</span></div>';
    }).join('') : '<div class="order-empty">还没有记录，打烊一次试试！</div>';
  }

  /* ---------------- 装扮 / 季节 ---------------- */
  function renderSkinPane() {
    if (!seasonRowEl) return;
    seasonRowEl.innerHTML = D.SEASONS.map(function (s) {
      return '<button class="chip' + (sim && sim.season === s.id ? ' active' : '') + '" data-season="' + s.id + '">' +
        s.emoji + ' ' + s.name + '</button>';
    }).join('');
    themeRowEl.innerHTML = Object.keys(D.THEMES).map(function (k) {
      var t = D.THEMES[k];
      return '<button class="chip' + (skin.theme === k ? ' active' : '') + '" data-theme="' + k + '">' +
        '<span class="dot" style="background:' + t.accent + '"></span>' + t.name + '</button>';
    }).join('');
  }

  /* ---------------- 新手引导 ---------------- */
  var GUIDE_STEPS = [
    '👋 欢迎光临「疯狂后厨」！全场自动运转，你只需要泡杯茶欣赏～',
    '🚪 顾客从门口进店、坐桌点单——气泡显示菜品，外圈是耐心倒计时',
    '🍳 后厨流水线：配菜师切菜 → 主厨翻炒并卡完美窗口出锅（黄色区★）',
    '🏃 跑堂把菜端上桌、收脏盘去洗；👔 经理巡逻催促员工、处理老鼠/漏水/灶火',
    '🎉 试试右侧【成就·图鉴·荣誉榜】与装修主题，按空格暂停、1/2/3 调速。开业大吉！'
  ];
  var guideStep = -1, guideTimer = null;

  function showGuide(force) {
    if (!force && ST.loadGuideSeen()) return;
    guideStep = 0;
    guideEl.classList.remove('hidden');
    renderGuideStep();
  }
  function renderGuideStep() {
    guideTextEl.textContent = GUIDE_STEPS[guideStep];
    guideTextEl.classList.remove('pop');
    void guideTextEl.offsetWidth;
    guideTextEl.classList.add('pop');
    clearTimeout(guideTimer);
    guideTimer = setTimeout(nextGuide, 8000);
  }
  function nextGuide() {
    guideStep++;
    if (guideStep >= GUIDE_STEPS.length) {
      guideEl.classList.add('hidden');
      ST.saveGuideSeen(true);
      showToast('📖 引导完成', '享受你的后厨之旅吧！', 'toast-ach');
      return;
    }
    renderGuideStep();
  }

  /* ---------------- 输入 ---------------- */
  function bindEvents() {
    window.addEventListener('keydown', function (e) {
      Sound.ensure();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      switch (e.code) {
        case 'Space': sim.togglePause(); btnPause.textContent = sim.status === 'paused' ? '继续' : '暂停'; break;
        case 'Digit1': case 'Numpad1': setSpeed(1); break;
        case 'Digit2': case 'Numpad2': setSpeed(2); break;
        case 'Digit3': case 'Numpad3': setSpeed(3); break;
        case 'KeyR': newGame(); break;
        case 'KeyP': case 'Escape': sim.togglePause(); btnPause.textContent = sim.status === 'paused' ? '继续' : '暂停'; break;
      }
    });
    window.addEventListener('blur', function () {
      if (sim.status === 'playing') { sim.pause(); btnPause.textContent = '继续'; }
    });

    btnNew.addEventListener('click', function () { Sound.ensure(); newGame(); });
    btnClose.addEventListener('click', function () { Sound.ensure(); closeDay(); });
    btnPause.addEventListener('click', function () {
      sim.togglePause();
      btnPause.textContent = sim.status === 'paused' ? '继续' : '暂停';
    });
    overlayBtnEl.addEventListener('click', function () { newGame(); });
    btnSound.addEventListener('click', function () {
      Sound.ensure();
      Sound.setEnabled(!Sound.enabled);
      btnSound.textContent = Sound.enabled ? '音效：开' : '音效：关';
    });
    speedBtns.forEach(function (b, i) {
      if (b) b.addEventListener('click', function () { Sound.ensure(); setSpeed(i + 1); });
    });
    Object.keys(tabBtns).forEach(function (k) {
      if (tabBtns[k]) tabBtns[k].addEventListener('click', function () { switchTab(k); });
    });
    // 主题 / 季节按钮（事件委托）
    themeRowEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-theme]');
      if (!btn) return;
      Sound.ensure();
      skin.theme = btn.getAttribute('data-theme');
      ST.saveSkin(skin);
      sim.skin = skin;
      renderSkinPane();
      showToast('🎨 装修完成', '已切换为「' + D.THEMES[skin.theme].name + '」主题', 'toast-ach');
    });
    seasonRowEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-season]');
      if (!btn) return;
      Sound.ensure();
      sim.setSeason(parseInt(btn.getAttribute('data-season'), 10));
      renderSkinPane();
    });
    nameInput.addEventListener('change', function () {
      ST.saveName(nameInput.value);
      showToast('✏️ 已保存', '店长昵称：' + ST.loadName(), 'toast-ach');
    });
    btnGuide.addEventListener('click', function () { showGuide(true); });
    guideSkipEl.addEventListener('click', function () {
      clearTimeout(guideTimer);
      guideEl.classList.add('hidden');
      ST.saveGuideSeen(true);
    });
  }

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var frameMs = Math.min(ts - lastTs, 200);
    lastTs = ts;

    if (sim.status === 'playing') {
      acc += frameMs * speed;
      var guard = 0;
      while (acc >= STEP && guard < 600) {
        sim.tick(STEP / 1000);
        appendLog(sim.events);
        acc -= STEP;
        guard++;
      }
      if (guard >= 600) acc = 0;
      // 周期性成就检查（8s）
      achCheckTimer += frameMs;
      if (achCheckTimer > 8000) {
        achCheckTimer = 0;
        checkAchievements(false);
      }
    }

    updateHUD();
    ui.render(sim, frameMs / 1000);
  }

  /* ---------------- 启动 ---------------- */
  bindEvents();
  newGame();
  renderSkinPane();
  renderAchPane();
  renderCodexPane();
  renderBoardPane();
  nameInput.value = ST.loadName();
  switchTab('stats');
  showGuide(false);
  overlayEl.classList.add('hidden');
  requestAnimationFrame(loop);
})(window, document);
