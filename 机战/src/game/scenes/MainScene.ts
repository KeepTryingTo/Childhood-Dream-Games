import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, BG_LAYERS, PLAYER, EnemyKind, WAVE_LOOP_SECONDS, DIFFICULTIES, FIRE_LEVEL_SCORES } from '../config/constants'
import { bus, EVENT } from '../systems/EventBus'
import { sfx } from '../systems/Sfx'
import { Spawner } from '../systems/Spawner'
import { Player } from '../entities/Player'
import { Enemy } from '../entities/Enemy'
import { Bullet } from '../entities/Bullet'
import { useGameStore } from '../../stores/game'

const PLAYER_BULLET_MAX = 120
const ENEMY_BULLET_MAX = 160
const ENEMY_MAX = 48

/**
 * 主战斗场景（require.md 四/五/六/七/八/十）
 */
export class MainScene extends Phaser.Scene {
  /** 下一次场景创建的模式：menu=进菜单，play=直接开战（重试用） */
  static nextMode: 'menu' | 'play' = 'menu'

  private player!: Player
  private playerBullets!: Phaser.Physics.Arcade.Group
  private enemyBullets!: Phaser.Physics.Arcade.Group
  private enemies!: Phaser.Physics.Arcade.Group
  private spawner!: Spawner
  private store = useGameStore()

  private bg: Phaser.GameObjects.TileSprite[] = []
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private scoreText!: Phaser.GameObjects.Text
  private hpBar!: Phaser.GameObjects.Graphics
  private bombText!: Phaser.GameObjects.Text
  private waveText!: Phaser.GameObjects.Text
  private controlsPanel!: Phaser.GameObjects.Graphics
  private controlsText!: Phaser.GameObjects.Text
  private boss: Enemy | null = null
  private bossBar!: Phaser.GameObjects.Graphics
  private ended = false
  private fireHeld = false

  constructor() {
    super('Main')
  }

  create(): void {
    this.ended = false
    this.boss = null
    this.store.resetRun()

    // 启动模式：默认进菜单；重试时由 restartRun 设为直接开战
    const playNow = MainScene.nextMode === 'play'
    MainScene.nextMode = 'menu'
    this.store.setScreen(playNow ? 'playing' : 'menu')

    // ---- 三层视差星空背景（require.md 一：Parallax Scrolling）----
    this.bg = [
      this.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'stars-1').setDepth(-30),
      this.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'stars-2').setDepth(-29),
      this.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'stars-3').setDepth(-28),
    ]

    // ---- 对象池分组（require.md 十二：子弹必须池化）----
    this.playerBullets = this.physics.add.group({ classType: Bullet, maxSize: PLAYER_BULLET_MAX })
    this.enemyBullets = this.physics.add.group({ classType: Bullet, maxSize: ENEMY_BULLET_MAX })
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: ENEMY_MAX })

    // ---- 玩家 ----
    this.player = new Player(this, GAME_WIDTH / 2, PLAYER.SPAWN_Y)

    // ---- 键盘（移动 / 射击 / 炸弹）----
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,B,J') as any
    this.input.keyboard!.on('keydown-B', () => this.triggerBomb())
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sfx.unlock()
      this.fireHeld = true
      this.player.followPointer(p.worldX, p.worldY)
      this.input.on('pointermove', this.onPointerMove, this)
    })
    this.input.on('pointerup', () => {
      this.fireHeld = false
      this.player.stop()
      this.input.off('pointermove', this.onPointerMove)
    })

    // ---- 波次生成器 ----
    this.spawner = new Spawner({
      spawnEnemy: (kind, x, y) => this.spawnEnemy(kind, x, y),
      spawnBoss: () => this.spawnBoss(),
      hasBossAlive: () => !!this.boss && this.boss.active,
      getScore: () => this.store.score,
      getDifficulty: () => this.store.difficulty,
      warnBoss: () => this.showWaveText('⚠ BOSS 来袭 ⚠', '#ff5e6c'),
    })

    // ---- 碰撞（require.md 四 分组 overlap）----
    this.physics.add.overlap(this.playerBullets, this.enemies, this.onBulletHitEnemy, undefined, this)
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHitEnemy, undefined, this)
    this.physics.add.overlap(this.player, this.enemyBullets, this.onPlayerHitBullet, undefined, this)

    // ---- HUD（require.md 九：游戏内 HUD 用 Phaser Text/Sprite）----
    this.scoreText = this.add
      .text(14, 10, 'SCORE 000000', {
        fontFamily: 'Consolas, monospace',
        fontSize: '18px',
        color: '#7ef0ff',
      })
      .setDepth(50)

    this.hpBar = this.add.graphics().setDepth(50)
    this.bombText = this.add
      .text(GAME_WIDTH - 14, GAME_HEIGHT - 16, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '14px',
        color: '#ffd54f',
      })
      .setOrigin(1, 1)
      .setDepth(50)

    this.bossBar = this.add.graphics().setDepth(50)

    this.waveText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '42px',
        color: '#ffffff',
        stroke: '#8b5cf6',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0)

    // ---- 左侧按键指南面板（随时可查看的操作说明）----
    this.controlsPanel = this.add.graphics().setDepth(45)
    const cpX = 10, cpY = 236, cpW = 176, cpH = 128
    this.controlsPanel.fillStyle(0x060a18, 0.55).fillRoundedRect(cpX, cpY, cpW, cpH, 10)
    this.controlsPanel.lineStyle(1, 0x7ef0ff, 0.3).strokeRoundedRect(cpX, cpY, cpW, cpH, 10)
    this.controlsText = this.add
      .text(cpX + 14, cpY + 12, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '12.5px',
        color: '#9fd8e8',
        lineSpacing: 7,
      })
      .setDepth(46)
    this.controlsText.setText(
      '[ 操作指南 ]\n' +
      '移动  ←↑↓→ / WASD\n' +
      '射击  空格 / J（按住）\n' +
      '炸弹  B\n' +
      '暂停  P',
    )
    this.setControlsVisible(false)

    // ---- 事件 ----
    bus.on(EVENT.PLAYER_DIE, this.onPlayerDie, this)

    // ---- Vue UI 层动作（require.md 二：通过事件总线解耦）----
    bus.on('ui:start', this.beginRun, this)
    bus.on('ui:retry', this.restartRun, this)
    bus.on('ui:pause', this.pauseRun, this)
    bus.on('ui:resume', this.resumeRun, this)
    bus.on('ui:quit', this.quitToMenu, this)
    bus.on('ui:bomb', this.triggerBomb, this)
    bus.on('ui:persist', () => this.store.persist(), this)

    this.events.once('shutdown', () => {
      bus.off(EVENT.PLAYER_DIE, this.onPlayerDie, this)
      bus.off('ui:start', this.beginRun, this)
      bus.off('ui:retry', this.restartRun, this)
      bus.off('ui:pause', this.pauseRun, this)
      bus.off('ui:resume', this.resumeRun, this)
      bus.off('ui:quit', this.quitToMenu, this)
      bus.off('ui:bomb', this.triggerBomb, this)
      this.input.off('pointermove', this.onPointerMove, this)
    })

    // ---- 开场提示 ----
    if (playNow) {
      this.showWaveText('WAVE 1', '#7ef0ff')
      this.setControlsVisible(true)
    }
    sfx.wave()
  }

  /** 从菜单开始一局 */
  private beginRun(): void {
    this.store.resetRun()
    this.store.setScreen('playing')
    this.spawner.reset()
    this.ended = false
    this.setControlsVisible(true)
    this.showWaveText('WAVE 1', '#7ef0ff')
    sfx.wave()
  }

  /** 左侧按键指南的显示 / 隐藏 */
  private setControlsVisible(visible: boolean): void {
    this.controlsPanel.setVisible(visible)
    this.controlsText.setVisible(visible)
  }

  /* ---------------- 输入 ---------------- */

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.store.screen !== 'playing') return
    this.player.followPointer(p.worldX, p.worldY)
    this.player.clampToScreen()
  }

  private playerInputVector(): { left: boolean; right: boolean; up: boolean; down: boolean } {
    const k = this.keys
    return {
      left: k.A.isDown || k.LEFT.isDown,
      right: k.D.isDown || k.RIGHT.isDown,
      up: k.W.isDown || k.UP.isDown,
      down: k.S.isDown || k.DOWN.isDown,
    }
  }

  /* ---------------- 主循环 ---------------- */

  update(time: number, delta: number): void {
    const dt = delta / 1000

    // 视差滚动（菜单/暂停/结算时保留背景动效）
    this.bg[0].tilePositionY -= BG_LAYERS[0].speed * dt
    this.bg[1].tilePositionY -= BG_LAYERS[1].speed * dt
    this.bg[2].tilePositionY -= BG_LAYERS[2].speed * dt

    if (this.store.screen !== 'playing' || this.ended) return

    // 玩家移动（触摸模式下由 pointermove 驱动）
    if (this.player.active) {
      if (!this.input.activePointer.isDown) {
        this.player.moveByKeys(this.playerInputVector())
      }
      this.player.clampToScreen()

      // 射击（空格/J 按住 / 鼠标触摸按住；冷却 require.md 五）
      if (this.keys.SPACE.isDown || this.keys.J.isDown || this.fireHeld) {
        this.tryFire(time)
      }
    }

    // 敌机更新与开火
    const playerPos = new Phaser.Math.Vector2(this.player.x, this.player.y)
    this.enemies.getChildren().forEach((obj) => {
      const e = obj as Enemy
      if (!e.active) return
      e.update(time, delta, playerPos)
      if (e.fireTimer <= 0 && e.fireMs > 0 && e.y > 20) {
        this.enemyFire(e)
        e.fireTimer = e.fireMs
      }
    })

    // 波次生成
    this.spawner.update(delta)

    // Boss 血条
    this.drawBossBar()
  }

  private tryFire(time: number): void {
    if (!this.player.active) return
    if (time - (this.player as any)._lastFire < PLAYER.FIRE_RATE) return
    ;(this.player as any)._lastFire = time

    const pattern = this.player.firePattern()
    for (const p of pattern) {
      const b = this.playerBullets.get(
        this.player.x + p.dx,
        this.player.y + p.dy,
        p.laser ? 'bullet-laser' : 'bullet-player',
      ) as Bullet | null
      if (!b) continue
      b.fire(this.player.x + p.dx, this.player.y + p.dy, p.vx, p.vy, p.damage, true)
      if (p.laser) b.setScale(1.1, 1.4)
      // Lv4 侧翼追踪弹：寻找最近敌机
      if (Math.abs(p.dx) >= 20) {
        b.setHoming(this.nearestEnemy(b.x, b.y))
      }
    }
    sfx.shoot()
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null
    let bestD = Infinity
    this.enemies.getChildren().forEach((obj) => {
      const e = obj as Enemy
      if (!e.active) return
      const d = (e.x - x) ** 2 + (e.y - y) ** 2   // 距离平方比较（require.md 十二）
      if (d < bestD) {
        bestD = d
        best = e
      }
    })
    return best
  }

  /* ---------------- 敌机生成 ---------------- */

  spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    if (this.store.screen !== 'playing') return
    const e = this.enemies.get(x, y, `enemy-${kind}`) as Enemy | null
    if (!e) return
    e.setup(kind, this.store.score, this.store.difficulty)
    e.setActive(true).setVisible(true)
    e.setDepth(10)
  }

  spawnBoss(): void {
    if (this.boss && this.boss.active) return
    this.boss = this.enemies.get(GAME_WIDTH / 2, -80, 'enemy-boss') as Enemy | null
    if (!this.boss) return
    this.boss.setup('boss', this.store.score, this.store.difficulty)
    this.boss.setActive(true).setVisible(true)
    this.boss.setDepth(15)
    this.store.bossVisible = true
    this.store.bossName = '旗舰 · 究极母舰'
    this.store.bossHpRatio = 1
  }

  /* ---------------- 敌方弹幕 ---------------- */

  private enemyFire(e: Enemy): void {
    const p = new Phaser.Math.Vector2(this.player.x, this.player.y)
    const m = DIFFICULTIES[this.store.difficulty].enemyBulletMul
    if (e.kind === 'bomber') {
      // 3 发扇形（require.md 六）
      for (const ang of [-0.35, 0, 0.35]) {
        this.fireEnemyBullet(e.x, e.y + 18, Math.sin(ang) * 240, Math.cos(ang) * 240 + 60)
      }
      sfx.enemyShoot()
    } else if (e.kind === 'fighter') {
      // 瞄准弹
      const aimed = this.fireEnemyBullet(e.x, e.y + 14, 0, 0)
      if (aimed) this.physics.moveTo(aimed, p.x, p.y, 300 * m)
      sfx.enemyShoot()
    } else if (e.kind === 'interceptor') {
      this.fireEnemyBullet(e.x, e.y + 14, 0, 340)
    }
  }

  private fireEnemyBullet(x: number, y: number, vx: number, vy: number): Bullet | null {
    const b = this.enemyBullets.get(x, y, 'bullet-enemy') as Bullet | null
    if (!b) return null
    const m = DIFFICULTIES[this.store.difficulty].enemyBulletMul
    b.fire(x, y, vx * m, vy * m, 12, false)
    return b
  }

  /* ---------------- Boss 多阶段弹幕（require.md 十） ---------------- */

  private bossFire(time: number): void {
    const boss = this.boss
    if (!boss || !boss.active || !boss.entered) return
    if (boss.fireTimer > 0) return
    const p = new Phaser.Math.Vector2(this.player.x, this.player.y)

    if (boss.phase === 1) {
      // 阶段一：周期瞄准三连
      boss.fireTimer = boss.fireMs
      for (const spread of [-0.16, 0, 0.16]) {
        const vx = Math.sin(spread) * 300
        const vy = Math.cos(spread) * 300
        const b = this.fireEnemyBullet(boss.x, boss.y + 30, vx + (p.x - boss.x) * 0.4, vy)
        void b
      }
      sfx.enemyShoot()
    } else if (boss.phase === 2) {
      // 阶段二：双向扇形 + 瞄准
      boss.fireTimer = boss.fireMs * 0.8
      for (let i = -3; i <= 3; i++) {
        const ang = Math.PI / 2 + i * 0.22
        this.fireEnemyBullet(boss.x, boss.y + 30, Math.cos(ang) * 260, Math.abs(Math.sin(ang)) * 260 + 40)
      }
      sfx.enemyShoot()
    } else {
      // 阶段三：螺旋弹幕 + 召唤侦察机
      boss.fireTimer = boss.fireMs * 0.5
      for (let i = 0; i < 6; i++) {
        const ang = boss.spiralAngle + (i / 6) * Math.PI * 2
        this.fireEnemyBullet(boss.x, boss.y + 30, Math.cos(ang) * 210, Math.abs(Math.sin(ang)) * 210 + 50)
      }
      if (Math.random() < 0.3) this.spawnEnemy('scout', boss.x + Phaser.Math.Between(-60, 60), boss.y)
      sfx.enemyShoot()
    }
  }

  /* ---------------- 碰撞回调 ---------------- */

  private onBulletHitEnemy = (bulletObj: any, enemyObj: any): void => {
    const bullet = bulletObj as Bullet
    const enemy = enemyObj as Enemy
    if (!bullet.active || !enemy.active) return
    bullet.recycle()
    sfx.hitEnemy()
    const killed = enemy.takeDamage(bullet.damage)
    if (killed) this.onEnemyKilled(enemy)
  }

  private onEnemyKilled(enemy: Enemy): void {
    const isBoss = enemy.kind === 'boss'
    this.spawnExplosion(enemy.x, enemy.y, isBoss ? 3 : enemy.radius > 20 ? 2 : 1)

    // 得分（按难度模式加成）
    const gained = Math.round(enemy.scoreValue * DIFFICULTIES[this.store.difficulty].scoreMul)
    this.store.score += gained
    bus.emit(EVENT.SCORE_UPDATE, this.store.score)

    // 火力随分数自动升级（道具已移除）；升级时补充一枚炸弹
    this.checkFireLevelUp()

    if (isBoss) {
      // Boss 击破奖励：回血 + 炸弹补满（替代道具系统的正反馈）
      this.player.heal(30)
      this.player.bombs = PLAYER.MAX_BOMB
      this.store.hp = this.player.hp
      this.store.bombs = this.player.bombs
      this.showToastText('Boss 击破！装甲修复 · 炸弹补满')
      this.store.bossVisible = false
      this.store.bossHpRatio = 0
      this.cameras.main.shake(400, 0.012)
      this.boss = null
    }
  }

  /** 分数达到阈值时自动提升火力（Lv1→Lv5） */
  private checkFireLevelUp(): void {
    const target = 1 + FIRE_LEVEL_SCORES.filter((t) => this.store.score >= t).length
    if (target > this.player.fireLevel) {
      this.player.fireLevel = Math.min(PLAYER.MAX_FIRE_LEVEL, target)
      if (this.player.bombs < PLAYER.MAX_BOMB) this.player.bombs++
      this.store.fireLevel = this.player.fireLevel
      this.store.bombs = this.player.bombs
      this.showToastText(`火力升级！Lv${this.player.fireLevel} · 炸弹 +1`)
      sfx.pickup()
    }
  }

  private onPlayerHitEnemy = (playerObj: any, enemyObj: any): void => {
    const enemy = enemyObj as Enemy
    const time = this.time.now
    if (!this.player.active) return
    const dmg = Math.max(1, Math.round(20 * DIFFICULTIES[this.store.difficulty].playerDamageMul))
    const died = this.player.takeDamage(dmg, time)
    this.store.hp = this.player.hp
    enemy.takeDamage(10)
    this.cameras.main.shake(120, 0.006)
    sfx.playerHit()
    if (died) this.onPlayerDie()
  }

  private onPlayerHitBullet = (playerObj: any, bulletObj: any): void => {
    const bullet = bulletObj as Bullet
    if (!bullet.active || !this.player.active) return
    bullet.recycle()
    const time = this.time.now
    const dmg = Math.max(1, Math.round(bullet.damage * DIFFICULTIES[this.store.difficulty].playerDamageMul))
    const died = this.player.takeDamage(dmg, time)
    this.store.hp = this.player.hp
    this.cameras.main.shake(100, 0.005)
    sfx.playerHit()
    if (died) this.onPlayerDie()
  }

  /* ---------------- 特效 ---------------- */

  /** 分级爆炸粒子（小敌机 5 / 大敌机 30 + 震动，require.md 八） */
  spawnExplosion(x: number, y: number, level: 1 | 2 | 3): void {
    const conf = {
      1: { count: 8, speed: 120, life: 420, scale: 0.8 },
      2: { count: 20, speed: 190, life: 560, scale: 1.1 },
      3: { count: 42, speed: 260, life: 760, scale: 1.5 },
    }[level]

    const emitter = this.add.particles(x, y, 'particle', {
      speed: { min: conf.speed * 0.4, max: conf.speed },
      scale: { start: conf.scale, end: 0 },
      lifespan: conf.life,
      quantity: conf.count,
      tint: level === 3 ? [0xffd54f, 0xff8a80, 0xffffff] : [0xffd54f, 0xff8a80],
      blendMode: 'ADD',
      emitting: false,
    })
    emitter.setDepth(30)
    emitter.explode(conf.count)
    this.time.delayedCall(conf.life + 100, () => emitter.destroy())

    if (level >= 2) this.cameras.main.shake(level === 3 ? 260 : 120, level === 3 ? 0.01 : 0.005)
    if (level === 1) sfx.explosionSmall()
    else sfx.explosionBig()
  }

  /** 炸弹：全屏清弹 + 全体敌机伤害（require.md 七 B） */
  triggerBomb(): void {
    if (this.store.screen !== 'playing') return
    if (!this.player.useBomb()) {
      this.showToastText('炸弹已用完')
      return
    }
    sfx.bomb()
    this.cameras.main.shake(300, 0.015)
    this.cameras.main.flash(220, 255, 255, 255)

    this.enemyBullets.getChildren().forEach((obj) => (obj as Bullet).recycle())
    this.enemies.getChildren().forEach((obj) => {
      const e = obj as Enemy
      if (!e.active) return
      const killed = e.takeDamage(80)
      if (killed) this.onEnemyKilled(e)
    })
  }

  private showToastText(msg: string): void {
    const t = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, msg, {
        fontFamily: 'Consolas, monospace',
        fontSize: '20px',
        color: '#ffd54f',
      })
      .setOrigin(0.5)
      .setDepth(70)
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, duration: 900, onComplete: () => t.destroy() })
  }

  private showWaveText(text: string, color: string): void {
    this.waveText.setText(text).setColor(color).setAlpha(0).setScale(0.7)
    this.tweens.add({
      targets: this.waveText,
      alpha: 1,
      scale: 1,
      duration: 260,
      yoyo: true,
      hold: 1400,
      onComplete: () => this.waveText.setAlpha(0),
    })
  }

  /* ---------------- HUD 绘制 ---------------- */

  private drawHud(): void {
    // 分数（每 100ms 节流同步，require.md 十二）
    this.scoreText.setText('SCORE ' + String(this.store.score).padStart(6, '0'))

    // 血条（左下，红色渐变）
    this.hpBar.clear()
    const bx = 14, by = GAME_HEIGHT - 26, bw = 170, bh = 12
    this.hpBar.fillStyle(0x000000, 0.55).fillRoundedRect(bx - 2, by - 2, bw + 4, bh + 4, 4)
    const ratio = this.store.hpRatio
    this.hpBar.fillStyle(ratio > 0.35 ? 0x69f0ae : 0xff5252, 1)
    if (ratio > 0) this.hpBar.fillRoundedRect(bx, by, Math.max(6, bw * ratio), bh, 3)
    this.bombText.setText('BOMB ×' + this.player.bombs + '   火力 Lv' + this.player.fireLevel)

    // Boss 血条（顶部超长血条，require.md 十）
    this.bossBar.clear()
    if (this.store.bossVisible && this.boss && this.boss.active) {
      this.bossBar.fillStyle(0x000000, 0.6).fillRoundedRect(20, 42, GAME_WIDTH - 40, 12, 4)
      const r = this.boss.hp / this.boss.maxHp
      this.bossBar.fillStyle(0xff5e6c, 1)
      if (r > 0) this.bossBar.fillRoundedRect(22, 44, (GAME_WIDTH - 44) * r, 8, 3)
    }
  }

  /* ---------------- 玩家死亡 / 结算 / UI 动作 ---------------- */

  private onPlayerDie = (): void => {
    if (this.ended) return
    this.ended = true
    this.spawnExplosion(this.player.x, this.player.y, 3)
    this.player.setVisible(false)
    this.player.body?.stop()
    this.setControlsVisible(false)
    sfx.gameOver()

    this.store.persist()
    this.store.setScreen('gameover')   // update 门控：画面冻结，Vue 显示结算
  }

  /** Vue 重试：重启场景并直接开战 */
  restartRun(): void {
    MainScene.nextMode = 'play'
    this.scene.resume()                // 从暂停态恢复后再重启
    this.scene.restart()
  }

  /** Vue 暂停 / 恢复 */
  pauseRun(): void {
    if (this.store.screen === 'playing') this.store.setScreen('paused')
  }

  resumeRun(): void {
    if (this.store.screen === 'paused') this.store.setScreen('playing')
  }

  /** Vue 退出到主菜单 */
  quitToMenu(): void {
    this.scene.restart()               // nextMode 默认 menu
  }

  private drawBossBar(): void {
    this.drawHud()
    // Boss 开火驱动
    this.bossFire(this.time.now)
    void WAVE_LOOP_SECONDS
  }
}
