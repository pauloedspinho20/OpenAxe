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
  consumeOAuthCallbackParams,
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

/** Advisory peek only (doesn't consume) - safe to call repeatedly, e.g. before a user gesture. */
const hasCallbackParams = (): boolean =>
  new URLSearchParams(window.location.search).has('code') ||
  new URLSearchParams(window.location.search).has('error')

export const useTone3000Auth = create<Tone3000AuthState & Tone3000AuthActions>()((set, get) => ({
  status: 'anonymous',
  user: null,
  error: null,
  pendingFlow: false,

  getToken: async () => {
    // If we're mid-callback (back from Tone3000), handle it before anything
    // else - handleCallback() is a safe no-op if there's nothing to consume,
    // so any outcome (success, failure, or nothing pending) just falls
    // through to the normal token lookup below.
    if (hasCallbackParams()) {
      await get().handleCallback()
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
    const callbackParams = consumeOAuthCallbackParams()
    if (!callbackParams) return false
    const result = await handleOAuthCallback(callbackParams)
    if (result.ok) {
      set({ status: 'connected', pendingFlow: false, error: null })
      return true
    }
    // A stale or bookmarked URL still carrying an already-consumed (or never
    // truly started) code/state pair isn't a real failure the user needs to
    // see - the params are already stripped above, so it also won't recur
    // on the next reload.
    if (result.error === 'not_pending') {
      set({ pendingFlow: false })
      return false
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

/**
 * Handle the OAuth callback once on app boot, if the URL carries one.
 * Unconditional - handleCallback() itself no-ops safely when there's
 * nothing to consume, which also makes this safe to call twice in a row
 * (e.g. React StrictMode's dev-only double effect invocation).
 */
export async function handleTone3000CallbackOnLoad(): Promise<void> {
  await useTone3000Auth.getState().handleCallback()
}
