import { useSyncExternalStore } from 'react'

/** Subscribe safely to `window.matchMedia(query)` without effect-time setState. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
      return window.matchMedia(query).matches
    },
    () => false,
  )
}

/** Narrow viewport breakpoint (tablet/mobile, matches --mw-lg = 920px). */
export function useNarrowViewport(query = '(max-width: 920px)'): boolean {
  return useMediaQuery(query)
}
