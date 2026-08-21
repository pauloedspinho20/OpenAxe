// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useMidiManager } from './midiManager'

describe('state/midiManager', () => {
  beforeEach(() => {
    useMidiManager.setState({ open: false })
  })

  it('starts closed', () => {
    expect(useMidiManager.getState().open).toBe(false)
  })

  it('opens the manager', () => {
    useMidiManager.getState().openManager()
    expect(useMidiManager.getState().open).toBe(true)
  })

  it('closes the manager', () => {
    useMidiManager.getState().openManager()
    useMidiManager.getState().closeManager()
    expect(useMidiManager.getState().open).toBe(false)
  })
})
