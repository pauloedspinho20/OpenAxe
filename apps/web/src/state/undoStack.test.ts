// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { UndoStack } from './undoStack'

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
