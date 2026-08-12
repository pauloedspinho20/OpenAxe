/**
 * Noise gate AudioWorkletProcessor: our own DSP (not ported from anywhere),
 * since a sample-accurate envelope follower needs the audio thread - a
 * native node can't do this. Plain JS with no imports and no build step, so
 * it can be registered directly via audioWorklet.addModule() (same approach
 * neural-amp-modeler-wasm's own worklet bundle uses).
 *
 * Classic one-pole gate: the gain smoothly approaches 1 (attack time
 * constant) when the input envelope is above threshold, and approaches 0
 * (release time constant) when below it. No lookahead or hold time - the
 * simplest version that still avoids zipper noise.
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0 },
      { name: 'attack', defaultValue: 0.003, minValue: 0.0001, maxValue: 1 },
      { name: 'release', defaultValue: 0.15, minValue: 0.001, maxValue: 2 },
    ]
  }

  constructor() {
    super()
    this.gainByChannel = []
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true

    const thresholdLinear = Math.pow(10, parameters.threshold[0] / 20)
    const attackCoeff = Math.exp(-1 / (sampleRate * parameters.attack[0]))
    const releaseCoeff = Math.exp(-1 / (sampleRate * parameters.release[0]))

    for (let channel = 0; channel < input.length; channel++) {
      const inChannel = input[channel]
      const outChannel = output[channel]
      let gain = this.gainByChannel[channel] ?? 0

      for (let i = 0; i < inChannel.length; i++) {
        const target = Math.abs(inChannel[i]) >= thresholdLinear ? 1 : 0
        const coeff = target > gain ? attackCoeff : releaseCoeff
        gain = target + (gain - target) * coeff
        outChannel[i] = inChannel[i] * gain
      }

      this.gainByChannel[channel] = gain
    }

    return true
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor)
