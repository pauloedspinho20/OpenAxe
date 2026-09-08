// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SettingsDialog } from './SettingsDialog'
import { getShellKind, shellOwnsAudioDevice } from '../../../native/openaxe'
import { useIOStore } from '../../../state/ioStore'
import { useTone3000Auth } from '../../../tone3000/authStore'
import { downloadFactoryPack } from '../../../factory/factoryDownload'
import { refreshBanks, setFactorySetupDone } from '../../../factory/factorySetup'

vi.mock('../../../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
  getShellKind: vi.fn(() => 'web'),
  shellOwnsAudioDevice: vi.fn(() => false),
}))
vi.mock('../../../factory/factoryDownload', () => ({
  downloadFactoryPack: vi.fn(),
}))
vi.mock('../../../factory/factorySetup', () => ({
  refreshBanks: vi.fn().mockResolvedValue(undefined),
  setFactorySetupDone: vi.fn(),
}))
vi.mock('../../../settings/dataBundle', () => ({
  getAssetCacheStats: vi.fn().mockResolvedValue({ count: 3, bytes: 1024 }),
  clearAssetCache: vi.fn(),
  deleteAllData: vi.fn(),
  buildDataBundle: vi.fn(),
  downloadDataBundle: vi.fn(),
  importDataBundle: vi.fn(),
  readDataBundleFromFile: vi.fn(),
}))

function renderDialog(over: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  const onPowerOff = vi.fn().mockResolvedValue(undefined)
  const onPowerOn = vi.fn().mockResolvedValue(undefined)
  const props = {
    open: true,
    onClose,
    rig: null,
    context: null,
    status: 'ready' as const,
    outputSelectionSupported: false,
    onPowerOff,
    onPowerOn,
    ...over,
  }
  const utils = render(<SettingsDialog {...props} />)
  return { ...utils, onClose, onPowerOff, onPowerOn }
}

describe('components/SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Explicit, not just clearAllMocks: these are vi.fn(() => …) from the
    // module factory, so a return value set by one test survives into the
    // next one and quietly changes which branch renders.
    vi.mocked(getShellKind).mockReturnValue('web')
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(false)
    // The guard reads the io store — reset it so device fixtures never leak
    // between tests.
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
  afterEach(() => vi.restoreAllMocks())

  it('renders the panel when open', () => {
    const { container } = renderDialog()
    expect(container.textContent).toContain('Settings')
    expect(container.textContent).toContain('Neural Amp Modeler Quality')
  })

  it('renders nothing when closed', () => {
    const { container } = renderDialog({ open: false })
    expect(container.textContent).not.toContain('Settings')
  })

  it('closes on Escape', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('restarts the audio engine through the power callbacks', async () => {
    // The buffer/latency section (and with it "Restart Audio Engine") only
    // exists where this shell owns the audio device — a plugin has neither.
    vi.mocked(shellOwnsAudioDevice).mockReturnValue(true)
    const { onPowerOff, onPowerOn } = renderDialog()
    const btn = screen.getByRole('button', { name: 'Restart Audio Engine' })
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(onPowerOff).toHaveBeenCalled()
    expect(onPowerOn).toHaveBeenCalled()
  })

  describe('audio device sections', () => {
    it('offers an input device picker on the web', () => {
      const { container } = renderDialog()
      expect(container.textContent).toContain('Audio Input')
      expect(screen.getByLabelText('Input device')).toBeInTheDocument()
    })

    it('offers input and output pickers on the desktop, which owns the device', () => {
      vi.mocked(shellOwnsAudioDevice).mockReturnValue(true)
      renderDialog()
      expect(screen.getByLabelText('Input device')).toBeInTheDocument()
      expect(screen.getByLabelText('Output device')).toBeInTheDocument()
    })

    it('offers no device pickers in a plugin, but keeps the channel choice', () => {
      // The DAW routes a track in and takes the result back, so an input
      // device picker selects nothing and the output section would otherwise
      // claim device selection "isn't supported in this browser" inside a
      // DAW. Which channel of that track the rig hears is a real choice,
      // though - a guitar is one cable on a stereo bus.
      vi.mocked(getShellKind).mockReturnValue('plugin')
      const { container } = renderDialog()

      expect(screen.queryByLabelText('Input device')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Output device')).not.toBeInTheDocument()
      expect(container.textContent).not.toContain('Audio Output')
      expect(container.textContent).not.toContain("isn't supported in this browser")

      expect(screen.getByLabelText('Input channel')).toBeInTheDocument()

      // The rest of Settings is untouched.
      expect(container.textContent).toContain('Neural Amp Modeler Quality')
    })

    it('sends a channel change to the plugin through the store', () => {
      vi.mocked(getShellKind).mockReturnValue('plugin')
      renderDialog()
      fireEvent.change(screen.getByLabelText('Input channel'), { target: { value: 'r' } })
      // useNativeAudioEngine watches this and pushes it over the bridge; the
      // store is the single place both the plugin and the web read it from.
      expect(useIOStore.getState().inputChannel).toBe('r')
    })

    it('warns about a built-in mic and acknowledges through the checkbox (issue #422)', () => {
      useIOStore.setState({
        inputDeviceId: 'mic',
        inputDevices: [{ deviceId: 'mic', label: 'MacBook Pro Microphone', groupId: 'g' }],
        outputDevices: [{ deviceId: 'spk', label: 'MacBook Pro Speakers', groupId: 'g' }],
      })
      renderDialog()
      expect(screen.getByText(/looks like a built-in microphone/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: /use it anyway/ }))
      expect(useIOStore.getState().micRiskAckDeviceId).toBe('mic')
      expect(screen.queryByText(/looks like a built-in microphone/)).toBeNull()
    })

    it('notes the restart requirement on desktop while the engine runs', () => {
      vi.mocked(shellOwnsAudioDevice).mockReturnValue(true)
      useIOStore.setState({
        inputDeviceId: 'mic',
        inputDevices: [{ deviceId: 'mic', label: 'Built-in Microphone', groupId: 'g' }],
        outputDevices: [],
      })
      renderDialog({ status: 'ready' })
      expect(screen.getByText(/looks like a built-in microphone/)).toBeInTheDocument()
      expect(screen.getByText(/takes effect when the audio engine restarts/i)).toBeInTheDocument()
    })
  })

  describe('the factory pack', () => {
    const connect = () => useTone3000Auth.setState({ status: 'connected' })

    afterEach(() => {
      useTone3000Auth.setState({ status: 'anonymous' })
    })

    it('offers the pack, since the first-run dialog is shown once and never again', () => {
      connect()
      const { container } = renderDialog()
      expect(container.textContent).toContain('Factory Pack')
      expect(screen.getByRole('button', { name: 'Download Factory Pack' })).toBeEnabled()
    })

    it('is disabled without a Tone3000 connection, and says why', () => {
      const { container } = renderDialog()
      expect(screen.getByRole('button', { name: 'Download Factory Pack' })).toBeDisabled()
      expect(container.textContent).toContain('Connect your Tone3000 account above to download')
    })

    it('confirms before overwriting bank slots rather than doing it on one click', async () => {
      // seedFactoryPack assigns the pack's bank slots unconditionally, so from
      // Settings — unlike first run, where the banks are empty — this can
      // replace slots the user has customised. Say so, and make them confirm.
      connect()
      renderDialog()
      fireEvent.click(screen.getByRole('button', { name: 'Download Factory Pack' }))

      expect(screen.getByText(/replacing whatever is in those slots/i)).toBeInTheDocument()
      expect(downloadFactoryPack).not.toHaveBeenCalled()
    })

    it('downloads on confirm, then re-reads the banks so the presets appear', async () => {
      connect()
      vi.mocked(downloadFactoryPack).mockResolvedValue({
        downloaded: 4,
        skipped: 2,
        failed: [],
        placedPresets: 6,
      })
      const { container } = renderDialog()

      fireEvent.click(screen.getByRole('button', { name: 'Download Factory Pack' }))
      const buttons = screen.getAllByRole('button', { name: 'Download Factory Pack' })
      await act(async () => {
        fireEvent.click(buttons[buttons.length - 1]!)
      })

      expect(downloadFactoryPack).toHaveBeenCalled()
      expect(container.textContent).toContain('4 downloaded, 2 already cached, 6 preset(s) placed')
      // Without these the pack lands on disk but the UI keeps showing the old
      // banks until a reload.
      expect(setFactorySetupDone).toHaveBeenCalled()
      expect(refreshBanks).toHaveBeenCalled()
    })

    it('reports per-model failures instead of claiming success', async () => {
      connect()
      vi.mocked(downloadFactoryPack).mockResolvedValue({
        downloaded: 1,
        skipped: 0,
        failed: [{ name: 'Twin', error: 'network' }],
        placedPresets: 1,
      })
      const { container } = renderDialog()

      fireEvent.click(screen.getByRole('button', { name: 'Download Factory Pack' }))
      const buttons = screen.getAllByRole('button', { name: 'Download Factory Pack' })
      await act(async () => {
        fireEvent.click(buttons[buttons.length - 1]!)
      })

      expect(container.textContent).toContain('1 failed')
      expect(container.textContent).toContain('Twin: network')
    })

    it('explains an auth failure rather than showing the raw error', async () => {
      connect()
      vi.mocked(downloadFactoryPack).mockRejectedValue(new Error('Not authenticated'))
      const { container } = renderDialog()

      fireEvent.click(screen.getByRole('button', { name: 'Download Factory Pack' }))
      const buttons = screen.getAllByRole('button', { name: 'Download Factory Pack' })
      await act(async () => {
        fireEvent.click(buttons[buttons.length - 1]!)
      })

      expect(container.textContent).toContain('needs a Tone3000 account connection')
    })
  })
})
