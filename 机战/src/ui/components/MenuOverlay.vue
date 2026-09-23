<script setup lang="ts">
/** 开始菜单（require.md 九：标题光效 / START / 最高分 / 难度选择 / 操作说明） */
import { computed } from 'vue'
import { useGameStore } from '../../stores/game'
import { DIFFICULTIES, DifficultyKind } from '../../game/config/constants'

defineProps<{ highScore: number }>()
defineEmits<{ (e: 'start'): void }>()

const store = useGameStore()
const difficulty = computed(() => store.difficulty)
const options: Array<{ value: DifficultyKind; label: string; desc: string }> = [
  { value: 'easy', label: '简单', desc: '敌机较弱 · 节奏舒缓' },
  { value: 'normal', label: '中等', desc: '标准强度 · 均衡体验' },
  { value: 'hard', label: '困难', desc: '弹幕密集 · 得分 ×1.5' },
]
</script>

<template>
  <div class="menu-overlay">
    <div class="menu-card">
      <h1 class="title">
        <span class="glow">机战</span>
        <small>MECHWARFARE</small>
      </h1>
      <p class="subtitle">纵向卷轴弹幕射击 · 击毁敌机 · 挑战 Boss</p>

      <div class="diff-box">
        <p class="diff-title">难度选择</p>
        <div class="diff-options">
          <button
            v-for="opt in options"
            :key="opt.value"
            class="diff-btn"
            :class="{ active: difficulty === opt.value, [opt.value]: true }"
            @click="store.setDifficulty(opt.value)"
          >
            <b>{{ opt.label }}</b>
            <i>{{ opt.desc }}</i>
          </button>
        </div>
      </div>

      <button class="start-btn" @click="$emit('start')">
        START GAME
        <em>回车 / 点击开始</em>
      </button>

      <div class="best-row">
        历史最高分：<b>{{ highScore }}</b>
      </div>

      <div class="keys">
        <p>移动：WASD / 方向键　　射击：空格 / J（按住）</p>
        <p>炸弹：B　　暂停：P</p>
        <p class="hint">游戏中左侧常驻按键指南，随时查看</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(700px 420px at 50% 30%, rgba(14, 165, 233, 0.12), rgba(5, 7, 15, 0.88));
  pointer-events: auto;
}
.menu-card { text-align: center; padding: 24px; max-width: 440px; }
.title {
  font-size: 64px;
  letter-spacing: 18px;
  margin-left: 18px;
  font-family: KaiTi, STKaiti, serif;
}
.title .glow {
  background: linear-gradient(90deg, #7ef0ff, #8b5cf6 55%, #f472b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(139, 92, 246, 0.65));
  animation: breath 2.6s ease-in-out infinite;
}
@keyframes breath {
  0%, 100% { filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.4)); }
  50% { filter: drop-shadow(0 0 26px rgba(14, 165, 233, 0.85)); }
}
.title small {
  display: block;
  font-size: 13px;
  letter-spacing: 8px;
  color: #5d6784;
  margin-top: 2px;
  font-family: Consolas, monospace;
}
.subtitle { color: #9aa5c0; font-size: 12.5px; margin: 14px 0 22px; line-height: 1.7; }

.diff-box { margin: 0 auto 26px; max-width: 340px; }
.diff-title {
  color: #7ef0ff;
  font-size: 12px;
  letter-spacing: 4px;
  margin: 0 0 10px;
}
.diff-options { display: flex; gap: 10px; }
.diff-btn {
  flex: 1;
  padding: 10px 4px 8px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(10, 16, 32, 0.55);
  color: #9aa5c0;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.2s, box-shadow 0.2s, color 0.2s;
}
.diff-btn:hover { transform: translateY(-2px); }
.diff-btn b { display: block; font-size: 15px; letter-spacing: 2px; }
.diff-btn i { display: block; font-style: normal; font-size: 10px; margin-top: 4px; opacity: 0.75; }
.diff-btn.active { color: #eaf7ff; }
.diff-btn.active.easy {
  border-color: #69f0ae;
  box-shadow: 0 0 16px rgba(105, 240, 174, 0.35), inset 0 0 12px rgba(105, 240, 174, 0.12);
}
.diff-btn.active.normal {
  border-color: #7ef0ff;
  box-shadow: 0 0 16px rgba(126, 240, 255, 0.35), inset 0 0 12px rgba(126, 240, 255, 0.12);
}
.diff-btn.active.hard {
  border-color: #ff8a80;
  box-shadow: 0 0 16px rgba(255, 138, 128, 0.4), inset 0 0 12px rgba(255, 138, 128, 0.14);
}

.start-btn {
  display: block;
  width: 240px;
  margin: 0 auto;
  padding: 14px 0 12px;
  font-size: 18px;
  letter-spacing: 5px;
  font-weight: bold;
  color: #04101c;
  background: linear-gradient(145deg, #7ef0ff, #0ea5e9 60%, #8b5cf6);
  border: none;
  border-radius: 30px;
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(14, 165, 233, 0.45);
  transition: transform 0.12s, box-shadow 0.2s;
}
.start-btn:hover { transform: scale(1.05); box-shadow: 0 14px 36px rgba(139, 92, 246, 0.55); }
.start-btn:active { transform: scale(0.97); }
.start-btn em {
  display: block;
  font-style: normal;
  font-size: 10.5px;
  letter-spacing: 2px;
  opacity: 0.75;
  margin-top: 4px;
}

.best-row { margin-top: 22px; color: #9aa5c0; font-size: 14px; }
.best-row b { color: #ffd54f; font-size: 20px; font-variant-numeric: tabular-nums; }

.keys {
  margin-top: 26px;
  color: #5d6784;
  font-size: 11.5px;
  line-height: 2;
  border-top: 1px dashed rgba(255, 255, 255, 0.14);
  padding-top: 14px;
}
.keys .hint { color: #45507a; font-size: 10.5px; }
</style>
