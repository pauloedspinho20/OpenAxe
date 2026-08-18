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
 * C++ side (SetParam no-ops for out-of-range indices). The native Dry Level
 * (param index 0 on every algorithm) is exposed as the `dryLevel` AudioParam
 * - Dragonfly's own dry/wet control - 0% dry (fully wet) to 100% dry.
 *
 * WASM instantiation and buffer marshaling are shared via namStudioEffectBase.js.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { REVERB_PARAMS } from './generatedParams.js'

const REVERB_KIND = 9

const ALGORITHM_HALL = 0
const ALGORITHM_ROOM = 1
const ALGORITHM_PLATE = 2
const ALGORITHM_EARLY_REFLECTIONS = 3

// Per-algorithm param index maps for the 7 user-facing knobs + dry level.
// This is a genuine semantic remap, not a 1:1 symbol pass-through - the same
// web-facing concept lives at a different core symbol per algorithm (e.g.
// "predelay" is Hall's `delay` param but Room/Plate's own `predelay`; the
// generated REVERB_PARAMS.<algorithm> map is what pins each one to the right
// index, so a core param-table reorder can't silently desync this worklet.
// Ranges differ slightly across algorithms (e.g. spin is [0,10]Hz in Hall
// but [0,5]Hz in Room), but the AudioParam ranges are generous enough to
// cover all cases.
const ALGO_PARAMS = {
  [ALGORITHM_HALL]: {
    dryLevel: REVERB_PARAMS.hall.dry_level,
    width: REVERB_PARAMS.hall.width,
    predelay: REVERB_PARAMS.hall.delay,
    highCut: REVERB_PARAMS.hall.high_cut,
    spin: REVERB_PARAMS.hall.spin,
    wander: REVERB_PARAMS.hall.wander,
    decay: REVERB_PARAMS.hall.decay,
    earlySend: REVERB_PARAMS.hall.early_send,
  },
  [ALGORITHM_ROOM]: {
    dryLevel: REVERB_PARAMS.room.dry_level,
    width: REVERB_PARAMS.room.width,
    predelay: REVERB_PARAMS.room.predelay,
    highCut: REVERB_PARAMS.room.in_high_cut,
    spin: REVERB_PARAMS.room.spin,
    wander: REVERB_PARAMS.room.wander,
    decay: REVERB_PARAMS.room.decay,
    earlySend: REVERB_PARAMS.room.early_send,
  },
  [ALGORITHM_PLATE]: {
    dryLevel: REVERB_PARAMS.plate.dry_level,
    width: REVERB_PARAMS.plate.width,
    predelay: REVERB_PARAMS.plate.predelay,
    highCut: REVERB_PARAMS.plate.high_cut,
    decay: REVERB_PARAMS.plate.decay,
  },
  [ALGORITHM_EARLY_REFLECTIONS]: {
    dryLevel: REVERB_PARAMS['early-reflections'].dry_level,
    width: REVERB_PARAMS['early-reflections'].width,
    highCut: REVERB_PARAMS['early-reflections'].high_cut,
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
      { name: 'dryLevel', defaultValue: 0, minValue: 0, maxValue: 100 },
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
      // Re-apply dry level after algorithm switch (new DSP has its own defaults).
      const params = ALGO_PARAMS[algorithm]
      module._nam_studio_set_param(this.graph, block, params.dryLevel, parameters.dryLevel[0])
    }

    const params = ALGO_PARAMS[this.currentAlgorithm]
    module._nam_studio_set_param(this.graph, block, params.dryLevel, parameters.dryLevel[0])
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
