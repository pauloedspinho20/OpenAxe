/**
 * Click-track scheduler. Uses its own AudioContext (created lazily on the
 * first start, which always follows a user gesture) so it works identically on
 * web and in the desktop webview, and never touches the rig's signal path.
 *
 * Look-ahead scheduling: a short timer queues clicks a little ahead on the
 * audio clock, so timer jitter never moves a beat. The tempo and volume are
 * read through getters on every tick, so a BPM change takes effect at the next
 * beat with no restart.
 */

const LOOKAHEAD_S = 0.12
const TICK_MS = 25
/** Beats per bar; the first of each bar is accented. */
const BEATS_PER_BAR = 4

export interface MetronomeSource {
  getBpm: () => number
  getVolume: () => number
}

export class Metronome {
  private ctx: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nextTime = 0
  private beat = 0

  private readonly source: MetronomeSource

  constructor(source: MetronomeSource) {
    this.source = source
  }

  get running(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    const Ctor =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx ??= new Ctor({ latencyHint: 'interactive' })
    void this.ctx.resume()
    this.beat = 0
    this.nextTime = this.ctx.currentTime + 0.06
    this.timer = setInterval(() => this.schedule(), TICK_MS)
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  private schedule(): void {
    const ctx = this.ctx
    if (!ctx) return
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.click(this.nextTime, this.beat % BEATS_PER_BAR === 0)
      this.nextTime += 60 / this.source.getBpm()
      this.beat += 1
    }
  }

  private click(when: number, accent: boolean): void {
    const ctx = this.ctx
    if (!ctx) return
    const volume = this.source.getVolume()
    if (volume <= 0) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = accent ? 1500 : 1000
    // Sharp attack, 40 ms exponential decay: a woodblock-like tick.
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04)
    osc.connect(gain).connect(ctx.destination)
    osc.start(when)
    osc.stop(when + 0.05)
  }
}
