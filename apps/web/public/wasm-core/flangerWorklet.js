/**
 * AudioWorkletProcessor for the Flanger effect: a modulated delay line with
 * strong feedback, classic comb-filter sweep (packages/core/src/dsp/
 * flanger.cpp). See namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { FLANGER_PARAMS } from './generatedParams.js'

const FLANGER_KIND = 4

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
    module._nam_studio_set_param(this.graph, block, FLANGER_PARAMS.rate, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, FLANGER_PARAMS.depth, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, FLANGER_PARAMS.feedback, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, FLANGER_PARAMS.delay, parameters.delay[0])
  }
}

registerProcessor('flanger-processor', FlangerProcessor)
