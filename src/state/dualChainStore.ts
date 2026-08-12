import { create } from 'zustand'
import type { ChainId } from '../engine/DualChainRig'

export type { ChainId } from '../engine/DualChainRig'

export interface ChainStripState {
  /** Linear gain, 0..1.5 (allows a bit of headroom above unity). */
  level: number
  /** -1 (hard left) .. 1 (hard right). */
  pan: number
  mute: boolean
  solo: boolean
}

export interface DualChainState {
  chainA: ChainStripState
  chainB: ChainStripState
  masterLevel: number
  /**
   * When true, level/mute changes apply to both chains identically, and pan
   * changes apply symmetrically (moving one chain's pan moves the other the
   * same distance in the opposite direction) so the stereo width stays
   * centered. Solo is never linked - soloing is inherently "listen to just
   * this one".
   */
  linked: boolean
  setLevel: (chain: ChainId, level: number) => void
  setPan: (chain: ChainId, pan: number) => void
  setMute: (chain: ChainId, mute: boolean) => void
  setSolo: (chain: ChainId, solo: boolean) => void
  setMasterLevel: (level: number) => void
  toggleLinked: () => void
  setLinked: (linked: boolean) => void
  /** True if this chain is silent given its own mute plus the other's solo. */
  isEffectivelyMuted: (chain: ChainId) => boolean
}

const other = (chain: ChainId): ChainId => (chain === 'A' ? 'B' : 'A')

const clampLevel = (value: number) => Math.min(1.5, Math.max(0, value))
const clampPan = (value: number) => Math.min(1, Math.max(-1, value))

const defaultStrip = (pan: number): ChainStripState => ({
  level: 1,
  pan,
  mute: false,
  solo: false,
})

export const useDualChainStore = create<DualChainState>()((set, get) => ({
  // Hard-panned left/right by default: two independently-modeled amp chains
  // mixed to stereo is the whole point of the dual-chain rig.
  chainA: defaultStrip(-1),
  chainB: defaultStrip(1),
  masterLevel: 1,
  linked: false,

  setLevel: (chain, level) => {
    const clamped = clampLevel(level)
    set((state) => {
      const next = { ...state, [`chain${chain}`]: { ...state[`chain${chain}`], level: clamped } }
      if (state.linked) {
        const otherChain = other(chain)
        next[`chain${otherChain}`] = { ...state[`chain${otherChain}`], level: clamped }
      }
      return next
    })
  },

  setPan: (chain, pan) => {
    const clamped = clampPan(pan)
    set((state) => {
      const next = { ...state, [`chain${chain}`]: { ...state[`chain${chain}`], pan: clamped } }
      if (state.linked) {
        const otherChain = other(chain)
        next[`chain${otherChain}`] = { ...state[`chain${otherChain}`], pan: -clamped }
      }
      return next
    })
  },

  setMute: (chain, mute) => {
    set((state) => {
      const next = { ...state, [`chain${chain}`]: { ...state[`chain${chain}`], mute } }
      if (state.linked) {
        const otherChain = other(chain)
        next[`chain${otherChain}`] = { ...state[`chain${otherChain}`], mute }
      }
      return next
    })
  },

  setSolo: (chain, solo) => {
    set((state) => ({ [`chain${chain}`]: { ...state[`chain${chain}`], solo } }))
  },

  setMasterLevel: (level) => set({ masterLevel: clampLevel(level) }),

  toggleLinked: () => set((state) => ({ linked: !state.linked })),

  setLinked: (linked) => set({ linked }),

  isEffectivelyMuted: (chain) => {
    const state = get()
    const strip = chain === 'A' ? state.chainA : state.chainB
    const otherStrip = chain === 'A' ? state.chainB : state.chainA
    const someChainSoloed = strip.solo || otherStrip.solo
    return strip.mute || (someChainSoloed && !strip.solo)
  },
}))
