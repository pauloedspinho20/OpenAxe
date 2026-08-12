import { useRef, useState } from 'react'
import type { AmpBlock } from '../../engine/blocks/AmpBlock'
import type { CabBlock } from '../../engine/blocks/CabBlock'
import { useEngineVersion } from '../../state/engineVersion'
import { useTone3000Browser } from '../../tone3000/browserStore'
import { useTone3000Library } from '../../tone3000/library'
import styles from './AssetScreenButton.module.css'

/** The 6 gear-type block kinds that have an asset to load - matches Tone3000's own Gear enum minus 'experimental'. */
export type AssetGearType = 'amp' | 'amp-cab' | 'pedal' | 'outboard' | 'space' | 'cab'

export interface AssetScreenButtonProps {
  blockId: string
  gearType: AssetGearType
  block: AmpBlock | CabBlock
  context: AudioContext | null
}

const GEAR_LABELS: Record<AssetGearType, string> = {
  amp: 'Amp Model',
  'amp-cab': 'Amp+Cab Model',
  pedal: 'Pedal Model',
  outboard: 'Outboard Model',
  space: 'Space Model',
  cab: 'Cab IR',
}

/**
 * The Tone3000-first "screen" for any gear-type block. The main click opens
 * the Tone3000 browser pre-filtered to this block's own gear type (see
 * Tone3000Browser); a small secondary button opens a local file picker
 * instead, and the whole screen also accepts a file dropped from the OS.
 */
export function AssetScreenButton({ blockId, gearType, block, context }: AssetScreenButtonProps) {
  const isIr = gearType === 'cab'
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openBrowser = useTone3000Browser((s) => s.openBrowser)

  // Re-render when the Tone3000 library changes (import/offline reload) so the screen shows the right name.
  useTone3000Library((s) => s.version)
  const libraryEntries = useTone3000Library((s) => s.entries)
  // Re-render after a local file/drop load too - that path doesn't touch the
  // Tone3000 library at all, so nothing else would trigger this component
  // to look at the block's newly-loaded name again.
  useEngineVersion((s) => s.version)

  const loaded = isIr ? (block as CabBlock).getLoadedIr() : (block as AmpBlock).getLoadedModel()
  const libraryEntry = loaded ? (libraryEntries.find((e) => e.id === loaded.id) ?? null) : null
  const label = GEAR_LABELS[gearType]
  const emptyText = isIr ? 'NO IR LOADED' : 'NO MODEL LOADED'

  const loadFromFile = async (file: File) => {
    setLoadError(null)
    try {
      if (isIr) {
        if (!context) return
        const audioBuffer = await context.decodeAudioData(await file.arrayBuffer())
        ;(block as CabBlock).loadIR(audioBuffer, (block as CabBlock).getIrMix(), {
          id: file.name,
          name: file.name,
        })
      } else {
        const json = await file.text()
        await (block as AmpBlock).loadModel(json, undefined, { id: file.name, name: file.name })
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
        accept={isIr ? 'audio/*,.wav' : '.nam'}
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadFromFile(file)
          e.target.value = ''
        }}
      />
      <div className={styles.screenRow}>
        <button
          type="button"
          className={`${styles.screen} ${dragOver ? styles.screenDragOver : ''}`}
          onClick={() => openBrowser({ blockId, slot: isIr ? 'ir' : 'model', gear: gearType })}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file) void loadFromFile(file)
          }}
          title={`Browse Tone3000 ${label.toLowerCase()}s - or drop a ${isIr ? 'cabinet IR' : '.nam model'} file here`}
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
          className={styles.localFileBtn}
          onClick={() => fileInputRef.current?.click()}
          title={`Load a local ${isIr ? 'IR' : '.nam'} file instead`}
        >
          FILE
        </button>
      </div>
      {loadError && <p className={styles.screenError}>{loadError}</p>}
    </div>
  )
}
