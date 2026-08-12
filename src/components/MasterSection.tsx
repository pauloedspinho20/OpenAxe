import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { Toggle } from './primitives/Toggle'
import { LiveMeter } from './LiveMeter'
import { useDualChainStore } from '../state/dualChainStore'
import styles from './MasterSection.module.css'

export interface MasterSectionProps {
  analyser: AnalyserNode | null
}

export function MasterSection({ analyser }: MasterSectionProps) {
  const masterLevel = useDualChainStore((s) => s.masterLevel)
  const setMasterLevel = useDualChainStore((s) => s.setMasterLevel)
  const linked = useDualChainStore((s) => s.linked)
  const setLinked = useDualChainStore((s) => s.setLinked)

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
        <Toggle label="Link A/B" checked={linked} onChange={setLinked} />
      </div>
    </Panel>
  )
}
