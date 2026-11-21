/**
 * Main-thread WASM bridge for the tuner (issue #123).
 *
 * The core's pitch detection and note mapping are pure functions compiled
 * into the same openaxe_core module the AudioWorklets use. This module
 * loads that same binary on the main thread so `Tuner` can call
 * `_openaxe_detect_pitch` / `_openaxe_frequency_to_note` without a
 * worklet round-trip — the direct path the issue's "callable from the UI
 * thread (web)" contract expects.
 *
 * Loading is lazy and async; callers should `await ensureWasm()` once and
 * then call the sync wrappers (`detectPitchWasm`, `frequencyToNoteWasm`).
 * When the module isn't available (tests in Node, fetch failure), the
 * wrappers return null/false so the caller can fall back to the TS
 * implementations in pitchDetect.ts / noteUtils.ts.
 */

export interface WasmPitchResult {
  frequency: number
  clarity: number
}
export interface WasmDetectedNote {
  name: string
  octave: number
  cents: number
}

// Emscripten module shape we actually use.
interface OpenAxeModule {
  _openaxe_detect_pitch: (ptr: number, count: number, sampleRate: number) => number
  _openaxe_frequency_to_note: (
    freq: number,
    ref: number,
    outName: number,
    outOctave: number,
    outCents: number,
  ) => number
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  HEAPF32: Float32Array
  HEAPU32: Uint32Array
  HEAP32: Int32Array
  UTF8ToString: (ptr: number) => string
}

let modulePromise: Promise<OpenAxeModule | null> | null = null
let cached: OpenAxeModule | null = null

async function loadModule(): Promise<OpenAxeModule | null> {
  // Node / jsdom tests have no fetch for the wasm binary or no AudioWorklet
  // module resolution — gracefully degrade to the TS fallback.
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null
  try {
    // Fetch the wasm bytes ourselves so Emscripten doesn't need locateFile.
    const wasmBytes = await fetch('/wasm-core/openaxe_core.wasm').then((r) =>
      r.ok ? r.arrayBuffer() : Promise.reject(new Error(`wasm fetch ${r.status}`)),
    )
    // Dynamic import of the Emscripten glue — it is an ES module (EXPORT_ES6=1).
    // `public/wasm-core/*` is copied verbatim and never processed by Vite, so a
    // literal `import('/wasm-core/...')` is rejected by Vite's import-analysis
    // (JS in `/public` can't be imported); the specifier is therefore assembled
    // at runtime and marked @vite-ignore, letting the browser fetch the
    // published file exactly as the worklet does via its relative import.
    //
    // The dev and production paths differ: under `vite dev` the import is
    // rewritten to `__vite__injectQuery(url, 'import')`, and Vite's dev server
    // rejects `/public` files requested with `?import` (500). The dev-only
    // `Function` indirection sidesteps that rewrite. Production uses the plain
    // import so it needs no eval — the web app's CSP is
    // `script-src 'self' 'wasm-unsafe-eval'` (no `'unsafe-eval'`). The dev
    // branch is never executed in a production build.
    const wasmJsUrl = '/wasm-core/' + 'openaxe_core.js'
    type GlueModule = { default: (opts: Record<string, unknown>) => Promise<OpenAxeModule> }
    // @ts-ignore - wasm-core is a generated Emscripten output, not a TS module
    const glue: GlueModule = await (import.meta.env.DEV
      ? Function('u', 'return import(u)')(wasmJsUrl)
      : import(/* @vite-ignore */ wasmJsUrl))
    const createModule = glue.default
    const mod = await createModule({
      instantiateWasm(
        imports: WebAssembly.Imports,
        success: (instance: WebAssembly.Instance) => void,
      ) {
        WebAssembly.instantiate(wasmBytes, imports).then(
          (r) => success(r.instance),
          (e) => {
            console.warn('[openAxeWasm] instantiate failed', e)
          },
        )
        return {}
      },
    })
    return mod
  } catch (e) {
    console.warn('[openAxeWasm] load failed, falling back to TS tuner', e)
    return null
  }
}

export function ensureWasm(): Promise<OpenAxeModule | null> {
  if (cached) return Promise.resolve(cached)
  if (!modulePromise) {
    modulePromise = loadModule().then((m) => {
      cached = m
      return m
    })
  }
  return modulePromise
}

/** Synchronous WASM pitch detection — call after `await ensureWasm()`. */
export function detectPitchWasm(
  buffer: Float32Array,
  sampleRate: number,
  mod: OpenAxeModule | null,
): WasmPitchResult | null {
  if (!mod || !buffer || buffer.length === 0 || sampleRate <= 0) return null
  const count = buffer.length
  const ptr = mod._malloc(count * 4)
  if (!ptr) return null
  try {
    mod.HEAPF32.set(buffer, ptr >> 2)
    const hz = mod._openaxe_detect_pitch(ptr, count, sampleRate)
    if (!hz || hz <= 0) return null
    // Clarity isn't exposed as a separate out-param on the Hz-only ABI
    // (it drove the confidence gate inside DetectPitch). Report 1.0 for a
    // found pitch so the UI's threshold checks keep working; the TS fallback
    // still surfaces the real clarity when WASM isn't loaded.
    return { frequency: hz, clarity: 1 }
  } finally {
    mod._free(ptr)
  }
}

/** Synchronous WASM note mapping — call after `await ensureWasm()`. */
export function frequencyToNoteWasm(
  frequency: number,
  referenceA4: number,
  mod: OpenAxeModule | null,
): WasmDetectedNote | null {
  if (!mod || frequency <= 0) return null
  const ref = referenceA4 > 0 ? referenceA4 : 440
  const namePtr = mod._malloc(4)
  const octPtr = mod._malloc(4)
  const centsPtr = mod._malloc(4)
  if (!namePtr || !octPtr || !centsPtr) {
    if (namePtr) mod._free(namePtr)
    if (octPtr) mod._free(octPtr)
    if (centsPtr) mod._free(centsPtr)
    return null
  }
  try {
    const ok = mod._openaxe_frequency_to_note(frequency, ref, namePtr, octPtr, centsPtr)
    if (!ok) return null
    const nameAddr = mod.HEAPU32[namePtr >> 2]!
    const name = mod.UTF8ToString(nameAddr)
    const octave = mod.HEAP32[octPtr >> 2]!
    const cents = mod.HEAP32[centsPtr >> 2]!
    return { name, octave, cents }
  } finally {
    mod._free(namePtr)
    mod._free(octPtr)
    mod._free(centsPtr)
  }
}

// For tests: reset the singleton.
export function __resetWasmForTests() {
  modulePromise = null
  cached = null
}
