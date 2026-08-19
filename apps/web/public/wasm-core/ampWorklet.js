/**
 * AudioWorkletProcessor for a NAM amp block, backed by packages/core's own
 * NAM inference (nam_studio_core's NamAmp) rather than a second, separately
 * compiled NAM engine. Before this existed the web app ran the
 * neural-amp-modeler-wasm npm package while the desktop app ran the C++ core,
 * so the same capture and the same preset could sound different per platform.
 *
 * Unlike the effect worklets, an amp's interesting operations are messages
 * rather than AudioParams: loading a model, unloading it, and re-slimming a
 * slimmable capture. Each message carries an `id` and gets a reply on the same
 * port, which is what lets the TS side await them (see NamAmpNode.ts).
 *
 * Threading note, inherited from how AudioWorklet works and shared with the
 * upstream npm engine: port messages are delivered on the audio thread, so
 * parsing a multi-megabyte capture briefly blocks rendering. The core's own
 * load path is where that cost lives, and it is the same cost the desktop app
 * pays on its control thread with audio suspended.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

// packages/core/include/nam_studio/api.h's NamStudioBlockKind - amp is the
// first of the five NAM-backed "gear" kinds.
const AMP_KIND = 10

// The amp param table (engine_amp_params.inc): input/output level are the
// capture's own dBu calibration, slim size only exists once a slimmable model
// is loaded. Deliberately no knob params here - the user-facing Input/Output
// trims are block trims, not these (see nam_studio_set_block_input_trim).
const PARAM_SLIM_SIZE = 2
// The 4-band tone stack the engine runs after the model
// (packages/core/src/dsp/tone_stack.cpp), contiguous from index 3.
const PARAM_BASS = 3
const PARAM_MID = 4
const PARAM_TREBLE = 5
const PARAM_PRESENCE = 6

class NamAmpProcessor extends NamStudioEffectProcessor {
  // The tone stack is continuous automation, so unlike model loading it is
  // AudioParams rather than messages - identical ranges to the core's own clamp
  // (±12dB) and to the knobs the UI draws.
  static get parameterDescriptors() {
    return [
      { name: 'bass', defaultValue: 0, minValue: -12, maxValue: 12 },
      { name: 'mid', defaultValue: 0, minValue: -12, maxValue: 12 },
      { name: 'treble', defaultValue: 0, minValue: -12, maxValue: 12 },
      { name: 'presence', defaultValue: 0, minValue: -12, maxValue: 12 },
    ]
  }

  constructor(options) {
    super(options, AMP_KIND)
    this.disposed = false
    this.port.onmessage = (event) => this.handleMessage(event.data)
  }

  async handleMessage(message) {
    // Messages can arrive before WASM instantiation finishes; awaiting the
    // base's readiness promise keeps ordering rather than dropping them.
    await this.ready
    const module = this.module
    const reply = { id: message.id, ok: false }
    if (this.disposed) {
      reply.error = 'this amp node has been disposed'
      this.port.postMessage(reply)
      return
    }
    try {
      if (message.type === 'loadModel') {
        reply.ok = this.loadModel(module, new Uint8Array(message.bytes, 0, message.byteLength))
        if (reply.ok) {
          if (typeof message.slimSize === 'number') {
            module._nam_studio_set_param(this.graph, this.block, PARAM_SLIM_SIZE, message.slimSize)
          }
          reply.info = this.readModelInfo(module)
        } else {
          reply.error = 'the core rejected this model file'
        }
      } else if (message.type === 'unloadModel') {
        module._nam_studio_unload_nam_model(this.graph, this.block)
        reply.ok = true
      } else if (message.type === 'dispose') {
        // Free the WASM graph (and with it the loaded capture, which can be
        // several MB) as soon as the block goes away, rather than waiting for
        // the AudioContext to close. Returning false from process() below then
        // lets the browser collect the processor itself.
        module._nam_studio_graph_destroy(this.graph)
        this.disposed = true
        reply.ok = true
      } else if (message.type === 'setSlimSize') {
        module._nam_studio_set_param(this.graph, this.block, PARAM_SLIM_SIZE, message.value)
        reply.ok = true
      } else {
        reply.error = `unknown message type "${message.type}"`
      }
    } catch (error) {
      reply.error = String(error)
    }
    this.port.postMessage(reply)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, PARAM_BASS, parameters.bass[0])
    module._nam_studio_set_param(this.graph, block, PARAM_MID, parameters.mid[0])
    module._nam_studio_set_param(this.graph, block, PARAM_TREBLE, parameters.treble[0])
    module._nam_studio_set_param(this.graph, block, PARAM_PRESENCE, parameters.presence[0])
  }

  // Once disposed the graph pointer is dangling, so nothing may touch it -
  // returning false ends this processor and silences the node.
  process(inputs, outputs, parameters) {
    if (this.disposed) return false
    return super.process(inputs, outputs, parameters)
  }

  /**
   * Copy the already-UTF-8-encoded JSON into WASM memory, NUL-terminate it, and
   * hand it to the core. The main thread does the encoding (see NamAmpNode):
   * AudioWorkletGlobalScope has no TextEncoder, and this keeps that pass off the
   * audio thread.
   */
  loadModel(module, bytes) {
    const ptr = module._malloc(bytes.length + 1)
    try {
      module.HEAPU8.set(bytes, ptr)
      module.HEAPU8[ptr + bytes.length] = 0
      // 0 is NAM_STUDIO_LOAD_OK.
      const result = module._nam_studio_load_nam_model_json(this.graph, this.block, ptr)
      // The core re-prepares the freshly loaded model at the rate and block
      // size the graph was last reset with (the base class does that at
      // construction), so no reset is needed here - which also keeps this off
      // the "allocate on the audio thread" list beyond the load itself.
      return result === 0
    } finally {
      module._free(ptr)
    }
  }

  /**
   * Read the capture's metadata out of the core. Mirrors NamModelInfo minus the
   * fields no front end reads yet; the out-params are a single scratch
   * allocation because nam_studio_block_model_info takes each one separately.
   */
  readModelInfo(module) {
    // 4 doubles (sample rate, loudness, input dBu, output dBu) + 4 int32 flags
    // + 1 int32 breakpoint count.
    const doubles = module._malloc(4 * 8)
    const ints = module._malloc(5 * 4)
    try {
      const ok = module._nam_studio_block_model_info(
        this.graph,
        this.block,
        doubles,
        ints,
        doubles + 8,
        ints + 4,
        doubles + 16,
        ints + 8,
        doubles + 24,
        ints + 12,
        ints + 16,
      )
      if (!ok) return null
      const d = doubles >> 3
      const i = ints >> 2
      const count = module.HEAP32[i + 4]
      const info = {
        sampleRate: module.HEAPF64[d],
        hasLoudness: module.HEAP32[i] === 1,
        loudnessDb: module.HEAPF64[d + 1],
        hasInputLevel: module.HEAP32[i + 1] === 1,
        inputLevelDbu: module.HEAPF64[d + 2],
        hasOutputLevel: module.HEAP32[i + 2] === 1,
        outputLevelDbu: module.HEAPF64[d + 3],
        slimmable: module.HEAP32[i + 3] === 1,
        slimmableBreakpoints: [],
      }
      if (info.slimmable && count > 0) {
        const values = module._malloc(count * 8)
        try {
          const written = module._nam_studio_block_model_slim_breakpoints(
            this.graph,
            this.block,
            values,
            count,
          )
          const base = values >> 3
          for (let n = 0; n < written; n++) info.slimmableBreakpoints.push(module.HEAPF64[base + n])
        } finally {
          module._free(values)
        }
      }
      return info
    } finally {
      module._free(doubles)
      module._free(ints)
    }
  }
}

registerProcessor('nam-amp-processor', NamAmpProcessor)
