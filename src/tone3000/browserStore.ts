/**
 * Tone3000 feature is wired into the amp/cab "screens" of grid blocks. This
 * store tracks which block + slot an import is targeted at, so the modal
 * can decide how to present results (model vs IR) and where to route them
 * on import. Kept out of the app shell (#/route) state on purpose: it's a
 * transient UI concern.
 */
import { create } from 'zustand'
import type { Tone3000Slot } from './types'

export interface BrowserTarget {
  blockId: string
  slot: Tone3000Slot
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
