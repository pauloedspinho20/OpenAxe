import { useCallback, useState } from 'react'

const STORAGE_KEY = 'nam-web-studio:factory-onboarding-dismissed'

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(STORAGE_KEY) === '1'
}

/**
 * Tracks whether the factory-pack first-run modal has been dismissed —
 * same pattern as useOnboarding, but separate key so the two modals are
 * independent.
 */
export function useFactoryOnboarding() {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed)

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setDismissed(false)
  }, [])

  return { open: !dismissed, dismiss, reset }
}
