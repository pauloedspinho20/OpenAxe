/** Clamp a value to [0, 1]. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export interface NativeAnalyserOptions {
  fftSize: number
  sampleRate: number
  /**
   * Returns the latest samples (oldest -> newest). Called synchronously on the
   * UI thread; may reuse an internal buffer, so callers copy immediately.
   */
  read: () => Float32Array
  /** AnalyserNode's own defaults; only the frequency-domain side reads these. */
  minDecibels?: number
  maxDecibels?: number
  smoothingTimeConstant?: number
}

/** AnalyserNode's defaults, so the desktop art behaves like the web one. */
const DEFAULT_MIN_DB = -100
const DEFAULT_MAX_DB = -30
const DEFAULT_SMOOTHING = 0.8

/** Blackman window (a = 0.16), the window the Web Audio spec's FFT applies. */
function blackmanWindow(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n
    w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x)
  }
  return w
}

/**
 * Bit-reversal permutation table for a radix-2 FFT, or null when `n` isn't a
 * power of two - there is no radix-2 transform then, so the frequency-domain
 * methods degrade to zeros rather than lying (see getByteFrequencyData).
 */
function bitReversalTable(n: number): Uint32Array | null {
  if (n < 2 || (n & (n - 1)) !== 0) return null
  const bits = Math.log2(n)
  const table = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b)
    table[i] = r
  }
  return table
}

/**
 * A Web Audio-free stand-in for the `AnalyserNode` the shared UI components
 * consume. Implements exactly the narrow surface LiveMeter / Tuner / BlockCard /
 * BlockHighlight / audioArt use (`fftSize`, `frequencyBinCount`,
 * `context.sampleRate`, `getFloatTimeDomainData`, `getByteTimeDomainData`,
 * `getByteFrequencyData`), fed by a synchronous sample source - the C++ side's
 * monitor taps for the real output/input, or a synthetic sine scaled to a
 * block's real native peak for the per-block meters.
 *
 * That surface is no longer a claim in a comment: NativeAnalyser.test.ts scans
 * the shared components for every `…analyser.<member>` access and fails if one
 * is missing here. The guard exists because the first version of this class
 * covered only the time domain, so `AudioReactiveArt`'s getByteFrequencyData
 * call threw on the first p5 frame after power-on and left every audio-reactive
 * visual in the desktop shell frozen for the rest of the session (issue #114).
 *
 * No AudioContext, no AudioNode, no Web Audio anywhere in the desktop path.
 */
export class NativeAnalyser {
  readonly fftSize: number
  readonly context: { sampleRate: number }
  readonly minDecibels: number
  readonly maxDecibels: number
  readonly smoothingTimeConstant: number
  private readonly read: () => Float32Array
  // Frequency-domain scratch, allocated once: getByteFrequencyData runs inside
  // a 45fps p5 draw loop and must not allocate per frame.
  private readonly window: Float32Array
  private readonly reverse: Uint32Array | null
  private readonly re: Float32Array
  private readonly im: Float32Array
  /** Previous frame's magnitudes, for smoothingTimeConstant. */
  private readonly smoothed: Float32Array

  constructor(opts: NativeAnalyserOptions) {
    this.fftSize = opts.fftSize
    this.context = { sampleRate: opts.sampleRate }
    this.read = opts.read
    this.minDecibels = opts.minDecibels ?? DEFAULT_MIN_DB
    this.maxDecibels = opts.maxDecibels ?? DEFAULT_MAX_DB
    this.smoothingTimeConstant = opts.smoothingTimeConstant ?? DEFAULT_SMOOTHING
    this.window = blackmanWindow(this.fftSize)
    this.reverse = bitReversalTable(this.fftSize)
    this.re = new Float32Array(this.fftSize)
    this.im = new Float32Array(this.fftSize)
    this.smoothed = new Float32Array(this.fftSize >>> 1)
  }

  /** Same relationship AnalyserNode defines: half the FFT size. */
  get frequencyBinCount(): number {
    return this.fftSize >>> 1
  }

  getFloatTimeDomainData(array: Float32Array): void {
    const s = this.read()
    const n = Math.min(array.length, s.length)
    for (let i = 0; i < n; i++) array[i] = s[i] ?? 0
    for (let i = n; i < array.length; i++) array[i] = 0
  }

  getByteTimeDomainData(array: Uint8Array): void {
    const s = this.read()
    const n = Math.min(array.length, s.length)
    for (let i = 0; i < n; i++) {
      const f = s[i] ?? 0
      const v = Math.round(128 + f * 127)
      array[i] = Math.max(0, Math.min(255, v))
    }
    for (let i = n; i < array.length; i++) array[i] = 128
  }

  /**
   * Magnitude spectrum of the current window in AnalyserNode's byte scale:
   * `minDecibels` maps to 0 and `maxDecibels` to 255, with the same Blackman
   * window and the same `smoothingTimeConstant` blending of magnitudes the
   * spec applies, so the shared audio-art sketches read the shape they were
   * written against on the web.
   *
   * Zero-fills when `fftSize` isn't a power of two - the radix-2 transform
   * can't run then. Nothing in the app builds such an analyser (256 for the
   * meters and art, 4096 for the tuner); it only keeps the method total.
   */
  getByteFrequencyData(array: Uint8Array): void {
    const bins = this.frequencyBinCount
    if (!this.reverse) {
      array.fill(0)
      return
    }

    const n = this.fftSize
    const src = this.read()
    const count = Math.min(n, src.length)
    for (let i = 0; i < count; i++) this.re[i] = (src[i] ?? 0) * (this.window[i] ?? 0)
    this.re.fill(0, count)
    this.im.fill(0)
    this.transform()

    const tau = this.smoothingTimeConstant
    const range = this.maxDecibels - this.minDecibels
    for (let k = 0; k < bins; k++) {
      const rr = this.re[k] ?? 0
      const ii = this.im[k] ?? 0
      // Smoothing blends magnitudes, before the dB conversion (as the spec does).
      const mag = tau * (this.smoothed[k] ?? 0) + (1 - tau) * (Math.sqrt(rr * rr + ii * ii) / n)
      this.smoothed[k] = mag
      if (k >= array.length) continue
      const db = mag > 0 ? 20 * Math.log10(mag) : this.minDecibels
      const scaled = Math.round((255 * (db - this.minDecibels)) / range)
      array[k] = Math.max(0, Math.min(255, scaled))
    }
    for (let k = bins; k < array.length; k++) array[k] = 0
  }

  /** In-place iterative radix-2 Cooley-Tukey FFT over `re`/`im`. */
  private transform(): void {
    const n = this.fftSize
    const reverse = this.reverse
    if (!reverse) return

    for (let i = 0; i < n; i++) {
      const j = reverse[i] ?? 0
      if (j <= i) continue
      const tr = this.re[i] ?? 0
      this.re[i] = this.re[j] ?? 0
      this.re[j] = tr
      const ti = this.im[i] ?? 0
      this.im[i] = this.im[j] ?? 0
      this.im[j] = ti
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1
      const angle = (-2 * Math.PI) / len
      const stepR = Math.cos(angle)
      const stepI = Math.sin(angle)
      for (let start = 0; start < n; start += len) {
        let wr = 1
        let wi = 0
        for (let k = 0; k < half; k++) {
          const a = start + k
          const b = a + half
          const br = this.re[b] ?? 0
          const bi = this.im[b] ?? 0
          const tr = br * wr - bi * wi
          const ti = br * wi + bi * wr
          const ar = this.re[a] ?? 0
          const ai = this.im[a] ?? 0
          this.re[a] = ar + tr
          this.im[a] = ai + ti
          this.re[b] = ar - tr
          this.im[b] = ai - ti
          const nextR = wr * stepR - wi * stepI
          wi = wr * stepI + wi * stepR
          wr = nextR
        }
      }
    }
  }
}

/**
 * A `read()` source that synthesizes a sine of amplitude equal to the current
 * native peak, so a block meter shows the true level without transporting a
 * real waveform from C++. The buffer is reused across calls (no allocation per
 * read) and the phase advances continuously so the waveform isn't static.
 */
export function peakSineSource(
  fftSize: number,
  sampleRate: number,
  getPeak: () => number,
): () => Float32Array {
  const buf = new Float32Array(fftSize)
  const omega = (2 * Math.PI * 440) / sampleRate
  let phase = 0
  return () => {
    const amp = clamp01(getPeak())
    for (let i = 0; i < fftSize; i++) {
      buf[i] = Math.sin(phase) * amp
      phase += omega
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI
    }
    return buf
  }
}
