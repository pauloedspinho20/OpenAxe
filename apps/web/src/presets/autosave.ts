/**
 * Debounced autosave: coalesces rapid changes (e.g. dragging a knob) into
 * one save after things settle, rather than saving on every single change.
 * Not wired to anything by default - the UI/UX epic calls schedule() from
 * wherever state changes happen.
 */
export interface AutosaveScheduler<T> {
  /** Debounce a save of `value`; resets the timer if called again before it fires. */
  schedule(value: T): void
  /** Cancel a pending save without running it. */
  cancel(): void
  /** Cancel any pending save and save `value` immediately. */
  flush(value: T): void
}

export function createAutosaveScheduler<T>(
  save: (value: T) => void | Promise<void>,
  delayMs = 1000,
): AutosaveScheduler<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return {
    schedule(value) {
      cancel()
      timeoutId = setTimeout(() => {
        timeoutId = null
        void save(value)
      }, delayMs)
    },
    cancel,
    flush(value) {
      cancel()
      void save(value)
    },
  }
}
