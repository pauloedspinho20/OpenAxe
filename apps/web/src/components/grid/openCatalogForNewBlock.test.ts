// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useTone3000Browser } from '../../tone3000/browserStore'
import { openCatalogForNewBlock } from './openCatalogForNewBlock'

describe('openCatalogForNewBlock', () => {
  beforeEach(() => {
    useTone3000Browser.setState({ open: false, target: null })
  })

  it('opens the catalog for a cab with the ir slot', () => {
    openCatalogForNewBlock('block-1', 'cab')
    const s = useTone3000Browser.getState()
    expect(s.open).toBe(true)
    expect(s.target).toEqual({ blockId: 'block-1', slot: 'ir', gear: 'cab' })
  })

  it('opens the catalog for a NAM model kind with the model slot', () => {
    openCatalogForNewBlock('block-2', 'amp')
    const s = useTone3000Browser.getState()
    expect(s.open).toBe(true)
    expect(s.target).toEqual({ blockId: 'block-2', slot: 'model', gear: 'amp' })
  })

  it('opens for every NAM model kind, not just amp', () => {
    for (const kind of ['amp', 'amp-cab', 'pedal', 'outboard', 'space'] as const) {
      useTone3000Browser.setState({ open: false, target: null })
      openCatalogForNewBlock('b', kind)
      expect(useTone3000Browser.getState().target?.slot).toBe('model')
    }
  })

  it('is a no-op for a kind with no asset to load (mixer)', () => {
    openCatalogForNewBlock('block-3', 'mixer')
    const s = useTone3000Browser.getState()
    expect(s.open).toBe(false)
    expect(s.target).toBeNull()
  })

  it('is a no-op for effects without models (e.g. reverb)', () => {
    openCatalogForNewBlock('block-4', 'reverb')
    expect(useTone3000Browser.getState().open).toBe(false)
  })
})
