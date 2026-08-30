// @vitest-environment jsdom
/**
 * Preferences must survive a restart and be shared between the desktop app
 * and the plugins, while staying synchronous to read (issue #300 follow-up) —
 * and must be completely untouched on the web.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getOpenAxe } from '../native/openaxe'

import { PREFS_STORE, installPrefsMirror, __resetPrefsMirrorForTests } from './prefsMirror'

vi.mock('../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
}))

function makeFakeBridge(initial: Record<string, string> = {}) {
  const prefs = new Map(Object.entries(initial))
  return {
    prefs,
    storageKeys: vi.fn(async () => ({ ok: true, keys: [...prefs.keys()] })),
    storageValues: vi.fn(async () => ({ ok: true, values: [...prefs.values()] })),
    storageGet: vi.fn(async ({ key }: { key: string }) => ({
      ok: true,
      value: prefs.get(key) ?? null,
    })),
    storagePut: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value)
      return { ok: true }
    }),
    storageDelete: vi.fn(async ({ key }: { key: string }) => {
      prefs.delete(key)
      return { ok: true }
    }),
    storageClear: vi.fn(async () => {
      prefs.clear()
      return { ok: true }
    }),
  }
}

describe('prefs mirror', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetPrefsMirrorForTests()
    vi.mocked(getOpenAxe).mockReturnValue(null)
  })

  afterEach(() => {
    __resetPrefsMirrorForTests()
    localStorage.clear()
  })

  it('does nothing on the web, leaving localStorage exactly as it was', async () => {
    await installPrefsMirror()
    localStorage.setItem('openaxe-theme', 'light')
    expect(localStorage.getItem('openaxe-theme')).toBe('light')
    // No patch installed means no bridge to have been called, and no
    // behaviour change for the browser build.
    expect(vi.mocked(getOpenAxe)).toHaveBeenCalled()
  })

  it('hydrates localStorage from the shared store before anything reads it', async () => {
    const bridge = makeFakeBridge({
      'openaxe-theme': 'light',
      'nam-web-studio:factory-setup-dismissed': '1',
    })
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)

    expect(localStorage.getItem('openaxe-theme')).toBeNull()
    await installPrefsMirror()

    // This is the actual reported symptom: the factory pack looked
    // uninstalled every launch because this flag started out empty.
    expect(localStorage.getItem('nam-web-studio:factory-setup-dismissed')).toBe('1')
    expect(localStorage.getItem('openaxe-theme')).toBe('light')
  })

  it('mirrors writes out, so the next launch and the other shell see them', async () => {
    const bridge = makeFakeBridge()
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
    await installPrefsMirror()

    localStorage.setItem('openaxe-theme', 'dark')
    expect(bridge.storagePut).toHaveBeenCalledWith({
      store: PREFS_STORE,
      key: 'openaxe-theme',
      value: 'dark',
    })

    localStorage.removeItem('openaxe-theme')
    expect(bridge.storageDelete).toHaveBeenCalledWith({
      store: PREFS_STORE,
      key: 'openaxe-theme',
    })
  })

  it('keeps the Tone3000 refresh token out of the shared store', async () => {
    const bridge = makeFakeBridge()
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
    await installPrefsMirror()

    // It belongs in the OS keychain, which is where a native shell already
    // routes it — mirroring it would put a live credential in a plain file.
    localStorage.setItem('t3k_refresh_token', 'secret-value')
    expect(bridge.storagePut).not.toHaveBeenCalled()
    expect([...bridge.prefs.keys()]).not.toContain('t3k_refresh_token')
  })

  it('does not stack wrappers when installed more than once', async () => {
    const bridge = makeFakeBridge()
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
    await installPrefsMirror()
    await installPrefsMirror()

    localStorage.setItem('openaxe-theme', 'dark')
    // Nested wrappers would mirror the same write once per install.
    expect(bridge.storagePut).toHaveBeenCalledTimes(1)
  })

  it('leaves sessionStorage alone', async () => {
    const bridge = makeFakeBridge()
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
    await installPrefsMirror()

    // The patch is on Storage.prototype, which sessionStorage shares.
    sessionStorage.setItem('ephemeral', 'x')
    expect(bridge.storagePut).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('ephemeral')).toBe('x')
  })

  it('still starts up when the shell is too old to have the storage bridge', async () => {
    const bridge = makeFakeBridge()
    bridge.storageKeys.mockRejectedValue(new Error('openAxe.storageKeys is unavailable'))
    vi.mocked(getOpenAxe).mockReturnValue(bridge as never)

    await expect(installPrefsMirror()).resolves.toBeUndefined()
  })
})
