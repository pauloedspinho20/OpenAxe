/**
 * A Web Audio-free stand-in for `AudioContext` threaded into the shared UI as
 * `engine.context`. The desktop runs the DSP in C++, so it needs no real
 * AudioContext; components only use it for `decodeAudioData` (see below) and a
 * couple of scalar reads (`currentTime`, `sampleRate`). Zero Web Audio.
 */

/**
 * What `NativeAudioContext.decodeAudioData` resolves to: an `AudioBuffer`-shaped
 * object that carries the *undecoded* file bytes instead of samples.
 *
 * Nothing on this path can decode audio - that is the whole point of the facade -
 * but the core can (`openaxe_load_ir_wav`). So rather than throwing the bytes
 * away, the stub keeps them, and `NativeBlock.loadIR` hands them to the core to
 * decode and resample. The shared UI keeps calling `decodeAudioData` then
 * `loadIR(buffer)` exactly as it does on the web.
 */
export interface NativeAudioBuffer extends AudioBuffer {
  /** The original file bytes, for the core to decode. */
  readonly nativeFileBytes: ArrayBuffer
}

/** True when a buffer came from NativeAudioContext and still holds its bytes. */
export function isNativeAudioBuffer(buffer: AudioBuffer): buffer is NativeAudioBuffer {
  return (buffer as Partial<NativeAudioBuffer>).nativeFileBytes instanceof ArrayBuffer
}

export class NativeAudioContext {
  readonly currentTime = 0
  readonly baseLatency = 0
  readonly outputLatency = 0
  readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  /**
   * Resolves an AudioBuffer-shaped stub that carries the file's bytes rather than
   * decoded samples (see NativeAudioBuffer). `length`/`duration` stay 0 because
   * nothing here parsed the file; only the core knows how long it is, and it
   * reports that back when the IR is installed.
   */
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    return {
      length: 0,
      duration: 0,
      sampleRate: this.sampleRate,
      numberOfChannels: 2,
      nativeFileBytes: data,
    } as unknown as AudioBuffer
  }
}
