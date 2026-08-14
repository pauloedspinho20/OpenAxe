/**
 * Whole-app backup: bundles every locally-persisted store (presets, scene
 * bank, MIDI config, Tone3000 library metadata, cached model/IR blobs) plus
 * the small localStorage-backed preferences into one downloadable JSON file,
 * and restores it. Deliberately written against storage/db.ts's low-level
 * `withStore`/`clearStore` rather than each module's own store-syncing
 * wrappers (e.g. Tone3000Library.importAsset) - those exist to keep a live
 * zustand cache in sync with IndexedDB, but a bundle import is always
 * followed by a full page reload (see SettingsDialog), so writing straight
 * to IndexedDB and letting the next boot re-hydrate everything is simpler
 * and avoids a bundle import triggering a network re-download.
 *
 * The Tone3000 OAuth refresh token is deliberately excluded - it's a live
 * credential, not app data.
 */
import {
  STORE_ASSETS,
  STORE_LIBRARY,
  STORE_MIDI,
  STORE_PRESETS,
  STORE_SCENES,
  clearStore,
  withStore,
} from '../storage/db'
import { getCachedAsset, putCachedAsset } from '../engine/assetCache'
import { listPresets, savePreset } from '../presets/presetStore'
import type { Preset } from '../presets/types'
import { loadSceneBank, saveSceneBank } from '../scenes/sceneBankStore'
import type { SceneBank } from '../scenes/types'
import { DEFAULT_MIDI_CONFIG, loadMidiConfig, saveMidiConfig } from '../midi/midiConfigStore'
import type { MidiConfig } from '../midi/midiConfigStore'
import { Tone3000Library } from '../tone3000/library'
import type { Tone3000LibraryEntry } from '../tone3000/library'
import { useIOStore, type InputChannelMode, type LatencyHint } from '../state/ioStore'
import { useSettingsStore } from '../state/settingsStore'

const BUNDLE_VERSION = 1
const THEME_KEY = 'nam-web-studio:theme'
const ONBOARDING_KEY = 'nam-web-studio:onboarding-dismissed'

export interface DataBundleAsset {
  id: string
  type: string
  base64: string
}

export interface DataBundle {
  version: number
  exportedAt: number
  presets: Preset[]
  sceneBank: SceneBank | null
  midiConfig: MidiConfig
  library: Tone3000LibraryEntry[]
  assets: DataBundleAsset[]
  theme: string | null
  onboardingDismissed: boolean
  io: { inputGain: number; inputChannel: InputChannelMode; latencyHint: LatencyHint } | null
  namQuality: number
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** Gathers every store into one in-memory bundle, ready to serialize. */
export async function buildDataBundle(): Promise<DataBundle> {
  const [presets, sceneBank, midiConfig, library, assetIds] = await Promise.all([
    listPresets(),
    loadSceneBank(),
    loadMidiConfig(),
    Tone3000Library.list(),
    withStore<IDBValidKey[]>(STORE_ASSETS, 'readonly', (store) => store.getAllKeys()),
  ])

  const assets: DataBundleAsset[] = []
  for (const key of assetIds) {
    const id = String(key)
    const blob = await getCachedAsset(id)
    if (!blob) continue
    assets.push({
      id,
      type: blob.type || 'application/octet-stream',
      base64: await blobToBase64(blob),
    })
  }

  const io = useIOStore.getState()
  return {
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    presets,
    sceneBank,
    midiConfig,
    library,
    assets,
    theme: localStorage.getItem(THEME_KEY),
    onboardingDismissed: localStorage.getItem(ONBOARDING_KEY) === '1',
    io: {
      inputGain: io.inputGain,
      inputChannel: io.inputChannel,
      latencyHint: io.latencyHint,
    },
    namQuality: useSettingsStore.getState().namQuality,
  }
}

/** Triggers a browser download of the bundle as a `.json` file. */
export function downloadDataBundle(bundle: DataBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `nam-web-studio-backup-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function validateBundle(value: unknown): DataBundle {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Backup file is not a valid JSON object')
  }
  const v = value as Record<string, unknown>
  if (typeof v.version !== 'number') {
    throw new Error("Backup file is missing a required number field 'version'")
  }
  return {
    version: v.version,
    exportedAt: typeof v.exportedAt === 'number' ? v.exportedAt : Date.now(),
    presets: Array.isArray(v.presets) ? (v.presets as Preset[]) : [],
    sceneBank: (v.sceneBank as SceneBank | null | undefined) ?? null,
    midiConfig: (v.midiConfig as MidiConfig | undefined) ?? DEFAULT_MIDI_CONFIG,
    library: Array.isArray(v.library) ? (v.library as Tone3000LibraryEntry[]) : [],
    assets: Array.isArray(v.assets) ? (v.assets as DataBundleAsset[]) : [],
    theme: typeof v.theme === 'string' ? v.theme : null,
    onboardingDismissed: Boolean(v.onboardingDismissed),
    io: (v.io as DataBundle['io']) ?? null,
    namQuality: typeof v.namQuality === 'number' ? v.namQuality : 1,
  }
}

/** Reads and lightly validates a backup file (from a file input's change event). */
export async function readDataBundleFromFile(file: File): Promise<DataBundle> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('Backup file is not valid JSON')
  }
  return validateBundle(parsed)
}

/**
 * Replaces every store with the bundle's contents - clears each store first,
 * so this is a full restore, not a merge. Callers should reload the page
 * immediately after (every store-backed hook/zustand cache hydrates once at
 * boot; there's no live re-hydration path for an external bulk write).
 */
export async function importDataBundle(bundle: DataBundle): Promise<void> {
  await clearStore(STORE_ASSETS)
  await clearStore(STORE_PRESETS)
  await clearStore(STORE_LIBRARY)
  await clearStore(STORE_SCENES)
  await clearStore(STORE_MIDI)

  for (const asset of bundle.assets) {
    await putCachedAsset(asset.id, base64ToBlob(asset.base64, asset.type))
  }
  for (const preset of bundle.presets) await savePreset(preset)
  if (bundle.sceneBank) await saveSceneBank(bundle.sceneBank)
  await saveMidiConfig(bundle.midiConfig)
  for (const entry of bundle.library) {
    await withStore<IDBValidKey>(STORE_LIBRARY, 'readwrite', (store) => store.put(entry))
  }

  if (bundle.theme === 'dark' || bundle.theme === 'light') {
    localStorage.setItem(THEME_KEY, bundle.theme)
  }
  if (bundle.onboardingDismissed) {
    localStorage.setItem(ONBOARDING_KEY, '1')
  }
  if (bundle.io) {
    useIOStore.setState({
      inputGain: bundle.io.inputGain,
      inputChannel: bundle.io.inputChannel,
      latencyHint: bundle.io.latencyHint,
    })
  }
  useSettingsStore.getState().setNamQuality(bundle.namQuality)
}

/** Total cached model/IR blobs, for the Settings dialog's cache section. */
export async function getAssetCacheStats(): Promise<{ count: number; bytes: number }> {
  const blobs = await withStore<Blob[]>(STORE_ASSETS, 'readonly', (store) => store.getAll())
  return { count: blobs.length, bytes: blobs.reduce((sum, blob) => sum + blob.size, 0) }
}

/** Clears only the downloaded model/IR cache - library metadata/presets/scenes are untouched. */
export async function clearAssetCache(): Promise<void> {
  await clearStore(STORE_ASSETS)
}

const REFRESH_TOKEN_KEY = 't3k_refresh_token'
const IO_STORAGE_KEY = 'nam-web-studio-io'
const SETTINGS_STORAGE_KEY = 'nam-web-studio-settings'

/** Wipes every store and every localStorage key this app owns - a full factory reset. */
export async function deleteAllData(options: { signOutTone3000: boolean }): Promise<void> {
  await clearStore(STORE_ASSETS)
  await clearStore(STORE_PRESETS)
  await clearStore(STORE_LIBRARY)
  await clearStore(STORE_SCENES)
  await clearStore(STORE_MIDI)

  localStorage.removeItem(THEME_KEY)
  localStorage.removeItem(ONBOARDING_KEY)
  localStorage.removeItem(IO_STORAGE_KEY)
  localStorage.removeItem(SETTINGS_STORAGE_KEY)
  if (options.signOutTone3000) {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}
