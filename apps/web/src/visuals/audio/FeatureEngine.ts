import { detectPitch } from '../../tuner/pitchDetect'
import { SpectrumAnalyzer, floorPow2 } from './fft'
import { emptyFeatures, type AudioFeatures } from './features'

/**
 * Turns raw time-domain taps into the 0..1 features in ./features.ts.
 *
 * Three ideas carry most of the weight:
 *
 * - **Auto-ranging.** Guitar levels swing 40 dB between a clean DI and a
 *   high-gain output, so loudness and band energies are normalised against a
 *   floor/ceiling that follows the recent playing (ceiling jumps up at once
 *   and relaxes over ~8 s, floor drops at once and creeps up over ~12 s,
 *   never closer than a minimum range so hiss is not stretched to full
 *   scale). Sensitivity trims the result; the noise gate decides what counts
 *   as playing at all.
 * - **One responsiveness dial.** Every attack/release time constant is
 *   scaled by a single factor (2.5x slower .. 2.5x faster), so "smooth vs
 *   punchy" is one control instead of twenty.
 * - **Pitch that knows bends from note changes.** A new note fires
 *   `noteChange` only when the pitch *jumps* (a hammer-on, a slide's
 *   landing, a fresh pick); a gradual glide is reported as `bend` relative
 *   to the note it started from, and fast wobble as `vibrato`.
 */

export interface FeatureSettings {
  /** Trim on top of auto-ranging, 0.25..4 (1 = neutral). */
  sensitivity: number
  /** Anything quieter than this (dBFS) counts as silence. */
  gateDb: number
  /** 0 = smooth/cinematic, 0.5 = balanced, 1 = punchy. */
  responsiveness: number
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  sensitivity: 1,
  gateDb: -62,
  responsiveness: 0.5,
}

export interface FeatureInput {
  /** Samples for loudness + timbre (oldest -> newest). */
  spectral: Float32Array | null
  /** Samples for pitch detection; usually the dry input. */
  pitch: Float32Array | null
  sampleRate: number
  /** Seconds since the previous update. */
  dt: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const toDb = (power: number) => 10 * Math.log10(power + 1e-12)

/** One-pole follower with separate rise/fall time constants (seconds). */
export function follow(
  current: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
) {
  const tau = target > current ? attack : release
  if (tau <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** Floor/ceiling tracker in dB - see the header comment. */
export class AutoRange {
  floor: number
  ceil: number
  private readonly minRange: number
  constructor(minRange: number, start: number) {
    this.minRange = minRange
    this.floor = start
    this.ceil = start + minRange
  }

  update(x: number, dt: number) {
    this.ceil =
      x > this.ceil ? follow(this.ceil, x, dt, 0.03, 0.03) : follow(this.ceil, x, dt, 8, 8)
    this.floor =
      x < this.floor ? follow(this.floor, x, dt, 0.3, 0.3) : follow(this.floor, x, dt, 12, 12)
    if (this.ceil - this.floor < this.minRange) this.floor = this.ceil - this.minRange
  }

  normalize(x: number) {
    return clamp01((x - this.floor) / (this.ceil - this.floor))
  }

  reset(start: number) {
    this.floor = start
    this.ceil = start + this.minRange
  }
}

const BANDS = [
  { key: 'bandLow', lo: 40, hi: 250 },
  { key: 'bandLowMid', lo: 250, hi: 1000 },
  { key: 'bandHighMid', lo: 1000, hi: 4000 },
  { key: 'bandHigh', lo: 4000, hi: 12000 },
] as const

const FLUX_HISTORY = 40
const PITCH_INTERVAL = 0.03
const PITCH_HOLD = 0.25
const MIDI_LOW = 40 // E2
const MIDI_HIGH = 84 // C6

export class FeatureEngine {
  readonly features: AudioFeatures = emptyFeatures()

  private spectrum: SpectrumAnalyzer | null = null
  private prevLogMag: Float32Array | null = null
  private readonly volumeRange = new AutoRange(18, -60)
  private readonly bandRanges = BANDS.map(() => new AutoRange(24, -80))
  private readonly fluxHistory = new Float32Array(FLUX_HISTORY)
  private fluxIndex = 0
  private fluxCount = 0
  private sinceOnset = 1
  private slowDb = -120

  // pitch state
  private sincePitch = 0
  private sinceDetection = 1
  private lastMidiF = 0
  private candidateNote = -1
  private candidateCount = 0
  private candidateJumped = false
  private anchorMidi = 0
  private midiEma = 0
  private vibVar = 0
  private hueX = 1
  private hueY = 0

  reset() {
    Object.assign(this.features, emptyFeatures())
    this.prevLogMag = null
    this.volumeRange.reset(-60)
    for (const r of this.bandRanges) r.reset(-80)
    this.fluxCount = 0
    this.features.note = -1
    this.candidateNote = -1
  }

  update(input: FeatureInput, settings: FeatureSettings): AudioFeatures {
    const f = this.features
    const dt = Math.min(Math.max(input.dt, 1e-4), 0.1)
    // 2.5x slower at 0, neutral at 0.5, 2.5x faster at 1.
    const tf = 2.5 ** (1 - 2 * clamp01(settings.responsiveness))
    const sens = Math.min(4, Math.max(0.25, settings.sensitivity))

    // ——— Volume ———
    let playing = false
    const buf = input.spectral
    if (buf && buf.length > 0) {
      const n = Math.min(buf.length, 1024)
      let sum = 0
      for (let i = buf.length - n; i < buf.length; i++) sum += buf[i]! * buf[i]!
      const db = toDb(sum / n)
      f.levelDb = db
      playing = db > settings.gateDb
      if (playing) this.volumeRange.update(db, dt)
      const target = playing ? clamp01(this.volumeRange.normalize(db) * sens) : 0
      f.volume = follow(f.volume, target, dt, 0.012 * tf, 0.14 * tf)

      // Energy-jump onset fallback, for windows too small for useful flux.
      const jump = db - this.slowDb
      this.slowDb = follow(this.slowDb, db, dt, 0.05, 0.05)
      this.spectral(buf, input.sampleRate, dt, tf, sens, playing, settings, jump)
    } else {
      f.levelDb = -120
      f.volume = follow(f.volume, 0, dt, 0, 0.14 * tf)
      this.decayTimbre(dt, tf)
    }

    f.activity = follow(f.activity, playing ? 1 : 0, dt, 0.05 * tf, 1.6 * tf)
    f.sustain = follow(f.sustain, f.volume, dt, 0.5 * tf, 2.5 * tf)

    this.pitchStage(input, dt, tf, settings)

    f.onset *= Math.exp(-dt / (0.16 * tf))
    f.noteChange *= Math.exp(-dt / (0.2 * tf))
    return f
  }

  private decayTimbre(dt: number, tf: number) {
    const f = this.features
    f.grit = follow(f.grit, 0, dt, 0, 0.3 * tf)
    for (const b of BANDS) f[b.key] = follow(f[b.key], 0, dt, 0, 0.15 * tf)
  }

  private spectral(
    buf: Float32Array,
    sampleRate: number,
    dt: number,
    tf: number,
    sens: number,
    playing: boolean,
    settings: FeatureSettings,
    energyJump: number,
  ) {
    const f = this.features
    const size = Math.min(2048, floorPow2(buf.length))
    if (size < 64) {
      this.decayTimbre(dt, tf)
      if (playing && energyJump > 6 && this.sinceOnset > 0.09) this.fireOnset(0.6)
      this.sinceOnset += dt
      return
    }
    if (!this.spectrum || this.spectrum.size !== size) {
      this.spectrum = new SpectrumAnalyzer(size)
      this.prevLogMag = null
    }
    const mag = this.spectrum.analyze(buf)
    const binHz = sampleRate / size
    const bin = (hz: number) => Math.min(mag.length - 1, Math.max(1, Math.round(hz / binHz)))

    // Centroid (80 Hz - 8 kHz) and flatness (150 Hz - 8 kHz).
    let wsum = 0
    let msum = 0
    for (let k = bin(80); k <= bin(8000); k++) {
      wsum += k * binHz * mag[k]!
      msum += mag[k]!
    }
    const centroid = msum > 1e-9 ? wsum / msum : 0
    let logSum = 0
    let powSum = 0
    const fLo = bin(150)
    const fHi = bin(8000)
    for (let k = fLo; k <= fHi; k++) {
      const p = mag[k]! * mag[k]! + 1e-12
      logSum += Math.log(p)
      powSum += p
    }
    const count = fHi - fLo + 1
    const flatness = count > 0 ? Math.exp(logSum / count) / (powSum / count) : 0

    if (playing) {
      f.centroidHz = centroid
      const bright = clamp01(Math.log2(Math.max(centroid, 1) / 250) / Math.log2(4000 / 250))
      f.brightness = follow(f.brightness, bright, dt, 0.08 * tf, 0.25 * tf)
      f.grit = follow(f.grit, clamp01((flatness - 0.04) / 0.32), dt, 0.06 * tf, 0.3 * tf)
    } else {
      f.grit = follow(f.grit, 0, dt, 0, 0.3 * tf)
    }

    // Bands.
    BANDS.forEach((b, i) => {
      let p = 0
      for (let k = bin(b.lo); k <= bin(b.hi); k++) p += mag[k]! * mag[k]!
      const db = toDb(p)
      const range = this.bandRanges[i]!
      if (playing && db > settings.gateDb - 6) range.update(db, dt)
      const target = playing ? clamp01(range.normalize(db) * sens) : 0
      f[b.key] = follow(f[b.key], target, dt, 0.02 * tf, 0.15 * tf)
    })

    // Spectral flux on log-compressed magnitudes, adaptive threshold.
    const lo = bin(60)
    const hi = bin(10000)
    if (!this.prevLogMag || this.prevLogMag.length !== mag.length) {
      this.prevLogMag = new Float32Array(mag.length)
    }
    let flux = 0
    for (let k = lo; k <= hi; k++) {
      const lm = Math.log1p(100 * mag[k]!)
      const d = lm - this.prevLogMag[k]!
      if (d > 0) flux += d
      this.prevLogMag[k] = lm
    }
    flux /= Math.max(1, hi - lo)

    let mean = 0
    let sq = 0
    const filled = Math.min(this.fluxCount, FLUX_HISTORY)
    for (let i = 0; i < filled; i++) {
      mean += this.fluxHistory[i]!
      sq += this.fluxHistory[i]! * this.fluxHistory[i]!
    }
    mean = filled ? mean / filled : 0
    const std = filled ? Math.sqrt(Math.max(0, sq / filled - mean * mean)) : 0
    const threshold = mean + 1.4 * std + 0.004
    this.fluxHistory[this.fluxIndex] = flux
    this.fluxIndex = (this.fluxIndex + 1) % FLUX_HISTORY
    this.fluxCount++

    this.sinceOnset += dt
    if (playing && this.sinceOnset > 0.09 && filled >= 8) {
      // Flux alone also rises on bends and slides (the spectrum moves); a
      // real attack also lifts the level, so require a little of both.
      if (flux > threshold && energyJump > 1.5) {
        this.fireOnset(0.4 + 0.6 * clamp01((flux - threshold) / (threshold + 1e-6)))
      } else if (energyJump > 8) {
        this.fireOnset(0.6)
      }
    }
  }

  private fireOnset(strength: number) {
    const f = this.features
    f.onset = Math.max(f.onset, clamp01(strength))
    this.sinceOnset = 0
    // A fresh pick re-anchors bends to whatever is ringing now.
    if (f.note >= 0) this.anchorMidi = Math.round(this.lastMidiF)
    this.pickedSinceNote = true
  }

  private pickedSinceNote = false

  private pitchStage(input: FeatureInput, dt: number, tf: number, settings: FeatureSettings) {
    const f = this.features
    this.sincePitch += dt
    this.sinceDetection += dt

    if (this.sincePitch >= PITCH_INTERVAL && input.pitch && input.pitch.length >= 512) {
      this.sincePitch = 0
      const buf = input.pitch
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
      const loud = toDb(sum / buf.length) > settings.gateDb
      const res = loud ? detectPitch(buf, input.sampleRate) : null
      if (res && res.frequency > 0) this.onPitch(res.frequency)
    }

    if (this.sinceDetection > PITCH_HOLD && f.note >= 0) {
      f.note = -1
      f.hz = 0
      this.candidateNote = -1
      this.candidateCount = 0
    }

    // Smooth the wheel along the shortest arc.
    const hueTau = 0.06 * tf
    if (f.note >= 0) {
      const ang = ((f.note % 12) / 12) * 2 * Math.PI
      this.hueX = follow(this.hueX, Math.cos(ang), dt, hueTau, hueTau)
      this.hueY = follow(this.hueY, Math.sin(ang), dt, hueTau, hueTau)
      f.register = follow(
        f.register,
        clamp01((this.lastMidiF - MIDI_LOW) / (MIDI_HIGH - MIDI_LOW)),
        dt,
        0.15 * tf,
        0.15 * tf,
      )
      const bendCents = (this.lastMidiF - this.anchorMidi) * 100
      f.bend = follow(f.bend, clamp01(Math.abs(bendCents) / 200), dt, 0.03 * tf, 0.12 * tf)
      f.vibrato = follow(
        f.vibrato,
        clamp01((Math.sqrt(this.vibVar) * 100) / 35),
        dt,
        0.08 * tf,
        0.3 * tf,
      )
    } else {
      f.bend = follow(f.bend, 0, dt, 0, 0.2 * tf)
      f.vibrato = follow(f.vibrato, 0, dt, 0, 0.3 * tf)
    }
    const a = Math.atan2(this.hueY, this.hueX) / (2 * Math.PI)
    f.pitchClass = a < 0 ? a + 1 : a
  }

  private onPitch(hz: number) {
    const f = this.features
    const midiF = 69 + 12 * Math.log2(hz / 440)
    const continuous = this.sinceDetection < 0.1
    const jumped = !continuous || Math.abs(midiF - this.lastMidiF) > 0.6
    this.sinceDetection = 0

    const rounded = Math.round(midiF)
    if (rounded === this.candidateNote) {
      this.candidateCount++
    } else {
      this.candidateNote = rounded
      this.candidateCount = 1
      this.candidateJumped = jumped
    }

    // Vibrato: high-passed pitch, then its running variance.
    if (jumped) {
      this.midiEma = midiF
      this.vibVar = 0
    } else {
      this.midiEma += (midiF - this.midiEma) * (1 - Math.exp(-0.03 / 0.2))
      const hp = midiF - this.midiEma
      this.vibVar += (hp * hp - this.vibVar) * (1 - Math.exp(-0.03 / 0.4))
    }
    this.lastMidiF = midiF
    f.hz = hz
    f.cents = (midiF - rounded) * 100

    if (this.candidateCount < 2) return
    if (f.note < 0) {
      this.startNote(rounded)
    } else if (rounded !== f.note) {
      if (this.candidateJumped || this.pickedSinceNote) this.startNote(rounded)
      else f.note = rounded // a bend crossing a semitone: colour follows, no event
    }
  }

  private startNote(note: number) {
    const f = this.features
    f.note = note
    this.anchorMidi = note
    this.pickedSinceNote = false
    f.noteChange = 1
  }
}
