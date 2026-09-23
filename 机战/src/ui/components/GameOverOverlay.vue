<script setup lang="ts">
import { onMounted, ref } from 'vue'

/** 结算界面（require.md 九：分数滚动动画 / RETRY / MENU） */
const props = defineProps<{
  score: number
  highScore: number
  newRecord: boolean
}>()
defineEmits<{ (e: 'retry'): void; (e: 'menu'): void }>()

const shown = ref(0)

// 结算动画：分数滚动（require.md 九）
onMounted(() => {
  const target = props.score
  const dur = 900
  const t0 = performance.now()
  const step = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur)
    shown.value = Math.round(target * (1 - Math.pow(1 - k, 3)))
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
})
</script>

<template>
  <div class="over-overlay">
    <div class="over-card">
      <h2 :class="{ record: newRecord }">{{ newRecord ? '🏆 新纪录！' : '游戏结束' }}</h2>
      <div class="score-line">
        <span>本局得分</span>
        <b>{{ shown.toLocaleString() }}</b>
      </div>
      <div class="best-line">
        <span>历史最高</span>
        <b>{{ Math.max(highScore, score).toLocaleString() }}</b>
      </div>
      <div class="btns">
        <button class="o-btn primary" @click="$emit('retry')">RETRY</button>
        <button class="o-btn" @click="$emit('menu')">MAIN MENU</button>
      </div>
      <p class="tip">按 Enter 重新出击</p>
    </div>
  </div>
</template>

<style scoped>
.over-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(600px 400px at 50% 40%, rgba(244, 114, 182, 0.10), rgba(5, 7, 15, 0.88));
  pointer-events: auto;
}
.over-card { text-align: center; min-width: 320px; }
h2 {
  font-size: 26px;
  letter-spacing: 6px;
  margin-bottom: 26px;
  color: #ff8a9e;
}
h2.record { color: #ffd54f; text-shadow: 0 0 24px rgba(255, 213, 79, 0.6); }

.score-line, .best-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 260px;
  margin: 0 auto 12px;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
}
.score-line b, .best-line b {
  font-size: 24px;
  font-family: Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.score-line span, .best-line span { font-size: 12.5px; color: #9aa5c0; }
.score-line b { color: #7ef0ff; }
.best-line b { color: #ffd54f; font-size: 18px; }

.btns { margin-top: 26px; display: flex; gap: 12px; justify-content: center; }
.o-btn {
  padding: 11px 30px;
  font-size: 14px;
  letter-spacing: 3px;
  color: #eef2ff;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.o-btn:hover { background: rgba(255, 255, 255, 0.14); transform: scale(1.04); }
.o-btn.primary {
  background: linear-gradient(145deg, #0ea5e9, #8b5cf6);
  border: none;
  font-weight: bold;
}
.tip { margin-top: 18px; font-size: 11.5px; color: #5d6784; }
</style>
