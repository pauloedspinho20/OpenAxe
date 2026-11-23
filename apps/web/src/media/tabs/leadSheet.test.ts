// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { importer, Settings } from '@coderline/alphatab'

import { buildLeadSheet, joinSyllables, transposeChord } from './leadSheet'

describe('lead sheet', () => {
  it('transposes chord names', () => {
    expect(transposeChord('Am7', 2)).toBe('Bm7')
    expect(transposeChord('F#m', 1)).toBe('Gm')
    expect(transposeChord('C/G', -1)).toBe('B/F#')
    expect(transposeChord('Bbmaj7', 2)).toBe('Cmaj7')
    expect(transposeChord('Eb', 1)).toBe('E')
    expect(transposeChord('Dsus4', 0)).toBe('Dsus4')
    expect(transposeChord('N.C.', 3)).toBe('N.C.')
  })

  it('joins syllables', () => {
    expect(joinSyllables(['Hel-', 'lo', 'world'])).toBe('Hello world')
    expect(joinSyllables([])).toBe('')
  })

  it('builds sections of bars with chords and repeats', () => {
    const settings = new Settings()
    const imp = new importer.AlphaTexImporter()
    imp.initFromString(
      '\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n' +
        '\\section "Verse" \\ro 0.5.2 {ch "Am"} 0.4.2 {ch "C"} | \\rc 2 3.6.1 {ch "G"} | \\section "Chorus" 0.4.1 {ch "D"}',
      settings,
    )
    const sheet = buildLeadSheet(imp.readScore())
    expect(sheet.map((s) => s.label)).toEqual(['Verse', 'Chorus'])
    expect(sheet[0]!.bars[0]!.chords).toEqual([
      { name: 'Am', at: 0 },
      { name: 'C', at: 0.5 },
    ])
    expect(sheet[0]!.bars[0]!.repeatStart).toBe(true)
    expect(sheet[0]!.bars[1]!.repeatEnd).toBe(2)
    expect(sheet[1]!.bars[0]!.chords[0]!.name).toBe('D')
  })
})
