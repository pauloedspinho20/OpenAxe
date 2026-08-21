// @vitest-environment node
//
// Integration test for the Web<->WASM ABI boundary (issue #80). The existing
// connect.test.ts only stubs the worklet and checks message *shape*; this test
// loads the REAL nam_studio_core module and drives the worklet's actual
// message handler, so a renamed field or wrong encoding fails loudly instead of
// silently at runtime.
//
// It stubs the handful of AudioWorkletGlobalScope globals the worklet module
// touches, instantiates the committed WASM, and calls handleMessage directly.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const WORKLET_URL = new URL('../../public/wasm-core/namStudioRigWorklet.js', import.meta.url)
const WASM_PATH = fileURLToPath(
  new URL('../../public/wasm-core/nam_studio_core.wasm', import.meta.url),
)

// AudioWorkletGlobalScope globals the worklet references at import / construct time.
// The worklet registers (not exports) its processor class, so capture it here.
let capturedClass: any = null
;(globalThis as unknown as Record<string, unknown>).AudioWorkletProcessor = class {
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: (_m: unknown) => {},
  }
}
;(globalThis as unknown as Record<string, unknown>).registerProcessor = (
  _name: string,
  klass: any,
) => {
  capturedClass = klass
}
;(globalThis as unknown as Record<string, unknown>).sampleRate = 48000

// The committed WASM was built with an Emscripten that calls
// Memory.prototype.toResizableBuffer() unconditionally; some Node builds lack
// it. It's only used to fetch the backing ArrayBuffer, so polyfill it.
if (
  typeof (WebAssembly.Memory.prototype as unknown as { toResizableBuffer?: unknown })
    .toResizableBuffer !== 'function'
) {
  ;(
    WebAssembly.Memory.prototype as unknown as { toResizableBuffer: () => ArrayBuffer }
  ).toResizableBuffer = function (this: WebAssembly.Memory) {
    return this.buffer
  }
}

interface RigProc {
  module: Record<string, any>
  graph: unknown
  ready: Promise<void>
  blockByJs: Map<string, number>
  edgeByJs: Map<string, number>
  port: { postMessage: (m: unknown) => void }
  handleMessage: (m: Record<string, unknown>) => Promise<void>
}

async function makeProcessor(): Promise<{ proc: RigProc; replies: any[] }> {
  const wasmBytes = readFileSync(WASM_PATH)
  await import(WORKLET_URL.href)
  const proc = new capturedClass({ processorOptions: { wasmBytes } }) as RigProc
  const replies: any[] = []
  proc.port.postMessage = (m: unknown) => replies.push(m)
  await proc.ready
  return { proc, replies }
}

// IN rail sentinel the web side sends for rail connects (api.h IN_RAIL = -1).
const IN_RAIL = -1

describe('Web->WASM ABI boundary (real core)', () => {
  let proc: RigProc
  let replies: any[]
  beforeAll(async () => {
    const made = await makeProcessor()
    proc = made.proc
    replies = made.replies
  })

  it('addBlock message creates a real core block', async () => {
    await proc.handleMessage({ id: 1, type: 'addBlock', block: 'd1', kind: 7, row: 0, col: 0 })
    expect(proc.blockByJs.get('d1')).toBeGreaterThanOrEqual(0)
  })

  it('connect message drives a real core edge and round-trips', async () => {
    await proc.handleMessage({
      id: 2,
      type: 'connect',
      fromId: 'IN',
      fromPort: 0,
      toId: 'd1',
      toPort: 0,
      edgeId: 'e1',
    })
    const reply = replies.find((r) => r.id === 2)
    expect(reply?.ok).toBe(true)
    // The core accepted the edge (edgeByJs only gets set on _nam_studio_connect >= 0).
    expect(proc.edgeByJs.get('e1')).toBeGreaterThanOrEqual(0)
  })

  it('setParam message reaches the C ABI with the resolved index and value', async () => {
    const mod = proc.module
    // Read a real param symbol from the core so we send a key the worklet can resolve.
    const namePtr = mod._malloc(4)
    const symPtr = mod._malloc(4)
    const minPtr = mod._malloc(4)
    const maxPtr = mod._malloc(4)
    const unitPtr = mod._malloc(4)
    mod._nam_studio_block_param_info(
      proc.graph,
      proc.blockByJs.get('d1'),
      0,
      namePtr,
      symPtr,
      minPtr,
      maxPtr,
      unitPtr,
    )
    const symbol = mod.UTF8ToString(mod.HEAPU32[symPtr >> 2])
    mod._free(namePtr)
    mod._free(symPtr)
    mod._free(minPtr)
    mod._free(maxPtr)
    mod._free(unitPtr)
    expect(symbol).toBeTruthy()

    // Spy on the C ABI call to prove the message fields reached it.
    let captured: any[] | null = null
    const orig = mod._nam_studio_set_param
    mod._nam_studio_set_param = (...args: any[]) => {
      captured = args
      return orig.apply(mod, args)
    }

    await proc.handleMessage({ id: 3, type: 'setParam', block: 'd1', key: symbol, value: 0.5 })

    expect(captured).not.toBeNull()
    expect(captured![0]).toBe(proc.graph)
    expect(captured![1]).toBe(proc.blockByJs.get('d1'))
    expect(captured![2]).toBe(0) // index resolved for the symbol at index 0
    expect(captured![3]).toBeCloseTo(0.5)
  })

  it('catches a renamed connect field (regression guard)', async () => {
    // fromId renamed to `from` - the worklet must reject, not silently accept.
    await proc.handleMessage({
      id: 4,
      type: 'connect',
      from: 'IN',
      fromPort: 0,
      toId: 'd1',
      toPort: 0,
      edgeId: 'e2',
    })
    const reply = replies.find((r) => r.id === 4)
    expect(reply?.ok).toBe(false)
    expect(proc.edgeByJs.has('e2')).toBe(false)
  })
})
