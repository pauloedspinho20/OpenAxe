// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RigWorkletNode } from './RigWorkletNode'

/**
 * Regression test for the web-rig migration (#55): the rail connects must reach
 * the worklet as the raw 'IN'/'OUT' strings so its `toCoreBlock` can map them
 * to the core's -1/-2 sentinels. They used to be pre-converted to numbers here,
 * which made every IN/OUT rail edge hit the worklet's "unknown block" path and
 * silently dropped it - so signal never reached any block (only the pre-graph
 * input/tuner moved). See connect()'s comment.
 */

let sent: Record<string, unknown>[] = []
let replies: Map<number, { ok: boolean; error?: string }> = new Map()

class FakePort {
  onmessage: ((e: { data: { id: number } }) => void) | null = null
  postMessage(msg: Record<string, unknown>): void {
    sent.push(msg)
    const id = msg.id as number
    const reply = replies.get(id) ?? { ok: true }
    queueMicrotask(() => {
      this.onmessage?.({ data: { ...reply, id } } as never)
    })
  }
}

class FakeNode {
  port = new FakePort()
}

beforeEach(() => {
  sent = []
  replies = new Map()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function makeRig(): Promise<RigWorkletNode> {
  const fakeNode = new FakeNode()
  const fakeAudioWorkletNode = fakeNode as unknown as AudioWorkletNode
  // Provide a global AudioWorkletNode that returns our fake node, and a fetch
  // that supplies the .wasm bytes, so RigWorkletNode.create can construct itself.
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
  // create() now stream-compiles the wasm on the main thread; these tests only
  // assert message shape, so stub the compile rather than shipping real bytes
  // (the real ABI handshake is covered by RigWorkletNode.integration.test.ts).
  vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue({} as WebAssembly.Module)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ clone: () => ({}), arrayBuffer: async () => new ArrayBuffer(8) }),
  )
  const rig = await RigWorkletNode.create(fakeContext)
  return rig
}

describe('RigWorkletNode.connect', () => {
  it('forwards the raw IN/OUT rail ids so the worklet can map them to core sentinels', async () => {
    const rig = await makeRig()
    const result = await rig.connect({ blockId: 'IN', port: 0 }, { blockId: 'b1', port: 0 }, 'e1')
    expect(result.ok).toBe(true)
    const connectMsg = sent.find((m) => m.type === 'connect')
    expect(connectMsg).toBeDefined()
    expect(connectMsg!.fromId).toBe('IN')
    expect(connectMsg!.toId).toBe('b1')
    expect(connectMsg!.edgeId).toBe('e1')
  })

  it('keeps block-to-block and block-to-OUT connects as strings too', async () => {
    const rig = await makeRig()
    await rig.connect({ blockId: 'b1', port: 0 }, { blockId: 'OUT', port: 0 }, 'e2')
    const connectMsg = sent.find((m) => m.type === 'connect' && m.edgeId === 'e2')
    expect(connectMsg!.fromId).toBe('b1')
    expect(connectMsg!.toId).toBe('OUT')
  })
})
