// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTone3000Target } from './useTone3000Target'
import type { GraphRig } from '../engine/GraphRig'
import type { BrowserTarget } from '../tone3000/browserStore'

function fakeRig(getBlock: (id: string) => unknown): GraphRig {
  return { getBlock } as unknown as GraphRig
}

const MODEL_TARGET: BrowserTarget = { blockId: 'b1', slot: 'model', gear: 'amp' }
const IR_TARGET: BrowserTarget = { blockId: 'b2', slot: 'ir', gear: 'cab' }

describe('useTone3000Target', () => {
  it('is null with no rig, no browser target, or an unknown block id', () => {
    expect(renderHook(() => useTone3000Target(null, MODEL_TARGET, 0)).result.current).toBeNull()
    expect(
      renderHook(() =>
        useTone3000Target(
          fakeRig(() => null),
          null,
          0,
        ),
      ).result.current,
    ).toBeNull()
    expect(
      renderHook(() =>
        useTone3000Target(
          fakeRig(() => null),
          MODEL_TARGET,
          0,
        ),
      ).result.current,
    ).toBeNull()
  })

  it("doesn't recompute just because the block now exists - only engineVersion signals that", () => {
    // Regression test for the exact bug reported after shipping the
    // Tone3000-auto-open feature: importing a model into a block added
    // moments earlier silently downloaded+cached it but never reached the
    // block, because this memo's deps didn't include engineVersion, so it
    // never re-ran once the block's async creation (see bindGraphRig)
    // actually finished - the very case this test exercises.
    let block: unknown = null
    const rig = fakeRig(() => block)
    const { result, rerender } = renderHook(
      ({ version }: { version: number }) => useTone3000Target(rig, MODEL_TARGET, version),
      { initialProps: { version: 0 } },
    )
    expect(result.current).toBeNull()

    block = { loadModel: vi.fn() }
    rerender({ version: 0 })
    expect(result.current).toBeNull()

    rerender({ version: 1 })
    expect(result.current).not.toBeNull()
  })

  it('resolves a model-slot target to a loadModel that delegates to the block, with a guarding loadIR', async () => {
    const loadModel = vi.fn().mockResolvedValue(undefined)
    const rig = fakeRig(() => ({ loadModel }))
    const { result } = renderHook(() => useTone3000Target(rig, MODEL_TARGET, 0))

    await result.current?.loadModel('{}', { id: 'x', name: 'X' })
    // Third arg is the global NAM quality setting (default 1 = full quality) - see settingsStore.ts.
    expect(loadModel).toHaveBeenCalledWith('{}', 1, { id: 'x', name: 'X' })
    expect(() => result.current?.loadIR({} as AudioBuffer, { id: 'x', name: 'X' })).toThrow(
      'This block is not a Cab block',
    )
  })

  it('resolves an ir-slot target to a loadIR that delegates to the block, with a guarding loadModel', () => {
    const loadIR = vi.fn()
    const rig = fakeRig(() => ({ loadIR }))
    const { result } = renderHook(() => useTone3000Target(rig, IR_TARGET, 0))

    const buffer = {} as AudioBuffer
    result.current?.loadIR(buffer, { id: 'x', name: 'X' })
    expect(loadIR).toHaveBeenCalledWith(buffer, 1, { id: 'x', name: 'X' })
    expect(() => result.current?.loadModel('{}', { id: 'x', name: 'X' })).toThrow(
      'This block is not an Amp block',
    )
  })
})
