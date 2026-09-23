/* ============================================================
 * input.js —— 键盘输入处理（E6）与移动端触摸按钮（E7）
 * 浏览器专用 IIFE
 *
 * 键位：
 *   ←/A 左移   →/D 右移   ↑/W 顺时针旋转   Z 逆时针旋转（扩展）
 *   ↓/S 软降   空格 硬降   C Hold   P 暂停   R 重开
 * 输入防抖：旋转/Hold/硬降 忽略按键自动重复（e.repeat），
 *          左右/软降允许重复触发实现连续移动。
 * ============================================================ */
(function (window, document) {
  'use strict';

  function bindInput(handlers) {
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                t.tagName === 'SELECT' || t.isContentEditable)) return;

      switch (e.code) {
        case 'ArrowLeft': case 'KeyA':
          e.preventDefault(); handlers.left(); break;
        case 'ArrowRight': case 'KeyD':
          e.preventDefault(); handlers.right(); break;
        case 'ArrowDown': case 'KeyS':
          e.preventDefault(); handlers.softDrop(); break;
        case 'ArrowUp': case 'KeyW': case 'KeyX':
          e.preventDefault();
          if (!e.repeat) handlers.rotate(); break;
        case 'KeyZ':
          if (!e.repeat) handlers.rotateCCW(); break;
        case 'Space':
          e.preventDefault();
          if (!e.repeat) handlers.hardDrop(); break;
        case 'KeyC':
          if (!e.repeat) handlers.hold(); break;
        case 'KeyP':
          if (!e.repeat) handlers.pause(); break;
        case 'KeyR':
          if (!e.repeat) handlers.restart(); break;
      }
    });

    // ---- 移动端触摸按钮（E7）----
    function bindTouch(id, fn, allowRepeat) {
      var el = document.getElementById(id);
      if (!el) return;
      var timer = 0;
      el.addEventListener('touchstart', function (e) {
        e.preventDefault();
        fn();
        if (allowRepeat) {
          timer = setInterval(fn, 120);
        }
      }, { passive: false });
      var stop = function () { if (timer) { clearInterval(timer); timer = 0; } };
      el.addEventListener('touchend', stop);
      el.addEventListener('touchcancel', stop);
    }
    bindTouch('touch-left', handlers.left, true);
    bindTouch('touch-right', handlers.right, true);
    bindTouch('touch-rotate', handlers.rotate, false);
    bindTouch('touch-down', handlers.softDrop, true);
    bindTouch('touch-drop', handlers.hardDrop, false);
    bindTouch('touch-hold', handlers.hold, false);
  }

  window.TetrisInput = { bindInput: bindInput };
})(window, document);
