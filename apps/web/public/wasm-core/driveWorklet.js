/**
 * AudioWorkletProcessor for the Drive effect (issue #14/#22): four BYOD
 * wave-digital-filter circuit models — Diode Clipper, Tube Screamer, Zen
 * Drive, MXR Distortion+ — backed by the same packages/core WASM module
 * every other nam_studio_core-backed effect uses. The `driveModel` AudioParam
 * selects which model is active; the union of every model's own knobs is
 * declared once as a fixed pool of AudioParams, and `applyParams` forwards
 * only the ones the current model actually owns (the C++ side ignores
 * out-of-range indices — see engine.cpp's SetParam). Changing models calls
 * `nam_studio_set_drive_model` (not real-time safe, but model switching is a
 * user action, not an automation curve) which destructs the old DSP wrapper
 * and constructs the new one, then seeds defaults from the new model's own
 * constructor; the next `process()` call pushes the current AudioParam values
 * on top so the model picks up whatever knobs the user has already set.
 *
 * WASM instantiation and buffer marshaling are shared with every other
 * nam_studio_core-backed effect — see namStudioEffectBase.js.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

// See packages/core/include/nam_studio/api.h's NamStudioBlockKind enum.
const DRIVE_KIND = 18

// Matches NamStudioDriveModel in api.h.
const MODEL_DIODE_CLIPPER = 0
const MODEL_TUBE_SCREAMER = 1
const MODEL_ZEN_DRIVE = 2
const MODEL_MXR_DISTORTION = 3

// Diode Clipper's own param indices (diode_clipper.cpp kParamInfo).
const DC_CUTOFF = 0
const DC_DRIVE = 1
const DC_DIODE_TYPE = 2
const DC_NUM_DIODES = 3

// Tube Screamer's own param indices (tube_screamer.cpp kParamInfo).
const TS_GAIN = 0
const TS_DIODE_TYPE = 1
const TS_NUM_DIODES = 2

// Zen Drive's own param indices (zen_drive.cpp kParamInfo).
const ZD_VOICE = 0
const ZD_GAIN = 1

// MXR Distortion's own param indices (mxr_distortion.cpp kParamInfo).
const MX_DIST = 0
const MX_LEVEL = 1

class DriveProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'driveModel', defaultValue: MODEL_DIODE_CLIPPER, minValue: 0, maxValue: 3 },
      { name: 'cutoff', defaultValue: 5000, minValue: 200, maxValue: 20000 },
      { name: 'drive', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'diodeType', defaultValue: 0, minValue: 0, maxValue: 2 },
      { name: 'numDiodes', defaultValue: 1, minValue: 0.3, maxValue: 3 },
      { name: 'gain', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'voice', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'dist', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'outputLevel', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ]
  }

  constructor(options) {
    super(options, DRIVE_KIND)
    this.currentModel = MODEL_DIODE_CLIPPER
  }

  applyParams(module, block, parameters) {
    const model = Math.round(parameters.driveModel[0])
    if (model !== this.currentModel) {
      this.currentModel = model
      module._nam_studio_set_drive_model(this.graph, block, model)
    }

    switch (this.currentModel) {
      case MODEL_DIODE_CLIPPER:
        module._nam_studio_set_param(this.graph, block, DC_CUTOFF, parameters.cutoff[0])
        module._nam_studio_set_param(this.graph, block, DC_DRIVE, parameters.drive[0])
        module._nam_studio_set_param(this.graph, block, DC_DIODE_TYPE, parameters.diodeType[0])
        module._nam_studio_set_param(this.graph, block, DC_NUM_DIODES, parameters.numDiodes[0])
        break
      case MODEL_TUBE_SCREAMER:
        module._nam_studio_set_param(this.graph, block, TS_GAIN, parameters.gain[0])
        module._nam_studio_set_param(this.graph, block, TS_DIODE_TYPE, parameters.diodeType[0])
        module._nam_studio_set_param(this.graph, block, TS_NUM_DIODES, parameters.numDiodes[0])
        break
      case MODEL_ZEN_DRIVE:
        module._nam_studio_set_param(this.graph, block, ZD_VOICE, parameters.voice[0])
        module._nam_studio_set_param(this.graph, block, ZD_GAIN, parameters.gain[0])
        break
      case MODEL_MXR_DISTORTION:
        module._nam_studio_set_param(this.graph, block, MX_DIST, parameters.dist[0])
        module._nam_studio_set_param(this.graph, block, MX_LEVEL, parameters.outputLevel[0])
        break
    }
  }
}

registerProcessor('drive-processor', DriveProcessor)
