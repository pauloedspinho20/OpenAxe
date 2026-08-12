import { create } from 'zustand'

interface ToastState {
  message: string | null
  show: (message: string) => void
  clear: () => void
}

/** A single transient status line (e.g. "moving X dropped 2 connections") - not a queue, latest wins. */
export const useToast = create<ToastState>()((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}))

/** Show a message for `durationMs`, then clear it (unless something else already replaced it). */
export function showToast(message: string, durationMs = 2500): void {
  useToast.getState().show(message)
  setTimeout(() => {
    if (useToast.getState().message === message) useToast.getState().clear()
  }, durationMs)
}
