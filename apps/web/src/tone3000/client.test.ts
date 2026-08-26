// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSearchTonesQuery,
  clearTokens,
  getAccessToken,
  isAuthPopup,
  notifyPopupResult,
  randomBase64url,
  readOAuthCallbackParams,
  setTokens,
  sha256Base64url,
  startPopupOAuthFlow,
  tryHydrateFromPersistentStorage,
} from './client'

// node env has no web storage - provide fresh in-memory shims per test.
function makeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

describe('tone3000 client', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeStorage())
    vi.stubGlobal('localStorage', makeStorage())
    clearTokens()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('build-search serializes gears, format, tags and architecture per the API conventions', () => {
    const qs = buildSearchTonesQuery({
      query: 'fender deluxe',
      page: 2,
      pageSize: 10,
      sort: 'newest',
      gears: ['amp', 'amp-cab'],
      format: 'nam',
      tags: ['clean', 'edge'],
      makes: ['Fender'],
      architecture: 2,
    })
    expect(qs.get('query')).toBe('fender deluxe')
    expect(qs.get('page')).toBe('2')
    expect(qs.get('page_size')).toBe('10')
    expect(qs.get('sort')).toBe('newest')
    expect(qs.get('gears')).toBe('amp_amp-cab')
    expect(qs.get('format')).toBe('nam')
    expect(qs.get('tags')).toBe('clean_edge')
    expect(qs.get('makes')).toBe('Fender')
    expect(qs.get('architecture')).toBe('2')
  })

  it('leaves filters that are not set out of the query string entirely', () => {
    const qs = buildSearchTonesQuery({})
    expect(qs.size).toBe(0)
  })

  it('creates url-safe base64url tokens of the requested length', async () => {
    const tok = await randomBase64url(16)
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tok).not.toContain('=')
  })

  it('computes an S256 code challenge shape', async () => {
    const hash = await sha256Base64url('verifier-string')
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes -> 43 base64url chars
  })

  it('getAccessToken throws when nothing is stored', async () => {
    await expect(getAccessToken()).rejects.toThrow(/Not authenticated/)
  })

  it('returns a stored access token', async () => {
    setTokens({
      access_token: 'abc',
      refresh_token: 'r',
      expires_at: Date.now() + 120_000,
    })
    await expect(getAccessToken()).resolves.toBe('abc')
  })

  // issue #146: on the web build (no window.openAxe bridge - see the
  // "native secret store mirroring" describe below for the desktop path),
  // the refresh token additionally persists to localStorage, so a later
  // visit can reconnect without a full OAuth round trip.
  it('setTokens persists the refresh token to localStorage', () => {
    setTokens({ access_token: 'abc', refresh_token: 'r-web', expires_at: Date.now() + 120_000 })
    expect(localStorage.getItem('t3k_refresh_token')).toBe('r-web')
  })

  it('clearTokens removes the persisted localStorage refresh token too', () => {
    setTokens({ access_token: 'abc', refresh_token: 'r-web', expires_at: Date.now() + 120_000 })
    clearTokens()
    expect(localStorage.getItem('t3k_refresh_token')).toBeNull()
  })

  it('tryHydrateFromPersistentStorage redeems a refresh token persisted in localStorage', async () => {
    localStorage.setItem('t3k_refresh_token', 'stored-web-refresh')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-web-access',
          refresh_token: 'rotated-web-refresh',
          expires_in: 3600,
        }),
      }),
    )

    const tokens = await tryHydrateFromPersistentStorage()
    expect(tokens?.access_token).toBe('fresh-web-access')
    expect(localStorage.getItem('t3k_refresh_token')).toBe('rotated-web-refresh')
  })

  it('tryHydrateFromPersistentStorage clears a rejected localStorage token instead of retrying it forever', async () => {
    localStorage.setItem('t3k_refresh_token', 'revoked-web-refresh')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    await expect(tryHydrateFromPersistentStorage()).resolves.toBeNull()
    expect(localStorage.getItem('t3k_refresh_token')).toBeNull()
  })
})

// issue #146: on desktop the refresh token also has to survive an app
// restart, which sessionStorage can't do on its own (the webview's origin -
// an ephemeral port - changes every launch). setTokens/clearTokens mirror it
// through window.openAxe.secure* when that bridge is present; these tests
// fake just enough of `window` to exercise that without a real native shell.
describe('tone3000 client - native secret store mirroring', () => {
  const secureStore = vi.fn().mockResolvedValue({ ok: true })
  const secureLoad = vi.fn()
  const secureDelete = vi.fn().mockResolvedValue({ ok: true })

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeStorage())
    vi.stubGlobal('localStorage', makeStorage())
    vi.stubGlobal('window', {
      'openAxe.version': vi.fn(),
      'openAxe.secureStore': secureStore,
      'openAxe.secureLoad': secureLoad,
      'openAxe.secureDelete': secureDelete,
    })
    secureStore.mockClear()
    secureLoad.mockReset()
    secureDelete.mockClear()
    clearTokens()
    secureDelete.mockClear() // clearTokens() above also calls it - reset the count for the actual test
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('setTokens mirrors the refresh token into the native secret store', () => {
    setTokens({ access_token: 'abc', refresh_token: 'r-1', expires_at: Date.now() + 120_000 })
    expect(secureStore).toHaveBeenCalledWith({
      key: 'tone3000_refresh_token',
      value: 'r-1',
    })
  })

  it('clearTokens deletes the native secret store entry too', () => {
    clearTokens()
    expect(secureDelete).toHaveBeenCalledWith({ key: 'tone3000_refresh_token' })
  })

  it('tryHydrateFromPersistentStorage returns null when nothing is stored', async () => {
    secureLoad.mockResolvedValue({ ok: true, value: null })
    await expect(tryHydrateFromPersistentStorage()).resolves.toBeNull()
  })

  it('tryHydrateFromPersistentStorage redeems a stored refresh token and re-persists the new one', async () => {
    secureLoad.mockResolvedValue({ ok: true, value: 'stored-refresh' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const tokens = await tryHydrateFromPersistentStorage()
    expect(tokens?.access_token).toBe('fresh-access')
    // The rotated refresh token gets mirrored back via the normal
    // setTokens() path, not just returned.
    expect(secureStore).toHaveBeenCalledWith({
      key: 'tone3000_refresh_token',
      value: 'rotated-refresh',
    })
  })

  it('tryHydrateFromPersistentStorage clears a rejected stored token instead of retrying it forever', async () => {
    secureLoad.mockResolvedValue({ ok: true, value: 'revoked-refresh' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    await expect(tryHydrateFromPersistentStorage()).resolves.toBeNull()
    expect(secureDelete).toHaveBeenCalledWith({ key: 'tone3000_refresh_token' })
  })
})

describe('tone3000 client - popup OAuth flow', () => {
  function fakeWindow(overrides: Record<string, unknown> = {}) {
    const popup = { location: { href: '' }, close: vi.fn() }
    return {
      open: vi.fn(() => popup),
      location: { origin: 'http://localhost:5173' },
      close: vi.fn(),
      ...overrides,
    } as unknown as Window
  }

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeStorage())
    vi.stubGlobal('localStorage', makeStorage())
    clearTokens()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a popup, seeds PKCE, and navigates it to the authorize URL', async () => {
    const win = fakeWindow()
    vi.stubGlobal('window', win)
    const popup = win.open('', 'openaxe-t3k-auth', expect.any(String)) as unknown as {
      location: { href: string }
      close: () => void
    }
    const popupOpenCall = win.open as ReturnType<typeof vi.fn>

    const started = await startPopupOAuthFlow({
      pubkey: 'pub',
      redirectUri: 'http://localhost:5173',
    })

    expect(started).toBe(true)
    expect(popupOpenCall).toHaveBeenCalledWith(
      '',
      'openaxe-t3k-auth',
      expect.stringContaining('width=560'),
    )
    const url = new URL(popup.location.href)
    expect(url.origin).toBe('https://www.tone3000.com')
    expect(url.searchParams.get('client_id')).toBe('pub')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    // The PKCE stays in the opener's storage so the exchange can run here
    // (the popup only relays the code back - see notifyPopupResult).
    expect(sessionStorage.getItem('t3k_state')).toBe(url.searchParams.get('state'))
  })

  it('returns false when the popup is blocked, so callers fall back to the redirect flow', async () => {
    vi.stubGlobal('window', fakeWindow({ open: vi.fn(() => null) }))
    await expect(startPopupOAuthFlow()).resolves.toBe(false)
    // The staged PKCE is cleaned up so the fallback redirect flow starts fresh.
    expect(sessionStorage.getItem('t3k_code_verifier')).toBeNull()
  })

  it('returns false on the native (desktop) build, which keeps its bounce-listener flow', async () => {
    vi.stubGlobal('window', fakeWindow({ open: vi.fn(() => null), 'openAxe.version': vi.fn() }))
    await expect(startPopupOAuthFlow()).resolves.toBe(false)
  })

  it('notifyPopupResult relays the raw callback params to the opener and closes', () => {
    const postMessage = vi.fn()
    const close = vi.fn()
    vi.stubGlobal('window', {
      opener: { postMessage },
      location: { origin: 'http://localhost:5173' },
      close,
    } as unknown as Window)

    notifyPopupResult({ code: 'the-code', state: 'state-1', error: null })

    expect(postMessage).toHaveBeenCalledWith(
      { source: 'openaxe-t3k-auth', code: 'the-code', state: 'state-1', error: null },
      'http://localhost:5173',
    )
    expect(close).toHaveBeenCalled()
  })

  it('readOAuthCallbackParams reads the code/state/error without consuming them', () => {
    vi.stubGlobal('window', { location: { search: '?code=c&state=s&error=e' } })
    expect(readOAuthCallbackParams()).toEqual({ code: 'c', state: 's', error: 'e' })
    expect(window.location.search).toBe('?code=c&state=s&error=e')
  })

  it('isAuthPopup is true only for a window with an opener', () => {
    vi.stubGlobal('window', { opener: {} as Window, location: { origin: 'x' } })
    expect(isAuthPopup()).toBe(true)
    vi.stubGlobal('window', { opener: null, location: { origin: 'x' } })
    expect(isAuthPopup()).toBe(false)
  })
})
