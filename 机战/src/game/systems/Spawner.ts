import Phaser from 'phaser'
import { WAVES, WaveConfig, WAVE_LOOP_SECONDS, EnemyKind, DIFFICULTIES, DifficultyKind } from '../config/constants'
import { bus, EVENT } from './EventBus'
import { sfx } from './Sfx'

/**
 * 波次生成器（require.md 十）
 * - 按 waves 配置表循环推进（Boss 波每周期触发）
 * - spawnInterval 随难度递减；难度模式额外调节生成密度
 * - 生成模式：单点 / 横排 / V 字 / 包围圈
 */

export type SpawnPattern = 'single' | 'row' | 'v' | 'circle'

export interface SpawnerDeps {
  spawnEnemy: (kind: EnemyKind, x: number, y: number) => void
  spawnBoss: () => void
  hasBossAlive: () => boolean
  getScore: () => number
  getDifficulty: () => DifficultyKind
  warnBoss: () => void
}

export class Spawner {
  private elapsed = 0
  private spawnTimer = 0
  private currentWave: WaveConfig | null = null
  private waveIndex = -1
  private cycle = 0
  private bossWarned = false

  constructor(private deps: SpawnerDeps) {}

  reset(): void {
    this.elapsed = 0
    this.spawnTimer = 400
    this.currentWave = null
    this.waveIndex = -1
    this.cycle = 0
    this.bossWarned = false
  }

  get waveNumber(): number {
    return this.cycle * WAVES.length + this.waveIndex + 1
  }

  update(delta: number): void {
    this.elapsed += delta / 1000

    // 循环内定位当前波（require.md 十：time >= wave.time 触发）
    const t = this.elapsed % WAVE_LOOP_SECONDS
    const cycleShift = Math.floor(this.elapsed / WAVE_LOOP_SECONDS)
    if (cycleShift !== this.cycle) {
      this.cycle = cycleShift
      this.waveIndex = -1
      this.currentWave = null
    }

    let idx = -1
    for (let i = 0; i < WAVES.length; i++) {
      if (t >= WAVES[i].time) idx = i
    }
    if (idx !== this.waveIndex) {
      this.waveIndex = idx
      this.currentWave = WAVES[idx]
      this.spawnTimer = 500
      this.bossWarned = false

      if (this.currentWave.boss) {
        // Boss 波：警告动画 + 清场提示（require.md 十 Boss 战）
        bus.emit(EVENT.BOSS_WARNING)
        sfx.bossAlarm()
        this.bossWarned = true
        window.setTimeout(() => {
          if (!this.deps.hasBossAlive()) this.deps.spawnBoss()
        }, 2200)
      } else {
        bus.emit(EVENT.WAVE_START, this.waveNumber)
        sfx.wave()
      }
    }

    if (!this.currentWave || this.currentWave.boss) return

    // 生成间隔随分数难度递减（2s -> 0.5s 方向）；难度模式倍率调节密度
    const scoreDiff = 1 + 0.1 * Math.floor(this.deps.getScore() / 1000)
    const modeMul = DIFFICULTIES[this.deps.getDifficulty()].spawnMul
    const interval = Math.max(450, (this.currentWave.interval / scoreDiff) * modeMul)

    this.spawnTimer -= delta
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval
      this.spawnWave(this.currentWave)
    }
  }

  /** 按编队模式生成敌机（require.md 六：单点、横排、V字、包围圈） */
  private spawnWave(wave: WaveConfig): void {
    const patterns: SpawnPattern[] = ['single', 'row', 'v', 'circle']
    const pattern = patterns[Math.floor(Math.random() * patterns.length)]
    const pool = wave.enemies

    const pick = (): EnemyKind => pool[Math.floor(Math.random() * pool.length)]

    switch (pattern) {
      case 'single': {
        this.deps.spawnEnemy(pick(), Phaser.Math.Between(50, 430), -30)
        break
      }
      case 'row': {
        const kind = pick()
        for (let i = 0; i < 4; i++) {
          this.deps.spawnEnemy(kind, 80 + i * 105, -30 - (i % 2) * 30)
        }
        break
      }
      case 'v': {
        const kind = pick()
        for (let i = 0; i < 5; i++) {
          const offset = Math.abs(i - 2)
          this.deps.spawnEnemy(kind, 110 + i * 65, -30 - offset * 45)
        }
        break
      }
      case 'circle': {
        const kind = pick()
        const cx = 240
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI - Math.PI // 上半圆
          this.deps.spawnEnemy(kind, cx + Math.cos(a) * 150, -40 - Math.sin(a) * 60)
        }
        break
      }
    }
  }
}
