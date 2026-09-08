// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useIOStore } from './ioStore'

const RESET = {
  inputDeviceId: '',
  outputDeviceId: '',
  inputGain: 1,
  inputChannel: 'l' as const,
  latencyHint: 'interactive' as const,
  micError: null,
  micRiskAckDeviceId: null as string | null,
  micRiskAckLabel: null as string | null,
  inputDevices: [],
  outputDevices: [],
}

describe('ioStore', () => {
  beforeEach(() => {
    useIOStore.setState(RESET)
    // The persist middleware also writes to localStorage — clear it so tests
    // don't leak state across runs.
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to default device, unity gain, interactive latency, no error', () => {
    const state = useIOStore.getState()
    expect(state.inputDeviceId).toBe('')
    expect(state.outputDeviceId).toBe('')
    expect(state.inputGain).toBe(1)
    expect(state.latencyHint).toBe('interactive')
    expect(state.micError).toBeNull()
    expect(state.inputDevices).toEqual([])
    expect(state.outputDevices).toEqual([])
  })

  it('setInputDevice updates the selected input id and clears micError', () => {
    useIOStore.getState().setInputDevice('dev-1')
    expect(useIOStore.getState().inputDeviceId).toBe('dev-1')
    expect(useIOStore.getState().micError).toBeNull()
  })

  it('setOutputDevice updates the selected output id', () => {
    useIOStore.getState().setOutputDevice('speaker-1')
    expect(useIOStore.getState().outputDeviceId).toBe('speaker-1')
  })

  it('setInputGain stores the value directly (Knob constrains it upstream)', () => {
    useIOStore.getState().setInputGain(0.5)
    expect(useIOStore.getState().inputGain).toBe(0.5)
    useIOStore.getState().setInputGain(2)
    expect(useIOStore.getState().inputGain).toBe(2)
  })

  it('setLatencyHint accepts the three valid values', () => {
    useIOStore.getState().setLatencyHint('balanced')
    expect(useIOStore.getState().latencyHint).toBe('balanced')
    useIOStore.getState().setLatencyHint('playback')
    expect(useIOStore.getState().latencyHint).toBe('playback')
    useIOStore.getState().setLatencyHint('interactive')
    expect(useIOStore.getState().latencyHint).toBe('interactive')
  })

  it('setInputChannel accepts all channel modes', () => {
    useIOStore.getState().setInputChannel('r')
    expect(useIOStore.getState().inputChannel).toBe('r')
    useIOStore.getState().setInputChannel('stereo')
    expect(useIOStore.getState().inputChannel).toBe('stereo')
    useIOStore.getState().setInputChannel('sum')
    expect(useIOStore.getState().inputChannel).toBe('sum')
    useIOStore.getState().setInputChannel('l')
    expect(useIOStore.getState().inputChannel).toBe('l')
  })

  it('setMicError stores the error message', () => {
    useIOStore.getState().setMicError('Permission denied')
    expect(useIOStore.getState().micError).toBe('Permission denied')
    useIOStore.getState().setMicError(null)
    expect(useIOStore.getState().micError).toBeNull()
  })

  it('setDeviceLists populates the ephemeral device arrays', () => {
    const inputs = [{ deviceId: 'in-1', label: 'Mic', groupId: 'g1' }]
    const outputs = [{ deviceId: 'out-1', label: 'Speakers', groupId: 'g2' }]
    useIOStore.getState().setDeviceLists(inputs, outputs)
    expect(useIOStore.getState().inputDevices).toEqual(inputs)
    expect(useIOStore.getState().outputDevices).toEqual(outputs)
  })

  it('setMicRiskAcknowledged snapshots the current selection, and revokes cleanly', () => {
    useIOStore
      .getState()
      .setDeviceLists([{ deviceId: 'mic', label: 'Built-in Microphone', groupId: 'g' }], [])
    useIOStore.getState().setInputDevice('mic')
    expect(useIOStore.getState().micRiskAckDeviceId).toBeNull()

    useIOStore.getState().setMicRiskAcknowledged(true)
    expect(useIOStore.getState().micRiskAckDeviceId).toBe('mic')
    expect(useIOStore.getState().micRiskAckLabel).toBe('Built-in Microphone')

    // Switching input does not clear the old snapshot — matching is
    // per-device, so the new selection simply doesn't match and re-arms.
    useIOStore.getState().setInputDevice('')
    expect(useIOStore.getState().micRiskAckDeviceId).toBe('mic')

    useIOStore.getState().setMicRiskAcknowledged(false)
    expect(useIOStore.getState().micRiskAckDeviceId).toBeNull()
    expect(useIOStore.getState().micRiskAckLabel).toBeNull()
  })

  it('partialize keeps device selections, gain, and latencyHint, but not the ephemeral lists', () => {
    // Set both persisted and non-persisted fields.
    useIOStore.getState().setInputDevice('some-mic')
    useIOStore.getState().setOutputDevice('some-speaker')
    useIOStore.getState().setInputGain(0.75)
    useIOStore.getState().setLatencyHint('balanced')
    useIOStore
      .getState()
      .setDeviceLists(
        [{ deviceId: 'in-1', label: 'Mic', groupId: 'g1' }],
        [{ deviceId: 'out-1', label: 'Spk', groupId: 'g2' }],
      )

    const persisted = localStorage.getItem('openaxe-io')
    expect(persisted).not.toBeNull()
    const parsed = JSON.parse(persisted!)
    // Persisted fields - device IDs survive reload so a chosen input/output
    // device is remembered; the enumerated lists themselves are re-populated
    // fresh every launch since hardware ids can change.
    expect(parsed.state.inputDeviceId).toBe('some-mic')
    expect(parsed.state.outputDeviceId).toBe('some-speaker')
    expect(parsed.state.inputGain).toBe(0.75)
    expect(parsed.state.latencyHint).toBe('balanced')
    expect(parsed.state.inputChannel).toBe('l')
    // NOT persisted.
    expect(parsed.state.inputDevices).toBeUndefined()
    expect(parsed.state.outputDevices).toBeUndefined()
    expect(parsed.state.micError).toBeUndefined()
    // The ack is session-scoped: a stale ack must never bless a new session's
    // (ephemeral-id) device.
    expect(parsed.state.micRiskAckDeviceId).toBeUndefined()
    expect(parsed.state.micRiskAckLabel).toBeUndefined()
  })
})
