/**
 * 轻量事件总线（require.md 四：Phaser EventEmitter / mitt 方案的自包含实现）
 * 用途：PLAYER_DIE / SCORE_UPDATE / WAVE_START 等跨层通知
 */

export type Handler = (...args: any[]) => void

interface Entry {
  fn: Handler
  ctx?: unknown
}

export class EventBus {
  private map = new Map<string, Set<Entry>>()

  /** 注册监听；可选 ctx 用于绑定 this */
  on(event: string, fn: Handler, ctx?: unknown): this {
    if (!this.map.has(event)) this.map.set(event, new Set())
    this.map.get(event)!.add({ fn, ctx })
    return this
  }

  off(event: string, fn: Handler, ctx?: unknown): this {
    const set = this.map.get(event)
    if (!set) return this
    for (const entry of set) {
      if (entry.fn === fn && entry.ctx === ctx) {
        set.delete(entry)
        break
      }
    }
    return this
  }

  emit(event: string, ...args: any[]): this {
    const set = this.map.get(event)
    if (!set) return this
    set.forEach((entry) => {
      try {
        entry.fn.apply(entry.ctx, args)
      } catch (e) {
        console.error(`[EventBus] handler error on "${event}"`, e)
      }
    })
    return this
  }

  clear(): this {
    this.map.clear()
    return this
  }
}

/** 全局单例事件总线 */
export const bus = new EventBus()

/** 游戏事件名常量（require.md 四） */
export const EVENT = {
  SCORE_UPDATE: 'score-update',
  HP_UPDATE: 'hp-update',
  PLAYER_DIE: 'player-die',
  WAVE_START: 'wave-start',
  BOSS_WARNING: 'boss-warning',
  BOSS_HP: 'boss-hp',
  GAME_READY: 'game-ready',
} as const
