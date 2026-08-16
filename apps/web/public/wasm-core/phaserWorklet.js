/**
 * AudioWorkletProcessor for the Phaser effect: a cascade of LFO-swept
 * first-order all-pass filters with feedback (packages/core/src/dsp/
 * phaser.cpp). See namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const PHASER_KIND = 5

const RATE_PARAM = 0
const DEPTH_PARAM = 1
const FEEDBACK_PARAM = 2
const STAGES_PARAM = 3

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
    module._nam_studio_set_param(this.graph, block, RATE_PARAM, parameters.rate[0])
    module._nam_studio_set_param(this.graph, block, DEPTH_PARAM, parameters.depth[0])
    module._nam_studio_set_param(this.graph, block, FEEDBACK_PARAM, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, STAGES_PARAM, parameters.stages[0])
  }
}

registerProcessor('phaser-processor', PhaserProcessor)
