/**
 * Sustained-clipping detector for the master output. A single transient
 * peak is not "clipping" - the signal has to sit at/near full scale long
 * enough to actually be hammering the output. Feed it one peak sample per
 * poll (see useAudioEngine) with the current clock; it returns true exactly
 * once per sustained-clip episode, then re-arms only after the signal drops
 * back below threshold.
 */
export class ClipControl {
  private readonly threshold: number
  private readonly sustainedMs: number
  private clipStart = -1
  private tripped = false

  constructor(options: { threshold: number; sustainedMs: number }) {
    this.threshold = options.threshold
    this.sustainedMs = options.sustainedMs
  }

  /** Feed one output-peak sample (0..1). Returns true on the poll the guard trips. */
  update(peak: number, now: number): boolean {
    if (peak >= this.threshold) {
      if (this.clipStart < 0) this.clipStart = now
      if (!this.tripped && now - this.clipStart >= this.sustainedMs) {
        this.tripped = true
        return true
      }
    } else {
      this.clipStart = -1
      this.tripped = false
    }
    return false
  }

  /** Drop all memory (e.g. while re-arming after a manual unmute). */
  reset(): void {
    this.clipStart = -1
    this.tripped = false
  }
}
