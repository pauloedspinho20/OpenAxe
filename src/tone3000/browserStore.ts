/**
 * Tone3000 feature is wired into the amp/cab "screens" of both channel
 * strips. This store tracks which chain + slot an import is targeted at, so
 * the modal can decide how to present results (model vs IR) and where to
 * route them on import. Kept out of the app shell (#/route) state on purpose:
 * it's a transient UI concern.
 */
import { create } from 'zustand'
import type { ChainId } from '../engine/DualChainRig'
import type { Tone3000Slot } from './types'

export interface BrowserTarget {
  chain: ChainId
  slot: Tone3000Slot
  /** Current name shown on the screen, if one is loaded (e.g. "NO MODEL LOADED"). */
}

export interface Tone3000BrowserState {
  open: boolean
  target: BrowserTarget | null
  openBrowser: (target: BrowserTarget) => void
  closeBrowser: () => void
}

export const useTone3000Browser = create<Tone3000BrowserState>()((set) => ({
  open: false,
  target: null,
  openBrowser: (target) => set({ open: true, target }),
  closeBrowser: () => set({ open: false, target: null }),
}))
