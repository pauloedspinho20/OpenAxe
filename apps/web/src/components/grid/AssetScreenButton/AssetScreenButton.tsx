import { useRef, useState } from 'react'
import type { AmpBlock } from '../../../engine/blocks/AmpBlock'
import type { CabBlock } from '../../../engine/blocks/CabBlock'
import {
  assertIrBytes,
  assertIrFile,
  assertModelFile,
  assertModelText,
} from '../../../engine/assetLimits'
import { useEngineVersion } from '../../../state/engineVersion'
import { useSettingsStore } from '../../../state/settingsStore'
import { useTone3000Browser } from '../../../tone3000/browserStore'
import { useTone3000Library } from '../../../tone3000/library'
import styles from './AssetScreenButton.module.css'
import { HardwareButton } from '@openaxe/ui'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openBrowser = useTone3000Browser((s) => s.openBrowser)

  // Re-render when the Tone3000 library changes (import/offline reload) so the screen shows the right name.
  useTone3000Library((s) => s.version)
  // Re-render after a local file/drop load too - that path doesn't touch the
  // Tone3000 library at all, so nothing else would trigger this component
  // to look at the block's newly-loaded name again.
  useEngineVersion((s) => s.version)

  const loaded = isIr ? (block as CabBlock).getLoadedIr() : (block as AmpBlock).getLoadedModel()
  const label = GEAR_LABELS[gearType]
  const emptyText = isIr ? 'NO IR LOADED' : 'NO MODEL LOADED'

  const loadFromFile = async (file: File) => {
    setLoadError(null)
    try {
      if (isIr) {
        if (!context) return
        assertIrFile(file)
        const buf = await file.arrayBuffer()
        assertIrBytes(buf)
        const audioBuffer = await context.decodeAudioData(buf)
        ;(block as CabBlock).loadIR(audioBuffer, (block as CabBlock).getIrMix(), {
          id: file.name,
          name: file.name,
        })
      } else {
        assertModelFile(file)
        const json = await file.text()
        assertModelText(json)
        const quality = useSettingsStore.getState().namQuality
        await (block as AmpBlock).loadModel(json, quality, { id: file.name, name: file.name })
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
        className="srOnly"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadFromFile(file)
          e.target.value = ''
        }}
      />
      <div className={styles.screenRow}>
        <HardwareButton
          onClick={() => openBrowser({ blockId, slot: isIr ? 'ir' : 'model', gear: gearType })}
          title={`Browse Tone3000 ${label.toLowerCase()}s - or drop a ${isIr ? 'cabinet IR' : '.nam model'} file here`}
          label={loaded ? 'CATALOG' : emptyText}
        ></HardwareButton>
        <HardwareButton
          onClick={() => fileInputRef.current?.click()}
          label={`UPLOAD ${isIr ? 'IR' : 'NAM'}`}
        ></HardwareButton>
      </div>
      {loadError && <p className={styles.screenError}>{loadError}</p>}
    </div>
  )
}
