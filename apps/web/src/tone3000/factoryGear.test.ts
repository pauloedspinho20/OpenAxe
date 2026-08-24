// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildFactoryGearEntries,
  factoryGearFor,
  firstFactoryGearFor,
  allFactoryGear,
  _resetFactoryManifestCache,
  _setFactoryManifestForTests,
  loadFactoryManifest,
  getFactoryManifestUrl,
  cacheFactoryGear,
} from './factoryGear'
import type { FactoryManifest } from './factoryGear'

beforeEach(() => {
  _resetFactoryManifestCache()
  vi.restoreAllMocks()
})

describe('buildFactoryGearEntries', () => {
  it('builds sorted entries with factory ids and slot', () => {
    const entries = buildFactoryGearEntries('amp', [
      { id: 'zebra-amp', name: 'Zebra Amp', url: '/factory/amp/zebra.nam' },
      { id: 'apple-amp', name: 'Apple Amp', url: '/factory/amp/apple.nam' },
    ])
    expect(entries).toEqual([
      {
        id: 'factory:amp:apple-amp',
        gear: 'amp',
        slot: 'model',
        name: 'Apple Amp',
        url: '/factory/amp/apple.nam',
      },
      {
        id: 'factory:amp:zebra-amp',
        gear: 'amp',
        slot: 'model',
        name: 'Zebra Amp',
        url: '/factory/amp/zebra.nam',
      },
    ])
  })

  it('uses ir slot for cab', () => {
    const entries = buildFactoryGearEntries('cab', [
      { id: 'mesa-4x12', name: 'Mesa 4x12', url: '/factory/cab/mesa.wav' },
    ])
    expect(entries[0]!.slot).toBe('ir')
  })
})

describe('factoryGearFor / firstFactoryGearFor / allFactoryGear', () => {
  it('returns empty when manifest not yet loaded', () => {
    expect(factoryGearFor('amp')).toEqual([])
    expect(firstFactoryGearFor('amp')).toBeUndefined()
    expect(allFactoryGear()).toEqual([])
  })

  it('returns entries for the requested gear kind after manifest is set', () => {
    const manifest: FactoryManifest = {
      version: 1,
      packs: {
        amp: [{ id: 'fender-deluxe', name: 'Fender Deluxe', url: '/factory/amp/fender.nam' }],
        cab: [{ id: 'mesa-4x12', name: 'Mesa 4x12', url: '/factory/cab/mesa.wav' }],
      },
    }
    _setFactoryManifestForTests(manifest)

    expect(factoryGearFor('amp')).toEqual([
      {
        id: 'factory:amp:fender-deluxe',
        gear: 'amp',
        slot: 'model',
        name: 'Fender Deluxe',
        url: '/factory/amp/fender.nam',
      },
    ])
    expect(factoryGearFor('cab')).toEqual([
      {
        id: 'factory:cab:mesa-4x12',
        gear: 'cab',
        slot: 'ir',
        name: 'Mesa 4x12',
        url: '/factory/cab/mesa.wav',
      },
    ])
    expect(factoryGearFor('pedal')).toEqual([])
    expect(firstFactoryGearFor('amp')?.name).toBe('Fender Deluxe')
    expect(firstFactoryGearFor('pedal')).toBeUndefined()
  })

  it('allFactoryGear aggregates amp, amp-cab, pedal, cab', () => {
    const manifest: FactoryManifest = {
      version: 1,
      packs: {
        amp: [{ id: 'a', name: 'Amp A', url: '/a.nam' }],
        'amp-cab': [{ id: 'b', name: 'AmpCab B', url: '/b.nam' }],
        pedal: [{ id: 'c', name: 'Pedal C', url: '/c.nam' }],
        cab: [{ id: 'd', name: 'Cab D', url: '/d.wav' }],
      },
    }
    _setFactoryManifestForTests(manifest)
    const all = allFactoryGear()
    expect(all.map((e) => e.id)).toEqual([
      'factory:amp:a',
      'factory:amp-cab:b',
      'factory:pedal:c',
      'factory:cab:d',
    ])
  })
})

describe('getFactoryManifestUrl', () => {
  it('defaults to /factory/manifest.json', () => {
    expect(getFactoryManifestUrl()).toBe('/factory/manifest.json')
  })
})

describe('loadFactoryManifest', () => {
  it('fetches and caches the manifest', async () => {
    const manifest: FactoryManifest = { version: 1, packs: { amp: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(manifest) })
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadFactoryManifest()
    expect(loaded).toEqual(manifest)
    expect(fetchMock).toHaveBeenCalledWith('/factory/manifest.json')

    // Second call returns cached without fetching
    const loaded2 = await loadFactoryManifest()
    expect(loaded2).toBe(loaded)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(loadFactoryManifest()).rejects.toThrow('Failed to fetch factory manifest')
  })
})

describe('cacheFactoryGear', () => {
  it('fetches and caches via assetCache', async () => {
    const blob = new Blob(['nam-data'])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }),
    )
    const entry = {
      id: 'factory:amp:test-amp',
      gear: 'amp' as const,
      slot: 'model' as const,
      name: 'Test Amp',
      url: '/factory/amp/test.nam',
    }
    const result = await cacheFactoryGear(entry)
    expect(await result.text()).toBe('nam-data')
    // Second call hits cache, no network
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not fetch')))
    const cached = await cacheFactoryGear(entry)
    expect(await cached.text()).toBe('nam-data')
  })
})
