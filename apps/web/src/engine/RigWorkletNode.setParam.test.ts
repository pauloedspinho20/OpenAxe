// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RigWorkletNode } from './RigWorkletNode'

let sent: Record<string, unknown>[] = []
let rafCb: ((t: number) => void) | null = null

class FakePort {
  onmessage: ((e: { data: { id: number } }) => void) | null = null
  postMessage(msg: Record<string, unknown>): void {
    sent.push(msg)
    const id = msg.id as number
    queueMicrotask(() => this.onmessage?.({ data: { id } } as never))
  }
}
class FakeNode {
  port = new FakePort()
}

beforeEach(() => {
  sent = []
  rafCb = null
})
afterEach(() => vi.unstubAllGlobals())

async function makeRig(): Promise<RigWorkletNode> {
  const fakeNode = new FakeNode()
  const fakeAudioWorkletNode = fakeNode as unknown as AudioWorkletNode
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      readonly port = fakeNode.port
      constructor() {
        return fakeAudioWorkletNode as unknown as this
      }
    } as unknown as typeof AudioWorkletNode,
  )
  const fakeContext = {
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    sampleRate: 48000,
  } as unknown as AudioContext
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }))
  return RigWorkletNode.create(fakeContext)
}

describe('RigWorkletNode.setParam', () => {
  it('coalesces repeated setParam for the same block/key into one send with the latest value', async () => {
    // Defer the rAF callback so all three setParam calls land in one "frame".
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafCb = cb
      return 1
    })
    const rig = await makeRig()

    rig.setParam('b1', 'drive', 0.2)
    rig.setParam('b1', 'drive', 0.9)
    rig.setParam('b1', 'tone', 0.5)

    // Nothing is flushed until the frame fires.
    expect(sent.filter((m) => m.type === 'setParam')).toHaveLength(0)
    rafCb!(0)

    const paramMsgs = sent.filter((m) => m.type === 'setParam')
    expect(paramMsgs).toHaveLength(2)
    expect(paramMsgs.find((m) => m.key === 'drive')!.value).toBe(0.9)
    expect(paramMsgs.find((m) => m.key === 'tone')!.value).toBe(0.5)
  })
})
