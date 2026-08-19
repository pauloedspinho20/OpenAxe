/**
 * AudioWorkletProcessor for the Noise Gate effect: a DSPark noise gate
 * (packages/core/src/dsp/noise_gate.cpp) with 6 params — threshold,
 * hysteresis, attack, hold, release, range. See namStudioEffectBase.js for
 * shared WASM/buffer plumbing. Replaces the old hand-rolled
 * src/effects/noiseGateWorklet.js (native Web Audio envelope follower).
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { NOISEGATE_PARAMS } from './generatedParams.js'

const NOISE_GATE_KIND = 0

class NoiseGateProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0 },
      { name: 'hysteresis', defaultValue: 4, minValue: 0, maxValue: 20 },
      { name: 'attack', defaultValue: 0.5, minValue: 0.01, maxValue: 50 },
      { name: 'hold', defaultValue: 50, minValue: 0, maxValue: 500 },
      { name: 'release', defaultValue: 100, minValue: 1, maxValue: 1000 },
      { name: 'range', defaultValue: -80, minValue: -100, maxValue: 0 },
    ]
  }

  constructor(options) {
    super(options, NOISE_GATE_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(
      this.graph,
      block,
      NOISEGATE_PARAMS.threshold,
      parameters.threshold[0],
    )
    module._nam_studio_set_param(
      this.graph,
      block,
      NOISEGATE_PARAMS.hysteresis,
      parameters.hysteresis[0],
    )
    module._nam_studio_set_param(this.graph, block, NOISEGATE_PARAMS.attack, parameters.attack[0])
    module._nam_studio_set_param(this.graph, block, NOISEGATE_PARAMS.hold, parameters.hold[0])
    module._nam_studio_set_param(this.graph, block, NOISEGATE_PARAMS.release, parameters.release[0])
    module._nam_studio_set_param(this.graph, block, NOISEGATE_PARAMS.range, parameters.range[0])
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor)
