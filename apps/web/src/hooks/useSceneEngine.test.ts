// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSceneEngine } from './useSceneEngine'
import { useSceneStore } from '../state/sceneStore'

const { setTarget, reloadActive } = vi.hoisted(() => ({
  setTarget: vi.fn(),
  reloadActive: vi.fn(),
}))

vi.mock('../scenes/sceneNavigator', () => ({
  SceneNavigator: { setTarget, reloadActive },
}))

function fakeRig() {
  return { id: 'rig' } as unknown as import('../engine/GraphRig').GraphRig
}
function fakeContext() {
  return { id: 'ctx' } as unknown as AudioContext
}

describe('hooks/useSceneEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSceneStore.setState({ hydrated: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the rig+context target when both are present', () => {
    const rig = fakeRig()
    const ctx = fakeContext()
    renderHook(() => useSceneEngine(rig, ctx, 'ready'))
    expect(setTarget).toHaveBeenCalledWith({ rig, context: ctx })
  })

  it('clears the target when rig or context is missing', () => {
    renderHook(() => useSceneEngine(null, null, 'ready'))
    expect(setTarget).toHaveBeenCalledWith(null)
  })

  it('restores the active scene once the engine is ready and hydrated', () => {
    renderHook(() => useSceneEngine(fakeRig(), fakeContext(), 'ready'))
    expect(reloadActive).toHaveBeenCalled()
  })

  it('does not restore until the engine is ready', () => {
    renderHook(() => useSceneEngine(fakeRig(), fakeContext(), 'starting'))
    expect(reloadActive).not.toHaveBeenCalled()
  })

  it('does not restore until the scene store is hydrated', () => {
    useSceneStore.setState({ hydrated: false })
    renderHook(() => useSceneEngine(fakeRig(), fakeContext(), 'ready'))
    expect(reloadActive).not.toHaveBeenCalled()
  })

  it('restores only once per AudioContext identity', () => {
    const rig = fakeRig()
    const ctx = fakeContext()
    const { rerender } = renderHook(({ status }) => useSceneEngine(rig, ctx, status), {
      initialProps: { status: 'ready' as const },
    })
    rerender({ status: 'ready' })
    expect(reloadActive).toHaveBeenCalledTimes(1)
  })

  it('clears the target on unmount', () => {
    const { unmount } = renderHook(() => useSceneEngine(fakeRig(), fakeContext(), 'ready'))
    unmount()
    expect(setTarget).toHaveBeenLastCalledWith(null)
  })
})
