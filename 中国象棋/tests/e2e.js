/* 端到端集成验证：AI vs AI 完整对局（Game 流程 + 记谱 + 终局） */
var M = require('../js/model.js');
var R = require('../js/rules.js');
var G = require('../js/game.js');
var AI = require('../js/ai.js');

var game = new G.Game();
var maxSteps = 120;
var steps = 0, t0 = Date.now(), slowest = 0;

while (game.status === 'playing' && steps < maxSteps) {
  var s = Date.now();
  var mv = AI.findBestMove(game.board, game.turn, 'medium');
  var dt = Date.now() - s;
  if (dt > slowest) slowest = dt;
  if (!mv) break;
  var info = game.applyMove(mv);
  if (steps < 8) console.log('  ' + info.record);
  steps++;
}

console.log('----------------------------------------');
console.log('总步数: ' + steps);
console.log('终局状态: ' + game.status + (game.endReason ? '（' + (game.endReason === 'checkmate' ? '将死' : '困毙') + '）' : ''));
console.log('最后5步: ' + game.history.slice(-5).map(function (h) { return h.record; }).join(' '));
console.log('AI 单步最慢耗时: ' + slowest + 'ms（要求 ≤3000ms）');
if (game.status !== 'playing') {
  var winner = game.status === 'red_win' ? '红方' : '黑方';
  console.log('胜负: ' + winner + '胜，判定自洽: ' +
    (game.endReason === 'checkmate'
      ? R.isCheckmate(game.board, game.turn)
      : R.isStalemate(game.board, game.turn)));
}
