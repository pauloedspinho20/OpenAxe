/**
 * AudioWorkletProcessor for a Cab block: cabinet/room impulse-response
 * convolution, running packages/core's own convolver
 * (packages/core/src/dsp/convolver.cpp) rather than a Web Audio ConvolverNode.
 *
 * Convolution was the last piece of the audio path that existed only in the web
 * app, which is why cab blocks on the desktop passed audio through untouched.
 * The core owns it now, so web, desktop and a future plugin share one
 * implementation - a zero-latency partitioned convolution (direct FIR head plus
 * FFT partitions).
 *
 * The IR arrives as a port message carrying mono float samples at this context's
 * sample rate; the wet/dry blend is an AudioParam, since it is continuous.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

// packages/core/include/nam_studio/api.h's NamStudioBlockKind.
const CAB_KIND = 15

// engine_cab_params.inc: the IR wet/dry blend, index 0.
const PARAM_IR_MIX = 0

class CabProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [{ name: 'irMix', defaultValue: 1, minValue: 0, maxValue: 1 }]
  }

  constructor(options) {
    super(options, CAB_KIND)
    this.port.onmessage = (event) => this.handleMessage(event.data)
  }

  async handleMessage(message) {
    // Messages can arrive before WASM instantiation finishes; awaiting the base's
    // readiness promise keeps ordering rather than dropping them.
    await this.ready
    const module = this.module
    const reply = { id: message.id, ok: false }
    try {
      if (message.type === 'loadIr') {
        reply.ok = this.loadIr(module, new Float32Array(message.samples))
        reply.frames = module._nam_studio_block_ir_length(this.graph, this.block)
        if (!reply.ok) reply.error = 'the core rejected this impulse response'
      } else if (message.type === 'unloadIr') {
        module._nam_studio_unload_ir(this.graph, this.block)
        reply.ok = true
      } else {
        reply.error = `unknown message type "${message.type}"`
      }
    } catch (error) {
      reply.error = String(error)
    }
    this.port.postMessage(reply)
  }

  /** Copy the samples into WASM memory and install them as the block's IR. */
  loadIr(module, samples) {
    if (samples.length === 0) return false
    const bytes = samples.length * 4
    const ptr = module._malloc(bytes)
    try {
      module.HEAPF32.set(samples, ptr >> 2)
      module._nam_studio_load_ir(this.graph, this.block, ptr, samples.length)
      // The core copies the samples, so the scratch allocation goes straight back.
      return module._nam_studio_block_ir_length(this.graph, this.block) === samples.length
    } finally {
      module._free(ptr)
    }
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, PARAM_IR_MIX, parameters.irMix[0])
  }
}

registerProcessor('nam-cab-processor', CabProcessor)
