/** Pure helpers for the block real-time analyser (kept out of the component so they are testable). */

export const MIN_HZ = 20
export const MAX_HZ = 20000
export const MIN_DB = -90
export const MAX_DB = 0
/** Pink-noise-style tilt: 4.5 dB/octave about 1 kHz, so guitar spectra read flatter. */
export const TILT_DB_PER_OCT = 4.5

export const linToDb = (lin: number): number => (lin > 1e-9 ? 20 * Math.log10(lin) : MIN_DB)

/** Frequency at normalized x (0..1) across a log axis. */
export const xToHz = (x: number): number => MIN_HZ * (MAX_HZ / MIN_HZ) ** x
export const hzToX = (hz: number): number => Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)

/** Normalized y (0 = top / MAX_DB, 1 = bottom / MIN_DB). */
export const dbToY = (db: number): number => (MAX_DB - db) / (MAX_DB - MIN_DB)

export const tiltDb = (hz: number): number => TILT_DB_PER_OCT * Math.log2(hz / 1000)

/**
 * Collapse a linear-magnitude FFT into `columns` dB values on a log frequency
 * axis. Each column takes the max of the bins it covers (so narrow peaks are
 * not lost at the high end) and interpolates between bins where a column falls
 * inside a single bin (the low end).
 */
export function spectrumColumnsDb(
  magnitude: Float32Array,
  sampleRate: number,
  columns: number,
  tilt: boolean,
  out: Float32Array,
): Float32Array {
  const binHz = sampleRate / 2 / magnitude.length
  for (let c = 0; c < columns; c++) {
    const lo = xToHz(c / columns)
    const hi = xToHz((c + 1) / columns)
    const centre = Math.sqrt(lo * hi)
    const b0 = lo / binHz
    const b1 = hi / binHz
    let mag: number
    if (b1 - b0 < 1) {
      const pos = centre / binHz
      const i = Math.min(magnitude.length - 2, Math.max(0, Math.floor(pos)))
      const f = pos - i
      mag = magnitude[i]! * (1 - f) + magnitude[i + 1]! * f
    } else {
      mag = 0
      for (let b = Math.ceil(b0); b <= Math.min(magnitude.length - 1, Math.floor(b1)); b++) {
        mag = Math.max(mag, magnitude[b]!)
      }
    }
    out[c] = linToDb(mag) + (tilt ? tiltDb(centre) : 0)
  }
  return out
}

/** One-pole smoothing of a dB trace toward `next` (in place). `amount` 0 = none, ->1 = slower. */
export function smoothDb(prev: Float32Array, next: Float32Array, amount: number): void {
  for (let i = 0; i < prev.length; i++) {
    prev[i] = prev[i] === MIN_DB ? next[i]! : prev[i]! * amount + next[i]! * (1 - amount)
  }
}
