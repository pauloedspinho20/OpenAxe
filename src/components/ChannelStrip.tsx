import { useState } from 'react'
import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { Fader } from './primitives/Fader'
import { HardwareButton } from './primitives/HardwareButton'
import { Led } from './primitives/Led'
import type { DualChainRig, ChainId } from '../engine/DualChainRig'
import { useDualChainStore } from '../state/dualChainStore'
import styles from './ChannelStrip.module.css'

export interface ChannelStripProps {
  chain: ChainId
  rig: DualChainRig | null
}

const FX_SLOT_COUNT = 3

function FxRow({ label }: { label: string }) {
  return (
    <div className={styles.fxRow}>
      <span className="label">{label}</span>
      <div className={styles.fxSlots}>
        {Array.from({ length: FX_SLOT_COUNT }, (_, i) => (
          <div key={i} className={styles.fxSlot}>
            +
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One chain's rack module: amp/cab readout, IR mix, FX slot placeholders
 * (effect browsing/patching UI is a fast-follow on top of this pass), and
 * the level/pan/mute/solo channel strip wired straight to dualChainStore.
 */
export function ChannelStrip({ chain, rig }: ChannelStripProps) {
  const strip = useDualChainStore((s) => (chain === 'A' ? s.chainA : s.chainB))
  const setLevel = useDualChainStore((s) => s.setLevel)
  const setPan = useDualChainStore((s) => s.setPan)
  const setMute = useDualChainStore((s) => s.setMute)
  const setSolo = useDualChainStore((s) => s.setSolo)
  const isEffectivelyMuted = useDualChainStore((s) => s.isEffectivelyMuted)

  const [irMix, setIrMixState] = useState(1)
  const amp = rig?.amp(chain) ?? null
  const modelName = amp?.getLoadedModel()?.name ?? null

  const handleIrMix = (value: number) => {
    setIrMixState(value)
    amp?.setIrMix(value)
  }

  return (
    <Panel
      label={`CHAIN ${chain}`}
      corner={<Led on={!isEffectivelyMuted(chain)} color={chain === 'A' ? 'accent' : 'green'} />}
    >
      <div className={styles.screen}>
        <span className={`label ${styles.screenLabel}`}>Amp Model</span>
        <span className={styles.screenValue}>{modelName ?? 'NO MODEL LOADED'}</span>
      </div>

      <FxRow label="Pre FX" />

      <div className={styles.row}>
        <Knob
          label="IR Mix"
          value={irMix}
          defaultValue={1}
          onChange={handleIrMix}
          disabled={!amp}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </div>

      <FxRow label="Post FX" />

      <div className={styles.stripRow}>
        <Fader
          label="Level"
          value={strip.level}
          onChange={(v) => setLevel(chain, v)}
          formatValue={(v) => v.toFixed(2)}
        />
        <Knob
          label="Pan"
          value={strip.pan}
          min={-1}
          max={1}
          defaultValue={chain === 'A' ? -1 : 1}
          onChange={(v) => setPan(chain, v)}
          formatValue={(v) => v.toFixed(2)}
        />
        <div className={styles.buttonCol}>
          <HardwareButton
            label="Mute"
            active={strip.mute}
            onClick={() => setMute(chain, !strip.mute)}
          />
          <HardwareButton
            label="Solo"
            variant="danger"
            active={strip.solo}
            onClick={() => setSolo(chain, !strip.solo)}
          />
        </div>
      </div>
    </Panel>
  )
}
