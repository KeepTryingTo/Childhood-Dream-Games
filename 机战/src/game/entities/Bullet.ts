import Phaser from 'phaser'

/**
 * 子弹（require.md 四：轻量级 Image 实体，配合对象池）
 * isPlayer 区分阵营；damage 供碰撞回调结算。
 */
export class Bullet extends Phaser.Physics.Arcade.Image {
  isPlayer = true
  damage = 1
  homing = false
  private homingTarget: Phaser.Physics.Arcade.Sprite | null = null
  private speed = 640

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture)
  }

  fire(x: number, y: number, vx: number, vy: number, damage: number, isPlayer: boolean): void {
    this.enableBody(true, x, y, true, true)
    this.setVelocity(vx, vy)
    this.damage = damage
    this.isPlayer = isPlayer
    this.homing = false
    this.setActive(true).setVisible(true)
  }

  /** Lv4 侧翼追踪弹：每帧微调方向朝最近敌机 */
  setHoming(target: Phaser.Physics.Arcade.Sprite | null): void {
    this.homing = true
    this.homingTarget = target
  }

  preUpdate(): void {
    if (!this.active) return
    // 出界回收（require.md 五：y < -50 自动回收）
    const out = this.y < -40 || this.y > 760 || this.x < -30 || this.x > 510
    if (out) {
      this.recycle()
      return
    }
    if (this.homing && this.homingTarget && this.homingTarget.active) {
      this.scene.physics.moveToObject(this, this.homingTarget, this.speed)
    }
  }

  recycle(): void {
    this.setActive(false)
    this.setVisible(false)
    this.body?.stop()
  }
}
