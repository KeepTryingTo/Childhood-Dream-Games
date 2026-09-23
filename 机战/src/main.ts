import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './ui/App.vue'
import { createGame } from './game/Game'
import { bus } from './game/systems/EventBus'
import { sfx } from './game/systems/Sfx'
import { useGameStore } from './stores/game'
import './style.css'

// ---- Vue UI 层（菜单 / 暂停 / 结算遮罩）----
const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#ui-layer')

// ---- Phaser 游戏层（挂载 #game-container）----
createGame()

// ---- 音效设置同步（require.md 八/十一：静音状态存 LocalStorage）----
const store = useGameStore(pinia)
sfx.setSfx(store.settings.sfx)
sfx.setBgm(store.settings.bgm)

// ---- 全局键盘：Enter 开始/重试，P 暂停，B 炸弹 ----
window.addEventListener('keydown', (e) => {
  sfx.unlock()

  if (e.code === 'Enter') {
    if (store.screen === 'menu') bus.emit('ui:start')
    else if (store.screen === 'gameover') bus.emit('ui:retry')
  } else if (e.code === 'KeyP') {
    if (store.screen === 'playing') bus.emit('ui:pause')
    else if (store.screen === 'paused') bus.emit('ui:resume')
  } else if (e.code === 'KeyB') {
    if (store.screen === 'playing') bus.emit('ui:bomb')
  }
})

// ---- 首次任意手势解锁 Web Audio（自动播放策略，require.md 3.1）----
window.addEventListener('pointerdown', () => sfx.unlock())

// ---- 移动端防浏览器手势冲突（require.md 十三）----
document.body.style.touchAction = 'none'
