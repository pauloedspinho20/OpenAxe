import { useCallback, useState } from 'react'

const STORAGE_KEY = 'openaxe:onboarding-dismissed'

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(STORAGE_KEY) === '1'
}

/**
 * Tracks whether the first-run walkthrough has been seen - persisted so it
 * only ever shows once per browser, same pattern as useTheme.
 */
export function useOnboarding() {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed)

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }, [])

  return { open: !dismissed, dismiss }
}
