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
}

/**
 * A Web Audio-free stand-in for the `AnalyserNode` the shared UI components
 * consume. Implements exactly the narrow surface LiveMeter / Tuner / BlockCard /
 * BlockHighlight / audioArt use (`fftSize`, `context.sampleRate`,
 * `getByteTimeDomainData`, `getFloatTimeDomainData`), fed by a synchronous
 * sample source - the C++ side's monitor taps for the real output/input, or a
 * synthetic sine scaled to a block's real native peak for the per-block meters.
 *
 * No AudioContext, no AudioNode, no Web Audio anywhere in the desktop path.
 */
export class NativeAnalyser {
  readonly fftSize: number
  readonly context: { sampleRate: number }
  private readonly read: () => Float32Array

  constructor(opts: NativeAnalyserOptions) {
    this.fftSize = opts.fftSize
    this.context = { sampleRate: opts.sampleRate }
    this.read = opts.read
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
