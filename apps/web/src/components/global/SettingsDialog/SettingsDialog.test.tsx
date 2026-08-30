// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SettingsDialog } from './SettingsDialog'
import { getShellKind, shellOwnsAudioDevice } from '../../../native/openaxe'

vi.mock('../../../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
  getShellKind: vi.fn(() => 'web'),
  shellOwnsAudioDevice: vi.fn(() => false),
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

    it('offers no device sections at all in a plugin', () => {
      // The DAW routes a track in and takes the result back: an input picker
      // selects nothing, the channel selector is never read on the native
      // path, and the output section would otherwise claim device selection
      // "isn't supported in this browser" inside a DAW.
      vi.mocked(getShellKind).mockReturnValue('plugin')
      const { container } = renderDialog()

      expect(screen.queryByLabelText('Input device')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Input channel')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Output device')).not.toBeInTheDocument()
      expect(container.textContent).not.toContain('Audio Input')
      expect(container.textContent).not.toContain('Audio Output')
      expect(container.textContent).not.toContain("isn't supported in this browser")

      // The rest of Settings is untouched.
      expect(container.textContent).toContain('Neural Amp Modeler Quality')
    })
  })
})
