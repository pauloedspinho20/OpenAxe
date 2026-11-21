// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// The desktop output/input rail meters read engine.analyserL/analyserR (and
// tunerAnalyserL/R) - the same names the web engine provides. The native
// hook's own fields predate the stereo meters (analyser/tunerAnalyser, plus
// the R-only additions from #385), so without explicit aliases the L fields
// are undefined on desktop and LiveStereoMeter renders a missing side as
// silence: centered audio then shows only its right bar. These tests drive a
// mocked bridge through powerOn and pin the alias contract.
describe('useNativeAudioEngine stereo analyser aliases', () => {
  afterEach(() => {
    vi.doUnmock('../native/openaxe')
    vi.resetModules()
  })

  async function renderReadyHook() {
    const calls: Record<string, unknown[]> = {}
    const bridge = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') return undefined
          return async (args?: unknown) => {
            const method = String(prop)
            ;(calls[method] ??= []).push(args)
            if (method === 'open') return { ok: true, sampleRate: 48000, bufferFrames: 128 }
            if (method === 'getTap') return { l: [], r: [], frames: 0 }
            if (method === 'meters') return []
            return { ok: true }
          }
        },
      },
    ) as unknown as import('../native/openaxe').OpenAxeBridge

    vi.resetModules()
    vi.doMock('../native/openaxe', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../native/openaxe')>()),
      getOpenAxe: () => bridge,
    }))
    const { useNativeAudioEngine } = await import('./useNativeAudioEngine')
    const utils = renderHook(() => useNativeAudioEngine())
    await act(async () => {
      await utils.result.current.powerOn()
    })
    await waitFor(() => expect(utils.result.current.status).toBe('ready'))
    return { ...utils, calls }
  }

  it('exposes analyserL/R (and tuner L/R) aliases around the same taps', async () => {
    const { result, unmount } = await renderReadyHook()
    try {
      expect(result.current.analyserL).not.toBeNull()
      expect(result.current.analyserR).not.toBeNull()
      expect(result.current.tunerAnalyserL).not.toBeNull()
      expect(result.current.tunerAnalyserR).not.toBeNull()
      // Aliases, not copies: one tap object per side, shared with the
      // historic singular fields their older consumers still read.
      expect(result.current.analyserL).toBe(result.current.analyser)
      expect(result.current.tunerAnalyserL).toBe(result.current.tunerAnalyser)
    } finally {
      unmount()
    }
  })

  it('pushes the persisted input-channel mode to the native bridge', async () => {
    const { result, calls, unmount } = await renderReadyHook()
    try {
      await waitFor(() => expect(calls['setInputChannel']?.length ?? 0).toBeGreaterThan(0))
      expect(result.current.analyserL).not.toBeNull()
    } finally {
      unmount()
    }
  })
})
