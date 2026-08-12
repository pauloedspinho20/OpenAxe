import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDualChainStore } from '../state/dualChainStore'
import { bindDualChainRig, type DualChainRigControls } from './bindDualChainRig'

function createMockRig(): {
  [K in keyof DualChainRigControls]: ReturnType<typeof vi.fn<DualChainRigControls[K]>>
} {
  return {
    setLevel: vi.fn(),
    setPan: vi.fn(),
    setEffectivelyMuted: vi.fn(),
    setMasterLevel: vi.fn(),
  }
}

describe('bindDualChainRig', () => {
  beforeEach(() => {
    useDualChainStore.setState({
      chainA: { level: 1, pan: -1, mute: false, solo: false },
      chainB: { level: 1, pan: 1, mute: false, solo: false },
      masterLevel: 1,
      linked: false,
    })
  })

  it('applies the current state immediately on bind', () => {
    const rig = createMockRig()
    bindDualChainRig(useDualChainStore, rig)

    expect(rig.setLevel).toHaveBeenCalledWith('A', 1)
    expect(rig.setPan).toHaveBeenCalledWith('A', -1)
    expect(rig.setPan).toHaveBeenCalledWith('B', 1)
    expect(rig.setMasterLevel).toHaveBeenCalledWith(1)
  })

  it('re-applies on every store change', () => {
    const rig = createMockRig()
    bindDualChainRig(useDualChainStore, rig)
    rig.setLevel.mockClear()

    useDualChainStore.getState().setLevel('B', 0.4)

    expect(rig.setLevel).toHaveBeenCalledWith('B', 0.4)
  })

  it('translates solo on one chain into an effective mute on the other', () => {
    const rig = createMockRig()
    bindDualChainRig(useDualChainStore, rig)
    rig.setEffectivelyMuted.mockClear()

    useDualChainStore.getState().setSolo('A', true)

    expect(rig.setEffectivelyMuted).toHaveBeenCalledWith('A', false)
    expect(rig.setEffectivelyMuted).toHaveBeenCalledWith('B', true)
  })

  it('stops applying updates once unbound', () => {
    const rig = createMockRig()
    const unbind = bindDualChainRig(useDualChainStore, rig)
    unbind()
    rig.setLevel.mockClear()

    useDualChainStore.getState().setLevel('A', 0.2)

    expect(rig.setLevel).not.toHaveBeenCalled()
  })
})
