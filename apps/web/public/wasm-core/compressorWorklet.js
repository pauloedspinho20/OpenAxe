/**
 * AudioWorkletProcessor for the Compressor effect: a DSPark compressor
 * (packages/core/src/dsp/compressor.cpp) with 7 params — threshold, ratio,
 * attack, release, knee, makeup_gain, and a character model selector
 * (Clean/Opto/FET/Varimu). See namStudioEffectBase.js for shared
 * WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const COMPRESSOR_KIND = 1

const THRESHOLD_PARAM = 0
const RATIO_PARAM = 1
const ATTACK_PARAM = 2
const RELEASE_PARAM = 3
const KNEE_PARAM = 4
const MAKEUP_PARAM = 5
const CHARACTER_PARAM = 6

class CompressorProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -18, minValue: -60, maxValue: 0 },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20 },
      { name: 'attack', defaultValue: 5, minValue: 0.1, maxValue: 100 },
      { name: 'release', defaultValue: 100, minValue: 1, maxValue: 2000 },
      { name: 'knee', defaultValue: 0, minValue: 0, maxValue: 20 },
      { name: 'makeup_gain', defaultValue: 0, minValue: 0, maxValue: 24 },
      { name: 'character', defaultValue: 0, minValue: 0, maxValue: 3 },
    ]
  }

  constructor(options) {
    super(options, COMPRESSOR_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, THRESHOLD_PARAM, parameters.threshold[0])
    module._nam_studio_set_param(this.graph, block, RATIO_PARAM, parameters.ratio[0])
    module._nam_studio_set_param(this.graph, block, ATTACK_PARAM, parameters.attack[0])
    module._nam_studio_set_param(this.graph, block, RELEASE_PARAM, parameters.release[0])
    module._nam_studio_set_param(this.graph, block, KNEE_PARAM, parameters.knee[0])
    module._nam_studio_set_param(this.graph, block, MAKEUP_PARAM, parameters.makeup_gain[0])
    module._nam_studio_set_param(this.graph, block, CHARACTER_PARAM, parameters.character[0])
  }
}

registerProcessor('compressor-processor', CompressorProcessor)
