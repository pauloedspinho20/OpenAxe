// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PowerGate } from './PowerGate'
import { useTone3000Auth } from '@/tone3000/authStore'
import { useIOStore } from '@/state/ioStore'
import { getNamStudio } from '@/native/namStudio'

vi.mock('@/native/namStudio', () => ({
  getNamStudio: vi.fn(() => null),
}))

const baseProps = {
  status: 'idle' as const,
  error: null,
  latencyHint: 'interactive' as const,
  onLatencyChange: () => {},
  outputSelectionSupported: true,
  onPowerOn: vi.fn(),
}

describe('PowerGate', () => {
  beforeEach(() => {
    vi.mocked(getNamStudio).mockReturnValue(null)
    useTone3000Auth.setState({ status: 'anonymous', user: null, error: null, pendingFlow: false })
    useIOStore.setState({
      inputDeviceId: '',
      outputDeviceId: '',
      inputDevices: [],
      outputDevices: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing once the engine is ready', () => {
    render(<PowerGate {...baseProps} status="ready" />)
    expect(screen.queryByLabelText('Power on')).toBeNull()
  })

  it('powers on normally and without sound', () => {
    const onPowerOn = vi.fn()
    render(<PowerGate {...baseProps} onPowerOn={onPowerOn} />)
    fireEvent.click(screen.getByRole('button', { name: 'POWER ON' }))
    expect(onPowerOn).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: 'Continue without sound' }))
    expect(onPowerOn).toHaveBeenCalledWith({ noSound: true })
  })

  it('shows the error text when in the error state', () => {
    render(<PowerGate {...baseProps} status="error" error="Boom" />)
    expect(screen.getByText('Boom')).toBeInTheDocument()
  })

  it('disables the power buttons while starting', () => {
    render(<PowerGate {...baseProps} status="starting" />)
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
  })

  it('reports a latency change', () => {
    const onLatencyChange = vi.fn()
    render(<PowerGate {...baseProps} onLatencyChange={onLatencyChange} />)
    fireEvent.change(screen.getByLabelText('Latency mode'), { target: { value: 'balanced' } })
    expect(onLatencyChange).toHaveBeenCalledWith('balanced')
  })

  it('connects to Tone3000 when not connected', () => {
    const connect = vi.spyOn(useTone3000Auth.getState(), 'connect')
    render(<PowerGate {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect Tone3000' }))
    expect(connect).toHaveBeenCalled()
  })

  it('disconnects when already connected', () => {
    vi.spyOn(useTone3000Auth.getState(), 'disconnect')
    useTone3000Auth.setState({ status: 'connected', user: { username: 'bob' } as never })
    render(<PowerGate {...baseProps} />)
    expect(screen.getByText('Tone3000: connected as bob')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(useTone3000Auth.getState().disconnect).toHaveBeenCalled()
  })

  it('shows an auth error hint', () => {
    useTone3000Auth.setState({ status: 'error', error: 'denied' })
    render(<PowerGate {...baseProps} />)
    expect(screen.getByText(/Couldn't connect to Tone3000 \(denied\)/)).toBeInTheDocument()
  })

  it('updates the input device selection', () => {
    const setInputDevice = vi.spyOn(useIOStore.getState(), 'setInputDevice')
    useIOStore.setState({
      inputDevices: [{ deviceId: 'd1', label: 'Mic' }],
      outputDevices: [],
    })
    render(<PowerGate {...baseProps} />)
    fireEvent.change(screen.getByLabelText('Input device'), { target: { value: 'd1' } })
    expect(setInputDevice).toHaveBeenCalledWith('d1')
  })

  it('hides the output selector when output selection is unsupported', () => {
    render(<PowerGate {...baseProps} outputSelectionSupported={false} />)
    expect(screen.queryByLabelText('Output device')).toBeNull()
  })

  it('always shows the output selector in the native (desktop) shell', () => {
    vi.mocked(getNamStudio).mockReturnValue({} as never)
    useIOStore.setState({
      inputDevices: [{ deviceId: 'i', label: 'In' }],
      outputDevices: [{ deviceId: 'o', label: 'Out' }],
    })
    render(<PowerGate {...baseProps} outputSelectionSupported={false} />)
    expect(screen.getByLabelText('Output device')).toBeInTheDocument()
  })
})
