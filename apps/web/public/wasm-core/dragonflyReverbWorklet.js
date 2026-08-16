/**
 * AudioWorkletProcessor for the Reverb effect: 4 Dragonfly Reverb algorithms
 * (Hall, Room, Plate, Early Reflections) compiled to WASM from
 * packages/core. The `reverbAlgorithm` AudioParam selects which algorithm
 * backs the block; switching algorithms reconstructs the underlying DSP
 * wrapper (not real-time safe, but algorithm choice is a user action). Each
 * algorithm has its own param-count and index layout, so per-algorithm index
 * maps route the UI's stable AudioParams to the correct C++ param slots.
 *
 * The 7 user-facing knobs (roomSize/damping/width/predelay/spin/wander/
 * earlySend) are the union of every algorithm's available controls; knobs
 * that don't exist for the current algorithm are harmlessly ignored by the
 * C++ side (SetParam no-ops for out-of-range indices). Dry Level is forced to
 * 0 on every algorithm — the Effect's own dry/wet crossfade handles mix.
 *
 * WASM instantiation and buffer marshaling are shared via namStudioEffectBase.js.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const REVERB_KIND = 9

const ALGORITHM_HALL = 0
const ALGORITHM_ROOM = 1
const ALGORITHM_PLATE = 2
const ALGORITHM_EARLY_REFLECTIONS = 3

// Per-algorithm param index maps for the 7 user-facing knobs + dry level.
// Ranges differ slightly across algorithms (e.g. spin is [0,10]Hz in Hall
// but [0,5]Hz in Room), but the AudioParam ranges are generous enough to
// cover all cases.
const ALGO_PARAMS = {
  [ALGORITHM_HALL]: {
    dryLevel: 0,
    width: 4,
    predelay: 5,
    highCut: 10,
    spin: 13,
    wander: 14,
    decay: 15,
    earlySend: 16,
  },
  [ALGORITHM_ROOM]: {
    dryLevel: 0,
    width: 5,
    predelay: 6,
    highCut: 11,
    spin: 9,
    wander: 10,
    decay: 7,
    earlySend: 2,
  },
  [ALGORITHM_PLATE]: {
    dryLevel: 0,
    width: 3,
    predelay: 4,
    highCut: 7,
    decay: 5,
  },
  [ALGORITHM_EARLY_REFLECTIONS]: {
    dryLevel: 0,
    width: 4,
    highCut: 6,
  },
}

// Room size → decay (0.1–10s across all algorithms that have it).
const DECAY_MIN = 0.1
const DECAY_MAX = 10
// Damping → high cut (1000–16000Hz across all algorithms that have it).
const HIGH_CUT_MIN = 1000
const HIGH_CUT_MAX = 16000

class DragonflyReverbProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'reverbAlgorithm', defaultValue: ALGORITHM_HALL, minValue: 0, maxValue: 3 },
      { name: 'roomSize', defaultValue: 0.84, minValue: 0, maxValue: 0.97 },
      { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'width', defaultValue: 100, minValue: 50, maxValue: 150 },
      { name: 'predelay', defaultValue: 20, minValue: 0, maxValue: 100 },
      { name: 'spin', defaultValue: 0.6, minValue: 0, maxValue: 10 },
      { name: 'wander', defaultValue: 8, minValue: 0, maxValue: 40 },
      { name: 'earlySend', defaultValue: 20, minValue: 0, maxValue: 100 },
    ]
  }

  constructor(options) {
    super(options, REVERB_KIND)
    this.currentAlgorithm = ALGORITHM_HALL
  }

  onReady(module, block) {
    const params = ALGO_PARAMS[this.currentAlgorithm]
    module._nam_studio_set_param(this.graph, block, params.dryLevel, 0)
  }

  applyParams(module, block, parameters) {
    const algorithm = Math.round(parameters.reverbAlgorithm[0])
    if (algorithm !== this.currentAlgorithm) {
      this.currentAlgorithm = algorithm
      module._nam_studio_set_reverb_algorithm(this.graph, block, algorithm)
      // Re-force dry level after algorithm switch (new DSP has its own defaults).
      const params = ALGO_PARAMS[algorithm]
      module._nam_studio_set_param(this.graph, block, params.dryLevel, 0)
    }

    const params = ALGO_PARAMS[this.currentAlgorithm]
    const decay = DECAY_MIN + (parameters.roomSize[0] / 0.97) * (DECAY_MAX - DECAY_MIN)
    const highCut = HIGH_CUT_MAX - parameters.damping[0] * (HIGH_CUT_MAX - HIGH_CUT_MIN)

    if (params.decay !== undefined) {
      module._nam_studio_set_param(this.graph, block, params.decay, decay)
    }
    module._nam_studio_set_param(this.graph, block, params.highCut, highCut)
    module._nam_studio_set_param(this.graph, block, params.width, parameters.width[0])
    if (params.predelay !== undefined) {
      module._nam_studio_set_param(this.graph, block, params.predelay, parameters.predelay[0])
    }
    if (params.spin !== undefined) {
      module._nam_studio_set_param(this.graph, block, params.spin, parameters.spin[0])
    }
    if (params.wander !== undefined) {
      module._nam_studio_set_param(this.graph, block, params.wander, parameters.wander[0])
    }
    if (params.earlySend !== undefined) {
      module._nam_studio_set_param(this.graph, block, params.earlySend, parameters.earlySend[0])
    }
  }
}

registerProcessor('dragonfly-reverb-processor', DragonflyReverbProcessor)
