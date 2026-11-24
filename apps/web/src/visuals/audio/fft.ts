/**
 * Radix-2 magnitude spectrum for the visuals' feature engine. Analyser taps
 * differ in size and smoothing between the web (`AnalyserNode`) and the
 * desktop shim (`NativeAnalyser`), so features are computed from raw
 * time-domain samples here instead of `getByteFrequencyData` - same numbers
 * on every front end, and a window size chosen for timbre, not for meters.
 */

/** Largest power of two <= n (0 for n < 2). */
export function floorPow2(n: number): number {
  if (n < 2) return 0
  return 2 ** Math.floor(Math.log2(n))
}

export class SpectrumAnalyzer {
  readonly size: number
  private readonly window: Float32Array
  private readonly re: Float32Array
  private readonly im: Float32Array
  private readonly rev: Uint32Array
  /** Linear magnitude per bin, `size / 2` bins. Reused between calls. */
  readonly magnitude: Float32Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0)
      throw new Error(`fft size ${size} is not a power of two`)
    this.size = size
    this.window = new Float32Array(size)
    // Hann: good leakage/resolution balance for centroid + flux.
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
    this.re = new Float32Array(size)
    this.im = new Float32Array(size)
    this.magnitude = new Float32Array(size >>> 1)
    const bits = Math.log2(size)
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
  }

  /** Transforms the LAST `size` samples of `samples` (zero-padded at the front when shorter). */
  analyze(samples: Float32Array): Float32Array {
    const n = this.size
    const { re, im, window, rev } = this
    const offset = samples.length - n
    for (let i = 0; i < n; i++) {
      const s = offset + i >= 0 ? samples[offset + i]! : 0
      re[rev[i]!] = s * window[i]!
      im[rev[i]!] = 0
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1
      const ang = (-2 * Math.PI) / len
      const wr = Math.cos(ang)
      const wi = Math.sin(ang)
      for (let start = 0; start < n; start += len) {
        let cr = 1
        let ci = 0
        for (let k = 0; k < half; k++) {
          const a = start + k
          const b = a + half
          const tr = re[b]! * cr - im[b]! * ci
          const ti = re[b]! * ci + im[b]! * cr
          re[b] = re[a]! - tr
          im[b] = im[a]! - ti
          re[a] = re[a]! + tr
          im[a] = im[a]! + ti
          const ncr = cr * wr - ci * wi
          ci = cr * wi + ci * wr
          cr = ncr
        }
      }
    }
    // 2/sum(window) normalises a full-scale sine to ~1.
    const norm = 4 / n
    const mag = this.magnitude
    for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k]!, im[k]!) * norm
    return mag
  }
}
