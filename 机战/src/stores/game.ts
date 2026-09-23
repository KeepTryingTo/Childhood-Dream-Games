/**
 * Pinia 状态管理（require.md 二/四：Phaser 游戏层写入，Vue UI 层读取）
 * 职责：HUD 数据镜像、界面切换、存档（require.md 十一）
 */
import { defineStore } from 'pinia'
import { SAVE_KEY, DifficultyKind } from '../game/config/constants'

export type ScreenName = 'menu' | 'playing' | 'paused' | 'gameover'

export interface SaveData {
  highScore: number
  settings: { sfx: boolean; bgm: boolean; difficulty: DifficultyKind }
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>
      const diff = data.settings?.difficulty
      return {
        highScore: Number(data.highScore) || 0,
        settings: {
          sfx: data.settings?.sfx !== false,
          bgm: data.settings?.bgm !== false,
          difficulty: diff === 'easy' || diff === 'hard' ? diff : 'normal',
        },
      }
    }
  } catch {
    /* QuotaExceededError / JSON 异常防崩溃（require.md 十一） */
  }
  return { highScore: 0, settings: { sfx: true, bgm: true, difficulty: 'normal' } }
}

function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export const useGameStore = defineStore('game', {
  state: () => {
    const save = loadSave()
    return {
      screen: 'menu' as ScreenName,
      difficulty: save.settings.difficulty,
      score: 0,
      hp: 100,
      maxHp: 100,
      fireLevel: 1,
      bombs: 2,
      wave: 1,
      bossName: '',
      bossHpRatio: 0,
      bossVisible: false,
      highScore: save.highScore,
      settings: { sfx: save.settings.sfx, bgm: save.settings.bgm },
      isNewRecord: false,
    }
  },
  getters: {
    hpRatio(state): number {
      return state.maxHp > 0 ? state.hp / state.maxHp : 0
    },
  },
  actions: {
    resetRun(): void {
      this.score = 0
      this.hp = 100
      this.maxHp = 100
      this.fireLevel = 1
      this.bombs = 2
      this.wave = 1
      this.bossName = ''
      this.bossHpRatio = 0
      this.bossVisible = false
      this.isNewRecord = false
    },
    setScreen(s: ScreenName): void {
      this.screen = s
    },
    setDifficulty(d: DifficultyKind): void {
      this.difficulty = d
    },
    persist(): void {
      if (this.score > this.highScore) {
        this.highScore = this.score
        this.isNewRecord = true
      }
      writeSave({
        highScore: this.highScore,
        settings: { ...this.settings, difficulty: this.difficulty },
      })
    },
  },
})
