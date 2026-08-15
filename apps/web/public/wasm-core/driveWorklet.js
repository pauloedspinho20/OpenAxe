/**
 * AudioWorkletProcessor for the Drive effect (issue #14/#22): Diode Clipper,
 * the first BYOD DSP wrapped into packages/core - the app's first-ever
 * distortion/drive effect (no prior hand-rolled implementation to replace).
 * WASM instantiation and buffer marshaling are shared with every other
 * nam_studio_core-backed effect - see namStudioEffectBase.js. Params pass
 * straight through to Diode Clipper's own native units/ranges - see
 * packages/core/src/dsp/diode_clipper.cpp's kParamInfo table - no legacy
 * effect's knob semantics to preserve, unlike Reverb's roomSize/damping.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

// See packages/core/include/nam_studio/api.h's NamStudioBlockKind enum -
// NAM_STUDIO_BLOCK_DRIVE is appended at the end (after NAM_STUDIO_BLOCK_SPLITTER).
const DRIVE_KIND = 18

// Diode Clipper's own param indices - see diode_clipper.cpp's kParamInfo table.
const CUTOFF_PARAM = 0 // 200-20000Hz
const DRIVE_PARAM = 1 // 0-1 (%)
const DIODE_TYPE_PARAM = 2 // 0-2 (GZ34/1N34/1N4148)
const NUM_DIODES_PARAM = 3 // 0.3-3.0

class DriveProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 5000, minValue: 200, maxValue: 20000 },
      { name: 'drive', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'diodeType', defaultValue: 0, minValue: 0, maxValue: 2 },
      { name: 'numDiodes', defaultValue: 1, minValue: 0.3, maxValue: 3 },
    ]
  }

  constructor(options) {
    super(options, DRIVE_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, CUTOFF_PARAM, parameters.cutoff[0])
    module._nam_studio_set_param(this.graph, block, DRIVE_PARAM, parameters.drive[0])
    module._nam_studio_set_param(this.graph, block, DIODE_TYPE_PARAM, parameters.diodeType[0])
    module._nam_studio_set_param(this.graph, block, NUM_DIODES_PARAM, parameters.numDiodes[0])
  }
}

registerProcessor('drive-processor', DriveProcessor)
