/**
 * WAV encoder for takes (#189): 16/24-bit int + 32-bit float, peak normalize, valid RIFF.
 * Mirrors `packages/core/src/dsp/wav.cpp`'s encode path so JS-encoded takes round-trip
 * via `DecodeWav` in the core if ever re-imported as IR.
 */

export type WavBits = 16 | 24 | 32

export interface EncodeOptions {
  bits: WavBits
  float: boolean // true → 32f (IEEE float, format 3), false → PCM int (format 1)
  normalize: boolean // peak normalize to 0.99 before quantizing (int only)
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

export function encodeWav(
  interleaved: Float32Array,
  sampleRate: number,
  numChannels: number,
  opts: EncodeOptions,
): Uint8Array {
  const { bits, float: isFloat, normalize } = opts
  const bytesPerSample = isFloat ? 4 : bits === 24 ? 3 : 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataBytes = interleaved.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, isFloat ? 3 : 1, true) // format: 3=float, 1=PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bits, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  // Peak normalize (int only)
  let peak = 0
  if (normalize && !isFloat) {
    for (let i = 0; i < interleaved.length; i++) peak = Math.max(peak, Math.abs(interleaved[i]!))
    if (peak > 0 && peak < 1) {
      const gain = 0.99 / peak
      for (let i = 0; i < interleaved.length; i++) interleaved[i]! *= gain
    }
  }

  let offset = 44
  if (isFloat) {
    for (let i = 0; i < interleaved.length; i++) {
      view.setFloat32(offset, interleaved[i]!, true)
      offset += 4
    }
  } else if (bits === 16) {
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]!))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  } else if (bits === 24) {
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]!))
      const int24 = s < 0 ? Math.round(s * 0x800000) : Math.round(s * 0x7fffff)
      view.setUint8(offset, int24 & 0xff)
      view.setUint8(offset + 1, (int24 >> 8) & 0xff)
      view.setUint8(offset + 2, (int24 >> 16) & 0xff)
      offset += 3
    }
  } else {
    // 32-bit int fallback
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]!))
      view.setInt32(offset, s < 0 ? s * 0x80000000 : s * 0x7fffffff, true)
      offset += 4
    }
  }

  return new Uint8Array(buf)
}

export function wavBase64FromPcm(
  interleaved: Float32Array,
  sampleRate: number,
  opts: EncodeOptions = { bits: 16, float: false, normalize: false },
): string {
  const wav = encodeWav(interleaved, sampleRate, 2, opts)
  let binary = ''
  for (let i = 0; i < wav.length; i++) binary += String.fromCharCode(wav[i]!)
  return btoa(binary)
}
