import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from './config/constants'
import { BootScene } from './scenes/BootScene'
import { MainScene } from './scenes/MainScene'

/**
 * Phaser.Game 实例化（require.md 三/十三）
 * Scale.FIT + AUTO_CENTER 自适应；dpr>2 限制为 2 防止 4K 渲染爆炸。
 */
export function createGame(): Phaser.Game {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#05070f',
    pixelArt: true,            // 复古像素风（require.md 一）
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
    },
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
    scene: [BootScene, MainScene],
  })
}
