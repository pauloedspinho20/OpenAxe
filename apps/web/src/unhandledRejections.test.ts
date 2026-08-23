import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@openaxe/ui'
import { installUnhandledRejectionHandler } from './unhandledRejections'

vi.mock('@openaxe/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openaxe/ui')>()),
  toast: { error: vi.fn() },
}))

// issue #50: an unhandled promise rejection used to fail silently (a console
// warning at best). Dispatching a real `unhandledrejection` event is the
// only way to exercise the actual browser-triggered path, rather than just
// calling the internal handler function directly.
describe('installUnhandledRejectionHandler', () => {
  let uninstall: () => void
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    uninstall = installUnhandledRejectionHandler()
  })

  afterEach(() => {
    uninstall()
    errorSpy.mockRestore()
    vi.clearAllMocks()
  })

  function dispatchRejection(reason: unknown) {
    const rejected = Promise.reject(reason)
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { promise: rejected, reason }),
    )
    rejected.catch(() => {}) // prevent this synthetic rejection itself from being unhandled
  }

  it('logs and toasts an Error rejection with its message', () => {
    dispatchRejection(new Error('graph rig create failed'))
    expect(errorSpy).toHaveBeenCalledWith(
      '[unhandledrejection]',
      expect.objectContaining({ message: 'graph rig create failed' }),
    )
    expect(toast.error).toHaveBeenCalledWith(
      'Unexpected error',
      expect.objectContaining({ description: 'graph rig create failed' }),
    )
  })

  it('stringifies a non-Error rejection reason', () => {
    dispatchRejection('boom')
    expect(toast.error).toHaveBeenCalledWith('Unexpected error', { description: 'boom' })
  })

  it('stops handling after uninstall', () => {
    uninstall()
    dispatchRejection(new Error('should be ignored'))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
