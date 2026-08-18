/**
 * AudioWorkletProcessor for the Delay effect: 3 character models (Digital,
 * Analog/BBD, Tape) backed by packages/core/src/dsp/delay.cpp. The
 * `model` AudioParam selects which model is active. Tape mode adds
 * wow/flutter modulation on the read tap. See namStudioEffectBase.js for
 * shared WASM plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'
import { DELAY_PARAMS } from './generatedParams.js'

const DELAY_KIND = 7

const MODEL_DIGITAL = 0
const MODEL_ANALOG = 1
const MODEL_TAPE = 2

class DelayProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'model', defaultValue: MODEL_DIGITAL, minValue: 0, maxValue: 2 },
      { name: 'time', defaultValue: 300, minValue: 10, maxValue: 1000 },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.9 },
      { name: 'tone', defaultValue: 6000, minValue: 200, maxValue: 12000 },
      { name: 'wow_depth', defaultValue: 1.5, minValue: 0, maxValue: 5 },
      { name: 'wow_rate', defaultValue: 0.5, minValue: 0.1, maxValue: 3 },
    ]
  }

  constructor(options) {
    super(options, DELAY_KIND)
    this.currentModel = MODEL_DIGITAL
  }

  applyParams(module, block, parameters) {
    const model = Math.round(parameters.model[0])
    if (model !== this.currentModel) {
      this.currentModel = model
      module._nam_studio_set_delay_model(this.graph, block, model)
    }

    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.time, parameters.time[0])
    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.feedback, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.tone, parameters.tone[0])
    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.model, model)
    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.wow_depth, parameters.wow_depth[0])
    module._nam_studio_set_param(this.graph, block, DELAY_PARAMS.wow_rate, parameters.wow_rate[0])
  }
}

registerProcessor('delay-processor', DelayProcessor)
