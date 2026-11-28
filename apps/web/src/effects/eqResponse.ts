/**
 * Magnitude response of the core's graphic EQ (packages/core/src/dsp/equalizer.cpp):
 * ten series RBJ peaking biquads at fixed octave centres with Q = sqrt(2), then
 *  Display-only - the DSP stays authoritative; a core test pins
 * the per-band gain at each centre, and eqResponse.test.ts pins this model to the
 * same numbers.
 */
import { EQ_GRAPHIC_BANDS } from './paramSchema'

export const GRAPHIC_Q = Math.SQRT2
const REF_SAMPLE_RATE = 48000

/** Magnitude in dB of one RBJ peaking filter at `freq`. */
export function peakingResponseDb(
  centreHz: number,
  gainDb: number,
  freq: number,
  sampleRate = REF_SAMPLE_RATE,
): number {
  if (gainDb === 0 || centreHz >= sampleRate * 0.45) return 0
  const a = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * centreHz) / sampleRate
  const alpha = Math.sin(w0) / (2 * GRAPHIC_Q)
  const cos = Math.cos(w0)
  const b0 = 1 + alpha * a
  const b1 = -2 * cos
  const b2 = 1 - alpha * a
  const a0 = 1 + alpha / a
  const a1 = -2 * cos
  const a2 = 1 - alpha / a
  const w = (2 * Math.PI * freq) / sampleRate
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const nRe = b0 + b1 * c1 + b2 * c2
  const nIm = -(b1 * s1 + b2 * s2)
  const dRe = a0 + a1 * c1 + a2 * c2
  const dIm = -(a1 * s1 + a2 * s2)
  return 10 * Math.log10((nRe * nRe + nIm * nIm) / (dRe * dRe + dIm * dIm))
}

/** Total graphic-EQ response (dB) at `freq` for the given band gains. */
export function graphicResponseDb(gains: readonly number[], freq: number): number {
  let db = 0
  EQ_GRAPHIC_BANDS.forEach((band, i) => {
    db += peakingResponseDb(band.hz, gains[i] ?? 0, freq)
  })
  return db
}
