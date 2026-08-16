/**
 * AudioWorkletProcessor for the Noise Gate effect: a DSPark noise gate
 * (packages/core/src/dsp/noise_gate.cpp) with 6 params — threshold,
 * hysteresis, attack, hold, release, range. See namStudioEffectBase.js for
 * shared WASM/buffer plumbing. Replaces the old hand-rolled
 * src/effects/noiseGateWorklet.js (native Web Audio envelope follower).
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const NOISE_GATE_KIND = 0

const THRESHOLD_PARAM = 0
const HYSTERESIS_PARAM = 1
const ATTACK_PARAM = 2
const HOLD_PARAM = 3
const RELEASE_PARAM = 4
const RANGE_PARAM = 5

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
    module._nam_studio_set_param(this.graph, block, THRESHOLD_PARAM, parameters.threshold[0])
    module._nam_studio_set_param(this.graph, block, HYSTERESIS_PARAM, parameters.hysteresis[0])
    module._nam_studio_set_param(this.graph, block, ATTACK_PARAM, parameters.attack[0])
    module._nam_studio_set_param(this.graph, block, HOLD_PARAM, parameters.hold[0])
    module._nam_studio_set_param(this.graph, block, RELEASE_PARAM, parameters.release[0])
    module._nam_studio_set_param(this.graph, block, RANGE_PARAM, parameters.range[0])
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor)
