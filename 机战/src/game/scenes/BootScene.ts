import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants'

/**
 * BootScene（require.md 三 Preloader）
 * 采用程序化纹理生成（Graphics/Canvas → generateTexture），
 * 免去外部图片资源依赖，开箱即跑；后续可无缝替换为 TexturePacker 图集。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    this.makeTextures()
    this.scene.start('Main')   // 菜单由 Vue 层承担，游戏直接就绪
    this.events.emit('ready')
  }

  private makeTextures(): void {
    const g = this.add.graphics()

    // ---- 玩家战机（青色三角战机）----
    g.fillStyle(0x0e2a3f, 1)
    g.fillTriangle(0, 26, 24, 26, 12, 0)
    g.fillStyle(0x0ea5e9, 1)
    g.fillTriangle(4, 24, 20, 24, 12, 4)
    g.fillStyle(0xbdf3ff, 1)
    g.fillTriangle(9, 14, 15, 14, 12, 6)
    g.fillStyle(0x0b7ea8, 1)
    g.fillRect(3, 20, 6, 6)
    g.fillRect(15, 20, 6, 6)
    g.generateTexture('player', 24, 28)
    g.clear()

    // ---- 通用敌机底图（圆形机身，tint 区分类型）----
    const mkEnemy = (key: string, size: number, body: number, edge: number): void => {
      g.fillStyle(edge, 1)
      g.fillCircle(size / 2, size / 2, size / 2 - 1)
      g.fillStyle(body, 1)
      g.fillCircle(size / 2, size / 2, size / 2 - 4)
      g.fillStyle(0xffffff, 0.85)
      g.fillCircle(size / 2, size / 2 - size * 0.16, size / 6)
      g.generateTexture(key, size, size)
      g.clear()
    }
    mkEnemy('enemy-scout', 28, 0x0c6d80, 0x7ef0ff)
    mkEnemy('enemy-fighter', 32, 0x1d6b35, 0x7dff9e)
    mkEnemy('enemy-bomber', 46, 0x8a5317, 0xffb15e)
    mkEnemy('enemy-interceptor', 28, 0x7a2a63, 0xff8ad8)

    // ---- Boss 母舰 ----
    g.fillStyle(0x5e1a24, 1)
    g.fillRoundedRect(4, 14, 116, 44, 12)
    g.fillStyle(0xff5e6c, 1)
    g.fillRoundedRect(10, 22, 104, 28, 10)
    g.fillStyle(0xffd1d5, 1)
    g.fillCircle(34, 36, 8)
    g.fillCircle(62, 36, 8)
    g.fillCircle(90, 36, 8)
    g.fillStyle(0x2a0b10, 1)
    g.fillRect(18, 6, 20, 10)
    g.fillRect(86, 6, 20, 10)
    g.generateTexture('enemy-boss', 124, 62)
    g.clear()

    // ---- 子弹 ----
    g.fillStyle(0xbdf3ff, 1)
    g.fillRoundedRect(2, 0, 6, 16, 3)
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(3.5, 2, 3, 9, 1.5)
    g.generateTexture('bullet-player', 10, 16)
    g.clear()

    g.fillStyle(0xff5ec7, 1)
    g.fillCircle(6, 6, 5)
    g.fillStyle(0xffe1f4, 1)
    g.fillCircle(6, 6, 2.4)
    g.generateTexture('bullet-enemy', 12, 12)
    g.clear()

    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(3, 0, 8, 26, 4)
    g.generateTexture('bullet-laser', 14, 26)
    g.clear()

    // ---- 粒子 ----
    g.fillStyle(0xffffff, 1)
    g.fillCircle(4, 4, 4)
    g.generateTexture('particle', 8, 8)
    g.clear()

    // ---- 星空背景（三层视差 tile 纹理）----
    const starLayers = [
      { key: 'stars-1', count: 42, size: 480, h: 720, alpha: 0.35, smin: 1, smax: 2 },
      { key: 'stars-2', count: 30, size: 480, h: 720, alpha: 0.6, smin: 1, smax: 3 },
      { key: 'stars-3', count: 18, size: 480, h: 720, alpha: 0.95, smin: 2, smax: 4 },
    ]
    for (const layer of starLayers) {
      const canvasTex = this.textures.createCanvas(layer.key, layer.size, layer.h)
      const c = canvasTex!.getContext()!
      c.clearRect(0, 0, layer.size, layer.h)
      for (let i = 0; i < layer.count; i++) {
        const x = Math.random() * layer.size
        const y = Math.random() * layer.h
        const s = layer.smin + Math.random() * (layer.smax - layer.smin)
        const a = 0.4 + Math.random() * 0.6
        c.fillStyle = `rgba(255,255,255,${a})`
        c.fillRect(x, y, s, s)
      }
      canvasTex!.refresh()
    }

    g.destroy()
    void GAME_WIDTH
    void GAME_HEIGHT
  }
}
