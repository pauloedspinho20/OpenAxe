import { afterEach, describe, expect, it, vi } from 'vitest'
import { describePowerOnError } from './useAudioEngine'

// The rest of useAudioEngine relies on real AudioContext/getUserMedia, which
// jsdom doesn't implement - describePowerOnError is the one pure, DOM-free
// piece (issue #49: give a WASM/network load failure a message worth
// showing, instead of a raw `TypeError: Failed to fetch`).
describe('describePowerOnError', () => {
  it('recognizes a WASM fetch failure', () => {
    const message = describePowerOnError(new TypeError('Failed to fetch'))
    expect(message).toMatch(/check your connection/i)
  })

  it('recognizes a permission/NotAllowedError failure', () => {
    const message = describePowerOnError(new Error('NotAllowedError: permission denied'))
    expect(message).toMatch(/blocked by the browser/i)
  })

  it('falls back to the original message for anything else', () => {
    expect(describePowerOnError(new Error('graph rig create failed'))).toBe(
      'graph rig create failed',
    )
  })

  it('stringifies a non-Error throw', () => {
    expect(describePowerOnError('boom')).toBe('boom')
  })
})

// issue #44: useAudioEngine used to call BOTH useWebAudioEngine and
// useNativeAudioEngine on every render and pick which result to keep - so
// the inactive engine's store subscriptions/effects still mounted. It now
// selects the hook implementation itself, once, at module load. These tests
// force a fresh module evaluation per case (vi.resetModules + a dynamic
// import) with native-bridge presence mocked, and assert useAudioEngine is
// referentially the selected hook - not a wrapper that still calls both.
describe('useAudioEngine dispatcher', () => {
  afterEach(() => {
    vi.doUnmock('../native/namStudio')
    vi.resetModules()
  })

  it('is the web engine hook when no native bridge is present', async () => {
    vi.resetModules()
    vi.doMock('../native/namStudio', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../native/namStudio')>()),
      getNamStudio: () => null,
    }))
    const mod = await import('./useAudioEngine')
    expect(mod.useAudioEngine).toBe(mod.useWebAudioEngine)
  })

  it('is the native engine hook when a native bridge is present', async () => {
    vi.resetModules()
    vi.doMock('../native/namStudio', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../native/namStudio')>()),
      getNamStudio: () => ({}) as import('../native/namStudio').NamStudioBridge,
    }))
    const [{ useNativeAudioEngine }, mod] = await Promise.all([
      import('./useNativeAudioEngine'),
      import('./useAudioEngine'),
    ])
    expect(mod.useAudioEngine).toBe(useNativeAudioEngine)
  })
})
