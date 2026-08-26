/**
 * Zero-dependency Tone3000 OAuth2+PKCE + API client for a pure client-side
 * SPA (see README's "no required backend" decision). Heavily inspired by the
 * official reference client (github.com/tone-3000/api/src/tone3000-client.ts),
 * adapted to this app's storage choices.
 *
 * The access token stays sessionStorage-only, tab/window-session-scoped -
 * it's short-lived (~1hr) and freely re-derivable from the refresh token, so
 * there's little upside to persisting it anywhere longer-lived.
 *
 * The refresh token is the credential that actually needs to survive a
 * restart so the user isn't asked to reconnect every time (issue #146) - see
 * persistRefreshToken/tryHydrateFromPersistentStorage below for where it
 * lives on each build:
 *   - Desktop: the OS keychain via window.openAxe.secure* (native/
 *     openaxe.ts), which sessionStorage/localStorage can't reach anyway -
 *     the webview's origin is a fresh ephemeral port every launch.
 *   - Web: localStorage. This is a deliberate change from an earlier,
 *     stricter design that kept it sessionStorage-only specifically to
 *     bound a same-origin XSS's reach to one tab session; persisting it
 *     trades that away for not having to reconnect on every visit. Worth
 *     revisiting if this app ever pulls in more third-party script surface.
 *
 * There is NO `t3k_cs_` client secret here: Tone3000's docs mark it server
 * only, and the browser token endpoint accepts just client_id + PKCE. See
 * config.ts for why.
 */
import { DESKTOP_REDIRECT_URI, PUBLISHABLE_KEY, REDIRECT_URI, T3K_API } from './config'
import { getOpenAxe } from '../native/openaxe'
import type { OAuthCallbackResult, T3KTokens } from './types'
import type {
  ListUserTonesParams,
  PaginatedResponse,
  SearchTonesParams,
  Tone,
  Tone3000Model,
  User,
} from './types'

/** The redirect_uri registered for this build - the desktop shell's fixed
 * OAuth bounce port when running natively (its own UI server is ephemeral
 * and can't be pre-registered), the web build's own value otherwise. See
 * config.ts's DESKTOP_REDIRECT_URI. */
function resolveRedirectUri(): string {
  return getOpenAxe() ? DESKTOP_REDIRECT_URI : REDIRECT_URI
}

export async function randomBase64url(bytes: number): Promise<string> {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export async function sha256Base64url(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

const VERIFIER_KEY = 't3k_code_verifier'
const STATE_KEY = 't3k_state'
const ACCESS_TOKENS_KEY = 't3k_tokens'

/** Marker used on the popup->opener postMessage channel and in the popup's
 * cloned sessionStorage, so the popup can recognize itself (and the opener
 * can ignore unrelated window messages). */
export const POPUP_AUTH_SOURCE = 'openaxe-t3k-auth'
export const POPUP_PENDING_KEY = 't3k_popup_pending'

export function storePkce(verifier: string, state: string): void {
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
}

export function clearPkce(): void {
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
}

function getAccessTokens(): T3KTokens | null {
  const raw = sessionStorage.getItem(ACCESS_TOKENS_KEY)
  return raw ? (JSON.parse(raw) as T3KTokens) : null
}

function setAccessTokens(tokens: T3KTokens): void {
  sessionStorage.setItem(ACCESS_TOKENS_KEY, JSON.stringify(tokens))
}

function getRefreshToken(): string | null {
  // For a same-tab-session refresh (the access token merely expired, the
  // tab never closed) the sessionStorage copy is all that's needed - no
  // need to go through the slower persistent store here. That store (see
  // tryHydrateFromPersistentStorage) is what a *new* session/launch reads.
  return getAccessTokens()?.refresh_token ?? null
}

/** Attempt to exchange a stored refresh token for fresh access tokens. Null if none is stored. */
export async function tryRefreshFromStorage(): Promise<T3KTokens | null> {
  const refresh = getRefreshToken()
  if (!refresh) return null
  return refreshTokens(refresh)
}

async function redeemCode(code: string, codeVerifier: string): Promise<T3KTokens> {
  const res = await fetch(`${T3K_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: resolveRedirectUri(),
      client_id: PUBLISHABLE_KEY!,
    }),
  })
  if (!res.ok) throw new Error('Token exchange failed')
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

export async function refreshTokens(refreshToken: string): Promise<T3KTokens> {
  const res = await fetch(`${T3K_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: PUBLISHABLE_KEY!,
    }),
  })
  if (!res.ok) throw new Error('Token refresh failed')
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

export interface OAuthCallbackParams {
  code: string | null
  error: string | null
  state: string | null
}

/**
 * Reads `?code=`/`?state=`/`?error=` off the current URL and immediately
 * strips them, atomically, so the same callback can never be processed
 * twice - neither by reloading/bookmarking a URL that still carries an
 * already-consumed code, nor by React StrictMode's dev-only double effect
 * invocation (the second invocation runs synchronously right after the
 * first and would otherwise see the exact same still-present params).
 * Returns null when the URL isn't carrying a callback at all.
 */
export function consumeOAuthCallbackParams(): OAuthCallbackParams | null {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('code') && !params.has('error')) return null
  const result: OAuthCallbackParams = {
    code: params.get('code'),
    error: params.get('error'),
    state: params.get('state'),
  }
  params.delete('code')
  params.delete('state')
  params.delete('error')
  const query = params.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState(null, '', url)
  return result
}

/**
 * Handle an OAuth redirect back into the app. Verifies state, redeems the
 * code, persists tokens, and returns them on success - or a typed error
 * (not a pending flow at all / state mismatch / missing code / failed
 * exchange).
 */
export async function handleOAuthCallback(
  params: OAuthCallbackParams,
): Promise<OAuthCallbackResult> {
  const { code, error, state: returnedState } = params

  const storedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  clearPkce()

  // No verifier means this browser never actually started a connect flow in
  // this session - most likely a stale or bookmarked URL still carrying an
  // old code/state pair, not a real failed attempt, so this isn't an error
  // worth surfacing.
  if (!verifier) return { ok: false, error: 'not_pending' }
  if (returnedState !== storedState) return { ok: false, error: 'state_mismatch' }
  if (error) return { ok: false, error }
  if (!code) return { ok: false, error: 'missing_code' }

  try {
    const tokens = await redeemCode(code, verifier)
    setTokens(tokens)
    return { ok: true, tokens }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'token_exchange_failed' }
  }
}

/** Identifier the desktop shell's OS-keychain-backed secret store uses for
 * the refresh token - see native/openaxe.ts's secureStore/secureLoad. */
const NATIVE_REFRESH_TOKEN_KEY = 'tone3000_refresh_token'
/** Web build's equivalent, in localStorage - see the module header for why
 * this is a deliberate exception to the rest of this file staying out of
 * localStorage. */
const WEB_REFRESH_TOKEN_KEY = 't3k_refresh_token'

function persistRefreshToken(token: string): void {
  const bridge = getOpenAxe()
  if (bridge) {
    void bridge.secureStore({ key: NATIVE_REFRESH_TOKEN_KEY, value: token }).catch(() => {})
  } else {
    localStorage.setItem(WEB_REFRESH_TOKEN_KEY, token)
  }
}

function clearPersistedRefreshToken(): void {
  const bridge = getOpenAxe()
  if (bridge) {
    void bridge.secureDelete({ key: NATIVE_REFRESH_TOKEN_KEY }).catch(() => {})
  } else {
    localStorage.removeItem(WEB_REFRESH_TOKEN_KEY)
  }
}

/**
 * Persist a freshly-issued token triple: the full triple in sessionStorage
 * (access + refresh, for same-tab-session reuse - see getAccessToken), and
 * the refresh token again into whichever longer-lived store this build
 * uses (see persistRefreshToken) so it survives past this session entirely.
 */
export function setTokens(tokens: T3KTokens): void {
  setAccessTokens({
    access_token: tokens.access_token,
    expires_at: tokens.expires_at,
    refresh_token: tokens.refresh_token,
  })
  persistRefreshToken(tokens.refresh_token)
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_TOKENS_KEY)
  clearPersistedRefreshToken()
}

/**
 * Redeem a refresh token persisted from a previous visit/launch (see
 * persistRefreshToken), so the user doesn't have to reconnect to Tone3000
 * every time. Returns the fresh tokens on success, or null if there's
 * nothing stored or the stored token was rejected (revoked/expired) - in
 * the latter case the stale entry is cleared so this doesn't keep retrying
 * a dead credential forever.
 */
export async function tryHydrateFromPersistentStorage(): Promise<T3KTokens | null> {
  const bridge = getOpenAxe()
  const stored = bridge
    ? ((await bridge.secureLoad({ key: NATIVE_REFRESH_TOKEN_KEY }).catch(() => null))?.value ??
      null)
    : localStorage.getItem(WEB_REFRESH_TOKEN_KEY)
  if (!stored) return null
  try {
    const tokens = await refreshTokens(stored)
    setTokens(tokens)
    return tokens
  } catch {
    clearPersistedRefreshToken()
    return null
  }
}

function buildAuthorizeUrl(
  pubkey: string,
  redirectUri: string,
  params: { state: string; codeChallenge: string },
): string {
  const url = new URL(`${T3K_API}/api/v1/oauth/authorize`)
  url.searchParams.set('client_id', pubkey)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  return url.toString()
}

/**
 * Point of use for Kick: start the standard OAuth flow. Must be called from a
 * user gesture (popup blockers). Builds the authorize URL with PKCE and
 * redirects the page to Tone3000; on return handleOAuthCallback() finishes the job.
 */
export async function startStandardFlow(
  config = {} as { pubkey?: string; redirectUri?: string },
): Promise<void> {
  const pubkey = config.pubkey ?? PUBLISHABLE_KEY
  const redirectUri = config.redirectUri ?? resolveRedirectUri()
  const verifier = await randomBase64url(32)
  const codeChallenge = await sha256Base64url(verifier)
  const state = await randomBase64url(16)
  storePkce(verifier, state)

  window.location.href = buildAuthorizeUrl(pubkey!, redirectUri, { state, codeChallenge })
}

const POPUP_WINDOW_NAME = 'openaxe-t3k-auth'
const POPUP_WINDOW_FEATURES = 'width=560,height=680,popup=yes'

let activeAuthPopup: Window | null = null

/** The popup the current web OAuth flow opened, or null. Lets callers detect
 * the user closing it without completing (see authStore's closure watch). */
export function getActiveAuthPopup(): Window | null {
  return activeAuthPopup
}

/**
 * Popup-based OAuth for the web build: keeps the main window (and its
 * AudioContext/engine) alive across login so the user isn't dumped back on
 * PowerGate after the round trip. Opens a blank popup synchronously inside
 * the user gesture, then navigates it to the authorize URL; the popup
 * completes the callback on its own and posts the result back to the opener
 * (see isAuthPopup/notifyPopupResult). Returns false when a popup couldn't
 * be opened (blocked, or the desktop webview which keeps its fixed-port
 * bounce-listener redirect flow) - callers should fall back to
 * startStandardFlow in that case.
 */
export async function startPopupOAuthFlow(
  config = {} as { pubkey?: string; redirectUri?: string },
): Promise<boolean> {
  if (getOpenAxe()) return false
  const pubkey = config.pubkey ?? PUBLISHABLE_KEY
  const redirectUri = config.redirectUri ?? resolveRedirectUri()

  // PKCE + the popup marker must be in sessionStorage BEFORE the popup is
  // opened: the popup receives a clone of our sessionStorage at open time,
  // so anything written afterwards never reaches it. The crypto here
  // resolves well within the user gesture's transient-activation window, so
  // the window.open below is still allowed.
  const verifier = await randomBase64url(32)
  const codeChallenge = await sha256Base64url(verifier)
  const state = await randomBase64url(16)
  storePkce(verifier, state)
  sessionStorage.setItem(POPUP_PENDING_KEY, '1')

  const popup = window.open('', POPUP_WINDOW_NAME, POPUP_WINDOW_FEATURES)
  if (!popup) {
    clearPkce()
    sessionStorage.removeItem(POPUP_PENDING_KEY)
    return false
  }

  activeAuthPopup = popup
  popup.location.href = buildAuthorizeUrl(pubkey!, redirectUri, { state, codeChallenge })
  return true
}

/** True when this window is the OAuth popup (opened by the main window). */
export function isAuthPopup(): boolean {
  return typeof window !== 'undefined' && Boolean(window.opener)
}

/** Tell the opener how the popup's callback went, then close. Only valid inside the popup. */
export function notifyPopupResult(result: { ok: boolean; error?: string }): void {
  try {
    window.opener?.postMessage({ source: POPUP_AUTH_SOURCE, ...result }, window.location.origin)
  } catch {
    // The main tab was closed mid-flow - nothing left to tell.
  }
  window.close()
}

// ─── API client ───────────────────────────────────────────────────────────────

let accessPromise: Promise<string> | null = null

/**
 * Resolve a valid access token, refreshing via the stored refresh token when
 * needed. Throws 'Not authenticated' if no usable credentials exist.
 */
export function getAccessToken(): Promise<string> {
  if (!accessPromise) {
    accessPromise = (async () => {
      const tokens = getAccessTokens()
      if (tokens && Date.now() < tokens.expires_at - 60_000) return tokens.access_token
      const refreshed = await tryRefreshFromStorage()
      if (refreshed) {
        setTokens(refreshed)
        return refreshed.access_token
      }
      throw new Error('Not authenticated')
    })().finally(() => {
      accessPromise = null
    })
  }
  return accessPromise
}

/** Authenticated fetch against the Tone3000 API with one 401 retry. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const doFetch = (t: string) =>
    globalThis.fetch(`${T3K_API}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${t}` },
    })
  const res = await doFetch(token)
  if (res.status === 401) {
    clearTokens()
    const fresh = await getAccessToken()
    return doFetch(fresh)
  }
  return res
}

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`)
  return res.json() as Promise<T>
}

export function buildSearchTonesQuery(params: SearchTonesParams = {}): URLSearchParams {
  const qs = new URLSearchParams()
  if (params.query) qs.set('query', params.query)
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  if (params.sort) qs.set('sort', params.sort)
  if (params.gears?.length) qs.set('gears', params.gears.join('_'))
  if (params.format) qs.set('format', params.format)
  if (params.sizes?.length) qs.set('sizes', params.sizes.join('_'))
  if (params.architecture != null) qs.set('architecture', String(params.architecture))
  if (params.tags?.length) qs.set('tags', params.tags.join('_'))
  if (params.makes?.length) qs.set('makes', params.makes.join('_'))
  if (params.creators?.length) qs.set('creators', params.creators.join(','))
  return qs
}

export function apiSearchTones(params: SearchTonesParams = {}): Promise<PaginatedResponse<Tone>> {
  return getJson<PaginatedResponse<Tone>>(`/api/v1/tones/search?${buildSearchTonesQuery(params)}`)
}

export function apiListMakes(
  query = '',
): Promise<PaginatedResponse<{ id: number; name: string; tones_count: number; url: string }>> {
  const qs = new URLSearchParams({ page: '1', page_size: '25', sort: 'name' })
  if (query) qs.set('query', query)
  return getJson(`/api/v1/makes?${qs}`)
}

export function apiListTags(
  query = '',
): Promise<PaginatedResponse<{ id: number; name: string; tones_count: number; url: string }>> {
  const qs = new URLSearchParams({ page: '1', page_size: '25', sort: 'name' })
  if (query) qs.set('query', query)
  return getJson(`/api/v1/tags?${qs}`)
}

export function apiGetTone(id: number): Promise<Tone> {
  return getJson<Tone>(`/api/v1/tones/${id}`)
}

export function apiListCreatedTones(
  params: ListUserTonesParams = {},
): Promise<PaginatedResponse<Tone>> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  if (params.gear) qs.set('gear', params.gear)
  return getJson<PaginatedResponse<Tone>>(`/api/v1/tones/created?${qs}`)
}

export function apiListFavoritedTones(
  params: ListUserTonesParams = {},
): Promise<PaginatedResponse<Tone>> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  if (params.gear) qs.set('gear', params.gear)
  return getJson<PaginatedResponse<Tone>>(`/api/v1/tones/favorited?${qs}`)
}

export function apiGetUser(): Promise<User> {
  return getJson<User>('/api/v1/user')
}

/** Models for a tone - each has a model_url for the actual file. */
export async function apiListModels(
  toneId: number,
  params: { page?: number; pageSize?: number; architecture?: number | 'custom' } = {},
): Promise<PaginatedResponse<Tone3000Model>> {
  const qs = new URLSearchParams({ tone_id: String(toneId) })
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  if (params.architecture != null) qs.set('architecture', String(params.architecture))
  return getJson<PaginatedResponse<Tone3000Model>>(`/api/v1/models?${qs}`)
}

/**
 * Download a model/IR file as a Blob using the authenticated client - model_url
 * requires the Bearer header, so a plain fetch() would 401. Callers cache the
 * result (see fetchWithCache in the engine's assetCache).
 */
export async function apiDownloadModel(modelUrl: string): Promise<Blob> {
  const path = modelUrl.replace(T3K_API, '')
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return res.blob()
}
