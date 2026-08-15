/**
 * AudioWorkletProcessor for the Flanger effect: a modulated delay line with
 * strong feedback, classic comb-filter sweep (packages/core/src/dsp/
 * flanger.cpp). See namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const FLANGER_KIND = 4

const RATE_PARAM = 0
const DEPTH_PARAM = 1
const FEEDBACK_PARAM = 2
const DELAY_PARAM = 3

class FlangerProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.3, minValue: 0.1, maxValue: 10 },
      { name: 'depth', defaultValue: 2, minValue: 0.1, maxValue: 5 },
      { name: 'feedback', defaultValue: 0.5, minValue: 0, maxValue: 0.9 },
      { name: 'delay', defaultValue: 1, minValue: 0.1, maxValue: 3 },
    ]
  }

  constructor(options) {
    super(options, FLANGER_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, RATE_PARAM, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, DEPTH_PARAM, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, FEEDBACK_PARAM, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, DELAY_PARAM, parameters.delay[0])
  }
}

registerProcessor('flanger-processor', FlangerProcessor)
