/**
 * Optional WASM-backed fingerprint probe (issue #288).
 * Tries to call `_nam_studio_compute_fingerprint` on the main thread's WASM
 * module when it has been built with that export; returns null when unavailable
 * so callers can fall back to the metadata helper.
 */

// Lazy singleton — reused across chart renders.
let wasmModulePromise: Promise<unknown> | null = null

type NamStudioWasmModule = {
  _nam_studio_compute_fingerprint?: (
    jsonPtr: number,
    outGainPtr: number,
    outBrightPtr: number,
  ) => number
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  stringToNewUTF8?: (str: string) => number
  lengthBytesUTF8?: (str: string) => number
  UTF8ToString?: (ptr: number) => string
}

async function getWasmModule(): Promise<NamStudioWasmModule | null> {
  if (wasmModulePromise) {
    try {
      return (await wasmModulePromise) as NamStudioWasmModule | null
    } catch {
      return null
    }
  }
  wasmModulePromise = (async () => {
    try {
      // Dynamically import the Emscripten glue; it may not yet export the
      // fingerprint symbol if the wasm hasn't been rebuilt — that's fine.
      // @ts-ignore - wasm-core is a generated Emscripten output, not a TS module
      const modFactory = (await import(/* @vite-ignore */ '/wasm-core/nam_studio_core.js')) as {
        default?: (opts?: unknown) => Promise<NamStudioWasmModule>
      }
      const factory =
        modFactory.default ??
        (modFactory as unknown as (opts?: unknown) => Promise<NamStudioWasmModule>)
      if (typeof factory !== 'function') return null
      const wasmBytes = await fetch('/wasm-core/nam_studio_core.wasm').then((r) => r.arrayBuffer())
      const mod = await factory({ wasmBinary: wasmBytes })
      return mod
    } catch {
      return null
    }
  })()
  try {
    return (await wasmModulePromise) as NamStudioWasmModule | null
  } catch {
    return null
  }
}

export async function wasmFingerprintForJson(
  json: string,
): Promise<{ gainDb: number; brightness: number } | null> {
  const mod = await getWasmModule()
  if (!mod || typeof mod._nam_studio_compute_fingerprint !== 'function') return null
  const malloc = mod._malloc
  const free = mod._free
  // Allocate JSON as NUL-terminated UTF-8.
  let jsonPtr = 0
  let gainPtr = 0
  let brightPtr = 0
  try {
    if (mod.stringToNewUTF8) {
      jsonPtr = mod.stringToNewUTF8(json)
    } else {
      const bytes = new TextEncoder().encode(json + '\0')
      jsonPtr = malloc(bytes.length)
      mod.HEAPU8.set(bytes, jsonPtr)
    }
    gainPtr = malloc(4)
    brightPtr = malloc(4)
    const ok = mod._nam_studio_compute_fingerprint(jsonPtr, gainPtr, brightPtr)
    if (!ok) return null
    const gainDb = mod.HEAPF32[gainPtr >> 2]!
    const brightness = mod.HEAPF32[brightPtr >> 2]!
    if (!Number.isFinite(gainDb) || !Number.isFinite(brightness)) return null
    return { gainDb, brightness }
  } catch {
    return null
  } finally {
    if (jsonPtr) free(jsonPtr)
    if (gainPtr) free(gainPtr)
    if (brightPtr) free(brightPtr)
  }
}
