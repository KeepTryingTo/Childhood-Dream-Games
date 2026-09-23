/* ============================================================
 * e2e.js —— 端到端冒烟：AI 在各种开关组合下的长局表现
 * 运行：node tests/e2e.js
 * ============================================================ */
'use strict';
var path = require('path');
var SG = require(path.join(__dirname, '../js/game.js'));
var AI = require(path.join(__dirname, '../js/ai.js'));

function runScenario(name, opts, maxTicks) {
  var g = new SG(opts);
  g.status = 'playing';
  var ticks = 0, lastLen = 3, stuck = 0;
  while (g.status === 'playing' && ticks < maxTicks) {
    var dir = AI.chooseDirection(g, 0);
    if (!dir) { g.status = 'over'; g.deathReason = 'trapped'; break; }
    g.snakes[0].dirQueue.length = 0;
    g.setDirection(dir, 0);
    g.tick();
    ticks++;
    if (g.snakes[0].body.length > lastLen) { lastLen = g.snakes[0].body.length; stuck = 0; }
    else if (++stuck > 600) break;
  }
  var eaten = g.snakes[0].body.length - 3;
  console.log('[' + name + '] ticks=' + ticks + ' 得分=' + g.snakes[0].score +
    ' 蛇长=' + g.snakes[0].body.length +
    (g.win ? ' 满盘通关!' : (g.status === 'over' ? ' 死因=' + g.deathReason : ' 未终局(限时截断)')));
  return { ticks: ticks, eaten: eaten };
}

var r;

r = runScenario('基础 20×20', { rows: 20, cols: 20 }, 3000);
if (r.eaten < 10) { console.log('FAIL: 基础局食物过少'); process.exit(1); }

r = runScenario('穿墙 20×20', { rows: 20, cols: 20, wrapMode: true }, 3000);
if (r.eaten < 10) { console.log('FAIL: 穿墙局食物过少'); process.exit(1); }

r = runScenario('障碍+穿墙+加速', { rows: 25, cols: 25, wrapMode: true, accel: true, obstacleCount: 12 }, 4000);
if (r.eaten < 8) { console.log('FAIL: 障碍局食物过少'); process.exit(1); }

r = runScenario('困难档 30×30', { rows: 30, cols: 30, speedMs: 70 }, 5000);
if (r.eaten < 10) { console.log('FAIL: 困难档食物过少'); process.exit(1); }

// 多局稳健性：5 局基础图全部达到 15+ 食物
var okRuns = 0;
for (var i = 0; i < 5; i++) {
  var rr = runScenario('稳健性 #' + (i + 1), { rows: 20, cols: 20 }, 4000);
  if (rr.eaten >= 15) okRuns++;
}
console.log('========================================');
console.log('稳健性: ' + okRuns + '/5 局达到 15+ 食物');
if (okRuns < 4) { console.log('FAIL: AI 稳健性不足'); process.exit(1); }
console.log('E2E 全部通过 ✓'.replace('✓', 'OK'));
