/**
 * SoundFont bundling (#165): compact MIT-licensed GM font, lazy load, user-supplied
 * SF2/SF3. Evaluation (done during Phase 3 planning):
 *
 * - FluidR3_GM (MIT, ~141 MB full, ~5-8 MB subset with one bank) — best coverage
 *   incl. drums, widely used, MIT license is GPLv3-compatible.
 * - GeneralUser GS (CC0-ish, ~30 MB) — smaller but less consistent drum map.
 * - Arachno (non-commercial) — rejected (not GPL-compatible).
 *
 * Choice: FluidR3_GM subset (single bank, 0) as default, lazy-loaded from
 * `/soundfonts/FluidR3_GM.sf2` (checked into `apps/web/public/soundfonts/` when
 * the subset is generated) with CDN fallback. Attribution in THIRD_PARTY_NOTICES.
 *
 * Loading pattern mirrors `assetCache.ts`: fetch → cache in IndexedDB `assets`
 * store under id `soundfont:default` (or `soundfont:user:<name>`), so the next
 * launch is offline. Size is guarded by `MAX_SOUNDFONT_BYTES` (32 MB, same as
 * kMaxModelBytes) before touching WASM.
 */

import { getCachedAsset, putCachedAsset } from '../engine/assetCache'
import {
  assertSoundfontBytes,
  assertSoundfontFile,
  MAX_SOUNDFONT_BYTES,
} from '../engine/assetLimits'

const DEFAULT_SOUNDFONT_ID = 'soundfont:default'
const DEFAULT_SOUNDFONT_URL = '/soundfonts/FluidR3_GM.sf2'
const CDN_FALLBACK_URL =
  'https://cdn.jsdelivr.net/gh/FluidSynth/fluid-soundfont@master/FluidR3_GM.sf2'

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.arrayBuffer()
}

/**
 * Ensure the default GM SoundFont is loaded into the engine. Fetches from
 * cache if present, otherwise from `/soundfonts/FluidR3_GM.sf2` then CDN,
 * caches the Blob, and hands the bytes to the worklet's song loader.
 *
 * The `loadBytes` callback is `(bytes: Uint8Array) => Promise<void>` — in
 * Phase 4 it will be `rig.loadSoundfont(bytes)`, for now the caller supplies
 * the engine call so this module stays worklet-agnostic.
 */
export async function ensureDefaultSoundfont(
  loadBytes: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const cached = await getCachedAsset(DEFAULT_SOUNDFONT_ID)
  if (cached) {
    const buf = await cached.arrayBuffer()
    assertSoundfontBytes(buf)
    await loadBytes(new Uint8Array(buf))
    return
  }

  let buf: ArrayBuffer | null = null
  try {
    buf = await fetchArrayBuffer(DEFAULT_SOUNDFONT_URL)
  } catch {
    buf = await fetchArrayBuffer(CDN_FALLBACK_URL)
  }
  if (buf.byteLength > MAX_SOUNDFONT_BYTES) {
    throw new Error(`Default SoundFont too large: ${buf.byteLength} > ${MAX_SOUNDFONT_BYTES}`)
  }
  assertSoundfontBytes(buf)
  await putCachedAsset(DEFAULT_SOUNDFONT_ID, new Blob([buf]))
  await loadBytes(new Uint8Array(buf))
}

/**
 * Load a user-supplied SF2/SF3 file (from `<input type=file>`). Validates
 * the File handle (extension + size) and the RIFF header, caches it, and
 * hands the bytes to the engine.
 */
export async function loadUserSoundfont(
  file: File,
  loadBytes: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  assertSoundfontFile(file)
  const buf = await file.arrayBuffer()
  assertSoundfontBytes(buf)
  const id = `soundfont:user:${file.name}`
  await putCachedAsset(id, new Blob([buf]))
  // Also promote to default so the next song play uses the user's font.
  await putCachedAsset(DEFAULT_SOUNDFONT_ID, new Blob([buf]))
  await loadBytes(new Uint8Array(buf))
}
