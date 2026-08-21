// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MAX_IR_BYTES,
  MAX_MODEL_BYTES,
  assertIrBytes,
  assertIrFile,
  assertModelFile,
  assertModelText,
} from './assetLimits'

function fakeFile(name: string, size: number): File {
  return { name, size } as File
}

describe('assetLimits', () => {
  it('rejects an oversized IR file before any bytes are read', () => {
    expect(() => assertIrFile(fakeFile('ir.wav', MAX_IR_BYTES + 1))).toThrow(/too large/)
    expect(() => assertIrFile(fakeFile('ir.wav', MAX_IR_BYTES))).not.toThrow()
  })

  it('rejects a non-.wav IR by extension', () => {
    expect(() => assertIrFile(fakeFile('ir.mp3', 100))).toThrow(/\.wav/)
  })

  it('rejects an oversized model file before any bytes are read', () => {
    expect(() => assertModelFile(fakeFile('m.nam', MAX_MODEL_BYTES + 1))).toThrow(/too large/)
    expect(() => assertModelFile(fakeFile('m.nam', MAX_MODEL_BYTES))).not.toThrow()
  })

  it('rejects a non-.nam model by extension', () => {
    expect(() => assertModelFile(fakeFile('m.json', 100))).toThrow(/\.nam/)
  })

  it('accepts a valid RIFF/WAVE buffer and rejects a non-WAV buffer', () => {
    const ok = new ArrayBuffer(44)
    const view = new DataView(ok)
    view.setUint32(0, 0x46464952, true) // 'RIFF'
    view.setUint32(8, 0x45564157, true) // 'WAVE'
    expect(() => assertIrBytes(ok)).not.toThrow()

    expect(() => assertIrBytes(new ArrayBuffer(8))).toThrow(/WAV/)
    const bad = new ArrayBuffer(44)
    expect(() => assertIrBytes(bad)).toThrow(/WAV/)
  })

  it('accepts JSON model text and rejects non-JSON', () => {
    expect(() => assertModelText('{"a":1}')).not.toThrow()
    expect(() => assertModelText('  [1,2]')).not.toThrow()
    expect(() => assertModelText('not json at all')).toThrow(/JSON/)
  })
})
