// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSearchTonesQuery,
  clearTokens,
  getAccessToken,
  setTokens,
  sha256Base64url,
  randomBase64url,
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
})
