// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { importer, Settings } from '@coderline/alphatab'

import { routineSections, sectionDone } from './routine'

const load = (tex: string) => {
  const imp = new importer.AlphaTexImporter()
  imp.initFromString(tex, new Settings())
  return imp.readScore()
}

describe('section routine', () => {
  it('splits by section markers, adding an intro before the first', () => {
    const score = load(
      '\\track "G"\n\\staff {tabs}\nr.1 | \\section A Verse r.1 | r.1 | \\section B Chorus r.1 | r.1',
    )
    expect(routineSections(score)).toEqual([
      { from: 0, to: 0, label: 'Intro' },
      { from: 1, to: 2, label: 'A Verse' },
      { from: 3, to: 4, label: 'B Chorus' },
    ])
  })

  it('falls back to 4-bar chunks', () => {
    const score = load('\\track "G"\n\\staff {tabs}\n' + Array(10).fill('r.1').join(' | '))
    expect(routineSections(score).map((s) => [s.from, s.to])).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ])
  })

  it('finishes a section only on a clean pass at the target speed', () => {
    expect(sectionDone(0.95, 0.8, 1)).toBe(false)
    expect(sectionDone(0.85, 1, 1)).toBe(false)
    expect(sectionDone(0.9, 1, 1)).toBe(true)
  })
})
