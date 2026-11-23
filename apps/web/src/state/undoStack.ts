/**
 * Generic undo/redo history. Not wired to any particular state shape - the
 * preset-editing UI (UI/UX epic) pushes a snapshot (e.g. a captured Preset)
 * on every meaningful change and calls undo()/redo() to step through them.
 */
export class UndoStack<T> {
  private past: T[] = []
  private future: T[] = []
  private current: T
  private readonly maxHistory: number

  constructor(initial: T, maxHistory = 50) {
    this.current = initial
    this.maxHistory = maxHistory
  }

  get value(): T {
    return this.current
  }

  /** Record a new state, clearing any redo history (the classic undo-tree-collapses-on-edit rule). */
  push(next: T): void {
    this.past.push(this.current)
    if (this.past.length > this.maxHistory) this.past.shift()
    this.current = next
    this.future = []
  }

  /** Step back one state, or return null if there's nothing to undo. */
  undo(): T | null {
    const previous = this.past.pop()
    if (previous === undefined) return null
    this.future.push(this.current)
    this.current = previous
    return this.current
  }

  /** Step forward one state, or return null if there's nothing to redo. */
  redo(): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(this.current)
    this.current = next
    return this.current
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }
}

/**
 * Lazy-snapshotting undo/redo history for mutable documents (such as alphaTab
 * `Score` instances) where capturing a full serialized snapshot is only done
 * right before an edit or when stepping undo/redo.
 */
export class LazyUndoStack<T> {
  private past: T[] = []
  private future: T[] = []
  private readonly maxHistory: number

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory
  }

  /** Record a pre-edit snapshot, clearing any redo history. */
  recordBefore(before: T): void {
    this.past.push(before)
    if (this.past.length > this.maxHistory) this.past.shift()
    this.future = []
  }

  /** Step back one snapshot, lazily capturing the current state for redo. */
  undo(captureCurrent: () => T): T | null {
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(captureCurrent())
    return prev
  }

  /** Step forward one snapshot, lazily capturing the current state for undo. */
  redo(captureCurrent: () => T): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(captureCurrent())
    if (this.past.length > this.maxHistory) this.past.shift()
    return next
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  get undoCount(): number {
    return this.past.length
  }

  get redoCount(): number {
    return this.future.length
  }
}
