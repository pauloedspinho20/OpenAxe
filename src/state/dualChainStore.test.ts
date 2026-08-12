import { beforeEach, describe, expect, it } from 'vitest'
import { useDualChainStore } from './dualChainStore'

const reset = () => {
  useDualChainStore.setState({
    chainA: { level: 1, pan: -1, mute: false, solo: false },
    chainB: { level: 1, pan: 1, mute: false, solo: false },
    masterLevel: 1,
    linked: false,
  })
}

describe('dualChainStore', () => {
  beforeEach(reset)

  it('defaults to hard-panned stereo with both chains at unity level', () => {
    const state = useDualChainStore.getState()
    expect(state.chainA.pan).toBe(-1)
    expect(state.chainB.pan).toBe(1)
    expect(state.chainA.level).toBe(1)
    expect(state.chainB.level).toBe(1)
  })

  it('sets a single chain level without touching the other when not linked', () => {
    useDualChainStore.getState().setLevel('A', 0.5)
    const state = useDualChainStore.getState()
    expect(state.chainA.level).toBe(0.5)
    expect(state.chainB.level).toBe(1)
  })

  it('clamps level to [0, 1.5]', () => {
    useDualChainStore.getState().setLevel('A', 99)
    expect(useDualChainStore.getState().chainA.level).toBe(1.5)
    useDualChainStore.getState().setLevel('A', -5)
    expect(useDualChainStore.getState().chainA.level).toBe(0)
  })

  it('clamps pan to [-1, 1]', () => {
    useDualChainStore.getState().setPan('A', -5)
    expect(useDualChainStore.getState().chainA.pan).toBe(-1)
  })

  it('setLinked sets the exact value, unlike toggleLinked', () => {
    useDualChainStore.getState().setLinked(true)
    expect(useDualChainStore.getState().linked).toBe(true)
    useDualChainStore.getState().setLinked(true)
    expect(useDualChainStore.getState().linked).toBe(true)
    useDualChainStore.getState().setLinked(false)
    expect(useDualChainStore.getState().linked).toBe(false)
  })

  it('mirrors level identically to both chains when linked', () => {
    useDualChainStore.getState().toggleLinked()
    useDualChainStore.getState().setLevel('A', 0.3)
    const state = useDualChainStore.getState()
    expect(state.chainA.level).toBe(0.3)
    expect(state.chainB.level).toBe(0.3)
  })

  it('mirrors pan symmetrically (opposite sign) when linked', () => {
    useDualChainStore.getState().toggleLinked()
    useDualChainStore.getState().setPan('A', -0.4)
    const state = useDualChainStore.getState()
    expect(state.chainA.pan).toBe(-0.4)
    expect(state.chainB.pan).toBe(0.4)
  })

  it('mirrors mute identically when linked', () => {
    useDualChainStore.getState().toggleLinked()
    useDualChainStore.getState().setMute('A', true)
    const state = useDualChainStore.getState()
    expect(state.chainA.mute).toBe(true)
    expect(state.chainB.mute).toBe(true)
  })

  it('never mirrors solo, even when linked', () => {
    useDualChainStore.getState().toggleLinked()
    useDualChainStore.getState().setSolo('A', true)
    const state = useDualChainStore.getState()
    expect(state.chainA.solo).toBe(true)
    expect(state.chainB.solo).toBe(false)
  })

  it('a plain mute makes only that chain effectively muted', () => {
    useDualChainStore.getState().setMute('A', true)
    expect(useDualChainStore.getState().isEffectivelyMuted('A')).toBe(true)
    expect(useDualChainStore.getState().isEffectivelyMuted('B')).toBe(false)
  })

  it('soloing one chain effectively mutes the other, even though its own mute flag is false', () => {
    useDualChainStore.getState().setSolo('A', true)
    const state = useDualChainStore.getState()
    expect(state.isEffectivelyMuted('A')).toBe(false)
    expect(state.isEffectivelyMuted('B')).toBe(true)
    expect(state.chainB.mute).toBe(false)
  })

  it('soloing both chains cancels the muting effect out', () => {
    useDualChainStore.getState().setSolo('A', true)
    useDualChainStore.getState().setSolo('B', true)
    expect(useDualChainStore.getState().isEffectivelyMuted('A')).toBe(false)
    expect(useDualChainStore.getState().isEffectivelyMuted('B')).toBe(false)
  })
})
