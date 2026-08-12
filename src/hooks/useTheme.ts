import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'nam-web-studio:theme'

function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

/**
 * Two hardware finishes ("Carbon"/dark, "Aluminum"/light), not a website's
 * light/dark mode - persisted explicitly rather than following
 * prefers-color-scheme, since a physical device doesn't relight itself for
 * the OS's setting. Applies via a `data-theme` attribute on <html> (see
 * index.css) so plain CSS handles the actual re-theming.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggleTheme }
}
