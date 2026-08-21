// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useTone3000Browser } from './browserStore'
import type { Gear, Tone3000Slot } from './types'

describe('tone3000/browserStore', () => {
  beforeEach(() => {
    useTone3000Browser.setState({ open: false, target: null })
  })

  it('starts closed with no target', () => {
    expect(useTone3000Browser.getState().open).toBe(false)
    expect(useTone3000Browser.getState().target).toBeNull()
  })

  it('opens with the supplied target', () => {
    const target = { blockId: 'b1', slot: 'model' as Tone3000Slot, gear: 'model' as Gear }
    useTone3000Browser.getState().openBrowser(target)
    expect(useTone3000Browser.getState().open).toBe(true)
    expect(useTone3000Browser.getState().target).toEqual(target)
  })

  it('closes and clears the target', () => {
    useTone3000Browser.getState().openBrowser({
      blockId: 'b1',
      slot: 'ir',
      gear: 'ir',
    })
    useTone3000Browser.getState().closeBrowser()
    expect(useTone3000Browser.getState().open).toBe(false)
    expect(useTone3000Browser.getState().target).toBeNull()
  })
})
