/**
 * 程序化合成音效（Web Audio API，require.md 八）
 * 全部音效由振荡器实时合成，无外部音频资源依赖；
 * BGM 为简单的合成琶音循环。iOS Safari 需首次手势后 resume。
 */

export class SfxManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxOn = true
  private bgmOn = true
  private bgmTimer = 0
  private bgmStep = 0
  private bgmGain: GainNode | null = null

  /** 必须在用户手势内调用（自动播放策略） */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
      this.startBgm()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setSfx(on: boolean): void {
    this.sfxOn = on
  }

  setBgm(on: boolean): void {
    this.bgmOn = on
    if (this.bgmGain) {
      this.bgmGain.gain.value = on ? 0.16 : 0
    }
  }

  private beep(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.03)
  }

  /** 噪声爆炸（白噪声 buffer + 低通） */
  private noise(dur: number, vol: number, freq = 1000): void {
    if (!this.ctx || !this.master) return
    const t0 = this.ctx.currentTime
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(freq * 2, t0)
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq / 4), t0 + dur)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    src.start(t0)
  }

  // ---- 游戏音效 ----
  shoot(): void {
    if (this.sfxOn) this.beep(880, 0.07, 'square', 0.05, 320)
  }
  enemyShoot(): void {
    if (this.sfxOn) this.beep(240, 0.08, 'sawtooth', 0.05, 120)
  }
  hitEnemy(): void {
    if (this.sfxOn) this.beep(520, 0.04, 'square', 0.06)
  }
  explosionSmall(): void {
    if (this.sfxOn) this.noise(0.25, 0.22, 900)
  }
  explosionBig(): void {
    if (this.sfxOn) {
      this.noise(0.5, 0.34, 700)
      this.beep(90, 0.4, 'sine', 0.22, 40)
    }
  }
  pickup(): void {
    if (this.sfxOn) {
      this.beep(660, 0.07, 'sine', 0.14)
      this.beep(990, 0.09, 'sine', 0.14, undefined, 0.06)
    }
  }
  playerHit(): void {
    if (this.sfxOn) this.beep(160, 0.18, 'sawtooth', 0.18, 70)
  }
  bomb(): void {
    if (this.sfxOn) {
      this.noise(0.8, 0.4, 500)
      this.beep(60, 0.7, 'sine', 0.3, 30)
    }
  }
  wave(): void {
    if (this.sfxOn) {
      this.beep(392, 0.1, 'triangle', 0.12)
      this.beep(523, 0.12, 'triangle', 0.12, undefined, 0.1)
    }
  }
  bossAlarm(): void {
    if (this.sfxOn) {
      for (let i = 0; i < 3; i++) this.beep(220, 0.18, 'sawtooth', 0.16, undefined, i * 0.3)
    }
  }
  gameOver(): void {
    if (this.sfxOn) {
      this.noise(0.7, 0.3, 500)
      this.beep(300, 0.6, 'sawtooth', 0.16, 60)
    }
  }

  /** 简单合成 BGM：小调琶音循环（低调不喧宾） */
  private startBgm(): void {
    if (!this.ctx || !this.master) return
    this.bgmGain = this.ctx.createGain()
    this.bgmGain.gain.value = this.bgmOn ? 0.16 : 0
    this.bgmGain.connect(this.master)

    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25]
    const pattern = [0, 2, 4, 3, 5, 4, 2, 1, 0, 3, 5, 6, 5, 4, 2, 0]
    this.bgmStep = 0

    this.bgmTimer = window.setInterval(() => {
      if (!this.bgmOn || !this.ctx || !this.bgmGain) return
      const f = scale[pattern[this.bgmStep % pattern.length]]
      const t0 = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42)
      osc.connect(gain)
      gain.connect(this.bgmGain)
      osc.start(t0)
      osc.stop(t0 + 0.45)
      if (this.bgmStep % 4 === 0) {
        const bass = this.ctx.createOscillator()
        const bg = this.ctx.createGain()
        bass.type = 'sine'
        bass.frequency.value = 110
        bg.gain.setValueAtTime(0.5, t0)
        bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3)
        bass.connect(bg)
        bg.connect(this.bgmGain)
        bass.start(t0)
        bass.stop(t0 + 0.32)
      }
      this.bgmStep++
    }, 260)
  }

  destroy(): void {
    if (this.bgmTimer) clearInterval(this.bgmTimer)
    void this.ctx?.close()
    this.ctx = null
  }
}

export const sfx = new SfxManager()
