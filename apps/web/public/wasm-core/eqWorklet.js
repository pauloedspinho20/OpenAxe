/**
 * AudioWorkletProcessor for the EQ effect: a 4-band parametric EQ
 * (packages/core/src/dsp/equalizer.cpp, DSPark) — low-shelf, two mid peaks,
 * high-shelf, each with frequency/gain/Q = 12 params. See
 * namStudioEffectBase.js for shared WASM/buffer plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const EQ_KIND = 2
const BAND_COUNT = 4

// Matches equalizer.cpp's kDefaults per band (100/500/2000/6000 Hz).
const BAND_DEFAULT_FREQUENCIES = [100, 500, 2000, 6000]

class EqProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    const descriptors = []
    for (let band = 0; band < BAND_COUNT; band++) {
      const prefix = `band${band}_`
      descriptors.push({ name: `${prefix}frequency`, defaultValue: BAND_DEFAULT_FREQUENCIES[band], minValue: 20, maxValue: 20000 })
      descriptors.push({ name: `${prefix}gain`, defaultValue: 0, minValue: -15, maxValue: 15 })
      descriptors.push({ name: `${prefix}q`, defaultValue: 0.707, minValue: 0.1, maxValue: 10 })
    }
    return descriptors
  }

  constructor(options) {
    super(options, EQ_KIND)
  }

  applyParams(module, block, parameters) {
    // The C++ side re-derives the whole band from the three sibling values
    // (see equalizer.cpp's Apply), so each band is set from its own three
    // knobs, indexed band*3 + {frequency, gain, q}.
    for (let band = 0; band < BAND_COUNT; band++) {
      const prefix = `band${band}_`
      const base = band * 3
      module._nam_studio_set_param(this.graph, block, base + 0, parameters[`${prefix}frequency`][0])
      module._nam_studio_set_param(this.graph, block, base + 1, parameters[`${prefix}gain`][0])
      module._nam_studio_set_param(this.graph, block, base + 2, parameters[`${prefix}q`][0])
    }
  }
}

registerProcessor('eq-processor', EqProcessor)
