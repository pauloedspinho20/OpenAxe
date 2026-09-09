// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { NativeBlock } from './NativeBlock'
import type { OpenAxeBridge } from './openaxe'

// bindGraphRig replays each block's FULL stored params object on every
// reconcile - i.e. on every knob move anywhere in the rig (graphStore merges
// the single changed key, then bindGraphRig passes the whole object to
// setParams). The old NativeBlock forwarded every key again, so a drag on any
// reverb/delay knob re-sent reverbAlgorithm/model on every move; each of those
// bridge calls runs the desktop shell's suspend handshake even though the core
// no-ops the unchanged value, which dropped a silence gap (a "crack") into the
// audio. These tests pin the fix: setParams forwards only the keys whose value
// actually changed, and never forwards the hidden slim_size/slimSize keys.
describe('NativeBlock.setParams diffing', () => {
  function makeBlock() {
    const calls: Record<string, unknown[]> = {}
    const bridge = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') return undefined
          return (args: unknown) => {
            ;(calls[String(prop)] ??= []).push(args)
            return Promise.resolve({ ok: true })
          }
        },
      },
    ) as unknown as OpenAxeBridge
    const block = new NativeBlock(bridge, 'block-1', 'reverb')
    return { block, bridge, calls }
  }

  it('sends every key on the first apply', () => {
    const { block, calls } = makeBlock()
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.5, damping: 0.4 })
    expect(calls['setReverbAlgorithm']).toHaveLength(1)
    expect(calls['setParam']).toHaveLength(2)
  })

  it('re-sends only the key that changed on subsequent applies', () => {
    const { block, calls } = makeBlock()
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.5, damping: 0.4 })
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.9, damping: 0.4 })
    // roomSize changed once; the unchanged reverbAlgorithm/damping must NOT be
    // re-sent (they would trigger the suspend handshake for no reason).
    expect(calls['setReverbAlgorithm']).toHaveLength(1)
    expect(calls['setParam']).toHaveLength(3)
    const roomSizeCalls = (calls['setParam'] ?? []).filter(
      (a) => (a as { key: string }).key === 'roomSize',
    )
    const roomSizeCall = roomSizeCalls[roomSizeCalls.length - 1] as { value: number } | undefined
    expect(roomSizeCall?.value).toBe(0.9)
  })

  it('never forwards the hidden slim_size/slimSize keys', () => {
    const { block, calls } = makeBlock()
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.5, slim_size: 1, slimSize: 1 })
    const sentKeys = [
      ...(calls['setParam'] as { key: string }[]),
      ...(calls['setReverbAlgorithm'] as unknown[]),
    ].map(
      (a) =>
        (a as { key?: string; algorithm?: string }).key ?? (a as { algorithm: string }).algorithm,
    )
    expect(sentKeys).not.toContain('slim_size')
    expect(sentKeys).not.toContain('slimSize')
  })

  it('forwarding a value equal to the previous one is a no-op', () => {
    const { block, calls } = makeBlock()
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.5 })
    block.setParams({ reverbAlgorithm: 'hall', roomSize: 0.5 })
    expect(calls['setReverbAlgorithm']).toHaveLength(1)
    expect(calls['setParam']).toHaveLength(1)
  })
})
