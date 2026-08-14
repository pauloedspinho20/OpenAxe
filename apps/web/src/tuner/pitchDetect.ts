/**
 * Autocorrelation-based pitch detection: normalized cross-correlation at
 * each lag in the musically-relevant range, refined with parabolic
 * interpolation for sub-sample precision. Lighter-weight than issue #7's
 * suggested Pitchfinder.js-in-an-AudioWorklet approach - no new dependency,
 * no worklet module to register - at the cost of running on the main
 * thread via a timer rather than the audio thread. Good enough for a tuner
 * (which only needs a few updates a second, not sample-accuracy); worth
 * revisiting if lower latency or better low-string accuracy is needed.
 */
export interface PitchResult {
  /** Detected fundamental frequency in Hz. */
  frequency: number
  /** 0..1 - the normalized correlation at the detected lag; low values are unreliable. */
  clarity: number
}

const RMS_GATE = 0.01
const MIN_CLARITY = 0.9

/**
 * Normalized cross-correlation between buffer[0..size-lag) and
 * buffer[lag..size) - a proper Pearson-style coefficient in [-1, 1]
 * regardless of lag (unlike a raw dot product, which shrinks at larger
 * lags purely from summing fewer terms, independent of periodicity).
 */
function correlationAt(buffer: Float32Array, lag: number): number {
  const count = buffer.length - lag
  let sum = 0
  let energyA = 0
  let energyB = 0
  for (let i = 0; i < count; i++) {
    const a = buffer[i]!
    const b = buffer[i + lag]!
    sum += a * b
    energyA += a * a
    energyB += b * b
  }
  const denom = Math.sqrt(energyA * energyB)
  return denom > 0 ? sum / denom : 0
}

/**
 * Detect the fundamental frequency of a time-domain buffer, or null if the
 * signal is too quiet or has no clear periodicity in the searched range
 * (silence, noise, a chord). Default range covers a 5-string bass's low B
 * (~31Hz) up to well past a guitar's high frets.
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFrequency = 25,
  maxFrequency = 1500,
): PitchResult | null {
  const size = buffer.length

  let sumSquares = 0
  for (let i = 0; i < size; i++) sumSquares += buffer[i]! * buffer[i]!
  const rms = Math.sqrt(sumSquares / size)
  if (rms < RMS_GATE) return null

  const minLag = Math.max(1, Math.floor(sampleRate / maxFrequency))
  const maxLag = Math.min(size - 2, Math.ceil(sampleRate / minFrequency))
  if (maxLag <= minLag) return null

  // Correlation near `minLag` is often still high purely because a
  // low-frequency waveform hasn't shifted phase much yet at a small lag -
  // that's not evidence of periodicity at that lag. Walk past this initial
  // decline into its first trough before tracking peaks, exactly like a
  // standard autocorrelation pitch tracker: only then does the first peak
  // we find correspond to the true fundamental rather than a false-early
  // reading or (searching the *global* max instead) a subharmonic further out.
  let lag = minLag
  while (lag < maxLag && correlationAt(buffer, lag) > correlationAt(buffer, lag + 1)) lag++

  let bestLag = -1
  let bestClarity = -1
  for (; lag <= maxLag; lag++) {
    const clarity = correlationAt(buffer, lag)
    if (clarity > bestClarity) {
      bestClarity = clarity
      bestLag = lag
    } else if (bestClarity >= MIN_CLARITY) {
      // Clarity just started dropping after clearing the threshold - we've
      // found the first strong peak past the trough, i.e. the fundamental.
      break
    }
  }
  if (bestLag < 0 || bestClarity < MIN_CLARITY) return null

  const prev = bestLag > minLag ? correlationAt(buffer, bestLag - 1) : bestClarity
  const next = bestLag < maxLag ? correlationAt(buffer, bestLag + 1) : bestClarity
  const denom = 2 * (2 * bestClarity - prev - next)
  const refinedLag = denom !== 0 ? bestLag + (next - prev) / denom : bestLag

  return { frequency: sampleRate / refinedLag, clarity: bestClarity }
}
