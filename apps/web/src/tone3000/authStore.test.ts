// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './authStore'
import { clearPkce, clearTokens, storePkce, setTokens } from './client'
import * as client from './client'

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
