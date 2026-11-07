// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputDeviceDialog } from './InputDeviceDialog'
import { getShellKind } from '../../../native/openaxe'
import { useIOStore } from '../../../state/ioStore'

vi.mock('../../../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
  getShellKind: vi.fn(() => 'web'),
  shellOwnsAudioDevice: vi.fn(() => false),
}))

function engineStub() {
  return {
    status: 'ready',
    diPlaying: false,
    diError: null,
    diSampleId: null,
    playDI: vi.fn(),
    stopDI: vi.fn(),
  } as never
}

describe('components/InputDeviceDialog feedback guard (issue #422)', () => {
  beforeEach(() => {
    vi.mocked(getShellKind).mockReturnValue('web')
    useIOStore.setState({
      inputDeviceId: '',
      outputDeviceId: '',
      inputDevices: [],
      outputDevices: [],
      micRiskAckDeviceId: null,
      micRiskAckLabel: null,
      micError: null,
    })
  })

  it('warns and points at the DI takes for a built-in mic', () => {
    useIOStore.setState({
      inputDeviceId: 'mic',
      inputDevices: [{ deviceId: 'mic', label: 'Built-in Microphone', groupId: 'g' }],
      outputDevices: [{ deviceId: 'spk', label: 'Built-in Output', groupId: 'g' }],
    })
    render(<InputDeviceDialog open onClose={() => {}} engine={engineStub()} />)
    expect(screen.getByText(/looks like a built-in microphone/)).toBeInTheDocument()
    expect(screen.getByText(/play a DI take below/)).toBeInTheDocument()
  })

  it('acknowledges through the checkbox and clears the warning', () => {
    useIOStore.setState({
      inputDeviceId: 'mic',
      inputDevices: [{ deviceId: 'mic', label: 'Built-in Microphone', groupId: 'g' }],
      outputDevices: [],
    })
    render(<InputDeviceDialog open onClose={() => {}} engine={engineStub()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /use it anyway/ }))
    expect(useIOStore.getState().micRiskAckDeviceId).toBe('mic')
    expect(screen.queryByText(/looks like a built-in microphone/)).toBeNull()
  })

  it('stays quiet for a real interface', () => {
    useIOStore.setState({
      inputDeviceId: 'usb',
      inputDevices: [{ deviceId: 'usb', label: 'Scarlett 2i4 USB', groupId: 's' }],
      outputDevices: [],
    })
    render(<InputDeviceDialog open onClose={() => {}} engine={engineStub()} />)
    expect(screen.queryByText(/built-in microphone/)).toBeNull()
  })
})
