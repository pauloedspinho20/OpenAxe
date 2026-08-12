import { useRef, useState } from 'react'
import type { AmpBlock } from '../../engine/blocks/AmpBlock'
import type { CabBlock } from '../../engine/blocks/CabBlock'
import { useEngineVersion } from '../../state/engineVersion'
import { useTone3000Browser } from '../../tone3000/browserStore'
import { useTone3000Library } from '../../tone3000/library'
import styles from './AssetScreenButton.module.css'

export type AssetKind = 'amp' | 'cab'

export interface AssetScreenButtonProps {
  blockId: string
  kind: AssetKind
  block: AmpBlock | CabBlock
  context: AudioContext | null
}

/**
 * The file-load "screen" for an Amp or Cab block - same shape either way
 * (loaded/empty/error state, local file picker, Tone3000 browse), extracted
 * from the old per-chain ChannelStrip so both block kinds share one
 * implementation instead of two near-identical copies.
 */
export function AssetScreenButton({ blockId, kind, block, context }: AssetScreenButtonProps) {
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openBrowser = useTone3000Browser((s) => s.openBrowser)

  // Re-render when the Tone3000 library changes (import/offline reload) so the screen shows the right name.
  useTone3000Library((s) => s.version)
  const libraryEntries = useTone3000Library((s) => s.entries)
  // Re-render after a local file load too - that path doesn't touch the
  // Tone3000 library at all, so nothing else would trigger this component
  // to look at the block's newly-loaded name again.
  useEngineVersion((s) => s.version)

  const loaded =
    kind === 'amp' ? (block as AmpBlock).getLoadedModel() : (block as CabBlock).getLoadedIr()
  const libraryEntry = loaded ? (libraryEntries.find((e) => e.id === loaded.id) ?? null) : null
  const label = kind === 'amp' ? 'Amp Model' : 'Cab IR'
  const emptyText = kind === 'amp' ? 'NO MODEL LOADED' : 'NO IR LOADED'

  const handleFile = async (file: File) => {
    setLoadError(null)
    try {
      if (kind === 'amp') {
        const json = await file.text()
        await (block as AmpBlock).loadModel(json, undefined, { id: file.name, name: file.name })
      } else {
        if (!context) return
        const audioBuffer = await context.decodeAudioData(await file.arrayBuffer())
        ;(block as CabBlock).loadIR(audioBuffer, (block as CabBlock).getIrMix(), {
          id: file.name,
          name: file.name,
        })
      }
      useEngineVersion.getState().bump()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={styles.screenBlock}>
      <input
        ref={fileInputRef}
        type="file"
        accept={kind === 'amp' ? '.nam' : 'audio/*,.wav'}
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className={styles.screen}
        onClick={() => fileInputRef.current?.click()}
        title={`Click to load a ${kind === 'amp' ? '.nam model' : 'cabinet IR'} file`}
      >
        {libraryEntry?.imageUrl && (
          <img src={libraryEntry.imageUrl} alt="" className={styles.screenImage} loading="lazy" />
        )}
        <span className={styles.screenMeta}>
          <span className={`label ${styles.screenLabel}`}>{label}</span>
          <span className={styles.screenValue}>{loaded?.name ?? emptyText}</span>
        </span>
      </button>
      <button
        type="button"
        className={styles.browseBtn}
        onClick={() => openBrowser({ blockId, slot: kind === 'amp' ? 'model' : 'ir' })}
        title={`Browse Tone3000 ${kind === 'amp' ? 'models' : 'IRs'}`}
      >
        T3K BROWSE
      </button>
      {loadError && <p className={styles.screenError}>{loadError}</p>}
    </div>
  )
}
