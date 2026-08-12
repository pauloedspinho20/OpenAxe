/**
 * Shared LFO-modulated delay line: the classic building block behind both
 * chorus (long-ish delay, subtle depth) and flanger (very short delay,
 * often with feedback for the pronounced comb-filter sweep). Kept as one
 * helper since both effects wire the exact same graph, just with different
 * default ranges and feedback amounts.
 */
export interface ModulatedDelay {
  readonly input: AudioNode
  readonly output: AudioNode
  readonly lfo: OscillatorNode
  readonly delay: DelayNode
  readonly depthGain: GainNode
  readonly feedbackGain: GainNode
  setRate(hz: number): void
  setDepth(ms: number): void
  setFeedback(amount: number): void
  dispose(): void
}

export interface ModulatedDelayOptions {
  baseDelayMs: number
  depthMs: number
  rateHz: number
  feedback: number
}

export function createModulatedDelay(
  context: BaseAudioContext,
  { baseDelayMs, depthMs, rateHz, feedback }: ModulatedDelayOptions,
): ModulatedDelay {
  const input = new GainNode(context)
  const output = new GainNode(context)
  const delay = new DelayNode(context, {
    delayTime: baseDelayMs / 1000,
    maxDelayTime: (baseDelayMs + depthMs) / 1000 + 0.01,
  })
  const lfo = new OscillatorNode(context, { type: 'sine', frequency: rateHz })
  const depthGain = new GainNode(context, { gain: depthMs / 1000 })
  const feedbackGain = new GainNode(context, { gain: feedback })

  input.connect(delay)
  delay.connect(output)
  delay.connect(feedbackGain)
  feedbackGain.connect(delay)
  lfo.connect(depthGain)
  depthGain.connect(delay.delayTime)
  lfo.start()

  return {
    input,
    output,
    lfo,
    delay,
    depthGain,
    feedbackGain,
    setRate(hz) {
      lfo.frequency.setTargetAtTime(hz, context.currentTime, 0.01)
    },
    setDepth(ms) {
      depthGain.gain.setTargetAtTime(ms / 1000, context.currentTime, 0.01)
    },
    setFeedback(amount) {
      feedbackGain.gain.setTargetAtTime(amount, context.currentTime, 0.01)
    },
    dispose() {
      lfo.stop()
      input.disconnect()
      output.disconnect()
      delay.disconnect()
      lfo.disconnect()
      depthGain.disconnect()
      feedbackGain.disconnect()
    },
  }
}
