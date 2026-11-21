import { useEffect, useState, type CSSProperties } from 'react'
import {
  Badge,
  BlockIcon,
  Chip,
  HardwareButton,
  Knob,
  Led,
  MediumMeter,
  Meter,
  Panel,
  PowerIcon,
  Select,
  StereoMeter,
  UndoIcon,
  levelToPeakDb,
  type BlockKind,
} from '@openaxe/ui'
import {
  BLOCK_BY_KIND,
  PATCH_CHAIN_KINDS,
  SIGNAL_BLOCKS,
  type PaletteCategory,
  type ParamControlDef,
} from './signalBlocks'
import styles from './SignalArchitecture.module.css'

type ParamValues = Record<string, Record<string, number | string>>

function buildInitialValues(): ParamValues {
  const map: ParamValues = {}
  for (const def of SIGNAL_BLOCKS) {
    const entry: Record<string, number | string> = {}
    for (const p of def.params) {
      entry[p.key] = p.defaultValue
    }
    map[def.kind] = entry
  }
  return map
}

function useLiveSignalEnvelope(): number {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const id = window.setInterval(() => {
      setPhase((prev) => (prev + 0.35) % (Math.PI * 2))
    }, 450)
    return () => window.clearInterval(id)
  }, [])

  return 0.42 + Math.sin(phase) * 0.14
}

export function SignalArchitecture() {
  const [selectedKind, setSelectedKind] = useState<BlockKind>('delay')
  const [paramValues, setParamValues] = useState<ParamValues>(buildInitialValues)
  const [bypassedKinds, setBypassedKinds] = useState<Record<string, boolean>>({})
  const [inputTrim, setInputTrim] = useState(1)
  const [masterLevel, setMasterLevel] = useState(1)
  const [masterMuted, setMasterMuted] = useState(false)

  const envelope = useLiveSignalEnvelope()
  const activeDef = BLOCK_BY_KIND.get(selectedKind) ?? SIGNAL_BLOCKS[0]!
  const activeValues = paramValues[activeDef.kind] ?? {}
  const activeBypassed = Boolean(bypassedKinds[activeDef.kind])

  const selectFields = activeDef.params.filter(
    (p): p is Extract<ParamControlDef, { control: 'select' }> => p.control === 'select',
  )
  const knobFields = activeDef.params.filter(
    (p): p is Extract<ParamControlDef, { control: 'knob' }> => p.control === 'knob',
  )

  const isDirty = activeDef.params.some((p) => activeValues[p.key] !== p.defaultValue)

  const updateParam = (key: string, nextValue: number | string) => {
    setParamValues((prev) => ({
      ...prev,
      [activeDef.kind]: {
        ...(prev[activeDef.kind] ?? {}),
        [key]: nextValue,
      },
    }))
  }

  const resetActiveParams = () => {
    const defaults: Record<string, number | string> = {}
    for (const p of activeDef.params) defaults[p.key] = p.defaultValue
    setParamValues((prev) => ({ ...prev, [activeDef.kind]: defaults }))
  }

  const toggleBypass = (kind: BlockKind) => {
    const def = BLOCK_BY_KIND.get(kind)
    if (!def?.bypassable) return
    setBypassedKinds((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }

  const inputLevel = Math.min(1, envelope * inputTrim)
  const blockGainFactor = activeBypassed
    ? 1
    : typeof activeValues.level === 'number'
      ? activeValues.level
      : typeof activeValues.trim_out === 'number'
        ? activeValues.trim_out
        : 1.08
  const blockOutLevel = Math.min(1, inputLevel * blockGainFactor)
  const outputBase = masterMuted ? 0 : Math.min(1, inputLevel * 0.92 * masterLevel)
  const outputLeft = outputBase
  const outputRight = masterMuted ? 0 : Math.min(1, outputBase * 0.96)

  const categories: PaletteCategory[] = ['Neural Amp Modeler', 'Core', 'Effects']

  const cornerReadout = (
    <div className={styles.cornerGroup}>
      {activeDef.category === 'Neural Amp Modeler' && (
        <span className={styles.assetTag}>
          {activeDef.kind === 'cab' ? 'CAB IR · .WAV' : 'NAM CAPTURE · .NAM'}
        </span>
      )}
      <Badge tone="live">C++ CORE</Badge>
    </div>
  )

  return (
    <div className={styles.root}>
      {/* 1. Real @openaxe/ui Panel Inspector */}
      <Panel
        label={activeDef.label}
        labelUrl={activeDef.vendor}
        url={activeDef.vendorUrl}
        corner={cornerReadout}
      >
        <p className={styles.inspectorSummary}>{activeDef.summary}</p>

        <div className={styles.inspectorControlsRow}>
          <div className={styles.controlsCluster}>
            {selectFields.length > 0 && (
              <div className={styles.selectRow}>
                {selectFields.map((field) => (
                  <div key={field.key} className={styles.selectCell} title={field.description}>
                    <Select
                      label={field.label}
                      value={String(activeValues[field.key] ?? field.defaultValue)}
                      onChange={(e) => updateParam(field.key, e.target.value)}
                    >
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            )}

            {knobFields.length > 0 ? (
              <div className={styles.knobsRow}>
                {knobFields.map((field) => (
                  <Knob
                    key={`${activeDef.kind}:${field.key}`}
                    label={field.label}
                    value={Number(activeValues[field.key] ?? field.defaultValue)}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    defaultValue={field.defaultValue}
                    formatValue={field.formatValue}
                    size={50}
                    description={field.description}
                    onChange={(v) => updateParam(field.key, v)}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.emptyParams}>
                Zero-parameter signal routing relay — wire directly to its paired bus block.
              </p>
            )}
          </div>

          <div className={styles.inspectorSide}>
            <div className={styles.actionButtons}>
              {activeDef.bypassable && (
                <HardwareButton
                  label={activeBypassed ? 'Enable block' : 'Bypass block'}
                  icon={<PowerIcon size={14} />}
                  active={!activeBypassed}
                  iconOnly
                  onClick={() => toggleBypass(activeDef.kind)}
                  title={activeBypassed ? 'Bypassed — click to enable' : 'Active — click to bypass'}
                />
              )}
              {activeDef.params.length > 0 && (
                <HardwareButton
                  label="Reset block parameters"
                  icon={<UndoIcon size={12} />}
                  size="small"
                  iconOnly
                  disabled={!isDirty}
                  onClick={resetActiveParams}
                  title="Reset parameters to defaults"
                />
              )}
            </div>

            <div className={styles.metersPair}>
              <MediumMeter label="IN" level={inputLevel} valueLabel={levelToPeakDb(inputLevel)} />
              <MediumMeter
                label="OUT"
                level={blockOutLevel}
                valueLabel={levelToPeakDb(blockOutLevel)}
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* 2. Interactive Cabled Signal Rack with Real Input/Output Rails */}
      <div className={styles.rackWrap} role="group" aria-label="Interactive signal chain">
        <div className={styles.rail}>
          <HardwareButton
            fullWidth
            size="small"
            label="INPUT"
            active
            onClick={() => setInputTrim(1)}
            title="Click to reset Trim to unity"
          />
          <Knob
            label="Trim"
            value={inputTrim}
            min={0}
            max={2}
            step={0.01}
            defaultValue={1}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            size={44}
            onChange={setInputTrim}
          />
          <Meter label="Input" level={inputLevel} valueLabel={levelToPeakDb(inputLevel)} />
        </div>

        <div className={styles.chainScroll}>
          {PATCH_CHAIN_KINDS.map((kind, idx) => {
            const def = BLOCK_BY_KIND.get(kind)!
            const selected = selectedKind === kind
            const bypassed = Boolean(bypassedKinds[kind])
            return (
              <div key={kind} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {idx > 0 && <span className={styles.cable} aria-hidden="true" />}
                <div
                  role="button"
                  tabIndex={0}
                  className={`${styles.blockCard} ${selected ? styles.blockCardSelected : ''} ${bypassed ? styles.blockCardBypassed : ''}`}
                  aria-pressed={selected}
                  aria-label={`Inspect ${def.label} block`}
                  onClick={() => setSelectedKind(kind)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedKind(kind)
                    }
                  }}
                >
                  <span className={`${styles.jackDot} ${styles.jackIn}`} aria-hidden="true" />
                  <span className={`${styles.jackDot} ${styles.jackOut}`} aria-hidden="true" />

                  <div className={styles.blockCardTop}>
                    {def.bypassable ? (
                      <button
                        type="button"
                        className={styles.ledButton}
                        aria-label={bypassed ? `Enable ${def.label}` : `Bypass ${def.label}`}
                        title={bypassed ? 'Bypassed — click to enable' : 'Active — click to bypass'}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleBypass(kind)
                        }}
                      >
                        <Led on={!bypassed} color="statusGreen" />
                      </button>
                    ) : (
                      <Led on color="statusGreen" />
                    )}
                  </div>

                  <div className={styles.blockGlyph}>
                    {bypassed ? (
                      <span className={styles.bypassLine} aria-hidden="true" />
                    ) : (
                      <BlockIcon kind={kind} size={28} />
                    )}
                  </div>

                  <span className={styles.blockLabel}>{def.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.rail}>
          <HardwareButton
            fullWidth
            size="small"
            label="MUTE"
            variant={masterMuted ? 'danger' : 'default'}
            active={masterMuted}
            onClick={() => setMasterMuted((m) => !m)}
          />
          <Knob
            label="Master"
            value={masterLevel}
            min={0}
            max={1.5}
            step={0.01}
            defaultValue={1}
            formatValue={(v) => v.toFixed(2)}
            size={44}
            onChange={setMasterLevel}
          />
          <StereoMeter
            label="Output"
            levelL={outputLeft}
            levelR={outputRight}
            valueLabelL={levelToPeakDb(outputLeft)}
            valueLabelR={levelToPeakDb(outputRight)}
          />
        </div>
      </div>

      {/* 3. Real @openaxe/ui Chip Palette (all 19 blocks) */}
      <div className={styles.palettePanel} aria-label="All 19 OpenAxe block types">
        {categories.map((cat) => {
          const items = SIGNAL_BLOCKS.filter((b) => b.category === cat)
          return (
            <div key={cat} className={styles.paletteGroup}>
              <span className="label">
                {cat} ({items.length})
              </span>
              <div className={styles.paletteChips} role="menu" aria-label={cat}>
                {items.map((item) => {
                  const active = item.kind === selectedKind
                  return (
                    <div
                      key={item.kind}
                      className={`${styles.chipWrap} ${active ? styles.chipWrapActive : ''}`}
                    >
                      <Chip
                        kind={item.kind}
                        label={item.label}
                        onPick={(kind) => setSelectedKind(kind)}
                        style={{ '--block-color': `var(${item.colorVar})` } as CSSProperties}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
