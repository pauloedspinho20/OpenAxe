import { describe, expect, it } from 'vitest'
import {
  buildDefaultGearEntries,
  defaultGearFor,
  displayNameFromPath,
  firstDefaultGearFor,
  gearFromPath,
  slugFromPath,
} from './defaultGear'

describe('gearFromPath', () => {
  it('infers each gear kind from its folder', () => {
    expect(gearFromPath('/src/assets/defaultGear/amp/x.nam')).toBe('amp')
    expect(gearFromPath('/src/assets/defaultGear/amp-cab/x.nam')).toBe('amp-cab')
    expect(gearFromPath('/src/assets/defaultGear/pedal/x.nam')).toBe('pedal')
    expect(gearFromPath('/src/assets/defaultGear/cab/x.wav')).toBe('cab')
  })

  it('throws for a path with no recognizable gear folder', () => {
    expect(() => gearFromPath('/src/assets/defaultGear/bogus/x.nam')).toThrow()
  })
})

describe('slugFromPath', () => {
  it('strips everything up to and including the gear folder, plus the extension', () => {
    expect(slugFromPath('/a/src/assets/defaultGear/amp/fender-twin-clean.nam', 'amp')).toBe(
      'fender-twin-clean',
    )
    expect(slugFromPath('/a/src/assets/defaultGear/cab/4x12-greenback.wav', 'cab')).toBe(
      '4x12-greenback',
    )
  })

  it('keeps a subfolder used to group variants of one physical unit, so two files with the same basename in different subfolders get distinct slugs', () => {
    expect(
      slugFromPath(
        '/a/src/assets/defaultGear/pedal/Ibanez TS9/Drive 7 Tone 7 Level 9.nam',
        'pedal',
      ),
    ).toBe('Ibanez TS9/Drive 7 Tone 7 Level 9')
    expect(
      slugFromPath('/a/src/assets/defaultGear/pedal/Boss DS-1/Drive 7 Tone 7 Level 9.nam', 'pedal'),
    ).toBe('Boss DS-1/Drive 7 Tone 7 Level 9')
  })
})

describe('displayNameFromPath', () => {
  it('turns dashes/underscores into spaces and title-cases', () => {
    expect(displayNameFromPath('/a/fender-twin_clean.nam')).toBe('Fender Twin Clean')
    expect(displayNameFromPath('/a/tube_screamer.nam')).toBe('Tube Screamer')
  })
})

describe('buildDefaultGearEntries', () => {
  it('builds a sorted, fully-populated entry per glob result', () => {
    const entries = buildDefaultGearEntries(
      {
        '/src/assets/defaultGear/amp/zebra-amp.nam': '/assets/zebra-amp.nam',
        '/src/assets/defaultGear/amp/apple-amp.nam': '/assets/apple-amp.nam',
      },
      'model',
    )
    expect(entries).toEqual([
      {
        id: 'default:amp:apple-amp',
        gear: 'amp',
        slot: 'model',
        name: 'Apple Amp',
        url: '/assets/apple-amp.nam',
      },
      {
        id: 'default:amp:zebra-amp',
        gear: 'amp',
        slot: 'model',
        name: 'Zebra Amp',
        url: '/assets/zebra-amp.nam',
      },
    ])
  })
})

describe('defaultGearFor / firstDefaultGearFor', () => {
  // Deliberately content-agnostic: apps/web/src/assets/defaultGear/*/ may be
  // empty (just a .gitkeep) or have real bundled files depending on what's
  // been added - both are valid states. The glob-discovery mechanism itself
  // (naming/slugging) is verified in buildDefaultGearEntries's tests above
  // using synthetic glob results, independent of what's actually on disk.
  it('only returns entries for the requested gear kind, and stays consistent with firstDefaultGearFor', () => {
    for (const gear of ['amp', 'amp-cab', 'pedal', 'cab'] as const) {
      const entries = defaultGearFor(gear)
      expect(entries.every((e) => e.gear === gear)).toBe(true)
      expect(firstDefaultGearFor(gear)).toEqual(entries[0])
    }
  })
})
