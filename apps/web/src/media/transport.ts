/**
 * The backing-track transport (issue #205): one interface over the core's
 * backing-track player, whichever shell hosts it.
 *
 *   - web: ops travel to the rig AudioWorklet (`player` messages), which owns
 *     the core's OpenAxePlayer next to the rig graph;
 *   - desktop: ops go over the `openAxe.player` bridge to the player AudioIO
 *     renders after the graph in the miniaudio callback.
 *
 * Either way the track is rendered by packages/core and mixed after the rig
 * into the same output, so it reaches the device the rig plays through.
 * Decoding is done here, in the UI (decodeAudioData exists in every webview),
 * and the PCM streams to the core in chunks so no single message blocks the
 * audio thread.
 */
import type { PlayerStatus } from '../engine/RigWorkletNode'
import type { OpenAxeBridge, OpenAxePlayerReply } from '../native/openaxe'

export type { PlayerStatus }

export interface DecodedTrack {
  /** One Float32Array per channel (1 or 2). */
  channels: Float32Array[]
  sampleRate: number
  frames: number
}

export interface BackingTransport {
  /** Streams a decoded track into the core; resolves once it is playable. */
  load(track: DecodedTrack, onProgress?: (fraction: number) => void): Promise<PlayerStatus>
  unload(): Promise<void>
  play(): Promise<PlayerStatus>
  pause(): Promise<PlayerStatus>
  seek(frame: number): Promise<PlayerStatus>
  setSpeed(speed: number): Promise<PlayerStatus>
  setSemitones(semitones: number): Promise<PlayerStatus>
  setVolume(volume: number): Promise<PlayerStatus>
  setLoop(start: number, end: number, enabled: boolean): Promise<PlayerStatus>
  status(): Promise<PlayerStatus>
}

/** Frames per streamed chunk: ~1 s, small enough to never stall a render. */
export const LOAD_CHUNK_FRAMES = 48_000

/** Interleave `frames` frames from `offset` (all channels) into one buffer. */
export function interleave(channels: Float32Array[], offset: number, frames: number): Float32Array {
  const n = channels.length
  const out = new Float32Array(frames * n)
  for (let c = 0; c < n; c++) {
    const src = channels[c]!
    for (let i = 0; i < frames; i++) out[i * n + c] = src[offset + i] ?? 0
  }
  return out
}

/** Interleaved little-endian int16, base64-encoded (the desktop wire format). */
export function pcm16Base64(interleaved: Float32Array): string {
  const bytes = new Uint8Array(interleaved.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < interleaved.length; i++) {
    const v = Math.max(-1, Math.min(1, interleaved[i]!))
    view.setInt16(i * 2, Math.round(v * 32767), true)
  }
  let binary = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP))
  }
  return btoa(binary)
}

type PlayerOp = (
  op: string,
  args?: Record<string, unknown>,
  transfer?: Transferable[],
) => Promise<PlayerStatus>

function makeTransport(
  call: PlayerOp,
  wireChunk: (chunk: Float32Array) => Record<string, unknown>,
  transfer: boolean,
): BackingTransport {
  return {
    async load(track, onProgress) {
      const channels = track.channels.length
      await call('loadBegin', { frames: track.frames, channels, sampleRate: track.sampleRate })
      for (let offset = 0; offset < track.frames; offset += LOAD_CHUNK_FRAMES) {
        const n = Math.min(LOAD_CHUNK_FRAMES, track.frames - offset)
        const chunk = interleave(track.channels, offset, n)
        await call(
          'loadWrite',
          { offset, channels, ...wireChunk(chunk) },
          transfer ? [chunk.buffer] : undefined,
        )
        onProgress?.(Math.min(1, (offset + n) / track.frames))
      }
      return call('loadEnd')
    },
    async unload() {
      await call('unload')
    },
    play: () => call('play'),
    pause: () => call('pause'),
    seek: (frame) => call('seek', { frame: Math.max(0, Math.round(frame)) }),
    setSpeed: (value) => call('setSpeed', { value }),
    setSemitones: (value) => call('setSemitones', { value }),
    setVolume: (value) => call('setVolume', { value }),
    setLoop: (start, end, enabled) =>
      call('setLoop', { start: Math.round(start), end: Math.round(end), enabled }),
    status: () => call('status'),
  }
}

/** Web: the rig worklet's player channel (GraphRig.playerPort). */
export function createWorkletTransport(port: {
  player(
    op: string,
    args?: Record<string, unknown>,
    transfer?: Transferable[],
  ): Promise<PlayerStatus>
}): BackingTransport {
  return makeTransport(
    (op, args, transfer) => port.player(op, args, transfer),
    (data) => ({ data }),
    true,
  )
}

function toStatus(reply: OpenAxePlayerReply, op: string): PlayerStatus {
  if (!reply.ok) throw new Error(reply.error ?? `player ${op} failed`)
  return {
    position: reply.position ?? 0,
    length: reply.length ?? 0,
    sampleRate: reply.sampleRate ?? 0,
    playing: reply.playing ?? false,
    meter: reply.meter ?? 0,
  }
}

/** Desktop: the `openAxe.player` bridge handler. */
export function createBridgeTransport(bridge: Pick<OpenAxeBridge, 'player'>): BackingTransport {
  return makeTransport(
    async (op, args) => {
      const reply = await bridge.player({ op, ...(args ?? {}) })
      // loadWrite replies without a status; normalize so every op resolves alike.
      if (op === 'loadWrite') {
        if (!reply.ok) throw new Error(reply.error ?? 'player loadWrite failed')
        return { position: 0, length: 0, sampleRate: 0, playing: false, meter: 0 }
      }
      return toStatus(reply, op)
    },
    (chunk) => ({ pcm16Base64: pcm16Base64(chunk) }),
    false,
  )
}
