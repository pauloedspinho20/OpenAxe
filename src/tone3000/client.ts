/**
 * Zero-dependency Tone3000 OAuth2+PKCE + API client for a pure client-side
 * SPA (see README's "no required backend" decision). Heavily inspired by the
 * official reference client (github.com/tone-3000/api/src/tone3000-client.ts),
 * adapted to this app's storage choices: the refresh token is persisted in
 * localStorage so a returning session reconnects without a full re-auth, and
 * the access token lives in sessionStorage.
 *
 * There is NO `t3k_cs_` client secret here: Tone3000's docs mark it server
 * only, and the browser token endpoint accepts just client_id + PKCE. See
 * config.ts for why.
 */
import { PUBLISHABLE_KEY, REDIRECT_URI, T3K_API } from './config'
import type { OAuthCallbackResult, T3KTokens } from './types'
import type {
  ListUserTonesParams,
  PaginatedResponse,
  SearchTonesParams,
  Tone,
  Tone3000Model,
  User,
} from './types'

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
const REFRESH_TOKENS_KEY = 't3k_refresh_token'

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
  return localStorage.getItem(REFRESH_TOKENS_KEY)
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
      redirect_uri: REDIRECT_URI,
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

/**
 * Handle the OAuth redirect back into the app (?code=...&state=...).
 * Verifies state, redeems the code, persists tokens, and returns them on
 * success - or a typed error (state mismatch / missing code / failed exchange).
 */
export async function handleOAuthCallback(): Promise<OAuthCallbackResult> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const returnedState = params.get('state')

  const storedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  clearPkce()

  if (returnedState !== storedState) return { ok: false, error: 'state_mismatch' }
  if (error) return { ok: false, error }
  if (!code || !verifier) return { ok: false, error: 'missing_code' }

  try {
    const tokens = await redeemCode(code, verifier)
    setTokens(tokens)
    return { ok: true, tokens }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'token_exchange_failed' }
  }
}

/** Persist a freshly-issued token triple (access in sessionStorage, refresh in localStorage). */
export function setTokens(tokens: T3KTokens): void {
  setAccessTokens({
    access_token: tokens.access_token,
    expires_at: tokens.expires_at,
    refresh_token: tokens.refresh_token,
  })
  // The refresh token is the long-lived credential - persist it across sessions.
  if (tokens.refresh_token) localStorage.setItem(REFRESH_TOKENS_KEY, tokens.refresh_token)
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_TOKENS_KEY)
  localStorage.removeItem(REFRESH_TOKENS_KEY)
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
  const redirectUri = config.redirectUri ?? REDIRECT_URI
  const verifier = await randomBase64url(32)
  const codeChallenge = await sha256Base64url(verifier)
  const state = await randomBase64url(16)
  storePkce(verifier, state)

  const url = new URL(`${T3K_API}/api/v1/oauth/authorize`)
  url.searchParams.set('client_id', pubkey!)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  window.location.href = url.toString()
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
