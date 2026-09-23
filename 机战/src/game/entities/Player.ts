import Phaser from 'phaser'
import { PLAYER, GAME_WIDTH, GAME_HEIGHT } from '../config/constants'
import { bus, EVENT } from '../systems/EventBus'

/**
 * 玩家战机（require.md 五）
 * - setVelocity 移动 + setDrag 摩擦 + 世界边界
 * - 火力 5 级弹幕 / 炸弹清屏 / 无敌闪烁 / 引擎尾焰
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  hp = PLAYER.MAX_HP
  maxHp = PLAYER.MAX_HP
  fireLevel = 1
  bombs = PLAYER.MAX_BOMB
  fireTimer = 0
  invincibleUntil = 0
  private blinkTween?: Phaser.Tweens.Tween
  private flame?: Phaser.GameObjects.Particles.ParticleEmitter

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player')
    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setDepth(20)
    this.setCollideWorldBounds(true)
    this.body!.setSize(34, 40)
    this.setDrag(PLAYER.DRAG, PLAYER.DRAG)
    this.setMaxVelocity(PLAYER.SPEED * 1.4, PLAYER.SPEED * 1.4)
    this.setInvincible(PLAYER.INVINCIBLE_MS)

    // 引擎尾焰粒子（require.md 五 视觉反馈）
    this.flame = scene.add
      .particles(x, y + 24, 'particle', {
        lifespan: 220,
        speedY: { min: 160, max: 260 },
        scale: { start: 0.55, end: 0 },
        tint: [0x7ef0ff, 0x0ea5e9, 0xffffff],
        blendMode: 'ADD',
        frequency: 28,
      })
      .setDepth(19)
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta)
    this.flame?.setPosition(this.x, this.y + 24)
  }

  /** 键盘方向输入（速度模式，急停由 drag 保证） */
  moveByKeys(keys: {
    left: boolean
    right: boolean
    up: boolean
    down: boolean
  }): void {
    let vx = 0
    let vy = 0
    if (keys.left) vx -= 1
    if (keys.right) vx += 1
    if (keys.up) vy -= 1
    if (keys.down) vy += 1
    const len = Math.hypot(vx, vy) || 1
    this.setVelocity((vx / len) * PLAYER.SPEED, (vy / len) * PLAYER.SPEED)
  }

  /** 触摸跟随（require.md 十三 方案 B：平滑跟随，松开急停） */
  followPointer(tx: number, ty: number): void {
    const dx = tx - this.x
    const dy = ty - this.y
    const d = Math.hypot(dx, dy)
    const dead = 6
    if (d < dead) {
      this.setVelocity(0, 0)
      return
    }
    const s = Math.min(1, d / 80)
    this.setVelocity((dx / d) * PLAYER.SPEED * s, (dy / d) * PLAYER.SPEED * s)
  }

  stop(): this {
    this.setVelocity(0, 0)
    return this
  }

  isInvincible(time: number): boolean {
    return time < this.invincibleUntil
  }

  setInvincible(ms: number): void {
    this.invincibleUntil = this.scene.time.now + ms
    this.blinkTween?.stop()
    this.setAlpha(1)
    if (ms > 0) {
      this.blinkTween = this.scene.tweens.add({
        targets: this,
        alpha: 0.25,
        duration: 100,
        yoyo: true,
        repeat: Math.floor(ms / 100),
        onComplete: () => this.setAlpha(1),
      })
    }
  }

  /**
   * 按火力等级生成弹幕（require.md 五 射击升级逻辑）
   * @returns 生成的子弹参数列表，由 MainScene 通过对象池实例化
   */
  firePattern(): Array<{ dx: number; dy: number; vx: number; vy: number; damage: number; laser?: boolean }> {
    const S = 640
    const out: Array<{ dx: number; dy: number; vx: number; vy: number; damage: number; laser?: boolean }> = []
    const add = (dx: number, vx: number, vy: number, damage = 1, laser = false) =>
      out.push({ dx, dy: -18, vx, vy: -vy, damage, laser })

    switch (this.fireLevel) {
      case 1:
        add(0, 0, S, 1)
        break
      case 2:
        add(-11, 0, S, 1)
        add(11, 0, S, 1)
        break
      case 3:
        add(0, 0, S, 1)
        add(-13, -110, S * 0.92, 1)
        add(13, 110, S * 0.92, 1)
        break
      case 4:
        add(-7, 0, S, 1)
        add(7, 0, S, 1)
        add(-20, -150, S * 0.85, 1)      // 侧翼追踪弹标记（由场景做追踪）
        add(20, 150, S * 0.85, 1)
        break
      case 5:
      default:
        add(0, 0, S * 1.15, 2, true)     // 中央激光炮
        add(-16, 0, S, 1)
        add(16, 0, S, 1)
        add(-26, -170, S * 0.85, 1)
        add(26, 170, S * 0.85, 1)
        break
    }
    return out
  }

  /** 使用炸弹：全屏清弹并对所有敌机造成伤害 */
  useBomb(): boolean {
    if (this.bombs <= 0) return false
    this.bombs--
    bus.emit(EVENT.HP_UPDATE, this)
    return true
  }

  takeDamage(dmg: number, time: number): boolean {
    if (this.isInvincible(time)) return false
    this.hp = Math.max(0, this.hp - dmg)
    bus.emit(EVENT.HP_UPDATE, this)
    if (this.hp <= 0) {
      bus.emit(EVENT.PLAYER_DIE)
      return true
    }
    this.setInvincible(1000)
    return false
  }

  /** 回血（Boss 击破奖励） */
  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount)
    bus.emit(EVENT.HP_UPDATE, this)
  }

  /** 触摸跟随的边界 clamp */
  clampToScreen(): void {
    this.x = Phaser.Math.Clamp(this.x, 20, GAME_WIDTH - 20)
    this.y = Phaser.Math.Clamp(this.y, 40, GAME_HEIGHT - 30)
  }

  destroy(fromScene?: boolean): void {
    this.flame?.destroy()
    this.blinkTween?.remove()
    super.destroy(fromScene)
  }
}

/** 引用常量，避免 tree-shaking 移除（GAME_WIDTH/HEIGHT 供场景使用） */
export const SCREEN = { W: GAME_WIDTH, H: GAME_HEIGHT }
