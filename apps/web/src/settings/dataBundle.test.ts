// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { Tone3000Library, useTone3000Library } from '../tone3000/library'
import { clearTokens, setTokens } from '../tone3000/client'
import {
  clearStore,
  STORE_ASSETS,
  STORE_LIBRARY,
  STORE_PRESETS,
  STORE_PRESET_BANK,
  STORE_SCENES,
  STORE_MIDI,
} from '../storage/db'
import { putCachedAsset, getCachedAsset } from '../engine/assetCache'
import { listPresets, savePreset } from '../presets/presetStore'
import type { Preset } from '../presets/types'
import { createEmptyPresetBank, loadPresetBank, savePresetBank } from '../presets/presetBankStore'
import { loadSceneBank, saveSceneBank } from '../scenes/sceneBankStore'
import type { SceneBank } from '../scenes/types'
import { DEFAULT_MIDI_CONFIG, loadMidiConfig, saveMidiConfig } from '../midi/midiConfigStore'
import type { MidiConfig } from '../midi/midiConfigStore'
import { useIOStore } from '../state/ioStore'
import { useSettingsStore } from '../state/settingsStore'
import {
  buildDataBundle,
  clearAssetCache,
  deleteAllData,
  downloadDataBundle,
  getAssetCacheStats,
  importDataBundle,
  readDataBundleFromFile,
  type DataBundle,
} from './dataBundle'

const THEME_KEY = 'openaxe:theme'
const ONBOARDING_KEY = 'openaxe:onboarding-dismissed'

function makePreset(id = 'p1', name = 'Clean'): Preset {
  return {
    id,
    name,
    tags: ['clean'],
    favorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    blocks: [],
    edges: [],
    masterLevel: 0.8,
    masterMuted: false,
  }
}

function makeSceneBank(): SceneBank {
  return {
    id: 'default',
    version: 1,
    scenes: [],
    activeScene: 0,
    activeSlot: 0,
    updatedAt: 2000,
  }
}

function makeMidiConfig(): MidiConfig {
  return { ...DEFAULT_MIDI_CONFIG, selectedInputId: 'input-1' }
}

async function seed() {
  await savePreset(makePreset())
  await saveSceneBank(makeSceneBank())
  const presetBank = createEmptyPresetBank()
  presetBank.slots[0] = 'p1'
  await savePresetBank(presetBank)
  await saveMidiConfig(makeMidiConfig())
  setTokens({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 120_000 })
  await Tone3000Library.importAsset({
    id: 'tone3000:model:1',
    kind: 'model',
    name: 'Deluxe',
    creator: 'c',
    sourceUrl: 'https://www.tone3000.com/tones/1',
    toneTitle: 'T',
    modelUrl: 'https://www.tone3000.com/models/1/download',
  })
  await putCachedAsset('asset-a', new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/wav' }))
  localStorage.setItem(THEME_KEY, 'dark')
  localStorage.setItem(ONBOARDING_KEY, '1')
  useIOStore.setState({ inputGain: 0.5, inputChannel: 'stereo', latencyHint: 'balanced' })
  useSettingsStore.setState({ namQuality: 0.75 })
}

describe('dataBundle', () => {
  beforeEach(async () => {
    useTone3000Library.setState({ entries: [] })
    localStorage.clear()
    useIOStore.setState({ inputGain: 1, inputChannel: 'l', latencyHint: 'interactive' })
    useSettingsStore.setState({ namQuality: 1 })
    // Tone3000Library.importAsset downloads the model blob via fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['{}'])) }),
    )
    // Reset every persisted store so tests don't leak into each other.
    await clearStore(STORE_ASSETS)
    await clearStore(STORE_LIBRARY)
    await clearStore(STORE_PRESETS)
    await clearStore(STORE_SCENES)
    await clearStore(STORE_MIDI)
    await clearStore(STORE_PRESET_BANK)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    clearTokens()
    await clearStore(STORE_ASSETS)
    await clearStore(STORE_LIBRARY)
  })

  describe('buildDataBundle', () => {
    it('gathers every store into one bundle', async () => {
      await seed()
      const bundle = await buildDataBundle()

      expect(bundle.version).toBe(1)
      expect(bundle.presets).toHaveLength(1)
      expect(bundle.presets[0]!.name).toBe('Clean')
      expect(bundle.sceneBank?.id).toBe('default')
      expect(bundle.presetBank?.slots[0]).toBe('p1')
      expect(bundle.midiConfig.selectedInputId).toBe('input-1')
      expect(bundle.library).toHaveLength(1)
      // seed() caches 'asset-a' plus the library model blob imported via importAsset.
      expect(bundle.assets.map((a) => a.id)).toContain('asset-a')
      expect(bundle.theme).toBe('dark')
      expect(bundle.onboardingDismissed).toBe(true)
      expect(bundle.io).toEqual({
        inputGain: 0.5,
        inputChannel: 'stereo',
        latencyHint: 'balanced',
      })
      expect(bundle.namQuality).toBe(0.75)
    })

    it('tolerates an empty asset cache', async () => {
      const bundle = await buildDataBundle()
      expect(bundle.assets).toEqual([])
      expect(bundle.presets).toEqual([])
    })
  })

  describe('readDataBundleFromFile', () => {
    it('parses a valid bundle file', async () => {
      const bundle = await buildDataBundle()
      const file = new File([JSON.stringify(bundle)], 'backup.json', { type: 'application/json' })
      const parsed = await readDataBundleFromFile(file)
      expect(parsed.version).toBe(1)
      expect(parsed.presets).toHaveLength(bundle.presets.length)
    })

    it('throws on invalid JSON', async () => {
      const file = new File(['not json'], 'bad.json')
      await expect(readDataBundleFromFile(file)).rejects.toThrow(/not valid JSON/)
    })

    it('throws when the root is not an object', async () => {
      const file = new File(['42'], 'bad.json')
      await expect(readDataBundleFromFile(file)).rejects.toThrow(/valid JSON object/)
    })

    it('throws when version is missing', async () => {
      const file = new File([JSON.stringify({ presets: [] })], 'bad.json')
      await expect(readDataBundleFromFile(file)).rejects.toThrow(/version/)
    })

    it('fills defaults for optional fields', async () => {
      const file = new File([JSON.stringify({ version: 1 })], 'min.json')
      const parsed = await readDataBundleFromFile(file)
      expect(parsed.presets).toEqual([])
      expect(parsed.sceneBank).toBeNull()
      expect(parsed.presetBank).toBeNull()
      expect(parsed.midiConfig).toEqual(DEFAULT_MIDI_CONFIG)
      expect(parsed.library).toEqual([])
      expect(parsed.assets).toEqual([])
      expect(parsed.theme).toBeNull()
      expect(parsed.onboardingDismissed).toBe(false)
      expect(parsed.io).toBeNull()
      expect(parsed.namQuality).toBe(1)
    })

    it('coerces onboardingDismissed to a boolean and preserves a string theme', async () => {
      const file = new File(
        [JSON.stringify({ version: 1, onboardingDismissed: 'yes', theme: 'light' })],
        'min.json',
      )
      const parsed = await readDataBundleFromFile(file)
      expect(parsed.onboardingDismissed).toBe(true)
      expect(parsed.theme).toBe('light')
    })
  })

  function minimalBundle(): DataBundle {
    return {
      version: 1,
      exportedAt: Date.now(),
      presets: [],
      sceneBank: null,
      presetBank: null,
      midiConfig: { ...DEFAULT_MIDI_CONFIG },
      library: [],
      assets: [],
      theme: null,
      onboardingDismissed: false,
      io: null,
      namQuality: 1,
    }
  }

  describe('importDataBundle', () => {
    async function seededBundle(): Promise<DataBundle> {
      await seed()
      return buildDataBundle()
    }

    it('replaces stores with the bundle contents', async () => {
      // Start from a known-empty state, then import.
      await clearStore(STORE_ASSETS)
      await clearStore(STORE_LIBRARY)
      const bundle = await seededBundle()
      // Mutate live stores so we can confirm a full replace happens.
      await savePreset(makePreset('other', 'Dirty'))
      await importDataBundle(bundle)

      const presets = await listPresets()
      expect(presets.map((p) => p.name).sort()).toEqual(['Clean'])

      const bank = await loadSceneBank()
      expect(bank?.id).toBe('default')

      const presetBank = await loadPresetBank()
      expect(presetBank?.slots[0]).toBe('p1')

      const midi = await loadMidiConfig()
      expect(midi.selectedInputId).toBe('input-1')

      const lib = await Tone3000Library.list()
      expect(lib).toHaveLength(1)

      const asset = await getCachedAsset('asset-a')
      expect(asset).not.toBeNull()
    })

    it('writes theme, onboarding, io, and namQuality side state', async () => {
      const bundle = await seededBundle()
      await importDataBundle(bundle)
      expect(localStorage.getItem(THEME_KEY)).toBe('dark')
      expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1')
      expect(useIOStore.getState().inputGain).toBe(0.5)
      expect(useIOStore.getState().inputChannel).toBe('stereo')
      expect(useIOStore.getState().latencyHint).toBe('balanced')
      expect(useSettingsStore.getState().namQuality).toBe(0.75)
    })

    it('does not write a theme that is neither dark nor light', async () => {
      const bundle = minimalBundle()
      bundle.theme = 'system'
      localStorage.clear()
      await importDataBundle(bundle)
      expect(localStorage.getItem(THEME_KEY)).toBeNull()
    })

    it('omits onboarding/localStorage writes when flags are false', async () => {
      const bundle = minimalBundle()
      bundle.onboardingDismissed = false
      localStorage.clear()
      await importDataBundle(bundle)
      expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull()
    })
  })

  describe('asset cache stats', () => {
    it('reports count and total bytes', async () => {
      await putCachedAsset('a', new Blob([new Uint8Array([1, 2, 3])]))
      await putCachedAsset('b', new Blob([new Uint8Array([4, 5, 6, 7])]))
      const stats = await getAssetCacheStats()
      expect(stats.count).toBe(2)
      expect(stats.bytes).toBe(7)
    })

    it('clearAssetCache empties only the asset store', async () => {
      await putCachedAsset('a', new Blob([new Uint8Array([1])]))
      await clearAssetCache()
      const stats = await getAssetCacheStats()
      expect(stats.count).toBe(0)
    })
  })

  describe('deleteAllData', () => {
    it('wipes stores and app localStorage keys', async () => {
      await seed()
      localStorage.setItem('t3k_refresh_token', 'secret')
      localStorage.setItem('openaxe:factory-setup-dismissed', '1')
      await deleteAllData({ signOutTone3000: false })

      expect(await listPresets()).toEqual([])
      expect(await getAssetCacheStats()).toEqual({ count: 0, bytes: 0 })
      expect(await loadPresetBank()).toBeNull()
      expect(localStorage.getItem(THEME_KEY)).toBeNull()
      expect(localStorage.getItem('openaxe:factory-setup-dismissed')).toBeNull()
      expect(localStorage.getItem('t3k_refresh_token')).toBe('secret') // not signed out
    })

    it('removes the refresh token when signOutTone3000 is set', async () => {
      localStorage.setItem('t3k_refresh_token', 'secret')
      await deleteAllData({ signOutTone3000: true })
      expect(localStorage.getItem('t3k_refresh_token')).toBeNull()
    })
  })

  describe('downloadDataBundle', () => {
    it('creates a download link with a dated filename and revokes the url', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:fake-url')
      const revokeObjectURL = vi.fn()
      const click = vi.fn()
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
      vi.stubGlobal('document', {
        createElement: () => ({ click, set href(_: string) {}, set download(_: string) {} }),
      })

      const bundle = await buildDataBundle()
      downloadDataBundle(bundle)

      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
      expect(click).toHaveBeenCalledOnce()
    })
  })
})
