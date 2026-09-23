<script setup lang="ts">
/** 暂停界面（require.md 九：半透明遮罩 + 继续/重新开始/退出） */
defineEmits<{ (e: 'resume'): void; (e: 'restart'): void; (e: 'quit'): void }>()
</script>

<template>
  <div class="pause-overlay">
    <div class="pause-card">
      <h2>已暂停</h2>
      <button class="p-btn primary" @click="$emit('resume')">继续游戏</button>
      <button class="p-btn" @click="$emit('restart')">重新开始</button>
      <button class="p-btn" @click="$emit('quit')">退出到主菜单</button>
    </div>
  </div>
</template>

<style scoped>
.pause-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 7, 15, 0.66);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}
.pause-card { text-align: center; }
h2 {
  font-size: 30px;
  letter-spacing: 10px;
  margin-bottom: 28px;
  color: #7ef0ff;
  text-shadow: 0 0 18px rgba(14, 165, 233, 0.6);
}
.p-btn {
  display: block;
  width: 210px;
  margin: 0 auto 12px;
  padding: 11px 0;
  font-size: 14.5px;
  letter-spacing: 3px;
  color: #eef2ff;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.p-btn:hover { background: rgba(255, 255, 255, 0.14); transform: scale(1.03); }
.p-btn.primary {
  background: linear-gradient(145deg, #0ea5e9, #8b5cf6);
  border: none;
  font-weight: bold;
}
</style>
