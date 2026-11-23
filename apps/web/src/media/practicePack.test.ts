import { describe, expect, it } from 'vitest'

import { DEFAULT_PRACTICE, type MediaItem } from './mediaDb'
import { buildPack, packItem, parsePack } from './practicePack'

const item = (p: Partial<MediaItem>): MediaItem => ({
  id: 'id-1',
  kind: 'score',
  name: 'Song',
  artist: 'Band',
  fileName: 'song.gp',
  mime: 'application/octet-stream',
  size: 3,
  addedAt: 1,
  duration: 0,
  peaks: [],
  practice: { ...DEFAULT_PRACTICE, speed: 0.8, loopStart: 2, loopEnd: 6, loopEnabled: true },
  markers: [{ id: 'm', label: 'Solo', time: 30 }],
  ...p,
})

describe('practice packs', () => {
  it('keeps the practice set-up, not personal history', () => {
    const p = packItem(
      item({
        favorite: true,
        status: 'learning',
        runs: [],
        resume: 12,
        barNotes: { 3: 'mute' },
        sync: { audioId: 'rec', points: [{ score: 0, audio: 1.5 }] },
      }),
    )
    expect(p.practice.speed).toBe(0.8)
    expect(p.barNotes).toEqual({ 3: 'mute' })
    expect(p.sync?.points).toHaveLength(1)
    expect(p).not.toHaveProperty('id')
    expect(p).not.toHaveProperty('favorite')
    expect(p).not.toHaveProperty('resume')
    expect(p).not.toHaveProperty('runs')
  })

  it('round-trips files and the manifest', async () => {
    const tab = new Blob([new Uint8Array([1, 2, 3])])
    const rec = new Blob([new Uint8Array([9, 8, 7, 6, 5])], { type: 'audio/mpeg' })
    const pack = await buildPack(
      [
        { key: 'main', item: packItem(item({})), blob: tab },
        {
          key: 'recording',
          item: packItem(item({ kind: 'audio', mime: 'audio/mpeg' })),
          blob: rec,
        },
      ],
      { toneNames: ['Clean', 'Lead'], now: 42 },
    )
    const out = await parsePack(pack)
    expect(out.manifest.createdAt).toBe(42)
    expect(out.manifest.toneNames).toEqual(['Clean', 'Lead'])
    expect(out.files.map((f) => f.file.key)).toEqual(['main', 'recording'])
    expect([...new Uint8Array(await out.files[0]!.blob.arrayBuffer())]).toEqual([1, 2, 3])
    expect([...new Uint8Array(await out.files[1]!.blob.arrayBuffer())]).toEqual([9, 8, 7, 6, 5])
    expect(out.files[1]!.file.item.practice.loopEnd).toBe(6)
  })

  it('rejects other files and damaged packs', async () => {
    await expect(parsePack(new Blob(['hello world, not a pack']))).rejects.toThrow(
      /not a practice pack/,
    )
    const good = await buildPack([
      { key: 'main', item: packItem(item({})), blob: new Blob([new Uint8Array(100)]) },
    ])
    await expect(parsePack(good.slice(0, good.size - 10))).rejects.toThrow(/cut short/)
  })
})
