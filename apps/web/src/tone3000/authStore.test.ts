// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './authStore'
import { clearPkce, clearTokens, storePkce, setTokens } from './client'
import * as client from './client'

// Several tests below use vi.spyOn(client, ...)/vi.stubGlobal('fetch', ...)
// without restoring them - harmless as long as nothing after them cares,
// but a real leak once new tests are added later in the file (as the
// native-hydration describe below found out): a spied handleOAuthCallback
// from an earlier test stays mocked for every subsequent one. Restoring
// after every test, file-wide, is what actually makes that safe.
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const reset = () => {
  clearTokens()
  clearPkce()
  useTone3000Auth.setState({
    status: 'anonymous',
    user: null,
    error: null,
    pendingFlow: false,
  })
}

function setUrl(url: string) {
  window.history.replaceState({}, '', url)
}

describe('tone3000 authStore', () => {
  beforeEach(reset)

  it('is anonymous by default', () => {
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('handleCallback returns false when there is no callback in the URL', async () => {
    setUrl('/')
    await expect(useTone3000Auth.getState().handleCallback()).resolves.toBe(false)
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('handleTone3000CallbackOnLoad completes a valid code+state callback and marks connected', async () => {
    storePkce('verifier-a', 'state-1')
    setUrl('/?code=the-code&state=state-1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      }),
    )

    await handleTone3000CallbackOnLoad()
    expect(useTone3000Auth.getState().status).toBe('connected')
  })

  it('rejects a callback whose state does not match (CSRF protection)', async () => {
    storePkce('verifier-a', 'state-1')
    setUrl('/?code=the-code&state=wrong-state')

    const result = await useTone3000Auth.getState().handleCallback()
    expect(result).toBe(false)
    expect(useTone3000Auth.getState().status).toBe('error')
    expect(useTone3000Auth.getState().error).toBe('state_mismatch')
  })

  it('getToken returns the stored access token when config + tokens exist', async () => {
    setTokens({ access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 60_000 })
    setUrl('/')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', refresh_token: 'r', expires_in: 3600 }),
      }),
    )
    await expect(useTone3000Auth.getState().getToken()).resolves.toBe('tok')
  })

  it('getToken refreshes via the stored refresh token when the access token expired', async () => {
    setTokens({
      access_token: 'stale',
      refresh_token: 'good-refresh',
      expires_at: Date.now() - 1000,
    })
    setUrl('/')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'fresh',
            refresh_token: 'good-refresh',
            expires_in: 3600,
          }),
      }),
    )
    await expect(useTone3000Auth.getState().getToken()).resolves.toBe('fresh')
    expect(useTone3000Auth.getState().status).toBe('connected')
  })

  it('disconnect clears token storage and returns to anonymous', () => {
    setTokens({ access_token: 'a', refresh_token: 'r', expires_at: 9999999999000 })
    expect(useTone3000Auth.getState().status).toBe('anonymous')
    useTone3000Auth.getState().disconnect()
    expect(useTone3000Auth.getState().status).toBe('anonymous')
    expect(sessionStorage.getItem('t3k_tokens')).toBeNull()
    expect(localStorage.getItem('t3k_refresh_token')).toBeNull()
  })

  it('getToken throws a helpful error when there are no credentials to use', async () => {
    setUrl('/')
    await expect(useTone3000Auth.getState().getToken()).rejects.toThrow(
      /account connection is needed/,
    )
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('connect surfaces an error when the OAuth flow fails to start', async () => {
    vi.spyOn(client, 'startStandardFlow').mockRejectedValue(new Error('popup blocked'))
    await useTone3000Auth.getState().connect()
    expect(useTone3000Auth.getState().status).toBe('error')
    expect(useTone3000Auth.getState().error).toBe('popup blocked')
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
  })

  it('handleCallback returns to anonymous when the user canceled', async () => {
    setUrl('/?code=c&state=s')
    vi.spyOn(client, 'handleOAuthCallback').mockResolvedValue({ ok: false, error: 'canceled' })
    const result = await useTone3000Auth.getState().handleCallback()
    expect(result).toBe(false)
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('handleCallback no-ops a not_pending (stale) callback', async () => {
    setUrl('/?code=c&state=s')
    vi.spyOn(client, 'handleOAuthCallback').mockResolvedValue({ ok: false, error: 'not_pending' })
    const result = await useTone3000Auth.getState().handleCallback()
    expect(result).toBe(false)
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('handleCallback sets an error status for a genuinely failed callback', async () => {
    setUrl('/?code=c&state=s')
    vi.spyOn(client, 'handleOAuthCallback').mockResolvedValue({ ok: false, error: 'expired' })
    const result = await useTone3000Auth.getState().handleCallback()
    expect(result).toBe(false)
    expect(useTone3000Auth.getState().status).toBe('error')
    expect(useTone3000Auth.getState().error).toBe('expired')
  })
})

// issue #146: desktop reconnects silently from a refresh token a previous
// launch persisted to the OS keychain (sessionStorage can't survive a
// restart there - see client.ts). `window['openAxe.*']` is exactly what
// native/openaxe.ts's getOpenAxe() probes for, so stubbing those
// specific dotted globals (jsdom's real `window` otherwise, unlike the
// plain-object stub client.test.ts uses) is enough to simulate the bridge.
describe('tone3000 authStore - native hydration', () => {
  beforeEach(reset)

  const fakeUser = {
    id: 'u1',
    username: 'shredder',
    avatar_url: null,
    url: 'https://www.tone3000.com/u/shredder',
    bio: null,
    links: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  it('does nothing without a native bridge (web build)', async () => {
    await useTone3000Auth.getState().hydrateFromPersistentStorage()
    expect(useTone3000Auth.getState().status).toBe('anonymous')
  })

  it('reconnects and refreshes the user profile from a stored refresh token', async () => {
    vi.stubGlobal('openAxe.version', vi.fn())
    vi.stubGlobal(
      'openAxe.secureLoad',
      vi.fn().mockResolvedValue({ ok: true, value: 'stored-refresh' }),
    )
    vi.stubGlobal('openAxe.secureStore', vi.fn().mockResolvedValue({ ok: true }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(fakeUser) })
    vi.stubGlobal('fetch', fetchMock)

    await useTone3000Auth.getState().hydrateFromPersistentStorage()

    expect(useTone3000Auth.getState().status).toBe('connected')
    expect(useTone3000Auth.getState().user?.username).toBe('shredder')
  })

  it('handleTone3000CallbackOnLoad falls back to it when the URL carries no OAuth callback', async () => {
    setUrl('/')
    vi.stubGlobal('openAxe.version', vi.fn())
    vi.stubGlobal(
      'openAxe.secureLoad',
      vi.fn().mockResolvedValue({ ok: true, value: 'stored-refresh' }),
    )
    vi.stubGlobal('openAxe.secureStore', vi.fn().mockResolvedValue({ ok: true }))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(fakeUser) }),
    )

    await handleTone3000CallbackOnLoad()

    expect(useTone3000Auth.getState().status).toBe('connected')
    expect(useTone3000Auth.getState().user?.username).toBe('shredder')
  })

  it('handleTone3000CallbackOnLoad skips hydration when a real callback already connected', async () => {
    storePkce('verifier-a', 'state-1')
    setUrl('/?code=the-code&state=state-1')
    vi.stubGlobal('openAxe.version', vi.fn())
    const secureLoad = vi.fn().mockResolvedValue({ ok: true, value: 'stored-refresh' })
    vi.stubGlobal('openAxe.secureLoad', secureLoad)
    vi.stubGlobal('openAxe.secureStore', vi.fn().mockResolvedValue({ ok: true }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      }),
    )

    await handleTone3000CallbackOnLoad()

    expect(useTone3000Auth.getState().status).toBe('connected')
    expect(secureLoad).not.toHaveBeenCalled()
  })
})

describe('tone3000 authStore - popup OAuth', () => {
  const setOpener = (value: unknown) => {
    Object.defineProperty(window, 'opener', { configurable: true, value })
  }

  beforeEach(() => {
    sessionStorage.removeItem(client.POPUP_PENDING_KEY)
    setOpener(undefined)
  })

  it('connect opens a popup on the web build and leaves the flow pending for the popup to settle', async () => {
    vi.spyOn(client, 'startPopupOAuthFlow').mockResolvedValue(true)
    const startStandard = vi.spyOn(client, 'startStandardFlow').mockResolvedValue(undefined)

    await useTone3000Auth.getState().connect()

    expect(startStandard).not.toHaveBeenCalled()
    expect(useTone3000Auth.getState().pendingFlow).toBe(true)
  })

  it('connect falls back to the full-page redirect when the popup cannot open', async () => {
    vi.spyOn(client, 'startPopupOAuthFlow').mockResolvedValue(false)
    const startStandard = vi.spyOn(client, 'startStandardFlow').mockResolvedValue(undefined)

    await useTone3000Auth.getState().connect()

    expect(startStandard).toHaveBeenCalled()
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
  })

  it('the popup message listener marks connected and hydrates on a successful result', async () => {
    const hydrate = vi
      .spyOn(useTone3000Auth.getState(), 'hydrateFromPersistentStorage')
      .mockResolvedValue()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: client.POPUP_AUTH_SOURCE, ok: true },
        origin: window.location.origin,
      }),
    )

    expect(useTone3000Auth.getState().status).toBe('connected')
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
    expect(hydrate).toHaveBeenCalled()
  })

  it('the popup message listener marks anonymous on a canceled result', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: client.POPUP_AUTH_SOURCE, ok: false, error: 'canceled' },
        origin: window.location.origin,
      }),
    )
    expect(useTone3000Auth.getState().status).toBe('anonymous')
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
  })

  it('the popup message listener ignores unrelated window messages', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'something-else' },
        origin: window.location.origin,
      }),
    )
    expect(useTone3000Auth.getState().status).toBe('anonymous')
    expect(useTone3000Auth.getState().pendingFlow).toBe(false)
  })

  it('handleTone3000CallbackOnLoad relays the result to the opener and closes the popup', async () => {
    storePkce('verifier-a', 'state-1')
    sessionStorage.setItem(client.POPUP_PENDING_KEY, '1')
    const postMessage = vi.fn()
    setOpener({ postMessage })
    const close = vi.fn()
    vi.spyOn(window, 'close').mockImplementation(close)
    setUrl('/?code=the-code&state=state-1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      }),
    )

    await handleTone3000CallbackOnLoad()

    expect(postMessage).toHaveBeenCalledWith(
      { source: client.POPUP_AUTH_SOURCE, ok: true },
      window.location.origin,
    )
    expect(close).toHaveBeenCalled()
    expect(useTone3000Auth.getState().status).toBe('connected')
  })

  it('handleTone3000CallbackOnLoad does not close a normal (non-popup) window', async () => {
    storePkce('verifier-a', 'state-1')
    setUrl('/?code=the-code&state=state-1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      }),
    )
    const close = vi.fn()
    vi.spyOn(window, 'close').mockImplementation(close)

    await handleTone3000CallbackOnLoad()

    expect(useTone3000Auth.getState().status).toBe('connected')
    expect(close).not.toHaveBeenCalled()
  })
})
