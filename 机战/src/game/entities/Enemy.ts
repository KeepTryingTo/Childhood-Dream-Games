import Phaser from 'phaser'
import { ENEMIES, EnemyKind, difficultyOf, DIFFICULTIES, DifficultyKind } from '../config/constants'

export interface EnemySpec {
  kind: EnemyKind
  hp: number
  maxHp: number
  speed: number
  score: number
  radius: number
  fireMs: number
}

/**
 * 敌机（require.md 六）
 * 行为：scout 直线 / fighter 正弦 / bomber 缓慢下压扇形弹 / interceptor Z 字 / boss 多阶段
 * 所有普通敌机均持续向下推进攻击玩家；难度模式 + 分数双重成长。
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  kind: EnemyKind = 'scout'
  hp = 1
  maxHp = 1
  speed = 100
  scoreValue = 10
  radius = 14
  fireMs = 0
  fireTimer = 0
  phaseTimer = 0
  phaseDir = 1
  baseX = 0
  entered = false          // Boss 入场完成标记
  phase = 1                // Boss 阶段 1~3
  spiralAngle = 0
  difficulty = 1

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture)
    scene.add.existing(this)
    scene.physics.add.existing(this)
  }

  /** 从类型配置 + 分数难度 + 模式难度初始化 */
  setup(kind: EnemyKind, score: number, mode: DifficultyKind = 'normal'): this {
    const cfg = ENEMIES[kind]
    const dm = DIFFICULTIES[mode]
    this.kind = kind
    this.difficulty = difficultyOf(score)
    const hpMul = (kind === 'boss' ? 1 + (score / 20000) : this.difficulty) * dm.enemyHpMul

    this.hp = Math.max(1, Math.round(cfg.hp * hpMul))
    this.maxHp = this.hp
    this.speed = cfg.speed * (kind === 'boss' ? 1 : Math.min(1.8, this.difficulty)) * dm.enemySpeedMul
    this.scoreValue = cfg.score
    this.radius = cfg.radius
    this.fireMs = cfg.fireMs ? (cfg.fireMs / Math.min(2, this.difficulty)) * dm.enemyFireMul : 0
    this.fireTimer = kind === 'bomber' ? 1200 : this.fireMs ? this.fireMs * 0.6 : 0
    this.phaseTimer = 0
    this.phaseDir = Math.random() < 0.5 ? -1 : 1
    this.baseX = this.x
    this.entered = false
    this.phase = 1
    this.spiralAngle = 0
    this.body!.setSize(cfg.radius * 1.6, cfg.radius * 1.6)
    return this
  }

  /** 敌机行为状态机：全部向下推进攻击玩家（require.md 六） */
  update(time: number, delta: number, playerPos: Phaser.Math.Vector2): void {
    const dt = delta / 1000

    if (this.kind === 'boss') {
      this.updateBoss(time, delta, playerPos)
      return
    }

    switch (this.kind) {
      case 'scout': {
        // 直线下坠 + 轻微摆动
        this.y += this.speed * dt
        this.x = this.baseX + Math.sin(time / 700 + this.baseX) * 14
        break
      }
      case 'fighter': {
        // 持续下压 + 正弦波摇摆
        this.y += this.speed * dt
        this.x = this.baseX + Math.sin(time / 420 + this.baseX) * 70
        break
      }
      case 'bomber': {
        // 缓慢持续推进，边压进边周期扇形弹
        this.y += this.speed * dt
        break
      }
      case 'interceptor': {
        // Z 字形折返：每 1s 变向，速度快，持续向下
        this.phaseTimer -= delta
        if (this.phaseTimer <= 0) {
          this.phaseTimer = 1000
          this.phaseDir *= -1
          this.baseX = this.x
        }
        this.y += this.speed * dt * 0.55
        this.x = Phaser.Math.Clamp(
          this.baseX + this.phaseDir * Math.min(this.speed * (1000 - this.phaseTimer) / 1000, 90),
          20,
          460,
        )
        break
      }
    }

    // 出界回收（底部）
    if (this.y > 780) this.setActive(false).setVisible(false)

    // 普通敌机开火
    if (this.fireMs > 0 && this.y > 40 && this.y < 620) {
      this.fireTimer -= delta
    }
  }

  private updateBoss(time: number, delta: number, playerPos: Phaser.Math.Vector2): void {
    const dt = delta / 1000

    if (!this.entered) {
      // 入场：滑入到悬停位
      this.y += 90 * dt
      if (this.y >= 130) {
        this.y = 130
        this.entered = true
      }
      return
    }

    // 悬停左右漂移
    this.x = 240 + Math.sin(time / 1600) * 130

    // 阶段切换（require.md 十：HP 阈值触发，重置攻击计时器）
    const ratio = this.hp / this.maxHp
    const newPhase = ratio > 0.6 ? 1 : ratio > 0.3 ? 2 : 3
    if (newPhase !== this.phase) {
      this.phase = newPhase
      this.fireTimer = 0
    }

    this.fireTimer -= delta
    this.spiralAngle += dt * 3.4

    // 记录玩家位置供场景生成瞄准弹
    ;(this as any)._playerPos = playerPos
    void time
  }

  takeDamage(dmg: number): boolean {
    this.hp -= dmg
    // 受击白闪
    this.setTintFill(0xffffff)
    this.scene.time.delayedCall(40, () => {
      if (this.active) this.clearTint()
    })
    if (this.hp <= 0) {
      this.die()
      return true
    }
    return false
  }

  die(): void {
    this.setActive(false)
    this.setVisible(false)
    this.body?.stop()
  }
}
