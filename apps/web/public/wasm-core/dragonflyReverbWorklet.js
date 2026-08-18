/**
 * AudioWorkletProcessor for the Reverb effect: 4 Dragonfly Reverb algorithms
 * (Hall, Room, Plate, Early Reflections) compiled to WASM from
 * packages/core. The `reverbAlgorithm` AudioParam selects which algorithm
 * backs the block; switching algorithms reconstructs the underlying DSP
 * wrapper (not real-time safe, but algorithm choice is a user action).
 *
 * The 8 user-facing knobs (roomSize/damping/width/predelay/spin/wander/
 * earlySend/dryLevel) are the union of every algorithm's available controls.
 * Which core param each one resolves to per algorithm - and the room-size and
 * damping abstractions, which have no core symbol of their own - is decided in
 * C++ by nam_studio_set_reverb_control (packages/core's ReverbControl), not
 * here: the desktop app and any future plugin editor drive the identical
 * mapping through the same call. Controls the current algorithm doesn't have
 * are no-ops on the C++ side.
 *
 * WASM instantiation and buffer marshaling are shared via namStudioEffectBase.js.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const REVERB_KIND = 9

// Algorithm ids, matching packages/core's NamStudioReverbAlgorithm order.
const ALGORITHM_HALL = 0

// Control ids from packages/core's api.h (NamStudioReverbControl).
const CONTROL_ROOM_SIZE = 0
const CONTROL_DAMPING = 1
const CONTROL_WIDTH = 2
const CONTROL_PREDELAY = 3
const CONTROL_SPIN = 4
const CONTROL_WANDER = 5
const CONTROL_EARLY_SEND = 6
const CONTROL_DRY_LEVEL = 7

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
    module._nam_studio_set_reverb_control(this.graph, block, CONTROL_DRY_LEVEL, 0)
  }

  applyParams(module, block, parameters) {
    const algorithm = Math.round(parameters.reverbAlgorithm[0])
    if (algorithm !== this.currentAlgorithm) {
      this.currentAlgorithm = algorithm
      module._nam_studio_set_reverb_algorithm(this.graph, block, algorithm)
    }

    const set = (control, value) =>
      module._nam_studio_set_reverb_control(this.graph, block, control, value)
    // Sent unconditionally on every render quantum, including right after an
    // algorithm switch (the new DSP starts from its own defaults, so the knobs
    // have to be reasserted anyway).
    set(CONTROL_DRY_LEVEL, parameters.dryLevel[0])
    set(CONTROL_ROOM_SIZE, parameters.roomSize[0])
    set(CONTROL_DAMPING, parameters.damping[0])
    set(CONTROL_WIDTH, parameters.width[0])
    set(CONTROL_PREDELAY, parameters.predelay[0])
    set(CONTROL_SPIN, parameters.spin[0])
    set(CONTROL_WANDER, parameters.wander[0])
    set(CONTROL_EARLY_SEND, parameters.earlySend[0])
  }
}

registerProcessor('dragonfly-reverb-processor', DragonflyReverbProcessor)
