/**
 * AudioWorkletProcessor for issue #22's first C++/WASM DSP slice: Dragonfly
 * Hall Reverb, running the real nam_studio_core WASM build (compiled by
 * scripts/build-core-wasm.sh from packages/core) instead of the app's own
 * hand-rolled Freeverb. Lives here (not under src/) and imports
 * './nam_studio_core.js' with a plain relative path so both files resolve
 * as static assets without going through Vite's bundler - same category of
 * asset as neural-amp-modeler-wasm's own prebuilt worklet+wasm pair.
 *
 * Uses real AudioParams (roomSize/damping), not postMessage - same
 * sample-accurate-automation convention as the app's own NoiseGate
 * (apps/web/src/effects/NoiseGate.ts / noiseGateWorklet.js).
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
const FRAMES = 128
const BYTES_PER_FLOAT = 4

// See packages/core/include/nam_studio/api.h's NamStudioBlockKind enum -
// NAM_STUDIO_BLOCK_REVERB is ordinal 9.
const REVERB_KIND = 9
// See api.h's NAM_STUDIO_IN_RAIL / NAM_STUDIO_OUT_RAIL sentinels.
const IN_RAIL = -1
const OUT_RAIL = -2

// Dragonfly Hall Reverb's own param indices/ranges - see
// packages/core/src/dsp/dragonfly_hall_reverb.cpp's kParamInfo table.
const DRY_LEVEL_PARAM = 0 // 0-100%; forced to 0 - the Effect's own dry/wet crossfade already handles mix
const HIGH_CUT_PARAM = 10 // 1000-16000Hz
const DECAY_PARAM = 15 // 0.1-10s

const DECAY_MIN = 0.1
const DECAY_MAX = 10
const HIGH_CUT_MIN = 1000
const HIGH_CUT_MAX = 16000

class DragonflyReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'roomSize', defaultValue: 0.84, minValue: 0, maxValue: 0.97 },
      { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ]
  }

  constructor(options) {
    super()
    this.module = null
    // AudioWorkletGlobalScope doesn't reliably expose fetch() (varies by
    // browser), so createModule()'s own default fetch-based WASM loading
    // can't be trusted here - DragonflyReverb.ts fetches the .wasm bytes on
    // the main thread instead and hands them over via processorOptions,
    // same dance neural-amp-modeler-wasm's own engine does for its worklet.
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
      this.reverbBlock = module._nam_studio_add_block(this.graph, REVERB_KIND, 0, 0)
      module._nam_studio_connect(this.graph, IN_RAIL, 0, this.reverbBlock, 0)
      module._nam_studio_connect(this.graph, this.reverbBlock, 0, OUT_RAIL, 0)
      module._nam_studio_reset(this.graph, sampleRate, FRAMES)
      module._nam_studio_set_param(this.graph, this.reverbBlock, DRY_LEVEL_PARAM, 0)

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
    })
  }

  process(inputs, outputs, parameters) {
    const module = this.module
    if (!module) return true // still loading (async WASM instantiation) - silence until ready

    const decay = DECAY_MIN + (parameters.roomSize[0] / 0.97) * (DECAY_MAX - DECAY_MIN)
    const highCut = HIGH_CUT_MAX - parameters.damping[0] * (HIGH_CUT_MAX - HIGH_CUT_MIN)
    module._nam_studio_set_param(this.graph, this.reverbBlock, DECAY_PARAM, decay)
    module._nam_studio_set_param(this.graph, this.reverbBlock, HIGH_CUT_PARAM, highCut)

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

registerProcessor('dragonfly-reverb-processor', DragonflyReverbProcessor)
