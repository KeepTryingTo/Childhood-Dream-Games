/**
 * 全局常量与配置表（require.md 二/五/六/七/十）
 */

/** 游戏逻辑分辨率（竖屏，Phaser Scale.FIT 自适应） */
export const GAME_WIDTH = 480
export const GAME_HEIGHT = 720

/** 玩家 */
export const PLAYER = {
  MAX_HP: 100,
  SPEED: 320,
  ACCEL: 2600,
  DRAG: 2200,
  FIRE_RATE: 130,        // ms，射击冷却
  MAX_FIRE_LEVEL: 5,
  MAX_BOMB: 3,
  INVINCIBLE_MS: 2000,   // 重生/受击后无敌
  SPAWN_Y: GAME_HEIGHT - 90,
}

/** 敌机类型配置（require.md 六） */
export type EnemyKind = 'scout' | 'fighter' | 'bomber' | 'interceptor' | 'boss'

export interface EnemyConfig {
  hp: number
  speed: number
  score: number
  radius: number       // 碰撞半径
  tint: number         // 色调
  fireMs?: number      // 开火间隔（0 = 不开火）
}

export const ENEMIES: Record<EnemyKind, EnemyConfig> = {
  scout:       { hp: 1,   speed: 150, score: 10,   radius: 14, tint: 0x7ef0ff },
  fighter:     { hp: 3,   speed: 110, score: 30,   radius: 16, tint: 0x7dff9e, fireMs: 1800 },
  bomber:      { hp: 8,   speed: 60,  score: 100,  radius: 22, tint: 0xffb15e, fireMs: 2000 },
  interceptor: { hp: 2,   speed: 300, score: 50,   radius: 14, tint: 0xff8ad8, fireMs: 2400 },
  boss:        { hp: 500, speed: 60,  score: 2000, radius: 60, tint: 0xff5e6c, fireMs: 900 },
}

/** 难度模式（简单 / 中等 / 困难） */
export type DifficultyKind = 'easy' | 'normal' | 'hard'

export interface DifficultyConfig {
  label: string
  enemyHpMul: number      // 敌机血量倍率
  enemySpeedMul: number   // 敌机移动速度倍率
  enemyFireMul: number    // 敌机开火间隔倍率（>1 更慢）
  enemyBulletMul: number  // 敌弹速度倍率
  spawnMul: number        // 敌机生成间隔倍率（>1 更稀疏）
  playerDamageMul: number // 玩家受伤倍率
  scoreMul: number        // 得分倍率
}

export const DIFFICULTIES: Record<DifficultyKind, DifficultyConfig> = {
  easy:   { label: '简单', enemyHpMul: 0.7, enemySpeedMul: 0.8, enemyFireMul: 1.5, enemyBulletMul: 0.75, spawnMul: 1.35, playerDamageMul: 0.5, scoreMul: 0.8 },
  normal: { label: '中等', enemyHpMul: 1.0, enemySpeedMul: 1.0, enemyFireMul: 1.0, enemyBulletMul: 1.0,  spawnMul: 1.0,  playerDamageMul: 1.0, scoreMul: 1.0 },
  hard:   { label: '困难', enemyHpMul: 1.5, enemySpeedMul: 1.25, enemyFireMul: 0.7, enemyBulletMul: 1.25, spawnMul: 0.72, playerDamageMul: 1.5, scoreMul: 1.5 },
}

/** 火力自动升级分数阈值（道具已移除，改为随分数成长） */
export const FIRE_LEVEL_SCORES = [1500, 4000, 8000, 15000]

/** 波次配置表（require.md 十，替代 waves.json 内联为 TS 配置） */
export interface WaveConfig {
  time: number              // 波次触发时间（秒）
  enemies: EnemyKind[]      // 该波内循环生成的敌机池
  interval: number          // 生成间隔 ms
  boss?: boolean            // 是否为 Boss 波
}

export const WAVES: WaveConfig[] = [
  { time: 0,   enemies: ['scout'],                          interval: 1400 },
  { time: 10,  enemies: ['scout', 'fighter'],               interval: 1200 },
  { time: 25,  enemies: ['fighter', 'scout', 'interceptor'], interval: 1000 },
  { time: 45,  enemies: ['bomber', 'fighter', 'interceptor'], interval: 900 },
  { time: 70,  enemies: ['interceptor', 'fighter', 'bomber', 'scout'], interval: 700 },
  { time: 90,  enemies: [], interval: 0, boss: true },
]

/** Boss 出现的循环周期（秒）：每 90 秒一个 Boss 波循环 */
export const WAVE_LOOP_SECONDS = 90

/** 难度公式（require.md 十）：随分数线性增强 */
export function difficultyOf(score: number): number {
  return 1 + 0.1 * Math.floor(score / 1000)
}

/** 存档键（require.md 十一） */
export const SAVE_KEY = 'mechwarfare_save_v1'

/** 分层视差背景滚动速度 */
export const BG_LAYERS = [
  { speed: 14,  alpha: 0.35, starMin: 1, starMax: 2 },
  { speed: 32,  alpha: 0.6,  starMin: 1, starMax: 3 },
  { speed: 70,  alpha: 0.95, starMin: 2, starMax: 4 },
]
