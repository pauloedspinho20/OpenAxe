import { useState } from 'react'
import { useGraphStore } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'
import { useEngineVersion } from '../../../state/engineVersion'
import { useTone3000Library } from '../../../tone3000/library'
import { NAM_MODEL_KINDS } from '../../../engine/blocks/blockRegistry'
import type { GraphRig } from '../../../engine/GraphRig'
import type { AmpBlock } from '../../../engine/blocks/AmpBlock'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import { AudioReactiveArt } from '../audioArt/AudioReactiveArt'
import { toArtVariant } from '../audioArt/sketches'
import { NamModelDetails } from '../NamModelDetails/NamModelDetails'
import styles from './BlockHighlight.module.css'

export interface BlockHighlightProps {
  rig: GraphRig | null
  /** Post-graph/master output tap - the default art's signal source when nothing is selected. */
  analyser: AnalyserNode | null
}

/**
 * Sits between BlockPalette and BlockInspector: a single box that always
 * shows something about the current selection. A NAM-core block (amp/
 * amp-cab/pedal/outboard/space) shows its Tone3000 model as a showcase card
 * - click it for the full NamModelDetails dialog. Any other selected block
 * (an effect, cab, mixer, or splitter), or no selection at all, shows a
 * p5.js audio-reactive visual driven by that block's own output (or the
 * master output when nothing's selected) - see audioArt/sketches.ts for how
 * each block kind maps to a visual.
 */
export function BlockHighlight({ rig, analyser }: BlockHighlightProps) {
  // Re-render once async block creation / a local file load finishes - see BlockInspector for why.
  useEngineVersion((s) => s.version)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)
  const blocks = useGraphStore((s) => s.blocks)
  // Re-render on import and on a library->chain reload (see Tone3000Library.notifyLoaded).
  useTone3000Library((s) => s.version)
  const libraryEntries = useTone3000Library((s) => s.entries)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const instance = selectedBlockId ? (blocks.find((b) => b.id === selectedBlockId) ?? null) : null
  const isNamCore = instance ? NAM_MODEL_KINDS.has(instance.kind) : false
  const block = instance ? (rig?.getBlock(instance.id) ?? null) : null
  const kindLabel = instance ? BLOCK_KIND_LABELS[instance.kind] : 'Master Output'

  if (instance && isNamCore) {
    const loaded = (block as AmpBlock | null)?.getLoadedModel?.() ?? null
    const libraryEntry = loaded ? (libraryEntries.find((e) => e.id === loaded.id) ?? null) : null
    const hasImage = Boolean(libraryEntry?.imageUrl)

    return (
      <div className={styles.box}>
        {loaded ? (
          <button
            type="button"
            className={`${styles.namButton} ${hasImage ? styles.namButtonWithImage : ''}`}
            style={hasImage ? { backgroundImage: `url(${libraryEntry!.imageUrl})` } : undefined}
            onClick={() => setDetailsOpen(true)}
            title={`View details for ${loaded.name}`}
          >
            <span className={`label ${styles.kindChip}`}>{kindLabel}</span>
            <span className={styles.namInfo}>
              <span className={styles.modelName}>{loaded.name}</span>
              {libraryEntry?.creator && (
                <span className={styles.creator}>by {libraryEntry.creator}</span>
              )}
              <span className={`label ${styles.hint}`}>View details</span>
            </span>
          </button>
        ) : (
          <div className={styles.namEmpty}>
            <span className="label">{kindLabel}</span>
            <span className={styles.emptyText}>No model loaded</span>
          </div>
        )}

        <NamModelDetails
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          kindLabel={kindLabel}
          loadedName={loaded?.name ?? null}
          entry={libraryEntry}
        />
      </div>
    )
  }

  const artAnalyser = instance ? (rig?.getBlockAnalyser(instance.id) ?? null) : analyser
  const artVariant = toArtVariant(instance ? instance.kind : 'master')

  return (
    <div className={styles.box}>
      <div className={styles.artWrap}>
        <span className={`label ${styles.artLabel}`}>{kindLabel}</span>
        <AudioReactiveArt analyser={artAnalyser} variant={artVariant} />
      </div>
    </div>
  )
}
