// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssetScreenButton } from './AssetScreenButton'
import { useTone3000Browser } from '../../../tone3000/browserStore'
import { useEngineVersion } from '../../../state/engineVersion'

function makeWavFile(): File {
  const buf = new ArrayBuffer(12)
  const dv = new DataView(buf)
  dv.setUint32(0, 0x46464952, true) // 'RIFF'
  dv.setUint32(8, 0x45564157, true) // 'WAVE'
  const file = new File([buf], 'ir.wav', { type: 'audio/wav' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

function makeNamFile(): File {
  const file = new File(['{}'], 'model.nam', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => '{}' })
  return file
}

function upload(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('AssetScreenButton', () => {
  let modelBlock: { getLoadedModel: () => null; loadModel: ReturnType<typeof vi.fn> }
  let irBlock: { getLoadedIr: () => null; getIrMix: () => number; loadIR: ReturnType<typeof vi.fn> }
  let context: { decodeAudioData: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    useTone3000Browser.setState({ open: false, target: null })
    useEngineVersion.setState({ version: 0 })
    modelBlock = { getLoadedModel: () => null, loadModel: vi.fn().mockResolvedValue(undefined) }
    irBlock = { getLoadedIr: () => null, getIrMix: () => 0.5, loadIR: vi.fn() }
    context = { decodeAudioData: vi.fn().mockResolvedValue({}) } as unknown as {
      decodeAudioData: ReturnType<typeof vi.fn>
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('model (amp) block', () => {
    it('shows the empty state and opens the browser on the browse button', () => {
      render(
        <AssetScreenButton blockId="b1" gearType="amp" block={modelBlock as any} context={null} />,
      )
      expect(screen.getByText('NO MODEL LOADED')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'NO MODEL LOADED' }))
      expect(useTone3000Browser.getState().target).toEqual({
        blockId: 'b1',
        slot: 'model',
        gear: 'amp',
      })
    })

    it('triggers the hidden file input via the upload button', () => {
      const click = vi.fn()
      render(
        <AssetScreenButton blockId="b1" gearType="amp" block={modelBlock as any} context={null} />,
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      vi.spyOn(input, 'click').mockImplementation(click)
      fireEvent.click(screen.getByRole('button', { name: 'UPLOAD NAM' }))
      expect(click).toHaveBeenCalled()
    })

    it('loads a .nam file into the block and bumps the engine version', async () => {
      render(
        <AssetScreenButton blockId="b1" gearType="amp" block={modelBlock as any} context={null} />,
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      upload(input, makeNamFile())
      await waitFor(() => expect(modelBlock.loadModel).toHaveBeenCalled())
      expect(modelBlock.loadModel.mock.calls[0]![0]).toBe('{}')
      expect(useEngineVersion.getState().version).toBe(1)
    })

    it('surfaces an invalid file as a load error', async () => {
      const bad = new File(['x'], 'model.txt', { type: 'text/plain' })
      render(
        <AssetScreenButton blockId="b1" gearType="amp" block={modelBlock as any} context={null} />,
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      upload(input, bad)
      expect(await screen.findByText(/must be a \.nam file/)).toBeInTheDocument()
      expect(modelBlock.loadModel).not.toHaveBeenCalled()
    })
  })

  describe('IR (cab) block', () => {
    it('shows the IR empty state', () => {
      render(
        <AssetScreenButton
          blockId="c1"
          gearType="cab"
          block={irBlock as any}
          context={context as any}
        />,
      )
      expect(screen.getByText('NO IR LOADED')).toBeInTheDocument()
    })

    it('decodes and loads a .wav IR into the block', async () => {
      render(
        <AssetScreenButton
          blockId="c1"
          gearType="cab"
          block={irBlock as any}
          context={context as any}
        />,
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      upload(input, makeWavFile())
      await waitFor(() => expect(irBlock.loadIR).toHaveBeenCalled())
      expect(context.decodeAudioData).toHaveBeenCalled()
      expect(useEngineVersion.getState().version).toBeTruthy()
    })

    it('refuses to load when no audio context is present', async () => {
      render(
        <AssetScreenButton blockId="c1" gearType="cab" block={irBlock as any} context={null} />,
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      upload(input, makeWavFile())
      // No error, nothing loaded - the handler returns early without a context.
      await new Promise((r) => setTimeout(r, 10))
      expect(irBlock.loadIR).not.toHaveBeenCalled()
    })
  })
})
