/**
 * Shared AudioWorkletProcessor base for every nam_studio_core-backed effect
 * (issue #22). Handles what's identical across every one of them: WASM
 * instantiation, a one-block IN -> block -> OUT rig, and the per-process()
 * buffer marshaling (malloc'd float buffers + pointer arrays, HEAPF32
 * copy-in/copy-out). Subclasses provide a block kind and override
 * `applyParams` to push their own AudioParam values into the graph each
 * `process()` call (and `onReady` for one-time setup once the module/block
 * exist, e.g. forcing a param to a fixed value).
 *
 * Lives here (not under src/) and imports './nam_studio_core.js' with a
 * plain relative path so every file in this directory resolves as a static
 * asset without going through Vite's bundler - same category of asset as
 * neural-amp-modeler-wasm's own prebuilt worklet+wasm pair.
 */
import createModule from './nam_studio_core.js'

// Emscripten's runtime uses performance.now() for monotonic time (backing
// AudioEngine::Process's own CPU-load timer, std::chrono::steady_clock).
// AudioWorkletGlobalScope has `performance` per spec in real browsers
// (Chrome/Firefox/Safari - see issue #22's own compatibility table), but not
// every environment agrees, so this stays a no-op almost everywhere and a
// safety net where it's missing rather than a workaround for one browser.
if (typeof performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() }
}

// Web Audio's render quantum is fixed at 128 frames - not configurable.
export const FRAMES = 128
// See packages/core/include/nam_studio/api.h's NAM_STUDIO_IN_RAIL / NAM_STUDIO_OUT_RAIL sentinels.
export const IN_RAIL = -1
export const OUT_RAIL = -2

const BYTES_PER_FLOAT = 4

export class NamStudioEffectProcessor extends AudioWorkletProcessor {
  constructor(options, blockKind) {
    super()
    this.module = null
    // AudioWorkletGlobalScope doesn't reliably expose fetch() (varies by
    // browser), so createModule()'s own default fetch-based WASM loading
    // can't be trusted here - the TS wrapper (e.g. DragonflyReverb.ts)
    // fetches the .wasm bytes on the main thread instead and hands them
    // over via processorOptions, same dance neural-amp-modeler-wasm's own
    // engine does for its worklet.
    const wasmBytes = options.processorOptions.wasmBytes
    this.ready = createModule({
      instantiateWasm(imports, successCallback) {
        WebAssembly.instantiate(wasmBytes, imports).then((result) => {
          successCallback(result.instance, result.module)
        })
        return {} // signals async instantiation - see Emscripten's instantiateWasm contract
      },
    }).then((module) => {
      this.module = module
      this.graph = module._nam_studio_graph_create()
      this.block = module._nam_studio_add_block(this.graph, blockKind, 0, 0)
      module._nam_studio_connect(this.graph, IN_RAIL, 0, this.block, 0)
      module._nam_studio_connect(this.graph, this.block, 0, OUT_RAIL, 0)
      module._nam_studio_reset(this.graph, sampleRate, FRAMES)

      const bytes = FRAMES * BYTES_PER_FLOAT
      this.inL = module._malloc(bytes)
      this.inR = module._malloc(bytes)
      this.outL = module._malloc(bytes)
      this.outR = module._malloc(bytes)
      this.inPtrs = module._malloc(8)
      this.outPtrs = module._malloc(8)
      module.HEAPU32.set([this.inL, this.inR], this.inPtrs >> 2)
      module.HEAPU32.set([this.outL, this.outR], this.outPtrs >> 2)
      this.silence = new Float32Array(FRAMES)

      this.onReady(module, this.block)
    })
  }

  /** Override for one-time setup once the module/block exist. No-op by default. */
  onReady(_module, _block) {}

  /** Override to push this process() call's AudioParam values into the graph. No-op by default. */
  applyParams(_module, _block, _parameters) {}

  process(inputs, outputs, parameters) {
    const module = this.module
    if (!module) return true // still loading (async WASM instantiation) - silence until ready

    this.applyParams(module, this.block, parameters)

    const input = inputs[0] ?? []
    module.HEAPF32.set(input[0] ?? this.silence, this.inL >> 2)
    module.HEAPF32.set(input[1] ?? input[0] ?? this.silence, this.inR >> 2)
    module._nam_studio_process(this.graph, this.inPtrs, 2, this.outPtrs, 2, FRAMES)

    const output = outputs[0] ?? []
    output[0]?.set(module.HEAPF32.subarray(this.outL >> 2, (this.outL >> 2) + FRAMES))
    output[1]?.set(module.HEAPF32.subarray(this.outR >> 2, (this.outR >> 2) + FRAMES))
    return true
  }
}
