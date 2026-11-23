// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { exporter, importer, model, Settings } from '@coderline/alphatab'

import {
  applyTuplet,
  clearTuplet,
  decomposeRests,
  makeRestAndMerge,
  normalizeBarRests,
  pasteKeepRhythm,
  quantizeBars,
  setDurationKeepRhythm,
  stepDurationKeepRhythm,
  toggleDotKeepRhythm,
} from './rhythm'
import { barFill, beatAt, setFret, startCursor } from './scoreEdit'
import { copyRange, rangeBeats } from './scoreOps'

const GTR = '\\tempo 120\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n'

function load(body: string) {
  const settings = new Settings()
  const imp = new importer.AlphaTexImporter()
  imp.initFromString(GTR + body, settings)
  return { score: imp.readScore(), settings }
}

function roundTrip(score: model.Score, settings: Settings) {
  const bytes = new exporter.Gp7Exporter().export(score, settings)
  return importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

function sig(score: model.Score, bar = 0) {
  return score.tracks[0]!.staves[0]!.bars[bar]!.voices[0]!.beats.map((b) => {
    const base = `${b.isRest ? 'r' : b.notes.map((n) => `${n.string}:${n.fret}`).join(',')}.${b.duration}${b.dots ? '.' : ''}`
    return b.tupletNumerator > 0 ? `${base}(${b.tupletNumerator}:${b.tupletDenominator})` : base
  })
}

describe('rhythm: decomposeRests', () => {
  it('produces metric-aware rests in 4/4, 3/4 and 6/8', () => {
    expect(decomposeRests(3840, 0, 3840, 960)).toEqual([
      { duration: model.Duration.Whole, dots: 0 },
    ])
    // Off-beat after an eighth note in 4/4: 8th + quarter + half.
    expect(decomposeRests(3360, 480, 3840, 960)).toEqual([
      { duration: model.Duration.Eighth, dots: 0 },
      { duration: model.Duration.Quarter, dots: 0 },
      { duration: model.Duration.Half, dots: 0 },
    ])
    // Beats 2 & 3 in 4/4 stay as two quarter rests instead of crossing the middle.
    expect(decomposeRests(1920, 960, 3840, 960)).toEqual([
      { duration: model.Duration.Quarter, dots: 0 },
      { duration: model.Duration.Quarter, dots: 0 },
    ])
    // Empty 3/4 bar uses dotted half rest; 6/8 uses dotted quarter rests per beat.
    expect(decomposeRests(2880, 0, 2880, 960)).toEqual([{ duration: model.Duration.Half, dots: 1 }])
    expect(decomposeRests(1440, 1440, 2880, 1440)).toEqual([
      { duration: model.Duration.Quarter, dots: 1 },
    ])
  })
})

describe('rhythm: keep rhythm on overwrite and rest merging', () => {
  it('splits trailing rests when shortening and merges rests when lengthening', () => {
    const { score, settings } = load('r.1')
    let c = startCursor()
    c = setDurationKeepRhythm(score, c, model.Duration.Quarter, settings)
    expect(sig(score, 0)).toEqual(['r.4', 'r.4', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    setFret(score, c, 5, settings)
    // Shorten beat 1 (quarter -> eighth) splits an eighth rest before the remaining rests.
    c = stepDurationKeepRhythm(score, c, 1, settings)
    expect(sig(score, 0)).toEqual(['1:5.8', 'r.8', 'r.4', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    // Lengthen beat 1 back to quarter absorbs the eighth rest.
    c = stepDurationKeepRhythm(score, c, -1, settings)
    expect(sig(score, 0)).toEqual(['1:5.4', 'r.4', 'r.2'])

    // Dotted quarter absorbs the following quarter and leaves an eighth rest before the half.
    c = toggleDotKeepRhythm(score, c, settings)
    expect(sig(score, 0)).toEqual(['1:5.4.', 'r.8', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    // Clearing the note merges all rests back into a single whole rest.
    c = makeRestAndMerge(score, c, settings)
    expect(sig(score, 0)).toEqual(['r.1'])

    const back = roundTrip(score, settings)
    expect(sig(back, 0)).toEqual(['r.1'])
  })

  it('normalizes underfilled bars and keeps bar rhythm on paste', () => {
    const { score, settings } = load('3.6.8 5.6.8 | 7.6.4 8.6.4 9.6.4 10.6.4')
    let c = startCursor()
    c = normalizeBarRests(score, c, settings)
    expect(sig(score, 0)).toEqual(['1:3.8', '1:5.8', 'r.4', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    const clip = copyRange(
      score,
      c,
      rangeBeats(score, c, { bar: 0, beat: 0 }, { bar: 0, beat: 1 }),
    )!
    const next = pasteKeepRhythm(score, { ...c, bar: 1, beat: 0 }, clip, settings)
    expect(sig(score, 1)).toEqual(['1:3.8', '1:5.8', '1:8.4', '1:9.4', '1:10.4'])
    expect(barFill(score, next)).toEqual({ used: 3840, capacity: 3840 })
  })
})

describe('rhythm: tuplet editor & bar quantize', () => {
  it('builds complete tuplet groups and toggles them off cleanly across GP7 round-trip', () => {
    const { score, settings } = load('r.1 | r.1')
    let c = startCursor()
    c = setDurationKeepRhythm(score, c, model.Duration.Eighth, settings)
    setFret(score, c, 5, settings)
    // Applying 3:2 on an eighth builds a complete 3-note triplet consuming 1 quarter beat.
    c = applyTuplet(score, c, [{ bar: 0, beat: 0 }], 3, 2, true, settings)
    expect(sig(score, 0)).toEqual(['1:5.8(3:2)', 'r.8(3:2)', 'r.8(3:2)', 'r.4', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    // Clear the triplet back to straight rhythm.
    c = clearTuplet(score, c, true, settings)
    expect(sig(score, 0)).toEqual(['1:5.8', 'r.8', 'r.4', 'r.2'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    // 5:4 sixteenth quintuplet in bar 1.
    let c1 = { ...c, bar: 1, beat: 0 }
    c1 = setDurationKeepRhythm(score, c1, model.Duration.Sixteenth, settings)
    setFret(score, c1, 7, settings)
    c1 = applyTuplet(score, c1, [{ bar: 1, beat: 0 }], 5, 4, true, settings)
    expect(sig(score, 1).slice(0, 5)).toEqual([
      '1:7.16(5:4)',
      'r.16(5:4)',
      'r.16(5:4)',
      'r.16(5:4)',
      'r.16(5:4)',
    ])
    expect(barFill(score, c1)).toEqual({ used: 3840, capacity: 3840 })

    const back = roundTrip(score, settings)
    expect(beatAt(back, { ...c1, bar: 1, beat: 0 })!.tupletNumerator).toBe(5)
    expect(beatAt(back, { ...c1, bar: 1, beat: 0 })!.tupletDenominator).toBe(4)
  })

  it('toggles tuplets over a multi-beat selection', () => {
    const { score, settings } = load('3.6.8 5.6.8 7.6.8')
    const c = startCursor()
    const refs = [
      { bar: 0, beat: 0 },
      { bar: 0, beat: 1 },
      { bar: 0, beat: 2 },
    ]
    applyTuplet(score, c, refs, 3, 2, true, settings)
    expect(sig(score, 0).slice(0, 3)).toEqual(['1:3.8(3:2)', '1:5.8(3:2)', '1:7.8(3:2)'])
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })
  })

  it('quantizes bars onto straight and triplet grids', () => {
    const { score, settings } = load('3.6.16 5.6.8 7.6.16 8.6.4')
    const c = startCursor()
    quantizeBars(score, c, 0, 0, '1/8', settings)
    expect(barFill(score, c)).toEqual({ used: 3840, capacity: 3840 })

    const { score: tripScore, settings: s2 } = load('3.6.8 5.6.8 7.6.8')
    applyTuplet(
      tripScore,
      startCursor(),
      [
        { bar: 0, beat: 0 },
        { bar: 0, beat: 1 },
        { bar: 0, beat: 2 },
      ],
      3,
      2,
      true,
      s2,
    )
    quantizeBars(tripScore, startCursor(), 0, 0, '1/8T', s2)
    expect(barFill(tripScore, startCursor())).toEqual({ used: 3840, capacity: 3840 })
    expect(sig(tripScore, 0).slice(0, 3)).toEqual(['1:3.8(3:2)', '1:5.8(3:2)', '1:7.8(3:2)'])
  })
})
