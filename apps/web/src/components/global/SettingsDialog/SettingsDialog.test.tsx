// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SettingsDialog } from './SettingsDialog'

vi.mock('../../../native/openaxe', () => ({ getOpenAxe: vi.fn(() => null) }))
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
  beforeEach(() => vi.clearAllMocks())
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
    const { onPowerOff, onPowerOn } = renderDialog()
    const btn = screen.getByRole('button', { name: 'Restart Audio Engine' })
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(onPowerOff).toHaveBeenCalled()
    expect(onPowerOn).toHaveBeenCalled()
  })
})
