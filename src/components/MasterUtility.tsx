import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { HardwareButton } from './primitives/HardwareButton'
import { LiveMeter } from './LiveMeter'
import { useGraphStore } from '../state/graphStore'
import styles from './MasterUtility.module.css'

export interface MasterUtilityProps {
  analyser: AnalyserNode | null
}

/**
 * The fixed, non-deletable master level/mute + output meter anchored at the
 * OUT rail - not a grid block, the final-safety-net equivalent of the old
 * dual-chain rig's always-present master strip. A limiter sits between this
 * and the destination inside GraphRig itself (see GraphRig.ts) since
 * arbitrary user-built parallel merges can sum much hotter than the old
 * fixed 2-chain mix ever could.
 */
export function MasterUtility({ analyser }: MasterUtilityProps) {
  const masterLevel = useGraphStore((s) => s.masterLevel)
  const setMasterLevel = useGraphStore((s) => s.setMasterLevel)
  const masterMuted = useGraphStore((s) => s.masterMuted)
  const setMasterMuted = useGraphStore((s) => s.setMasterMuted)

  return (
    <Panel label="Master">
      <div className={styles.row}>
        <Knob
          label="Master"
          value={masterLevel}
          max={1.5}
          defaultValue={1}
          onChange={setMasterLevel}
          formatValue={(v) => v.toFixed(2)}
        />
        <LiveMeter label="Output" analyser={analyser} />
        <HardwareButton
          label="Mute"
          active={masterMuted}
          onClick={() => setMasterMuted(!masterMuted)}
        />
      </div>
    </Panel>
  )
}
