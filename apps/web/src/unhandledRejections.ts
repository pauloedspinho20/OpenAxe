import { toast } from '@openaxe/ui'

/**
 * A rejected promise with no .catch() anywhere in its chain fails silently -
 * a console warning at best, nothing a user ever sees (issue #50). This
 * can't fix the underlying bug, but it stops "async error = no signal at
 * all" the same way ErrorBoundary stops a render error from blanking the
 * page. Returns an unsubscribe function so tests (and, if ever needed, a
 * future caller) can remove the listener cleanly.
 */
export function installUnhandledRejectionHandler(target: Window = window): () => void {
  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown
    console.error('[unhandledrejection]', reason)
    const message = reason instanceof Error ? reason.message : String(reason)
    toast.error('Unexpected error', { description: message })
  }
  target.addEventListener('unhandledrejection', handleRejection)
  return () => target.removeEventListener('unhandledrejection', handleRejection)
}
