/**
 * AudioWorkletProcessor for the Tremolo effect: a DSPark stereo tremolo
 * (packages/core/src/dsp/tremolo.cpp) with 3 params — rate, depth, and a
 * shape selector (Sine/Triangle/Square). The right channel's LFO is
 * 180°-offset from the left (stereo mode), giving the classic slow
 * auto-pan wobble. See namStudioEffectBase.js for shared WASM/buffer
 * plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const TREMOLO_KIND = 6

const RATE_PARAM = 0
const DEPTH_PARAM = 1
const SHAPE_PARAM = 2

class TremoloProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 4, minValue: 0.1, maxValue: 20 },
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 2 },
    ]
  }

  constructor(options) {
    super(options, TREMOLO_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, RATE_PARAM, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, DEPTH_PARAM, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, SHAPE_PARAM, parameters.shape[0])
  }
}

registerProcessor('tremolo-processor', TremoloProcessor)
