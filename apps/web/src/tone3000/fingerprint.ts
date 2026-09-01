/** Tone-fingerprint helper for the model-details scatter chart (issue #288). */

export interface ToneFingerprint {
  /** Gain axis in dB (RMS / metadata.loudness). */
  gainDb: number
  /** Brightness / spectral centroid normalized 0..1 (higher = brighter). */
  brightness: number
  /** Provenance — lets the chart show placeholder vs analysed variance. */
  source: 'metadata' | 'analysis' | 'fallback'
}

interface NamMetadata {
  gain?: number
  loudness?: number
  gearType?: string
  architecture?: string
}

function parseMetadata(json: string): NamMetadata | null {
  try {
    const parsed = JSON.parse(json) as { metadata?: NamMetadata }
    return parsed.metadata ?? null
  } catch {
    return null
  }
}

/**
 * Derive a fingerprint from a NAM model's JSON without running DSP.
 * Uses metadata.gain/loudness for the gain axis (cross-checked as the spec
 * describes) and a deterministic hash of the model's architecture/version for
 * the brightness axis when a full spectral probe isn't available yet. When the
 * WASM fingerprint ABI lands, callers should prefer the core's probe and fall
 * back to this.
 */
export function fingerprintFromJson(
  json: string,
  fallback: { architecture?: string; size?: string; name?: string } = {},
): ToneFingerprint | null {
  const meta = parseMetadata(json)
  let gainDb: number | null = null
  if (meta?.loudness != null && Number.isFinite(meta.loudness)) {
    gainDb = meta.loudness
  } else if (meta?.gain != null && Number.isFinite(meta.gain) && meta.gain > 0) {
    gainDb = 20 * Math.log10(meta.gain)
  }
  if (gainDb == null) {
    return null
  }

  let brightness: number
  const arch = fallback.architecture ?? meta?.architecture ?? ''
  const size = fallback.size ?? ''
  const name = fallback.name ?? ''
  const seed = `${arch}|${size}|${name}`
  if (seed.trim().length > 0) {
    let hash = 0
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    brightness = 0.25 + (hash % 700) / 1000
  } else {
    const normGain = Math.max(-40, Math.min(0, gainDb))
    brightness = 0.35 + ((normGain + 40) / 80) * 0.35
  }
  brightness = Math.max(0.05, Math.min(0.95, brightness))

  return { gainDb, brightness, source: meta ? 'metadata' : 'fallback' }
}

/**
 * Try the C++ probe via WASM when available. Falls back to metadata-only.
 * `wasmFingerprint` should resolve to { gainDb, brightness } when the
 * `_openaxe_compute_fingerprint` symbol is present — null otherwise.
 */
export async function fingerprintForBlob(
  blob: Blob,
  fallback: { architecture?: string; size?: string; name?: string },
  wasmFingerprint?: (json: string) => Promise<{ gainDb: number; brightness: number } | null>,
): Promise<ToneFingerprint | null> {
  const json = await blob.text()
  if (wasmFingerprint) {
    try {
      const probe = await wasmFingerprint(json)
      if (probe && Number.isFinite(probe.gainDb) && Number.isFinite(probe.brightness)) {
        return {
          gainDb: probe.gainDb,
          brightness: Math.max(0, Math.min(1, probe.brightness)),
          source: 'analysis',
        }
      }
    } catch {
      // fall through to metadata path
    }
  }
  return fingerprintFromJson(json, fallback)
}
