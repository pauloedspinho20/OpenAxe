// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { LazyUndoStack, UndoStack } from './undoStack'

describe('UndoStack', () => {
  it('starts with the initial value and nothing to undo/redo', () => {
    const stack = new UndoStack('a')
    expect(stack.value).toBe('a')
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
  })

  it('undo steps back to the previous value', () => {
    const stack = new UndoStack('a')
    stack.push('b')
    stack.push('c')

    expect(stack.undo()).toBe('b')
    expect(stack.value).toBe('b')
  })

  it('redo steps forward after an undo', () => {
    const stack = new UndoStack('a')
    stack.push('b')
    stack.undo()

    expect(stack.redo()).toBe('b')
    expect(stack.canRedo()).toBe(false)
  })

  it('undo returns null and leaves the value unchanged when there is nothing to undo', () => {
    const stack = new UndoStack('a')
    expect(stack.undo()).toBeNull()
    expect(stack.value).toBe('a')
  })

  it('redo returns null when there is nothing to redo', () => {
    const stack = new UndoStack('a')
    expect(stack.redo()).toBeNull()
  })

  it('pushing a new value after an undo discards the redo history', () => {
    const stack = new UndoStack('a')
    stack.push('b')
    stack.push('c')
    stack.undo() // back to 'b', 'c' is redoable

    stack.push('d')

    expect(stack.canRedo()).toBe(false)
    expect(stack.redo()).toBeNull()
    expect(stack.value).toBe('d')
  })

  it('caps history at maxHistory, dropping the oldest entries', () => {
    const stack = new UndoStack(0, 2)
    stack.push(1)
    stack.push(2)
    stack.push(3) // history should now only remember [1, 2] as past, 0 dropped

    expect(stack.undo()).toBe(2)
    expect(stack.undo()).toBe(1)
    expect(stack.undo()).toBeNull() // 0 was evicted
  })
})

describe('LazyUndoStack', () => {
  it('starts empty with zero counts', () => {
    const stack = new LazyUndoStack<string>()
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
    expect(stack.undoCount).toBe(0)
    expect(stack.redoCount).toBe(0)
  })

  it('does not call captureCurrent when undo or redo stack is empty', () => {
    const stack = new LazyUndoStack<string>()
    const capture = vi.fn(() => 'current')
    expect(stack.undo(capture)).toBeNull()
    expect(stack.redo(capture)).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })

  it('roundtrips recordBefore -> undo -> redo lazily', () => {
    const stack = new LazyUndoStack<string>()
    let doc = 'v0'
    stack.recordBefore(doc)
    doc = 'v1'

    expect(stack.canUndo()).toBe(true)
    expect(stack.undoCount).toBe(1)

    const prev = stack.undo(() => doc)
    expect(prev).toBe('v0')
    doc = prev!
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(true)
    expect(stack.redoCount).toBe(1)

    const next = stack.redo(() => doc)
    expect(next).toBe('v1')
    expect(stack.canUndo()).toBe(true)
    expect(stack.canRedo()).toBe(false)
  })

  it('recordBefore discards redo history', () => {
    const stack = new LazyUndoStack<string>()
    stack.recordBefore('v0')
    stack.undo(() => 'v1')
    expect(stack.canRedo()).toBe(true)

    stack.recordBefore('v0b')
    expect(stack.canRedo()).toBe(false)
    expect(stack.redoCount).toBe(0)
    expect(stack.redo(() => 'v2')).toBeNull()
  })

  it('evicts the oldest entries past maxHistory', () => {
    const stack = new LazyUndoStack<number>(2)
    stack.recordBefore(0)
    stack.recordBefore(1)
    stack.recordBefore(2)

    expect(stack.undoCount).toBe(2)
    expect(stack.undo(() => 3)).toBe(2)
    expect(stack.undo(() => 2)).toBe(1)
    expect(stack.undo(() => 1)).toBeNull()
  })

  it('clear drops both past and future entries', () => {
    const stack = new LazyUndoStack<string>()
    stack.recordBefore('v0')
    stack.recordBefore('v1')
    stack.undo(() => 'v2')

    stack.clear()
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
    expect(stack.undoCount).toBe(0)
    expect(stack.redoCount).toBe(0)
  })
})
