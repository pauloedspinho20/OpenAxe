import { useRef, useState } from 'react'
import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { Fader } from './primitives/Fader'
import { HardwareButton } from './primitives/HardwareButton'
import { Led } from './primitives/Led'
import { EffectParamsPanel } from './EffectParamsPanel'
import type { DualChainRig, ChainId } from '../engine/DualChainRig'
import type { Effect, EffectKind } from '../effects/Effect'
import type { PresetEffectsChain } from '../presets/types'
import { createEffect } from '../effects/effectRegistry'
import { useDualChainStore } from '../state/dualChainStore'
import { useTone3000Browser } from '../tone3000/browserStore'
import { useTone3000Library } from '../tone3000/library'
import styles from './ChannelStrip.module.css'

export interface ChannelStripProps {
  chain: ChainId
  rig: DualChainRig | null
  context: AudioContext | null
}

const FX_SLOT_COUNT = 3

const EFFECT_OPTIONS: Array<{ kind: EffectKind; label: string }> = [
  { kind: 'noise-gate', label: 'Noise Gate' },
  { kind: 'compressor', label: 'Compressor' },
  { kind: 'eq', label: 'EQ' },
  { kind: 'drive', label: 'Drive' },
  { kind: 'chorus', label: 'Chorus' },
  { kind: 'flanger', label: 'Flanger' },
  { kind: 'phaser', label: 'Phaser' },
  { kind: 'tremolo', label: 'Tremolo' },
  { kind: 'delay', label: 'Delay' },
  { kind: 'ping-pong-delay', label: 'Ping-Pong Delay' },
  { kind: 'reverb', label: 'Reverb' },
]

interface FxRowProps {
  label: string
  fxChain: PresetEffectsChain | null
  context: AudioContext | null
  effects: Effect[]
  onEffectsChange: (effects: Effect[]) => void
}

function FxRow({ label, fxChain, context, effects, onEffectsChange }: FxRowProps) {
  const [pendingSlot, setPendingSlot] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Effect | null>(null)

  const addEffect = async (kind: EffectKind) => {
    if (!fxChain || !context) return
    const effect = await createEffect(context, kind)
    fxChain.insert(effect)
    onEffectsChange([...effects, effect])
    setPendingSlot(null)
    setExpanded(effect)
  }

  const removeEffect = async (effect: Effect) => {
    if (!fxChain) return
    fxChain.remove(effect)
    await effect.dispose()
    onEffectsChange(effects.filter((e) => e !== effect))
    setExpanded((current) => (current === effect ? null : current))
  }

  const toggleBypass = (effect: Effect) => {
    effect.setBypass(!effect.isBypassed())
    // Effect instances are mutable and not itself reactive state - force a
    // re-render by shallow-copying the array so the bypassed look updates.
    onEffectsChange([...effects])
  }

  return (
    <div className={styles.fxRow}>
      <span className="label">{label}</span>
      <div className={styles.fxSlots}>
        {Array.from({ length: FX_SLOT_COUNT }, (_, i) => {
          const effect = effects[i]
          if (effect) {
            const bypassed = effect.isBypassed()
            return (
              <div key={i} className={`${styles.fxSlot} ${styles.fxSlotFilled}`}>
                <div className={styles.fxSlotHeader}>
                  <button
                    type="button"
                    className={`${styles.fxSlotBypass} ${bypassed ? '' : styles.fxSlotBypassOn}`}
                    onClick={() => toggleBypass(effect)}
                    title={bypassed ? 'Bypassed - click to enable' : 'Click to bypass'}
                    aria-label={bypassed ? `Enable ${effect.name}` : `Bypass ${effect.name}`}
                  >
                    ●
                  </button>
                  <button
                    type="button"
                    className={styles.fxSlotRemove}
                    onClick={() => void removeEffect(effect)}
                    aria-label={`Remove ${effect.name}`}
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  className={`${styles.fxSlotName} ${bypassed ? styles.fxSlotBypassed : ''}`}
                  onClick={() => setExpanded((current) => (current === effect ? null : effect))}
                  title="Click to edit parameters"
                >
                  {effect.name}
                </button>
              </div>
            )
          }

          if (pendingSlot === i) {
            return (
              <select
                key={i}
                className={styles.fxSlotSelect}
                autoFocus
                defaultValue=""
                onBlur={() => setPendingSlot(null)}
                onChange={(e) => void addEffect(e.target.value as EffectKind)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {EFFECT_OPTIONS.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </select>
            )
          }

          return (
            <button
              key={i}
              type="button"
              className={styles.fxSlot}
              disabled={!fxChain || !context}
              onClick={() => setPendingSlot(i)}
              title={fxChain && context ? 'Add an effect' : 'Power on to add effects'}
            >
              +
            </button>
          )
        })}
      </div>
      {expanded && effects.includes(expanded) && (
        <EffectParamsPanel key={expanded.name + effects.indexOf(expanded)} effect={expanded} />
      )}
    </div>
  )
}

/**
 * One chain's rack module: amp/cab loading, FX slots, and the
 * level/pan/mute/solo channel strip wired straight to dualChainStore.
 */
export function ChannelStrip({ chain, rig, context }: ChannelStripProps) {
  const strip = useDualChainStore((s) => (chain === 'A' ? s.chainA : s.chainB))
  const setLevel = useDualChainStore((s) => s.setLevel)
  const setPan = useDualChainStore((s) => s.setPan)
  const setMute = useDualChainStore((s) => s.setMute)
  const setSolo = useDualChainStore((s) => s.setSolo)
  const isEffectivelyMuted = useDualChainStore((s) => s.isEffectivelyMuted)

  const [irMix, setIrMixState] = useState(1)
  const [bass, setBassState] = useState(0)
  const [mid, setMidState] = useState(0)
  const [treble, setTrebleState] = useState(0)
  const [presence, setPresenceState] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [preFx, setPreFx] = useState<Effect[]>([])
  const [postFx, setPostFx] = useState<Effect[]>([])

  // Re-render when the Tone3000 library changes (a sibling modal imports into this rig, or
  // loads a cached item from the library tab) so the amp/cab screens show the right name.
  useTone3000Library((s) => s.version)

  const modelInputRef = useRef<HTMLInputElement>(null)
  const irInputRef = useRef<HTMLInputElement>(null)
  const openBrowser = useTone3000Browser((s) => s.openBrowser)

  const amp = rig?.amp(chain) ?? null
  // Displayed names come from the rig, not local state - the Tone3000 modal
  // imports straight into the chain and this stays in sync with it.
  const modelName = amp?.getLoadedModel()?.name ?? null
  const irName = amp?.getLoadedIr()?.name ?? null

  const handleModelFile = async (file: File) => {
    if (!amp) return
    setLoadError(null)
    try {
      const json = await file.text()
      await amp.loadModel(json, undefined, { id: file.name, name: file.name })
    } catch (error) {
      setLoadError(`Model: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleIrFile = async (file: File) => {
    if (!amp || !context) return
    setLoadError(null)
    try {
      const audioBuffer = await context.decodeAudioData(await file.arrayBuffer())
      amp.loadIR(audioBuffer, irMix, { id: file.name, name: file.name })
    } catch (error) {
      setLoadError(`IR: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleIrMix = (value: number) => {
    setIrMixState(value)
    amp?.setIrMix(value)
  }

  return (
    <Panel
      label={`CHAIN ${chain}`}
      corner={<Led on={!isEffectivelyMuted(chain)} color={chain === 'A' ? 'accent' : 'green'} />}
    >
      <input
        ref={modelInputRef}
        type="file"
        accept=".nam"
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleModelFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={irInputRef}
        type="file"
        accept="audio/*,.wav"
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleIrFile(file)
          e.target.value = ''
        }}
      />

      <div className={styles.screenBlock}>
        <button
          type="button"
          className={styles.screen}
          disabled={!amp}
          onClick={() => modelInputRef.current?.click()}
          title={amp ? 'Click to load a .nam model file' : 'Power on to load a model'}
        >
          <span className={`label ${styles.screenLabel}`}>Amp Model</span>
          <span className={styles.screenValue}>{modelName ?? 'NO MODEL LOADED'}</span>
        </button>
        <button
          type="button"
          className={styles.browseBtn}
          disabled={!amp}
          onClick={() => openBrowser({ chain, slot: 'model' })}
          title={amp ? 'Browse Tone3000 models' : 'Power on to browse Tone3000'}
        >
          T3K BROWSE
        </button>
      </div>

      {modelName && (
        <div className={styles.ampControls}>
          <div className={styles.toneStack}>
            <Knob
              label="Bass"
              value={bass}
              min={-12}
              max={12}
              defaultValue={0}
              onChange={(v) => {
                setBassState(v)
                amp?.setBass(v)
              }}
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
            <Knob
              label="Mid"
              value={mid}
              min={-12}
              max={12}
              defaultValue={0}
              onChange={(v) => {
                setMidState(v)
                amp?.setMid(v)
              }}
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
            <Knob
              label="Treble"
              value={treble}
              min={-12}
              max={12}
              defaultValue={0}
              onChange={(v) => {
                setTrebleState(v)
                amp?.setTreble(v)
              }}
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
            <Knob
              label="Presence"
              value={presence}
              min={-12}
              max={12}
              defaultValue={0}
              onChange={(v) => {
                setPresenceState(v)
                amp?.setPresence(v)
              }}
              formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
          </div>
          <div className={styles.ampMetaRow}>
            {amp?.getSlimmableInfo() && (
              <select
                className={styles.slimSizeSelect}
                value={amp.getSlimmableInfo()!.currentSize}
                onChange={(e) => void amp!.setModelSlimSize(Number(e.target.value))}
                aria-label="Model slim size"
              >
                <option value={1}>Full (100%)</option>
                {amp.getSlimmableInfo()!.breakpoints.map((bp) => (
                  <option key={bp} value={bp}>
                    {slimLabel(bp)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={styles.unloadBtn}
              onClick={() => {
                void amp?.unloadModel()
                setBassState(0)
                setMidState(0)
                setTrebleState(0)
                setPresenceState(0)
              }}
              title="Unload the amp model"
            >
              UNLOAD
            </button>
          </div>
        </div>
      )}

      <FxRow
        label="Pre FX"
        fxChain={rig?.preFx(chain) ?? null}
        context={context}
        effects={preFx}
        onEffectsChange={setPreFx}
      />

      <div className={styles.row}>
        <div className={styles.screenBlock}>
          <button
            type="button"
            className={styles.screen}
            disabled={!amp || !context}
            onClick={() => irInputRef.current?.click()}
            title={amp ? 'Click to load a cabinet IR file' : 'Power on to load an IR'}
          >
            <span className={`label ${styles.screenLabel}`}>Cab IR</span>
            <span className={styles.screenValue}>{irName ?? 'NO IR LOADED'}</span>
          </button>
          <button
            type="button"
            className={styles.browseBtn}
            disabled={!amp || !context}
            onClick={() => openBrowser({ chain, slot: 'ir' })}
            title={amp ? 'Browse Tone3000 IRs' : 'Power on to browse Tone3000'}
          >
            T3K BROWSE
          </button>
        </div>
        <Knob
          label="IR Mix"
          value={irMix}
          defaultValue={1}
          onChange={handleIrMix}
          disabled={!amp}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </div>

      {loadError && <p className={styles.screenError}>{loadError}</p>}

      <FxRow
        label="Post FX"
        fxChain={rig?.postFx(chain) ?? null}
        context={context}
        effects={postFx}
        onEffectsChange={setPostFx}
      />

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

/** Convert a slim ratio (0.01–1) to a human-readable label. */
function slimLabel(ratio: number): string {
  if (ratio >= 0.9) return 'Full (100%)'
  if (ratio >= 0.4) return `Lite (${Math.round(ratio * 100)}%)`
  if (ratio >= 0.15) return `Feather (${Math.round(ratio * 100)}%)`
  return `Nano (${Math.round(ratio * 100)}%)`
}
