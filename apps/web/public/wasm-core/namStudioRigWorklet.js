/**
 * The single "rig" AudioWorkletProcessor (issue #55): owns ONE nam_studio_core
 * module and ONE nam_studio_graph, and drives the whole rig inside it through
 * the existing C ABI - add/remove/move/connect/disconnect, params by symbol,
 * per-block trims, bypass, the master bus, NAM model loading, IR convolution
 * and the reverb/delay algorithm switches. This replaces the per-effect
 * worklets (namStudioEffectBase.js + the 12 effect/amp/cab worklets), each of
 * which previously instantiated its own module and its own one-block graph.
 *
 * Everything the web path used to own as Web Audio plumbing - the left-to-right
 * connection rules, mixer summing, splitter fan-out, per-input level/pan,
 * per-output level, trims, bypass, master bus, metering - now lives in the core
 * (graph_rig.cpp / graph_validation.cpp / engine.cpp), so this worklet is just
 * a thin message -> C ABI dispatcher around one graph plus the single-buffer
 * process() loop. A plugin (issue #16) presents the same rig because all of it
 * is C++.
 *
 * Threading: AudioWorklet delivers port messages and process() on the same
 * audio thread, never concurrently, so graph mutations are serialised against
 * process() by construction - no suspend handshake is needed on the web path
 * (contrast the desktop bridge, which suspends RtAudio around mutations). The
 * one cost is that parsing a multi-megabyte NAM model or IR on the port handler
 * briefly blocks rendering, exactly as the old per-effect worklets did.
 *
 * Every operation that must return a result (connect rejection reasons, model
 * info) is a request-reply: the message carries an `id` and the worklet posts a
 * reply with the same id, which is how the TS side awaits it (see
 * RigWorkletNode.ts). Param/trim/bypass/master writes are fire-and-forget.
 */

// Emscripten's runtime uses performance.now() for monotonic time (backing
// AudioEngine::Process's CPU-load timer). AudioWorkletGlobalScope has
// `performance` per spec in real browsers, but not every environment agrees,
// so this stays a no-op almost everywhere and a safety net where it's missing.
if (typeof performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() }
}

import createModule from './nam_studio_core.js'

// Web Audio's render quantum is fixed at 128 frames - not configurable.
export const FRAMES = 128

// packages/core/include/nam_studio/api.h rail sentinels - the JS side maps the
// 'IN'/'OUT' grid rails onto these before sending a connect.
const IN_RAIL = -1
const OUT_RAIL = -2

// packages/core/include/nam_studio/api.h NamStudioBlockKind / ReverbControl /
// ReverbAlgorithm. Reverb blocks are driven through the core's ReverbControl
// mapping (the UI's roomSize/damping/width/... are abstractions, not symbols),
// mirroring the desktop bridge's ReverbControlFor.
const REVERB_KIND = 9
const REVERB_CONTROL = {
  roomSize: 0,
  damping: 1,
  width: 2,
  predelay: 3,
  spin: 4,
  wander: 5,
  earlySend: 6,
  dryLevel: 7,
}
const REVERB_ALGORITHM = {
  hall: 0,
  room: 1,
  plate: 2,
  'early-reflections': 3,
}

const BYTES_PER_FLOAT = 4

// The single render-quantum scratch: one pair of stereo in/out buffers shared
// across the whole graph, sized for FRAMES. The graph's internal stereo pair is
// what nam_studio_process reads/writes.
const MAX_BLOCKS = 64

class NamStudioRigProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.module = null
    this.graph = null
    this.disposed = false
    // jsId (from the store) -> core int block id, and jsEdgeId -> core edge id.
    // The core speaks ints; the web speaks stable strings so presets and the
    // store never renumber.
    this.blockByJs = new Map()
    this.kindByJs = new Map()
    this.edgeByJs = new Map()
    // Last reported peak per js block id, read by the meter poll.
    this.meters = new Map()
    // The graph's block count is bounded by the store, but we keep it under a
    // ceiling so the meter map can't grow unbounded if a driver leaks blocks.
    this.maxBlocks = MAX_BLOCKS

    // The TS wrapper (RigWorkletNode) fetches the .wasm bytes on the main
    // thread and hands them over via processorOptions - AudioWorkletGlobalScope
    // can't be trusted to have fetch(), same dance as the old per-effect
    // worklets and neural-amp-modeler-wasm.
    this.port.onmessage = (event) => this.handleMessage(event.data)
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
      // One reset arms the whole graph; topology mutations (add/remove/connect)
      // are handled by the core's own RecomputeRouting on each ABI call, so no
      // further reset is needed after the initial one.
      module._nam_studio_reset(this.graph, sampleRate, FRAMES)

      this.inL = module._malloc(FRAMES * BYTES_PER_FLOAT)
      this.inR = module._malloc(FRAMES * BYTES_PER_FLOAT)
      this.outL = module._malloc(FRAMES * BYTES_PER_FLOAT)
      this.outR = module._malloc(FRAMES * BYTES_PER_FLOAT)
      this.inPtrs = module._malloc(8)
      this.outPtrs = module._malloc(8)
      module.HEAPU32.set([this.inL, this.inR], this.inPtrs >> 2)
      module.HEAPU32.set([this.outL, this.outR], this.outPtrs >> 2)
      this.silence = new Float32Array(FRAMES)
    })
  }

  /** Map a store block id or rail string to a core int id, or null. */
  toCoreBlock(js) {
    if (js === 'IN') return IN_RAIL
    if (js === 'OUT') return OUT_RAIL
    const id = this.blockByJs.get(js)
    return id === undefined ? null : id
  }

  /** Resolve a param symbol to its core index for a block, or -1 if unknown. */
  paramIndex(module, coreBlock, symbol) {
    // A handful of the UI's param keys are camelCase where the core's symbol is
    // snake_case (issue #41) - the amp's slim-size and the cab's IR mix kept
    // their camelCase keys, so translate here to match the desktop bridge's
    // CoreSymbolAliasFor.
    if (symbol === 'slimSize') symbol = 'slim_size'
    else if (symbol === 'irMix') symbol = 'ir_mix'
    const count = module._nam_studio_block_param_count(this.graph, coreBlock)
    for (let i = 0; i < count; i++) {
      const namePtr = module._malloc(4)
      const symbolPtr = module._malloc(4)
      const minPtr = module._malloc(4)
      const maxPtr = module._malloc(4)
      const unitPtr = module._malloc(4)
      let found = false
      try {
        const ok = module._nam_studio_block_param_info(
          this.graph,
          coreBlock,
          i,
          namePtr,
          symbolPtr,
          minPtr,
          maxPtr,
          unitPtr,
        )
        if (ok) {
          const symPtr = module.HEAPU32[symbolPtr >> 2]
          if (symPtr && module.UTF8ToString(symPtr) === symbol) found = true
        }
      } finally {
        module._free(namePtr)
        module._free(symbolPtr)
        module._free(minPtr)
        module._free(maxPtr)
        module._free(unitPtr)
      }
      if (found) return i
    }
    return -1
  }

  async handleMessage(message) {
    if (!message || typeof message.type !== 'string') return
    // Messages can arrive before WASM instantiation finishes; awaiting the
    // readiness promise keeps ordering rather than dropping them.
    try {
      await this.ready
    } catch {
      return
    }
    const reply = message.id === undefined ? null : { id: message.id, ok: false }
    const module = this.module
    if (!module || this.disposed) {
      if (reply) {
        reply.error = 'this rig worklet is not ready or has been disposed'
        this.port.postMessage(reply)
      }
      return
    }

    try {
      switch (message.type) {
        case 'addBlock': {
          if (this.blockByJs.has(message.id)) {
            reply.ok = true
            break
          }
          if (this.blockByJs.size >= this.maxBlocks) {
            reply.error = 'block limit reached'
            break
          }
          const coreBlock = module._nam_studio_add_block(
            this.graph,
            message.kind,
            message.row,
            message.col,
          )
          this.blockByJs.set(message.id, coreBlock)
          this.kindByJs.set(message.id, message.kind)
          this.meters.set(message.id, 0)
          reply.ok = true
          break
        }
        case 'removeBlock': {
          const coreBlock = this.toCoreBlock(message.id)
          if (coreBlock !== null && coreBlock >= 0) {
            module._nam_studio_remove_block(this.graph, coreBlock)
          }
          this.blockByJs.delete(message.id)
          this.kindByJs.delete(message.id)
          this.meters.delete(message.id)
          reply.ok = true
          break
        }
        case 'moveBlock': {
          const coreBlock = this.toCoreBlock(message.id)
          if (coreBlock !== null && coreBlock >= 0) {
            module._nam_studio_move_block(this.graph, coreBlock, message.row, message.col)
          }
          reply.ok = true
          break
        }
        case 'connect': {
          const from = this.toCoreBlock(message.fromId)
          const to = this.toCoreBlock(message.toId)
          if (from === null || to === null) {
            reply.error = 'unknown block'
            break
          }
          const edgeId = module._nam_studio_connect(
            this.graph,
            from,
            message.fromPort,
            to,
            message.toPort,
          )
          if (edgeId < 0) {
            reply.error = 'connection rejected by the core'
            break
          }
          this.edgeByJs.set(message.id, edgeId)
          reply.ok = true
          break
        }
        case 'disconnect': {
          const coreEdge = this.edgeByJs.get(message.id)
          if (coreEdge !== undefined) {
            module._nam_studio_disconnect(this.graph, coreEdge)
            this.edgeByJs.delete(message.id)
          }
          reply.ok = true
          break
        }
        case 'setParam': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            // Reverb blocks: the UI's control names (roomSize/damping/width/
            // predelay/spin/wander/earlySend/dryLevel) are per-algorithm
            // abstractions, not core symbols - route them through the core's
            // ReverbControl mapping, exactly as the desktop bridge does.
            const reverbControl = REVERB_CONTROL[message.key]
            if (reverbControl !== undefined && this.kindByJs.get(message.block) === REVERB_KIND) {
              module._nam_studio_set_reverb_control(
                this.graph,
                coreBlock,
                reverbControl,
                message.value,
              )
            } else {
              const index = this.paramIndex(module, coreBlock, message.key)
              if (index >= 0)
                module._nam_studio_set_param(this.graph, coreBlock, index, message.value)
            }
          }
          if (reply) reply.ok = true
          break
        }
        case 'setReverbAlgorithm': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            const algo = REVERB_ALGORITHM[message.algorithm]
            if (algo !== undefined && this.kindByJs.get(message.block) === REVERB_KIND) {
              module._nam_studio_set_reverb_algorithm(this.graph, coreBlock, algo)
            }
          }
          if (reply) reply.ok = true
          break
        }
        case 'setBypass': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            module._nam_studio_set_bypass(this.graph, coreBlock, message.bypassed ? 1 : 0)
          }
          if (reply) reply.ok = true
          break
        }
        case 'setTrim': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            if (typeof message.input === 'number') {
              module._nam_studio_set_block_input_trim(this.graph, coreBlock, message.input)
            }
            if (typeof message.output === 'number') {
              module._nam_studio_set_block_output_trim(this.graph, coreBlock, message.output)
            }
          }
          if (reply) reply.ok = true
          break
        }
        case 'setMasterLevel':
          module._nam_studio_set_master_level(this.graph, message.level)
          if (reply) reply.ok = true
          break
        case 'setMasterMuted':
          module._nam_studio_set_master_muted(this.graph, message.muted ? 1 : 0)
          if (reply) reply.ok = true
          break
        case 'setTunerMuted':
          module._nam_studio_set_tuner_muted(this.graph, message.tunerMuted ? 1 : 0)
          if (reply) reply.ok = true
          break
        case 'loadModel': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock === null || coreBlock < 0) {
            reply.error = 'unknown block'
            break
          }
          const bytes = new Uint8Array(message.bytes, 0, message.byteLength)
          const ok = this.loadModelJson(module, coreBlock, bytes)
          if (!ok) {
            reply.error = 'the core rejected this model file'
            break
          }
          if (typeof message.slimSize === 'number') {
            const slim = this.paramIndex(module, coreBlock, 'slim_size')
            if (slim >= 0)
              module._nam_studio_set_param(this.graph, coreBlock, slim, message.slimSize)
          }
          reply.info = this.readModelInfo(module, coreBlock)
          reply.ok = true
          break
        }
        case 'unloadModel': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            module._nam_studio_unload_nam_model(this.graph, coreBlock)
          }
          reply.ok = true
          break
        }
        case 'setSlimSize': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            const slim = this.paramIndex(module, coreBlock, 'slim_size')
            if (slim >= 0) module._nam_studio_set_param(this.graph, coreBlock, slim, message.value)
          }
          reply.ok = true
          break
        }
        case 'loadIr': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock === null || coreBlock < 0) {
            reply.error = 'unknown block'
            break
          }
          // The samples arrive as a Float32Array of mono audio at the graph's
          // rate (the main thread decoded the buffer with decodeAudioData and
          // resampled to the context rate). Copy into WASM, install, and free -
          // nam_studio_load_ir copies the samples itself, so the temp is
          // disposable immediately.
          const samples = message.samples
          if (!samples || samples.length === 0) {
            module._nam_studio_load_ir(this.graph, coreBlock, 0, 0)
            break
          }
          const ptr = module._malloc(samples.length * BYTES_PER_FLOAT)
          try {
            module.HEAPF32.set(samples, ptr >> 2)
            module._nam_studio_load_ir(this.graph, coreBlock, ptr, samples.length)
          } finally {
            module._free(ptr)
          }
          reply.ok = true
          break
        }
        case 'unloadIr': {
          const coreBlock = this.toCoreBlock(message.block)
          if (coreBlock !== null && coreBlock >= 0) {
            module._nam_studio_unload_ir(this.graph, coreBlock)
          }
          reply.ok = true
          break
        }
        case 'meters': {
          const out = {}
          for (const [jsId, coreBlock] of this.blockByJs) {
            out[jsId] = module._nam_studio_get_meter(this.graph, coreBlock)
          }
          reply.meters = out
          reply.ok = true
          break
        }
        case 'dispose': {
          module._nam_studio_graph_destroy(this.graph)
          this.graph = null
          this.disposed = true
          reply.ok = true
          break
        }
        default:
          reply.error = `unknown message type "${message.type}"`
      }
    } catch (error) {
      reply.error = String(error)
    }
    if (reply) this.port.postMessage(reply)
  }

  /**
   * Copy already-UTF-8-encoded .nam JSON into WASM memory, NUL-terminate it, and
   * hand it to the core. The main thread does the encoding (see RigWorkletNode):
   * AudioWorkletGlobalScope has no TextEncoder, and this keeps that pass off the
   * audio thread.
   */
  loadModelJson(module, coreBlock, bytes) {
    const ptr = module._malloc(bytes.length + 1)
    try {
      module.HEAPU8.set(bytes, ptr)
      module.HEAPU8[ptr + bytes.length] = 0
      // 0 is NAM_STUDIO_LOAD_OK.
      return module._nam_studio_load_nam_model_json(this.graph, coreBlock, ptr) === 0
    } finally {
      module._free(ptr)
    }
  }

  /** Read a loaded capture's metadata out of the core (see NamModelInfo). */
  readModelInfo(module, coreBlock) {
    const doubles = module._malloc(4 * 8)
    const ints = module._malloc(5 * 4)
    try {
      const ok = module._nam_studio_block_model_info(
        this.graph,
        coreBlock,
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
            coreBlock,
            values,
            count,
          )
          const base = values >> 3
          for (let n = 0; n < written; n++) {
            info.slimmableBreakpoints.push(module.HEAPF64[base + n])
          }
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

  process(inputs, outputs) {
    if (!this.module || this.disposed) return !this.disposed
    const module = this.module

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

registerProcessor('nam-studio-rig-processor', NamStudioRigProcessor)
