/**
 * Media-center library persistence (issue #205). Metadata rows live in the
 * `media` kv store; the original file bytes live in the asset store under
 * `media:<id>` - both have an IndexedDB backend on the web and an on-disk one
 * in the desktop shell (storage/kv.ts, engine/assetCache.ts).
 */
import { deleteCachedAsset, getCachedAsset, putCachedAsset } from '../engine/assetCache'
import { STORE_MEDIA } from '../storage/db'
import { kvDelete, kvGetAll, kvPut } from '../storage/kv'
import type { RecordingSync } from './tabs/sync'

export type MediaKind = 'audio' | 'score'

export interface PracticeSettings {
  /** Playback rate, pitch preserved (0.25..2). */
  speed: number
  /** Transposition in semitones (-12..12). */
  semitones: number
  /** Linear volume (0..2). */
  volume: number
  /** A-B loop in seconds; null when unset. */
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  /** Count-in bars before playback (0 = off). */
  countInBars: number
  /** Tempo and meter for an audio track's count-in (tabs use the score's). */
  bpm: number
  beatsPerBar: number
}

export interface MediaMarker {
  id: string
  label: string
  time: number
}

export interface MediaItem {
  id: string
  kind: MediaKind
  name: string
  artist: string
  fileName: string
  mime: string
  size: number
  addedAt: number
  /** Seconds; audio only (scores derive it from the rendered audio). */
  duration: number
  /** Waveform overview (min/max pairs), audio only. */
  peaks: number[]
  practice: PracticeSettings
  markers: MediaMarker[]
  /** Tabs only: a recording of the song paired with the score, and its sync points. */
  sync?: RecordingSync | null
  /** Where playback was left (seconds; score time for tabs). */
  resume?: number
  /** Tabs only: how the workspace was left (zoom, tracks, panels...). */
  view?: TabViewState | null
  /** Scored practice runs, oldest first (capped). */
  runs?: PracticeRun[]
  /** The rig tone linked to this song: a scene, and a slot per section. */
  tone?: SongTone | null
}

/**
 * Song -> rig tone link. `scene` is a scene index (0-63); `sections` maps a
 * section key - "start", a tab's section bar ("bar:12") or a backing track's
 * marker id - to a slot (0-7) of that scene.
 */
export interface SongTone {
  scene: number | null
  sections: Record<string, number>
  /** Switch slots automatically at sections during playback. */
  follow: boolean
}

export interface TabViewState {
  zoom: number
  profile: 'tab' | 'both' | 'score'
  horizontal: boolean
  trackIndex: number
  shown: number[]
  sidebarOpen: boolean
  source: 'synth' | 'recording'
}

/** One scored practice run (a wait-mode run, or a listened pass/play-through). */
export interface PracticeRun {
  /** Epoch ms when it finished. */
  at: number
  mode: 'wait' | 'listen'
  speed: number
  notes: number
  hits: number
  /** Per bar: [bar index, hits, misses]. */
  bars: [number, number, number][]
  seconds: number
}

/** Runs kept per song. */
export const MAX_RUNS = 200

export const DEFAULT_PRACTICE: PracticeSettings = {
  speed: 1,
  semitones: 0,
  volume: 1,
  loopStart: null,
  loopEnd: null,
  loopEnabled: false,
  countInBars: 0,
  bpm: 120,
  beatsPerBar: 4,
}

const ASSET_PREFIX = 'media:'

export function isMediaAssetId(id: string): boolean {
  return id.startsWith(ASSET_PREFIX)
}

export function mediaAssetId(id: string): string {
  return ASSET_PREFIX + id
}

function normalize(row: Partial<MediaItem> & { id: string }): MediaItem {
  return {
    id: row.id,
    kind: row.kind === 'score' ? 'score' : 'audio',
    name: row.name ?? 'Untitled',
    artist: row.artist ?? '',
    fileName: row.fileName ?? '',
    mime: row.mime ?? '',
    size: row.size ?? 0,
    addedAt: row.addedAt ?? 0,
    duration: row.duration ?? 0,
    peaks: Array.isArray(row.peaks) ? row.peaks : [],
    practice: { ...DEFAULT_PRACTICE, ...(row.practice ?? {}) },
    markers: Array.isArray(row.markers) ? row.markers : [],
    sync: row.sync && typeof row.sync.audioId === 'string' ? row.sync : null,
    resume: typeof row.resume === 'number' && row.resume > 0 ? row.resume : 0,
    view: row.view ?? null,
    runs: Array.isArray(row.runs) ? row.runs : [],
    tone: row.tone && typeof row.tone === 'object' ? row.tone : null,
  }
}

export async function listMedia(): Promise<MediaItem[]> {
  const rows = await kvGetAll<Partial<MediaItem> & { id: string }>(STORE_MEDIA)
  return rows
    .filter((r) => r && typeof r.id === 'string')
    .map(normalize)
    .sort((a, b) => b.addedAt - a.addedAt)
}

export async function saveMedia(item: MediaItem): Promise<void> {
  await kvPut(STORE_MEDIA, item)
}

export async function saveMediaFile(id: string, blob: Blob): Promise<void> {
  await putCachedAsset(mediaAssetId(id), blob)
}

export async function loadMediaFile(id: string): Promise<Blob | null> {
  return getCachedAsset(mediaAssetId(id))
}

export async function deleteMedia(id: string): Promise<void> {
  await deleteCachedAsset(mediaAssetId(id))
  await kvDelete(STORE_MEDIA, id)
}

export function newMediaId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return rand
}

/** "Artist - Title.mp3" -> { artist, name }; otherwise the bare file name. */
export function titleFromFileName(fileName: string): { name: string; artist: string } {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .trim()
  const dash = base.split(/\s+[-–]\s+/)
  if (dash.length >= 2) return { artist: dash[0]!.trim(), name: dash.slice(1).join(' - ').trim() }
  return { name: base || fileName, artist: '' }
}

export const SCORE_EXTENSIONS = [
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
  '.musicxml',
  '.xml',
  '.mxl',
  '.atex',
  '.tex',
  '.cap',
]

export function isScoreFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SCORE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
