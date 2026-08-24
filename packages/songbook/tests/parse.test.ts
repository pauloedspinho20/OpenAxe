// @ts-ignore - node types are provided by root @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore
import { join, dirname } from 'node:path'
// @ts-ignore
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parseScore, extractTrackEvents } from '../src/index.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('songbook: parseScore', () => {
  it('parses MusicXML: title, tracks, bar count, tempo', async () => {
    const xml = readFileSync(join(fixturesDir, 'simple.musicxml'), 'utf8')
    const score = await parseScore(xml)
    expect(score.title).toBe('Simple Test')
    expect(score.tracks.length).toBe(1)
    expect(score.tracks[0].name).toBe('Guitar')
    expect(score.tracks[0].tuning).toEqual([40, 45, 50, 55, 59, 64])
    expect(score.barCount).toBe(4)
    expect(score.tempoMap[0].bpm).toBe(120)
    expect(score.ticksPerBeat).toBe(960)
    expect(score.durationTicks).toBe(4 * 4 * 960)
  })

  it('parses MIDI: tracks, tempo, duration', async () => {
    const bytes = readFileSync(join(fixturesDir, 'simple.mid'))
    const score = await parseScore(new Uint8Array(bytes))
    expect(score.tracks.length).toBeGreaterThanOrEqual(1)
    expect(score.tempoMap[0].bpm).toBeCloseTo(120, 0)
    expect(score.barCount).toBe(4)
    expect(score.ticksPerBeat).toBeGreaterThan(0)
  })

  it('parses GP fallback: generic 4 bars', async () => {
    const bytes = readFileSync(join(fixturesDir, 'simple.gp5'))
    const score = await parseScore(new Uint8Array(bytes), { filename: 'simple.gp5' })
    expect(score.barCount).toBe(4)
    expect(score.tracks.length).toBe(1)
    expect(score.tracks[0].tuning.length).toBe(6)
  })

  it('extractTrackEvents returns ordered noteOn/noteOff', async () => {
    const xml = readFileSync(join(fixturesDir, 'simple.musicxml'), 'utf8')
    const score = await parseScore(xml)
    const events = extractTrackEvents(score, [0])
    expect(events.length).toBeGreaterThan(0)
    // First event should be noteOn at tick 0
    expect(events[0].type).toBe('noteOn')
    expect(events[0].tick).toBe(0)
    // Events sorted by tick
    for (let i = 1; i < events.length; ++i) {
      expect(events[i].tick).toBeGreaterThanOrEqual(events[i - 1].tick)
    }
    // Should have equal noteOn/noteOff
    const ons = events.filter((e) => e.type === 'noteOn').length
    const offs = events.filter((e) => e.type === 'noteOff').length
    expect(ons).toBe(offs)
  })
})
