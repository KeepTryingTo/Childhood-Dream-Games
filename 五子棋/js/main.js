/**
 * main.js —— 程序入口
 *
 * 职责：初始化 UI 与对局，绑定控件事件，连通各层。
 * 启动流程：
 *   1. 创建 Game 实例（传入状态刷新回调与提示回调）
 *   2. 初始化 UI（Canvas 渲染与点击/悬停）
 *   3. 绑定模式/难度/规则下拉框与按钮事件
 */
(function () {
  'use strict';

  const Gomoku = window.Gomoku;
  const Model = Gomoku.Model;
  const Rules = Gomoku.Rules;
  const Game = Gomoku.Game;
  const UI = Gomoku.UI;

  // ---------- 获取 DOM 元素 ----------
  const canvas = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const moveListEl = document.getElementById('moveList');
  const modeSel = document.getElementById('mode');
  const difficultySel = document.getElementById('difficulty');
  const ruleSel = document.getElementById('rule');
  const ruleHint = document.getElementById('ruleHint');
  const btnRestart = document.getElementById('btn-restart');
  const btnUndo = document.getElementById('btn-undo');
  const btnSave = document.getElementById('btn-save');
  const btnLoad = document.getElementById('btn-load');
  const toastEl = document.getElementById('toast');

  // ---------- Toast 提示 ----------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------- 创建对局实例 ----------
  const game = new Game({
    onStateChange: (state) => UI.render(state),
    onMessage: showToast,
  });

  // ---------- 初始化 UI ----------
  UI.init(canvas, {
    onCellClick: (r, c) => game.handleCellClick(r, c),
    statusEl: statusEl,
    moveListEl: moveListEl,
  });

  // 初始渲染
  UI.render(game.getState());

  // ---------- 设置项变更 ----------
  modeSel.addEventListener('change', () => {
    game.setMode(modeSel.value);
    difficultySel.disabled = modeSel.value !== 'pve';
  });

  difficultySel.addEventListener('change', () => {
    game.setDifficulty(difficultySel.value);
  });

  ruleSel.addEventListener('change', () => {
    game.setRule(ruleSel.value);
    // 更新规则说明
    if (ruleSel.value === 'renju') {
      ruleHint.textContent =
        'Renju：黑方禁手（三三/双四/长连），成五优先；白方连五（含长连）为胜。';
    } else {
      ruleHint.textContent = '自由规则：任意方向连五（含长连）即胜。';
    }
  });

  // ---------- 操作按钮 ----------
  btnRestart.addEventListener('click', () => game.newGame());
  btnUndo.addEventListener('click', () => game.undo());
  btnSave.addEventListener('click', () => game.save());
  btnLoad.addEventListener('click', () => game.load());
})();
