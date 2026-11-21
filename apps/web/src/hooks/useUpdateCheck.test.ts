// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { isNewer, dismissUpdate, useUpdateCheck } from './useUpdateCheck'

describe('isNewer', () => {
  it('detects newer tag', () => {
    expect(isNewer('v0.2.4', '0.2.3')).toBe(true)
    expect(isNewer('0.3.0', '0.2.9')).toBe(true)
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true)
  })
  it('returns false when current is newer or equal', () => {
    expect(isNewer('v0.2.3', '0.2.3')).toBe(false)
    expect(isNewer('v0.2.3', '0.2.4')).toBe(false)
    expect(isNewer('v0.2.3', '0.3.0')).toBe(false)
  })
  it('handles missing v prefix and patch', () => {
    expect(isNewer('0.2.4', '0.2.3')).toBe(true)
    expect(isNewer('v0.2.10', 'v0.2.9')).toBe(true)
    expect(isNewer('v0.2.4', 'v0.2.4')).toBe(false)
  })
  it('returns false on invalid', () => {
    expect(isNewer('', '0.2.3')).toBe(false)
    expect(isNewer('v0.2.3', '')).toBe(false)
  })
})

describe('useUpdateCheck', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('shows update when the landing manifest reports a newer tag', async () => {
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            releases: [
              {
                tag_name: 'v0.2.5',
                html_url: 'https://openaxe-site.pages.dev/releases.html',
                published_at: null,
              },
            ],
          }),
        }) as Response,
    )
    const { result } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(result.current.latest).not.toBeNull())
    expect(result.current.latest?.tag).toBe('v0.2.5')
  })

  it('does not show when current is latest', async () => {
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            releases: [
              {
                tag_name: 'v0.2.4',
                html_url: 'https://openaxe-site.pages.dev/releases.html',
                published_at: null,
              },
            ],
          }),
        }) as Response,
    )
    const { result } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.latest).toBeNull()
  })

  it('skips prereleases', async () => {
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            releases: [
              {
                tag_name: 'v0.3.0-rc.1',
                html_url: 'https://openaxe-site.pages.dev/releases.html',
                published_at: null,
                prerelease: true,
              },
              {
                tag_name: 'v0.2.4',
                html_url: 'https://openaxe-site.pages.dev/releases.html',
                published_at: null,
              },
            ],
          }),
        }) as Response,
    )
    const { result } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.latest).toBeNull()
  })

  it('hides after dismiss and persists', async () => {
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            releases: [
              {
                tag_name: 'v0.2.5',
                html_url: 'https://openaxe-site.pages.dev/releases.html',
                published_at: null,
              },
            ],
          }),
        }) as Response,
    )
    const { result } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(result.current.latest).not.toBeNull())
    act(() => result.current.dismiss())
    expect(result.current.latest).toBeNull()
    expect(localStorage.getItem('openaxe-dismissed-update-v0.2.5')).toBe('1')
    // second hook should stay hidden even with same fetch
    const { result: r2 } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(r2.current.checking).toBe(false))
    expect(r2.current.latest).toBeNull()
  })

  it('fails silently on network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network')
    })
    const { result } = renderHook(() => useUpdateCheck('0.2.4'))
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.latest).toBeNull()
  })

  it('respects dismissed cache via dismissUpdate helper', () => {
    dismissUpdate('v0.9.9')
    expect(localStorage.getItem('openaxe-dismissed-update-v0.9.9')).toBe('1')
  })
})
