/**
 * Tone3000 auth state. Connection is lazy and best-effort: the catalog UI
 * works anonymously to search the public catalog, and a token is fetched (or
 * a full OAuth connect run) only when the user actually imports/downloads.
 *
 * The refresh token is persisted in localStorage by client.ts, so a returning
 * session can re-authenticate without a full OAuth round trip.
 */
import { create } from 'zustand'
import {
  clearTokens,
  getAccessToken,
  handleOAuthCallback,
  setTokens,
  startStandardFlow,
  tryRefreshFromStorage,
} from './client'
import type { User } from './types'

export type Tone3000AuthStatus = 'anonymous' | 'connected' | 'error'

export interface Tone3000AuthState {
  status: Tone3000AuthStatus
  user: User | null
  /** Human-readable error from the most recent failed connect/refresh. */
  error: string | null
  /** True while an OAuth PKCE flow is in flight (redirect to Tone3000). */
  pendingFlow: boolean
}

export interface Tone3000AuthActions {
  /** Access token for a Tone3000 API call, refreshing a stored refresh token or running OAuth on demand (from a user gesture). */
  getToken: () => Promise<string>
  /** Run the full OAuth connect flow (redirect to Tone3000). Must be called from a user gesture. */
  connect: () => Promise<void>
  /** Exchange ?code=...&state=... after an OAuth redirect and store tokens. Returns true if a callback was handled. */
  handleCallback: () => Promise<boolean>
  /** Forget all tokens and connection state. */
  disconnect: () => void
  setError: (error: string | null) => void
}

const isCallbackUrl = (): boolean =>
  new URLSearchParams(window.location.search).has('code') ||
  new URLSearchParams(window.location.search).has('error')

export const useTone3000Auth = create<Tone3000AuthState & Tone3000AuthActions>()((set, get) => ({
  status: 'anonymous',
  user: null,
  error: null,
  pendingFlow: false,

  getToken: async () => {
    // If we're mid-callback (back from Tone3000), handle it before anything else.
    if (isCallbackUrl()) {
      const handled = await get().handleCallback()
      if (!handled) throw new Error('Tone3000 auth callback failed')
    }
    try {
      const token = await getAccessToken()
      set({ status: 'connected' })
      return token
    } catch {
      // No stored credentials - refresh token missing, expired, or revoked.
      const refresh = await tryRefreshFromStorage().catch(() => null)
      if (refresh) {
        setTokens(refresh)
        const token = await getAccessToken()
        set({ status: 'connected' })
        return token
      }
      set({ status: 'anonymous' })
      throw new Error('A Tone3000 account connection is needed to download this model/IR.')
    }
  },

  connect: async () => {
    set({ pendingFlow: true, error: null })
    try {
      await startStandardFlow()
      // startStandardFlow navigates away; if it resolves (e.g. tests), reset.
      set({ pendingFlow: false })
    } catch (err) {
      set({
        pendingFlow: false,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  handleCallback: async () => {
    if (!isCallbackUrl()) return false
    const result = await handleOAuthCallback()
    if (result.ok) {
      set({ status: 'connected', pendingFlow: false, error: null })
      return true
    }
    set({
      status: result.error === 'canceled' ? 'anonymous' : 'error',
      pendingFlow: false,
      error: result.error,
    })
    return false
  },

  disconnect: () => {
    clearTokens()
    set({ status: 'anonymous', user: null, error: null, pendingFlow: false })
  },

  setError: (error) => set({ error }),
}))

/** Handle the OAuth callback once on app boot, if the URL carries one. */
export async function handleTone3000CallbackOnLoad(): Promise<void> {
  if (isCallbackUrl()) {
    await useTone3000Auth.getState().handleCallback()
  }
}
