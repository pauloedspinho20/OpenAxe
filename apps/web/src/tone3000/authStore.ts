/**
 * Tone3000 auth state. Connection is lazy and best-effort: the catalog UI
 * works anonymously to search the public catalog, and a token is fetched (or
 * a full OAuth connect run) only when the user actually imports/downloads.
 *
 * The refresh token is persisted by client.ts (localStorage on web, the OS
 * keychain on desktop - see its module header), so a returning
 * session/launch can re-authenticate without a full OAuth round trip - see
 * hydrateFromPersistentStorage below for where that actually happens.
 */
import { create } from 'zustand'
import {
  POPUP_AUTH_SOURCE,
  POPUP_PENDING_KEY,
  apiGetUser,
  clearTokens,
  consumeOAuthCallbackParams,
  getAccessToken,
  getActiveAuthPopup,
  handleOAuthCallback,
  isAuthPopup,
  notifyPopupResult,
  setTokens,
  startPopupOAuthFlow,
  startStandardFlow,
  tryHydrateFromPersistentStorage,
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
  /** Silently redeem a refresh token persisted from a previous visit/launch
   * and refetch the user profile, so a returning user is shown as connected
   * without reconnecting. No-op (and no error) when there's nothing stored. */
  hydrateFromPersistentStorage: () => Promise<void>
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
      // Web build: popup OAuth so the main window (and the powered-on
      // engine) survives login. Falls back to the full-page redirect when a
      // popup can't be opened, and desktop always keeps its fixed-port
      // bounce-listener redirect flow.
      if (await startPopupOAuthFlow()) {
        // Flow completes asynchronously via the popup's postMessage - the
        // listener below settles pendingFlow. Watch for the user just closing
        // the popup so "Connecting…" doesn't stick.
        watchPopupClosure()
        return
      }
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

  hydrateFromPersistentStorage: async () => {
    const tokens = await tryHydrateFromPersistentStorage()
    if (!tokens) return
    set({ status: 'connected', error: null })
    try {
      set({ user: await apiGetUser() })
    } catch {
      // The refresh above already proved the credential is live - a
      // transient failure fetching the profile on top of that shouldn't
      // undo "connected"; the catalog just falls back to showing no
      // username until the next successful fetch.
    }
  },

  disconnect: () => {
    clearTokens()
    set({ status: 'anonymous', user: null, error: null, pendingFlow: false })
  },

  setError: (error) => set({ error }),
}))

/**
 * Listens for the OAuth popup's postMessage and settles the opener's auth
 * state without a page navigation. The popup redeemed the code and persisted
 * the tokens; on success we hydrate from the persistent store so this window
 * mints its own access token (the popup's sessionStorage is a private clone)
 * and picks up the user profile.
 */
let popupListenerAttached = false
function attachPopupAuthListener(): void {
  if (popupListenerAttached) return
  popupListenerAttached = true
  window.addEventListener('message', (event) => {
    const data = event.data as { source?: string; ok?: boolean; error?: string } | null
    if (!data || data.source !== POPUP_AUTH_SOURCE) return
    if (event.origin !== window.location.origin) return
    sessionStorage.removeItem(POPUP_PENDING_KEY)
    if (data.ok) {
      useTone3000Auth.setState({ status: 'connected', pendingFlow: false, error: null })
      void useTone3000Auth.getState().hydrateFromPersistentStorage()
    } else {
      useTone3000Auth.setState({
        status: data.error === 'canceled' ? 'anonymous' : 'error',
        pendingFlow: false,
        error: data.error ?? null,
      })
    }
  })
}

/**
 * If the user closes the OAuth popup without completing (no postMessage
 * lands), drop the "Connecting…" state instead of leaving it stuck.
 */
function watchPopupClosure(): void {
  const id = window.setInterval(() => {
    const popup = getActiveAuthPopup()
    if (useTone3000Auth.getState().pendingFlow && popup && popup.closed) {
      window.clearInterval(id)
      useTone3000Auth.setState({ pendingFlow: false })
    } else if (!useTone3000Auth.getState().pendingFlow) {
      window.clearInterval(id)
    }
  }, 500)
}

if (typeof window !== 'undefined') {
  attachPopupAuthListener()
}

/**
 * Handle the OAuth callback once on app boot, if the URL carries one -
 * handleCallback() itself no-ops safely when there's nothing to consume,
 * which also makes this safe to call twice in a row (e.g. React StrictMode's
 * dev-only double effect invocation). Otherwise, fall back to silently
 * reconnecting from a refresh token a previous visit/launch persisted (see
 * client.ts's tryHydrateFromPersistentStorage) - skipped if the callback
 * above already connected, so a normal OAuth completion doesn't also
 * trigger a redundant refresh right behind it.
 *
 * When this window is the OAuth popup (opened via connect), the result is
 * relayed to the opener and the popup closes instead of continuing to run
 * the app.
 */
export async function handleTone3000CallbackOnLoad(): Promise<void> {
  const handledCallback = await useTone3000Auth.getState().handleCallback()
  if (isAuthPopup() && sessionStorage.getItem(POPUP_PENDING_KEY) === '1') {
    sessionStorage.removeItem(POPUP_PENDING_KEY)
    const state = useTone3000Auth.getState()
    notifyPopupResult(
      handledCallback ? { ok: true } : { ok: false, error: state.error ?? 'not_pending' },
    )
    return
  }
  if (!handledCallback && useTone3000Auth.getState().status !== 'connected') {
    await useTone3000Auth.getState().hydrateFromPersistentStorage()
  }
}
