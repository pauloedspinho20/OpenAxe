// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAudioIO } from './useAudioIO'
import { useIOStore } from '../state/ioStore'
import { getNamStudio } from '../native/namStudio'

vi.mock('@/native/namStudio', () => ({
  getNamStudio: vi.fn(() => null),
}))

function stubMediaDevices() {
  const md = {
    enumerateDevices: vi.fn().mockResolvedValue([]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true })
  return md
}

describe('useAudioIO', () => {
  beforeEach(() => {
    vi.mocked(getNamStudio).mockReturnValue(null)
    useIOStore.setState({
      inputDeviceId: '',
      outputDeviceId: '',
      inputDevices: [],
      outputDevices: [],
    })
    stubMediaDevices()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enumerates browser devices into the ioStore on mount', async () => {
    const md = navigator.mediaDevices as unknown as { enumerateDevices: ReturnType<typeof vi.fn> }
    md.enumerateDevices.mockResolvedValue([
      { deviceId: 'i1', kind: 'audioinput', label: 'Mic', groupId: 'g' },
      { deviceId: 'o1', kind: 'audiooutput', label: 'Speakers', groupId: 'g' },
    ])
    renderHook(() => useAudioIO())
    await waitFor(() => expect(useIOStore.getState().inputDevices).toHaveLength(1))
    expect(useIOStore.getState().outputDevices).toHaveLength(1)
    expect(useIOStore.getState().inputDevices.length).toBe(1)
  })

  it('uses the native bridge when present', async () => {
    vi.mocked(getNamStudio).mockReturnValue({
      listDevices: vi.fn().mockResolvedValue([
        { id: 1, isInput: true, name: 'In', api: 'wasapi' },
        { id: 2, isInput: false, name: 'Out', api: 'wasapi' },
      ]),
    } as never)
    renderHook(() => useAudioIO())
    await waitFor(() => expect(useIOStore.getState().inputDevices).toHaveLength(1))
    expect(useIOStore.getState().inputDevices[0]).toEqual({
      deviceId: '1',
      label: 'In',
      groupId: 'wasapi',
    })
  })

  it('falls back to default when the selected input device disappears', async () => {
    const setMicError = vi.spyOn(useIOStore.getState(), 'setMicError')
    useIOStore.setState({ inputDeviceId: 'gone' })
    const md = navigator.mediaDevices as unknown as { enumerateDevices: ReturnType<typeof vi.fn> }
    md.enumerateDevices.mockResolvedValue([
      { deviceId: 'i1', kind: 'audioinput', label: 'Mic', groupId: 'g' },
    ])
    renderHook(() => useAudioIO())
    await waitFor(() => expect(useIOStore.getState().inputDeviceId).toBe(''))
    expect(setMicError).toHaveBeenCalled()
  })

  it('reports output selection support based on setSinkId availability', () => {
    const { result } = renderHook(() => useAudioIO())
    // jsdom AudioContext has no setSinkId, so unsupported here.
    expect(result.current.outputSelectionSupported).toBe(false)
  })

  it('attaches a devicechange listener in web mode only', async () => {
    const md = navigator.mediaDevices as unknown as {
      enumerateDevices: ReturnType<typeof vi.fn>
      addEventListener: ReturnType<typeof vi.fn>
    }
    md.enumerateDevices.mockResolvedValue([])
    renderHook(() => useAudioIO())
    await waitFor(() =>
      expect(md.addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function)),
    )
  })

  it('does not attach a devicechange listener in native mode', async () => {
    vi.mocked(getNamStudio).mockReturnValue({ listDevices: vi.fn().mockResolvedValue([]) } as never)
    const md = navigator.mediaDevices as unknown as { addEventListener: ReturnType<typeof vi.fn> }
    renderHook(() => useAudioIO())
    await waitFor(() => expect(useIOStore.getState().inputDevices).toHaveLength(0))
    expect(md.addEventListener).not.toHaveBeenCalled()
  })
})
