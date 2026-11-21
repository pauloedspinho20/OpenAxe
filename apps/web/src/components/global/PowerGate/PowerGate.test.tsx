// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PowerGate } from './PowerGate'
import { useTone3000Auth } from '@/tone3000/authStore'
import { useIOStore } from '@/state/ioStore'
import { getOpenAxe, getShellKind, shellOwnsAudioDevice } from '@/native/openaxe'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'

vi.mock('@/native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
  getShellKind: vi.fn(() => 'web'),
  shellOwnsAudioDevice: vi.fn(() => false),
}))

vi.mock('@/hooks/useUpdateCheck', () => ({
  useUpdateCheck: vi.fn(() => ({
    latest: null,
    checking: false,
    dismiss: vi.fn(),
    refresh: vi.fn(),
  })),
}))

const baseProps = {
  status: 'off' as const,
  error: null,
  latencyHint: 'interactive' as const,
  onLatencyChange: () => {},
  outputSelectionSupported: true,
  onPowerOn: vi.fn(),
}

describe('PowerGate', () => {
  beforeEach(() => {
    // Reset the shell mocks too, not just getOpenAxe: a test that switches to
    // the plugin shell would otherwise leak into every test after it, and in
    // plugin mode the gate renders nothing at all — so the failures land
    // somewhere unrelated and look like a different bug.
    vi.mocked(getOpenAxe).mockReturnValue(null)
    vi.mocked(getShellKind).mockReturnValue('web')
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(false)
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

  it('powers on normally', () => {
    const onPowerOn = vi.fn()
    render(<PowerGate {...baseProps} onPowerOn={onPowerOn} />)
    fireEvent.click(screen.getByRole('button', { name: 'POWER ON' }))
    expect(onPowerOn).toHaveBeenCalledWith()
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
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(connect).toHaveBeenCalled()
  })

  it('disconnects when already connected', () => {
    vi.spyOn(useTone3000Auth.getState(), 'disconnect')
    useTone3000Auth.setState({ status: 'connected', user: { username: 'bob' } as never })
    render(<PowerGate {...baseProps} />)
    expect(screen.getByText('TONE3000 - Connected as bob')).toBeInTheDocument()
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
      inputDevices: [{ deviceId: 'd1', label: 'Mic', groupId: 'grp' }],
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
    vi.mocked(getOpenAxe).mockReturnValue({} as never)
    vi.mocked(getShellKind).mockReturnValue('desktop')
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(true)
    useIOStore.setState({
      inputDevices: [{ deviceId: 'i', label: 'In', groupId: 'grp' }],
      outputDevices: [{ deviceId: 'o', label: 'Out', groupId: 'grp' }],
    })
    render(<PowerGate {...baseProps} outputSelectionSupported={false} />)
    expect(screen.getByLabelText('Output device')).toBeInTheDocument()
  })

  it('renders nothing at all in the plugin shell', () => {
    // A plugin has no power switch to offer: the DAW owns the transport and App
    // powers the engine on automatically, so the gate would only flash up and
    // dismiss itself. Previously it rendered device pickers here; now it
    // renders nothing.
    vi.mocked(getOpenAxe).mockReturnValue({} as never)
    vi.mocked(getShellKind).mockReturnValue('plugin')
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(false)
    useIOStore.setState({
      inputDevices: [{ deviceId: 'i', label: 'In', groupId: 'grp' }],
      outputDevices: [{ deviceId: 'o', label: 'Out', groupId: 'grp' }],
    })
    const { container } = render(<PowerGate {...baseProps} outputSelectionSupported={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByLabelText('Input device')).toBeNull()
    expect(screen.queryByLabelText('Output device')).toBeNull()
    expect(screen.queryByRole('button', { name: /power/i })).toBeNull()
  })

  it('still surfaces a failure in the plugin shell, with a retry rather than a power switch', () => {
    // Rendering nothing on error would leave a blank editor with no
    // explanation, so the gate stays for that one case — but retry is the only
    // action that means anything when the host owns the transport.
    vi.mocked(getOpenAxe).mockReturnValue({} as never)
    vi.mocked(getShellKind).mockReturnValue('plugin')
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(false)
    render(<PowerGate {...baseProps} status="error" error="engine failed to start" />)
    expect(screen.getByText('engine failed to start')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /power on/i })).toBeNull()
  })

  it('shows the download link via the hero wordmark', () => {
    render(<PowerGate {...baseProps} />)
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
  })

  it('shows update banner when a newer version exists', () => {
    vi.mocked(useUpdateCheck).mockReturnValue({
      latest: {
        tag: 'v0.3.0',
        htmlUrl: 'https://github.com/pauloedspinho20/OpenAxe/releases/tag/v0.3.0',
        publishedAt: null,
      },
      checking: false,
      dismiss: vi.fn(),
      refresh: vi.fn(),
    } as never)
    render(<PowerGate {...baseProps} />)
    const banner = screen.getByRole('status')
    expect(within(banner).getByText('New version v0.3.0 available')).toBeInTheDocument()
    expect(within(banner).getByRole('link', { name: 'Download' })).toBeInTheDocument()
  })

  it('dismisses the update banner', () => {
    const dismiss = vi.fn()
    vi.mocked(useUpdateCheck).mockReturnValue({
      latest: { tag: 'v0.3.0', htmlUrl: '', publishedAt: null },
      checking: false,
      dismiss,
      refresh: vi.fn(),
    } as never)
    render(<PowerGate {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }))
    expect(dismiss).toHaveBeenCalled()
  })
})
