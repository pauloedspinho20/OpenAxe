/**
 * Practice packs (issue #459): one file to share a song with everything set
 * up for practice - the tab or backing track, its paired recording and sync
 * points, loops, markers, bar notes and view - importable into another
 * library.
 *
 * Format (.oapack): the ASCII magic "OAPACK1\n", a 4-byte little-endian
 * manifest length, the manifest as UTF-8 JSON, then each file's bytes in
 * manifest order. No compression: audio and Guitar Pro files are already
 * compressed.
 */
import type { MediaItem } from './mediaDb'

export const PACK_EXTENSION = '.oapack'
const MAGIC = 'OAPACK1\n'

/** What a pack keeps of an item: the practice set-up, not the personal history. */
export type PackItem = Pick<
  MediaItem,
  'kind' | 'name' | 'artist' | 'fileName' | 'mime' | 'duration' | 'peaks' | 'practice' | 'markers'
> &
  Partial<Pick<MediaItem, 'sync' | 'view' | 'barNotes' | 'tags'>>

export interface PackFile {
  key: 'main' | 'recording'
  size: number
  item: PackItem
}

export interface PackManifest {
  format: 1
  createdAt: number
  app: string
  /** Names of the rig presets the song was linked to, for information (scene links aren't portable). */
  toneNames?: string[]
  files: PackFile[]
}

/** The shareable part of an item. Ids, play history, resume point, favourite and status stay home. */
export function packItem(item: MediaItem): PackItem {
  const out: PackItem = {
    kind: item.kind,
    name: item.name,
    artist: item.artist,
    fileName: item.fileName,
    mime: item.mime,
    duration: item.duration,
    peaks: item.peaks,
    practice: item.practice,
    markers: item.markers,
  }
  if (item.sync) out.sync = item.sync
  if (item.view) out.view = item.view
  if (item.barNotes && Object.keys(item.barNotes).length) out.barNotes = item.barNotes
  if (item.tags?.length) out.tags = item.tags
  return out
}

export async function buildPack(
  files: { key: PackFile['key']; item: PackItem; blob: Blob }[],
  extra: { toneNames?: string[]; now?: number } = {},
): Promise<Blob> {
  const manifest: PackManifest = {
    format: 1,
    createdAt: extra.now ?? Date.now(),
    app: 'OpenAxe',
    ...(extra.toneNames?.length ? { toneNames: extra.toneNames } : {}),
    files: files.map((f) => ({ key: f.key, size: f.blob.size, item: f.item })),
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const head = new Uint8Array(MAGIC.length + 4)
  head.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(head.buffer).setUint32(MAGIC.length, json.length, true)
  return new Blob([head, json, ...files.map((f) => f.blob)], {
    type: 'application/octet-stream',
  })
}

export interface ParsedPack {
  manifest: PackManifest
  files: { file: PackFile; blob: Blob }[]
}

/** Read a pack; throws a readable error for anything that isn't a valid one. */
export async function parsePack(data: Blob): Promise<ParsedPack> {
  const headLen = MAGIC.length + 4
  if (data.size < headLen) throw new Error('This is not a practice pack (file too short)')
  const head = new Uint8Array(await data.slice(0, headLen).arrayBuffer())
  if (new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC)
    throw new Error('This is not a practice pack')
  const jsonLen = new DataView(head.buffer).getUint32(MAGIC.length, true)
  if (headLen + jsonLen > data.size) throw new Error('The practice pack is damaged')
  let manifest: PackManifest
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(await data.slice(headLen, headLen + jsonLen).arrayBuffer()),
    ) as PackManifest
  } catch {
    throw new Error('The practice pack is damaged (unreadable contents list)')
  }
  if (manifest.format !== 1 || !Array.isArray(manifest.files))
    throw new Error('This practice pack was made by a newer version of the app')
  let at = headLen + jsonLen
  const files = manifest.files.map((file) => {
    if (typeof file.size !== 'number' || at + file.size > data.size)
      throw new Error('The practice pack is damaged (a file is cut short)')
    const blob = data.slice(at, at + file.size, file.item?.mime || 'application/octet-stream')
    at += file.size
    return { file, blob }
  })
  if (!files.some((f) => f.file.key === 'main'))
    throw new Error('The practice pack has no song in it')
  return { manifest, files }
}
