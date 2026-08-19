/**
 * AudioWorkletProcessor for the Phaser effect: a cascade of LFO-swept
 * first-order all-pass filters with feedback (packages/core/src/dsp/
 * phaser.cpp). See namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { PHASER_PARAMS } from './generatedParams.js'

const PHASER_KIND = 5

class PhaserProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.3, minValue: 0.1, maxValue: 5 },
      { name: 'depth', defaultValue: 0.7, minValue: 0.1, maxValue: 1 },
      { name: 'feedback', defaultValue: 0.5, minValue: 0, maxValue: 0.9 },
      { name: 'stages', defaultValue: 4, minValue: 2, maxValue: 8 },
    ]
  }

  constructor(options) {
    super(options, PHASER_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, PHASER_PARAMS.rate, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, PHASER_PARAMS.depth, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, PHASER_PARAMS.feedback, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, PHASER_PARAMS.stages, parameters.stages[0])
  }
}

registerProcessor('phaser-processor', PhaserProcessor)
