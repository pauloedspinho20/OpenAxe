/**
 * AudioWorkletProcessor for the Chorus effect: a classic stereo modulated
 * delay line (packages/core/src/dsp/chorus.cpp). See namStudioEffectBase.js
 * for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { CHORUS_PARAMS } from './generatedParams.js'

const CHORUS_KIND = 3

class ChorusProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.5, minValue: 0.1, maxValue: 10 },
      { name: 'depth', defaultValue: 5, minValue: 0.2, maxValue: 10 },
      { name: 'delay', defaultValue: 8, minValue: 5, maxValue: 30 },
      { name: 'feedback', defaultValue: 0.2, minValue: 0, maxValue: 0.5 },
    ]
  }

  constructor(options) {
    super(options, CHORUS_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, CHORUS_PARAMS.rate, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, CHORUS_PARAMS.depth, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, CHORUS_PARAMS.delay, parameters.delay[0])
    module._nam_studio_set_param(this.graph, block, CHORUS_PARAMS.feedback, parameters.feedback[0])
  }
}

registerProcessor('chorus-processor', ChorusProcessor)
