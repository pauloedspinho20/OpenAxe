import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  avcCodecCandidates,
  contrast,
  packPlanarFloat32,
  padAudioForVideo,
  pickWebCodecsTarget,
  runOfflineEncode,
  silence,
  sliceAudio,
  tickAt,
  withCountIn,
  type WebCodecsTarget,
} from './videoExport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('video export helpers', () => {
  const segs = [
    { start: 0, end: 2, tickStart: 0, tickEnd: 3840 },
    // A repeat plays the first bar again.
    { start: 2, end: 4, tickStart: 3840, tickEnd: 7680 },
  ]
  it('maps score time to ticks, clamped', () => {
    expect(tickAt(segs, -1)).toBe(0)
    expect(tickAt(segs, 1)).toBe(1920)
    expect(tickAt(segs, 3)).toBe(5760)
    expect(tickAt(segs, 99)).toBe(7679)
    expect(tickAt([], 1)).toBe(0)
  })
  it('picks readable text colours', () => {
    expect(contrast('#ffffff')).toBe('#111111')
    expect(contrast('#101010')).toBe('#F4F1EA')
  })

  it('selects appropriate H.264/AVC levels for 720p, 1080p and 4K', () => {
    expect(avcCodecCandidates(1280, 720, 30)[0]).toBe('avc1.640028')
    expect(avcCodecCandidates(1920, 1080, 30)[0]).toBe('avc1.640028')
    expect(avcCodecCandidates(1920, 1080, 60)[0]).toBe('avc1.64002a')
    expect(avcCodecCandidates(3840, 2160, 30)[0]).toBe('avc1.640033')
    expect(avcCodecCandidates(3840, 2160, 60)[0]).toBe('avc1.640034')
  })
})

describe('video audio helpers', () => {
  const tone = () => {
    const ch = new Float32Array(1000).fill(1)
    return { channels: [ch, ch.slice()], sampleRate: 100, frames: 1000 }
  }
  it('cuts a range with short fades', () => {
    const cut = sliceAudio(tone(), 2, 5)
    expect(cut.frames).toBe(300)
    expect(cut.channels[0]![0]).toBe(0)
    expect(cut.channels[0]![150]).toBe(1)
    expect(sliceAudio(tone(), 9, 20).frames).toBe(100)
  })
  it('prepends count-in clicks', () => {
    const sr = 48_000
    const ch = new Float32Array(sr).fill(1)
    const t = withCountIn({ channels: [ch], sampleRate: sr, frames: sr }, 4, 0.5)
    expect(t.frames).toBe(3 * sr)
    expect(t.channels[0]![2 * sr]).toBe(1)
    const lead = t.channels[0]!.subarray(0, 2 * sr)
    let peak = 0
    for (const v of lead) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.1)
    expect(silence(2, 100).frames).toBe(200)
  })

  it('pads audio with title-card lead silence and packs f32-planar frames', () => {
    const sr = 100
    const l = new Float32Array([0.5, 0.6])
    const r = new Float32Array([-0.5, -0.6])
    const padded = padAudioForVideo({ channels: [l, r], sampleRate: sr, frames: 2 }, 0.5, 1.0)
    expect(padded.frames).toBe(100)
    expect(padded.channels[0]![0]).toBe(0)
    expect(padded.channels[0]![49]).toBe(0)
    expect(padded.channels[0]![50]).toBeCloseTo(0.5)
    expect(padded.channels[1]![51]).toBeCloseTo(-0.6)
    expect(padded.channels[0]![99]).toBe(0)

    const packed = packPlanarFloat32([l, r], 0, 2)
    expect([...packed].map((v) => Math.round(v * 10) / 10)).toEqual([0.5, 0.6, -0.5, -0.6])
  })
})

describe('WebCodecs target negotiation and offline muxing', () => {
  function stubCodecs(opts: {
    videoSupport?: (c: VideoEncoderConfig) => boolean
    audioSupport?: (c: AudioEncoderConfig) => boolean
    closedLog?: string[]
  }) {
    class MockVideoFrame {
      readonly timestamp: number
      readonly duration: number | null
      closed = false
      constructor(_src: unknown, init: { timestamp: number; duration?: number }) {
        this.timestamp = init.timestamp
        this.duration = init.duration ?? null
      }
      close() {
        this.closed = true
      }
    }
    class MockAudioData {
      readonly timestamp: number
      readonly numberOfFrames: number
      closed = false
      constructor(init: { timestamp: number; numberOfFrames: number }) {
        this.timestamp = init.timestamp
        this.numberOfFrames = init.numberOfFrames
      }
      close() {
        this.closed = true
      }
    }
    class MockEncodedVideoChunk {
      readonly type: EncodedVideoChunkType
      readonly timestamp: number
      readonly duration: number | null
      readonly byteLength: number
      private readonly data: Uint8Array
      constructor(init: {
        type: EncodedVideoChunkType
        timestamp: number
        duration?: number
        data: Uint8Array
      }) {
        this.type = init.type
        this.timestamp = init.timestamp
        this.duration = init.duration ?? null
        this.data = init.data
        this.byteLength = init.data.byteLength
      }
      copyTo(dst: ArrayBufferView | ArrayBuffer) {
        const view =
          dst instanceof ArrayBuffer
            ? new Uint8Array(dst)
            : new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength)
        view.set(this.data)
      }
    }
    class MockEncodedAudioChunk {
      readonly type: EncodedAudioChunkType
      readonly timestamp: number
      readonly duration: number | null
      readonly byteLength: number
      private readonly data: Uint8Array
      constructor(init: {
        type: EncodedAudioChunkType
        timestamp: number
        duration?: number
        data: Uint8Array
      }) {
        this.type = init.type
        this.timestamp = init.timestamp
        this.duration = init.duration ?? null
        this.data = init.data
        this.byteLength = init.data.byteLength
      }
      copyTo(dst: ArrayBufferView | ArrayBuffer) {
        const view =
          dst instanceof ArrayBuffer
            ? new Uint8Array(dst)
            : new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength)
        view.set(this.data)
      }
    }
    class MockVideoEncoder {
      state: CodecState = 'unconfigured'
      encodeQueueSize = 0
      ondequeue: (() => void) | null = null
      private cfg: VideoEncoderConfig | null = null
      private out: EncodedVideoChunkOutputCallback
      static async isConfigSupported(cfg: VideoEncoderConfig) {
        return { supported: opts.videoSupport ? opts.videoSupport(cfg) : true, config: cfg }
      }
      constructor(init: { output: EncodedVideoChunkOutputCallback }) {
        this.out = init.output
      }
      configure(cfg: VideoEncoderConfig) {
        this.cfg = cfg
        this.state = 'configured'
      }
      encode(frame: MockVideoFrame, encOpts?: { keyFrame?: boolean }) {
        const key = !!encOpts?.keyFrame
        const chunk = new MockEncodedVideoChunk({
          type: key ? 'key' : 'delta',
          timestamp: frame.timestamp,
          duration: frame.duration ?? 33_333,
          data: new Uint8Array([0, 0, 0, 2, 0x65, 0x88]),
        }) as unknown as EncodedVideoChunk
        const codec = this.cfg?.codec ?? 'avc1.640028'
        this.out(
          chunk,
          key
            ? {
                decoderConfig: {
                  codec,
                  ...(codec.startsWith('avc1')
                    ? {
                        description: new Uint8Array([
                          1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68,
                          0xee, 0x3c, 0x80,
                        ]),
                      }
                    : {}),
                },
              }
            : {},
        )
      }
      async flush() {}
      close() {
        this.state = 'closed'
        opts.closedLog?.push('video')
      }
    }
    class MockAudioEncoder {
      state: CodecState = 'unconfigured'
      encodeQueueSize = 0
      ondequeue: (() => void) | null = null
      private cfg: AudioEncoderConfig | null = null
      private out: EncodedAudioChunkOutputCallback
      static async isConfigSupported(cfg: AudioEncoderConfig) {
        return { supported: opts.audioSupport ? opts.audioSupport(cfg) : true, config: cfg }
      }
      constructor(init: { output: EncodedAudioChunkOutputCallback }) {
        this.out = init.output
      }
      configure(cfg: AudioEncoderConfig) {
        this.cfg = cfg
        this.state = 'configured'
      }
      encode(ad: MockAudioData) {
        const chunk = new MockEncodedAudioChunk({
          type: 'key',
          timestamp: ad.timestamp,
          duration: 21_333,
          data: new Uint8Array([0x21, 0x00, 0x49, 0x90]),
        }) as unknown as EncodedAudioChunk
        const codec = this.cfg?.codec ?? 'mp4a.40.2'
        this.out(chunk, {
          decoderConfig: {
            codec,
            sampleRate: this.cfg?.sampleRate ?? 48_000,
            numberOfChannels: this.cfg?.numberOfChannels ?? 2,
            ...(codec === 'opus'
              ? {
                  description: new Uint8Array([
                    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0,
                    0, 0, 0,
                  ]),
                }
              : {}),
          },
        })
      }
      async flush() {}
      close() {
        this.state = 'closed'
        opts.closedLog?.push('audio')
      }
    }
    vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk)
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk)
    vi.stubGlobal('VideoFrame', MockVideoFrame)
    vi.stubGlobal('AudioData', MockAudioData)
    vi.stubGlobal('VideoEncoder', MockVideoEncoder)
    vi.stubGlobal('AudioEncoder', MockAudioEncoder)
  }

  it('negotiates MP4 first, falls back to WebM, and respects explicit format', async () => {
    expect(
      await pickWebCodecsTarget({
        width: 1920,
        height: 1080,
        fps: 30,
        hasAudio: true,
        sampleRate: 48_000,
        channels: 2,
      }),
    ).toBeNull()

    stubCodecs({})
    const auto = await pickWebCodecsTarget({
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sampleRate: 48_000,
      channels: 2,
    })
    expect(auto?.container).toBe('mp4')

    const explicitWebm = await pickWebCodecsTarget({
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      sampleRate: 48_000,
      channels: 2,
      format: 'webm',
    })
    expect(explicitWebm?.container).toBe('webm')
    expect(explicitWebm?.audioConfig).toBeNull()

    // No AAC audio support -> falls back from MP4 to WebM (VP9 + Opus).
    stubCodecs({ audioSupport: (c) => c.codec === 'opus' })
    const fallback = await pickWebCodecsTarget({
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sampleRate: 48_000,
      channels: 2,
    })
    expect(fallback?.container).toBe('webm')
  })

  it('muxes valid MP4 and WebM containers and cleans up on abort', async () => {
    const closedLog: string[] = []
    stubCodecs({ closedLog })

    const mp4Target: WebCodecsTarget = {
      container: 'mp4',
      mime: 'video/mp4',
      videoConfig: {
        codec: 'avc1.640028',
        width: 320,
        height: 180,
        bitrate: 1_000_000,
        framerate: 10,
      },
      audioConfig: {
        codec: 'mp4a.40.2',
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 192_000,
      },
      muxerVideoCodec: 'avc',
      muxerAudioCodec: 'aac',
    }
    const mp4 = await runOfflineEncode({
      canvas: {} as unknown as CanvasImageSource,
      drawFrame: () => {},
      lead: 0.1,
      total: 0.3,
      fps: 10,
      width: 320,
      height: 180,
      audio: silence(0.2, 48_000, 2),
      target: mp4Target,
      onProgress: () => {},
      signal: new AbortController().signal,
    })
    expect(mp4.ext).toBe('mp4')
    const mp4Bytes = new Uint8Array(await mp4.blob.arrayBuffer())
    expect(String.fromCharCode(...mp4Bytes.subarray(4, 8))).toBe('ftyp')

    const webmTarget: WebCodecsTarget = {
      container: 'webm',
      mime: 'video/webm',
      videoConfig: {
        codec: 'vp09.00.41.08',
        width: 320,
        height: 180,
        bitrate: 1_000_000,
        framerate: 10,
      },
      audioConfig: { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 },
      muxerVideoCodec: 'V_VP9',
      muxerAudioCodec: 'A_OPUS',
    }
    const webm = await runOfflineEncode({
      canvas: {} as unknown as CanvasImageSource,
      drawFrame: () => {},
      lead: 0,
      total: 0.2,
      fps: 10,
      width: 320,
      height: 180,
      audio: silence(0.2, 48_000, 2),
      target: webmTarget,
      onProgress: () => {},
      signal: new AbortController().signal,
    })
    expect(webm.ext).toBe('webm')
    const webmBytes = new Uint8Array(await webm.blob.arrayBuffer())
    expect([...webmBytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])

    // Cancelling mid-encode rejects with AbortError and closes encoders.
    closedLog.length = 0
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      runOfflineEncode({
        canvas: {} as unknown as CanvasImageSource,
        drawFrame: () => {},
        lead: 0,
        total: 0.2,
        fps: 10,
        width: 320,
        height: 180,
        audio: null,
        target: { ...mp4Target, audioConfig: null, muxerAudioCodec: null },
        onProgress: () => {},
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(closedLog).toContain('video')
  })
})
