/**
 * A Web Audio-free stand-in for `AudioContext` threaded into the shared UI as
 * `engine.context`. The desktop runs the DSP in C++, so it needs no real
 * AudioContext; components only use it for `decodeAudioData` (IR loading - a
 * no-op on native, since the core has no cab/convolution DSP) and a couple of
 * scalar reads (`currentTime`, `sampleRate`). Zero Web Audio.
 */
export class NativeAudioContext {
  readonly currentTime = 0
  readonly baseLatency = 0
  readonly outputLatency = 0
  readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  /**
   * Resolves a minimal AudioBuffer-shaped stub. Native IR loading is a no-op,
   * so this only exists so the shared IR-loading call sites don't crash; the
   * decoded bytes are discarded.
   */
  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
    return {
      length: 0,
      duration: 0,
      sampleRate: this.sampleRate,
      numberOfChannels: 2,
    } as AudioBuffer
  }
}
