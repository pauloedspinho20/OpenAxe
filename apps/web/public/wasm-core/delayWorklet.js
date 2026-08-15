/**
 * AudioWorkletProcessor for the Delay effect: 3 character models (Digital,
 * Analog/BBD, Tape) backed by packages/core/src/dsp/delay.cpp. The
 * `delayModel` AudioParam selects which model is active. Tape mode adds
 * wow/flutter modulation on the read tap. See namStudioEffectBase.js for
 * shared WASM plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const DELAY_KIND = 7

const MODEL_DIGITAL = 0
const MODEL_ANALOG = 1
const MODEL_TAPE = 2

const TIME_PARAM = 0
const FEEDBACK_PARAM = 1
const TONE_PARAM = 2
const MODEL_PARAM = 3
const WOW_DEPTH_PARAM = 4
const WOW_RATE_PARAM = 5

class DelayProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'delayModel', defaultValue: MODEL_DIGITAL, minValue: 0, maxValue: 2 },
      { name: 'time', defaultValue: 300, minValue: 10, maxValue: 1000 },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.9 },
      { name: 'tone', defaultValue: 6000, minValue: 200, maxValue: 12000 },
      { name: 'wowDepth', defaultValue: 1.5, minValue: 0, maxValue: 5 },
      { name: 'wowRate', defaultValue: 0.5, minValue: 0.1, maxValue: 3 },
    ]
  }

  constructor(options) {
    super(options, DELAY_KIND)
    this.currentModel = MODEL_DIGITAL
  }

  applyParams(module, block, parameters) {
    const model = Math.round(parameters.delayModel[0])
    if (model !== this.currentModel) {
      this.currentModel = model
      module._nam_studio_set_delay_model(this.graph, block, model)
    }

    module._nam_studio_set_param(this.graph, block, TIME_PARAM, parameters.time[0])
    module._nam_studio_set_param(this.graph, block, FEEDBACK_PARAM, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, TONE_PARAM, parameters.tone[0])
    module._nam_studio_set_param(this.graph, block, MODEL_PARAM, model)
    module._nam_studio_set_param(this.graph, block, WOW_DEPTH_PARAM, parameters.wowDepth[0])
    module._nam_studio_set_param(this.graph, block, WOW_RATE_PARAM, parameters.wowRate[0])
  }
}

registerProcessor('delay-processor', DelayProcessor)
