/**
 * MP3 export via lamejs (#190, LGPL — see THIRD_PARTY_NOTICES).
 * Opus is noted as stretch (requires Opus encoder, not bundled here).
 */

export async function encodeMp3(
  interleaved: Float32Array,
  sampleRate: number,
  channels: number,
  bitrate = 128,
): Promise<Uint8Array> {
  // Dynamic import so the main bundle doesn't pay for lamejs until export is used.
  const lamejs = await import('lamejs').catch(() => null)
  if (!lamejs) throw new Error('lamejs not available — run `pnpm add lamejs`')

  const Mp3Encoder = (lamejs as unknown as { Mp3Encoder: new (c: number, sr: number, br: number) => { encodeBuffer: (l: Int16Array, r?: Int16Array) => Int8Array; flush: () => Int8Array } }).Mp3Encoder
  const encoder = new Mp3Encoder(channels, sampleRate, bitrate)

  // lamejs expects Int16Array, so convert Float32 [-1,1] → Int16
  const toInt16 = (float: Float32Array): Int16Array => {
    const int16 = new Int16Array(float.length)
    for (let i = 0; i < float.length; i++) {
      const s = Math.max(-1, Math.min(1, float[i]!))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return int16
  }

  const blockSize = 1152
  const mp3Chunks: Uint8Array[] = []

  if (channels === 1) {
    const int16 = toInt16(interleaved)
    for (let i = 0; i < int16.length; i += blockSize) {
      const chunk = int16.subarray(i, i + blockSize)
      const mp3buf = encoder.encodeBuffer(chunk)
      if (mp3buf.length > 0) mp3Chunks.push(new Uint8Array(mp3buf))
    }
  } else {
    // De-interleave
    const left = new Float32Array(interleaved.length / 2)
    const right = new Float32Array(interleaved.length / 2)
    for (let i = 0, j = 0; i < interleaved.length; i += 2, j++) {
      left[j] = interleaved[i]!
      right[j] = interleaved[i + 1]!
    }
    const lInt16 = toInt16(left)
    const rInt16 = toInt16(right)
    for (let i = 0; i < lInt16.length; i += blockSize) {
      const lChunk = lInt16.subarray(i, i + blockSize)
      const rChunk = rInt16.subarray(i, i + blockSize)
      const mp3buf = encoder.encodeBuffer(lChunk, rChunk)
      if (mp3buf.length > 0) mp3Chunks.push(new Uint8Array(mp3buf))
    }
  }

  const flush = encoder.flush()
  if (flush.length > 0) mp3Chunks.push(new Uint8Array(flush))

  const total = mp3Chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of mp3Chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function downloadMp3(filename: string, mp3Bytes: Uint8Array) {
  const blob = new Blob([mp3Bytes], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.mp3') ? filename : `${filename}.mp3`
  a.click()
  URL.revokeObjectURL(url)
}
