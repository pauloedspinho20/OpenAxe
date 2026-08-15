/**
 * AudioWorkletProcessor for the Ping-Pong Delay: two delay lines that
 * alternate left/right taps per repeat (packages/core/src/dsp/
 * ping_pong_delay.cpp). See namStudioEffectBase.js for shared WASM plumbing.
 */
import { NamStudioEffectProcessor } from './namStudioEffectBase.js'

const PING_PONG_KIND = 8

const TIME_PARAM = 0
const FEEDBACK_PARAM = 1
const TONE_PARAM = 2

class PingPongProcessor extends NamStudioEffectProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time', defaultValue: 250, minValue: 50, maxValue: 1000 },
      { name: 'feedback', defaultValue: 0.5, minValue: 0, maxValue: 0.9 },
      { name: 'tone', defaultValue: 6000, minValue: 200, maxValue: 12000 },
    ]
  }

  constructor(options) {
    super(options, PING_PONG_KIND)
  }

  applyParams(module, block, parameters) {
    module._nam_studio_set_param(this.graph, block, TIME_PARAM, parameters.time[0])
    module._nam_studio_set_param(this.graph, block, FEEDBACK_PARAM, parameters.feedback[0])
    module._nam_studio_set_param(this.graph, block, TONE_PARAM, parameters.tone[0])
  }
}

registerProcessor('ping-pong-processor', PingPongProcessor)
