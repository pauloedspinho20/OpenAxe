/**
 * AudioWorkletProcessor for the Compressor effect: a DSPark compressor
 * (packages/core/src/dsp/compressor.cpp) with 8 params — threshold, ratio,
 * attack, release, knee, makeup_gain, a character model selector
 * (Clean/Opto/FET/Varimu), and a native dry/wet Mix. See
 * namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { COMPRESSOR_PARAMS } from './generatedParams.js'

const COMPRESSOR_KIND = 1

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
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1 },
    ]
  }

  constructor(options) {
    super(options, COMPRESSOR_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(
      this.graph,
      block,
      COMPRESSOR_PARAMS.threshold,
      parameters.threshold[0],
    )
    module._nam_studio_set_param(this.graph, block, COMPRESSOR_PARAMS.ratio, parameters.ratio[0])
    module._nam_studio_set_param(this.graph, block, COMPRESSOR_PARAMS.attack, parameters.attack[0])
    module._nam_studio_set_param(
      this.graph,
      block,
      COMPRESSOR_PARAMS.release,
      parameters.release[0],
    )
    module._nam_studio_set_param(this.graph, block, COMPRESSOR_PARAMS.knee, parameters.knee[0])
    module._nam_studio_set_param(
      this.graph,
      block,
      COMPRESSOR_PARAMS.makeup_gain,
      parameters.makeup_gain[0],
    )
    module._nam_studio_set_param(
      this.graph,
      block,
      COMPRESSOR_PARAMS.character,
      parameters.character[0],
    )
    module._nam_studio_set_param(this.graph, block, COMPRESSOR_PARAMS.mix, parameters.mix[0])
  }
}

registerProcessor('compressor-processor', CompressorProcessor)
