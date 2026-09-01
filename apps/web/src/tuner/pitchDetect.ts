/**
 * Autocorrelation-based pitch detection (issue #123): the single detector
 * lives in packages/core/src/dsp/pitch_detect.cpp, compiled to WASM for
 * the web path and used natively on desktop/plugin. This file is the TS
 * fallback + the JS entry point that forwards to that core when the WASM
 * module is ready — preserving the original pure-TS algorithm so tests and
 * offline environments stay deterministic while the live app converges on
 * one implementation everywhere.
 *
 * Original rationale: normalized cross-correlation at each lag in the
 * musically-relevant range, refined with parabolic interpolation for
 * sub-sample precision. Lighter-weight than issue #7's suggested
 * Pitchfinder.js-in-an-AudioWorklet approach — no new dependency, no
 * worklet module to register — at the cost of running on the main thread
 * via a timer rather than the audio thread. Good enough for a tuner
 * (which only needs a few updates a second, not sample-accuracy).
 */
export interface PitchResult {
  /** Detected fundamental frequency in Hz. */
  frequency: number
  /** 0..1 - the normalized correlation at the detected lag; low values are unreliable. */
  clarity: number
}

// ——— WASM fast path (issue #123) ———
// Loaded lazily on the main thread; when ready, detectPitch() forwards to
// the core's `openaxe_detect_pitch` and returns its result. Until then
// (and in Node/jsdom tests where fetch/WASM is unavailable) the pure-TS
// fallback below runs instead, so behaviour is never broken by WASM readiness.
// openAxeWasm itself has no import of this file (it defines its own result
// types), so a static import here is safe — no circular dependency.
import { detectPitchWasm, ensureWasm } from './openAxeWasm'

let wasmMod: unknown | null = null
let wasmReady = false
if (typeof window !== 'undefined') {
  void ensureWasm()
    .then((m) => {
      wasmMod = m
      wasmReady = m !== null
    })
    .catch(() => {})
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

/** Pure-TS fallback — extracted so tests and the WASM fallback share it. */
export function detectPitchFallback(
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

/**
 * Detect the fundamental frequency of a time-domain buffer, or null if the
 * signal is too quiet or has no clear periodicity in the searched range
 * (silence, noise, a chord). Default range covers a 5-string bass's low B
 * (~31Hz) up to well past a guitar's high frets.
 *
 * When the WASM module is ready and the default 25..1500Hz range is used,
 * this forwards to the core's `openaxe_detect_pitch` so every front end
 * shares one detector (issue #123); otherwise it runs the TS fallback
 * above. Custom ranges stay on the TS path since the ABI's Hz-only entry
 * point is fixed to that range — call `detectPitchFallback` directly for
 * non-default ranges and get identical results to the C++ fallback.
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFrequency = 25,
  maxFrequency = 1500,
): PitchResult | null {
  const isDefaultRange = minFrequency === 25 && maxFrequency === 1500
  if (wasmReady && wasmMod && isDefaultRange) {
    try {
      const r = detectPitchWasm(buffer, sampleRate, wasmMod as never)
      // WASM reports null as Hz==0. Fall back to TS null is equivalent.
      if (r) return r as PitchResult
      // For a null result both agree — but let wasm's null stand: it is
      // the core's authoritative answer at the same threshold.
      if (r === null) {
        // Double-check with the TS path in debug is unnecessary — the
        // cores's threshold is intentionally identical. Return null directly.
        return null
      }
    } catch {
      // Fall through to TS fallback on any WASM error (e.g. OOM).
    }
  }
  return detectPitchFallback(buffer, sampleRate, minFrequency, maxFrequency)
}
