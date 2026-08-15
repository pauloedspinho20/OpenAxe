/**
 * AudioWorkletProcessor for issue #22's first C++/WASM DSP slice: Dragonfly
 * Hall Reverb, running the real nam_studio_core WASM build (compiled by
 * scripts/build-core-wasm.sh from packages/core) instead of the app's own
 * hand-rolled Freeverb.
 *
 * Uses real AudioParams (roomSize/damping), not postMessage - same
 * sample-accurate-automation convention as the app's own NoiseGate
 * (apps/web/src/effects/NoiseGate.ts / noiseGateWorklet.js). WASM
 * instantiation and buffer marshaling are shared with every other
 * nam_studio_core-backed effect - see namStudioEffectBase.js.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

// See packages/core/include/nam_studio/api.h's NamStudioBlockKind enum -
// NAM_STUDIO_BLOCK_REVERB is ordinal 9.
const REVERB_KIND = 9

// Dragonfly Hall Reverb's own param indices/ranges - see
// packages/core/src/dsp/dragonfly_hall_reverb.cpp's kParamInfo table.
const DRY_LEVEL_PARAM = 0 // 0-100%; forced to 0 - the Effect's own dry/wet crossfade already handles mix
const WIDTH_PARAM = 4 // 50-150%
const PREDELAY_PARAM = 5 // 0-100ms
const HIGH_CUT_PARAM = 10 // 1000-16000Hz
const SPIN_PARAM = 13 // 0-10Hz
const WANDER_PARAM = 14 // 0-40ms
const DECAY_PARAM = 15 // 0.1-10s
const EARLY_SEND_PARAM = 16 // 0-100%

const DECAY_MIN = 0.1
const DECAY_MAX = 10
const HIGH_CUT_MIN = 1000
const HIGH_CUT_MAX = 16000

class DragonflyReverbProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'roomSize', defaultValue: 0.84, minValue: 0, maxValue: 0.97 },
      { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      // These 5 pass straight through to Dragonfly's own native units/ranges
      // (see the param indices above) - no UI-friendly remapping needed,
      // unlike roomSize/damping which preserve Freeverb's original 0-0.97/
      // 0-1 semantics for continuity with previously-saved preset values.
      { name: 'width', defaultValue: 100, minValue: 50, maxValue: 150 },
      { name: 'predelay', defaultValue: 20, minValue: 0, maxValue: 100 },
      { name: 'spin', defaultValue: 0.6, minValue: 0, maxValue: 10 },
      { name: 'wander', defaultValue: 8, minValue: 0, maxValue: 40 },
      { name: 'earlySend', defaultValue: 20, minValue: 0, maxValue: 100 },
    ]
  }

  constructor(options) {
    super(options, REVERB_KIND)
  }

  onReady(module, block) {
    module._nam_studio_set_param(this.graph, block, DRY_LEVEL_PARAM, 0)
  }

  applyParams(module, block, parameters) {
    const decay = DECAY_MIN + (parameters.roomSize[0] / 0.97) * (DECAY_MAX - DECAY_MIN)
    const highCut = HIGH_CUT_MAX - parameters.damping[0] * (HIGH_CUT_MAX - HIGH_CUT_MIN)
    module._nam_studio_set_param(this.graph, block, DECAY_PARAM, decay)
    module._nam_studio_set_param(this.graph, block, HIGH_CUT_PARAM, highCut)
    module._nam_studio_set_param(this.graph, block, WIDTH_PARAM, parameters.width[0])
    module._nam_studio_set_param(this.graph, block, PREDELAY_PARAM, parameters.predelay[0])
    module._nam_studio_set_param(this.graph, block, SPIN_PARAM, parameters.spin[0])
    module._nam_studio_set_param(this.graph, block, WANDER_PARAM, parameters.wander[0])
    module._nam_studio_set_param(this.graph, block, EARLY_SEND_PARAM, parameters.earlySend[0])
  }
}

registerProcessor('dragonfly-reverb-processor', DragonflyReverbProcessor)
