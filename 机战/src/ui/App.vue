<script setup lang="ts">
/**
 * UI 根组件（require.md 二/九）
 * Phaser 画布之上叠加的 Vue 遮罩层：菜单 / 暂停 / 结算。
 * 游戏内 HUD 由 Phaser Text/Graphics 绘制（低 DOM 开销）。
 */
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { bus } from '../game/systems/EventBus'
import { sfx } from '../game/systems/Sfx'
import MenuOverlay from './components/MenuOverlay.vue'
import PauseOverlay from './components/PauseOverlay.vue'
import GameOverOverlay from './components/GameOverOverlay.vue'

const store = useGameStore()

const overlay = computed(() => store.screen)

function uiEvent(name: string): void {
  sfx.unlock()
  bus.emit(name)
}

function toggleSound(): void {
  const on = !store.settings.sfx
  store.settings.sfx = on
  sfx.setSfx(on)
  bus.emit('ui:persist')
}
function toggleBgm(): void {
  const on = !store.settings.bgm
  store.settings.bgm = on
  sfx.setBgm(on)
  bus.emit('ui:persist')
}
</script>

<template>
  <div class="ui-root">
    <!-- 开始菜单 -->
    <MenuOverlay v-if="overlay === 'menu'" :high-score="store.highScore" @start="uiEvent('ui:start')" />

    <!-- 暂停 -->
    <PauseOverlay
      v-else-if="overlay === 'paused'"
      @resume="uiEvent('ui:resume')"
      @restart="uiEvent('ui:restart')"
      @quit="uiEvent('ui:quit')"
    />

    <!-- 结算 -->
    <GameOverOverlay
      v-else-if="overlay === 'gameover'"
      :score="store.score"
      :high-score="store.highScore"
      :new-record="store.isNewRecord"
      @retry="uiEvent('ui:retry')"
      @menu="uiEvent('ui:quit')"
    />

    <!-- 右上角音频开关（任何界面可见） -->
    <div class="sound-switch" v-if="overlay !== 'menu'">
      <button class="sound-btn" :class="{ off: !store.settings.bgm }" title="背景音乐" @click="toggleBgm">♪</button>
      <button class="sound-btn" :class="{ off: !store.settings.sfx }" title="音效" @click="toggleSound">🔊</button>
    </div>
  </div>
</template>

<style scoped>
.ui-root {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sound-switch {
  position: absolute;
  top: 12px;
  right: 14px;
  display: flex;
  gap: 8px;
  pointer-events: auto;
}
.sound-btn {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(10, 16, 32, 0.6);
  color: #7ef0ff;
  font-size: 15px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}
.sound-btn:hover {
  transform: scale(1.08);
}
.sound-btn.off {
  opacity: 0.35;
  text-decoration: line-through;
}
</style>
