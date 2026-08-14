// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaveScheduler } from './autosave'

describe('createAutosaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves after the delay elapses', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save, 1000)

    scheduler.schedule('a')
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledWith('a')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('debounces: rapid schedule() calls only save the latest value once', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save, 1000)

    scheduler.schedule('a')
    vi.advanceTimersByTime(500)
    scheduler.schedule('b')
    vi.advanceTimersByTime(500)
    expect(save).not.toHaveBeenCalled() // first timer was reset, not yet 1000ms since 'b'

    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('b')
  })

  it('cancel() prevents a pending save from running', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save, 1000)

    scheduler.schedule('a')
    scheduler.cancel()
    vi.advanceTimersByTime(1000)

    expect(save).not.toHaveBeenCalled()
  })

  it('flush() saves immediately and cancels the pending timer', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save, 1000)

    scheduler.schedule('a')
    scheduler.flush('b')
    expect(save).toHaveBeenCalledWith('b')
    expect(save).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1) // the original scheduled 'a' save never fires
  })
})
