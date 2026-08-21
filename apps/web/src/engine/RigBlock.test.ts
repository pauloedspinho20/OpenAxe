// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RigBlock } from './RigBlock'
import type { RigWorkletNode } from './RigWorkletNode'

function makeWorklet() {
  return {
    setTrim: vi.fn(),
    setParam: vi.fn(),
    setReverbAlgorithm: vi.fn(),
    setBypass: vi.fn(),
    loadModel: vi.fn().mockResolvedValue({ status: 'ok' as const }),
    unloadModel: vi.fn().mockResolvedValue(undefined),
    setSlimSize: vi.fn().mockResolvedValue(undefined),
    loadIr: vi.fn().mockResolvedValue(undefined),
    unloadIr: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeBuffer(channels: number[], length: number): AudioBuffer {
  const data = channels.map(() => new Float32Array(length).fill(1))
  return {
    numberOfChannels: channels.length,
    length,
    getChannelData: (i: number) => data[i],
  } as unknown as AudioBuffer
}

describe('engine/RigBlock', () => {
  let worklet: ReturnType<typeof makeWorklet>
  let block: RigBlock

  beforeEach(() => {
    worklet = makeWorklet()
    block = new RigBlock(worklet as unknown as RigWorkletNode, 'b1', 'reverb')
  })

  it('returns a defensive copy from getParams', () => {
    block.setParams({ mix: 0.5 })
    const a = block.getParams()
    a.mix = 0.9
    expect(block.getParams().mix).toBe(0.5)
  })

  it('routes input_level/output_level to setTrim, not setParam', () => {
    block.setParams({ input_level: 0.2, output_level: -3, mix: 0.5 })
    expect(worklet.setTrim).toHaveBeenCalledWith('b1', 0.2, -3)
    expect(worklet.setParam).toHaveBeenCalledWith('b1', 'mix', 0.5)
    // The I/O trims themselves must never be forwarded as DSP params.
    expect(worklet.setParam).not.toHaveBeenCalledWith('b1', 'input_level', expect.any(Number))
    expect(worklet.setParam).not.toHaveBeenCalledWith('b1', 'output_level', expect.any(Number))
  })

  it('routes reverbAlgorithm to setReverbAlgorithm', () => {
    block.setParams({ reverbAlgorithm: 'plate', mix: 0.5 })
    expect(worklet.setReverbAlgorithm).toHaveBeenCalledWith('b1', 'plate')
    expect(worklet.setParam).toHaveBeenCalledWith('b1', 'mix', 0.5)
  })

  it('coerces string and boolean params to numbers for setParam', () => {
    block.setParams({ gain: '0.7', enabled: true, disabled: false })
    expect(worklet.setParam).toHaveBeenCalledWith('b1', 'gain', 0.7)
    expect(worklet.setParam).toHaveBeenCalledWith('b1', 'enabled', 1)
    expect(worklet.setParam).toHaveBeenCalledWith('b1', 'disabled', 0)
  })

  it('tracks and forwards bypass state', () => {
    block.setBypass(true)
    expect(block.isBypassed()).toBe(true)
    expect(worklet.setBypass).toHaveBeenCalledWith('b1', true)
    block.setBypass(false)
    expect(block.isBypassed()).toBe(false)
  })

  it('records the loaded model and returns the worklet result', async () => {
    const result = await block.loadModel('{}', undefined, { id: 'm1', name: 'Model' })
    expect(result).toEqual({ status: 'ok' })
    expect(block.getLoadedModel()).toEqual({ id: 'm1', name: 'Model' })
    expect(worklet.loadModel).toHaveBeenCalledWith('b1', '{}', undefined)
  })

  it('clears the loaded model on unload', async () => {
    await block.loadModel('{}', undefined, { id: 'm1', name: 'Model' })
    await block.unloadModel()
    expect(block.getLoadedModel()).toBeNull()
    expect(worklet.unloadModel).toHaveBeenCalledWith('b1')
  })

  it('forwards slim-size changes to the worklet', async () => {
    await block.setModelSlimSize(2048)
    expect(worklet.setSlimSize).toHaveBeenCalledWith('b1', 2048)
  })

  it('folds a mono IR down to its single channel', () => {
    block.loadIR(fakeBuffer([1], 4), undefined, { id: 'ir1', name: 'IR' })
    expect(block.getLoadedIr()).toEqual({ id: 'ir1', name: 'IR' })
    const samples = worklet.loadIr.mock.calls[0][1] as Float32Array
    expect(samples).toHaveLength(4)
    expect(Array.from(samples)).toEqual([1, 1, 1, 1])
  })

  it('averages a multi-channel IR and scales by 1/channels', () => {
    block.loadIR(fakeBuffer([2], 2), undefined, { id: 'ir2', name: 'Stereo IR' })
    const samples = worklet.loadIr.mock.calls[0][1] as Float32Array
    // 2 channels of all-ones averaged and scaled by 1/2 -> 1.
    expect(Array.from(samples)).toEqual([1, 1])
  })

  it('clears the IR record if the worklet rejects the load', async () => {
    worklet.loadIr.mockRejectedValueOnce(new Error('bad ir'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    block.loadIR(fakeBuffer([1], 2), undefined, { id: 'ir3', name: 'IR' })
    expect(block.getLoadedIr()).toEqual({ id: 'ir3', name: 'IR' })
    await new Promise((r) => setTimeout(r, 0))
    expect(block.getLoadedIr()).toBeNull()
    errors.mockRestore()
  })

  it('clears the IR on clearIR', () => {
    block.loadIR(fakeBuffer([1], 2), undefined, { id: 'ir4', name: 'IR' })
    block.clearIR()
    expect(block.getLoadedIr()).toBeNull()
    expect(worklet.unloadIr).toHaveBeenCalledWith('b1')
  })
})
