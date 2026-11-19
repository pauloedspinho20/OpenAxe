import { describe, expect, it, vi } from 'vitest'

import {
  createBridgeTransport,
  createWorkletTransport,
  interleave,
  LOAD_CHUNK_FRAMES,
  pcm16Base64,
  type PlayerStatus,
} from './transport'

const STATUS: PlayerStatus = { position: 0, length: 0, sampleRate: 48000, playing: false, meter: 0 }

describe('media transport', () => {
  it('interleaves planar channels', () => {
    const l = new Float32Array([1, 2, 3])
    const r = new Float32Array([-1, -2, -3])
    expect(Array.from(interleave([l, r], 1, 2))).toEqual([2, -2, 3, -3])
    expect(Array.from(interleave([l], 0, 3))).toEqual([1, 2, 3])
  })

  it('encodes interleaved PCM as little-endian int16 base64, clamped', () => {
    const b64 = pcm16Base64(new Float32Array([0, 1, -1, 2]))
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    expect([0, 1, 2, 3].map((i) => view.getInt16(i * 2, true))).toEqual([0, 32767, -32767, 32767])
  })

  it('streams a track to the worklet in chunks with transferable buffers', async () => {
    const calls: {
      op: string
      args?: Record<string, unknown> | undefined
      transfer?: Transferable[] | undefined
    }[] = []
    const port = {
      player: vi.fn(
        async (op: string, args?: Record<string, unknown>, transfer?: Transferable[]) => {
          calls.push({ op, args, transfer })
          return STATUS
        },
      ),
    }
    const t = createWorkletTransport(port)
    const frames = LOAD_CHUNK_FRAMES * 2 + 10
    const progress: number[] = []
    await t.load(
      { channels: [new Float32Array(frames), new Float32Array(frames)], sampleRate: 44100, frames },
      (p) => progress.push(p),
    )
    expect(calls.map((c) => c.op)).toEqual([
      'loadBegin',
      'loadWrite',
      'loadWrite',
      'loadWrite',
      'loadEnd',
    ])
    expect(calls[0]!.args).toEqual({ frames, channels: 2, sampleRate: 44100 })
    expect(calls[3]!.args!.offset).toBe(LOAD_CHUNK_FRAMES * 2)
    expect((calls[3]!.args!.data as Float32Array).length).toBe(20)
    expect(calls[1]!.transfer).toHaveLength(1)
    expect(progress.at(-1)).toBe(1)
    await t.setLoop(10.4, 20.6, true)
    expect(calls.at(-1)).toMatchObject({
      op: 'setLoop',
      args: { start: 10, end: 21, enabled: true },
    })
  })

  it('maps the desktop bridge replies and errors', async () => {
    const bridge = {
      player: vi.fn(async (args: { op: string }) => {
        if (args.op === 'loadBegin') return { ok: false, error: 'too long' }
        return {
          ok: true,
          position: 480,
          length: 960,
          sampleRate: 48000,
          playing: true,
          meter: 0.5,
        }
      }),
    }
    const t = createBridgeTransport(bridge)
    await expect(t.status()).resolves.toEqual({
      position: 480,
      length: 960,
      sampleRate: 48000,
      playing: true,
      meter: 0.5,
    })
    await expect(
      t.load({ channels: [new Float32Array(4)], sampleRate: 48000, frames: 4 }),
    ).rejects.toThrow('too long')
  })
})
