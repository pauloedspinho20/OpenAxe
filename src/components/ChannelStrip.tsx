import { useRef, useState } from 'react'
import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { Fader } from './primitives/Fader'
import { HardwareButton } from './primitives/HardwareButton'
import { Led } from './primitives/Led'
import type { DualChainRig, ChainId } from '../engine/DualChainRig'
import type { Effect, EffectKind } from '../effects/Effect'
import type { PresetEffectsChain } from '../presets/types'
import { createEffect } from '../effects/effectRegistry'
import { useDualChainStore } from '../state/dualChainStore'
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

  const addEffect = async (kind: EffectKind) => {
    if (!fxChain || !context) return
    const effect = await createEffect(context, kind)
    fxChain.insert(effect)
    onEffectsChange([...effects, effect])
    setPendingSlot(null)
  }

  const removeEffect = async (effect: Effect) => {
    if (!fxChain) return
    fxChain.remove(effect)
    await effect.dispose()
    onEffectsChange(effects.filter((e) => e !== effect))
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
            return (
              <div key={i} className={`${styles.fxSlot} ${styles.fxSlotFilled}`}>
                <button
                  type="button"
                  className={`${styles.fxSlotName} ${effect.isBypassed() ? styles.fxSlotBypassed : ''}`}
                  onClick={() => toggleBypass(effect)}
                  title={effect.isBypassed() ? 'Bypassed - click to enable' : 'Click to bypass'}
                >
                  {effect.name}
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
  const [modelName, setModelName] = useState<string | null>(null)
  const [irName, setIrName] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [preFx, setPreFx] = useState<Effect[]>([])
  const [postFx, setPostFx] = useState<Effect[]>([])

  const modelInputRef = useRef<HTMLInputElement>(null)
  const irInputRef = useRef<HTMLInputElement>(null)

  const amp = rig?.amp(chain) ?? null

  const handleModelFile = async (file: File) => {
    if (!amp) return
    setLoadError(null)
    try {
      const json = await file.text()
      await amp.loadModel(json, undefined, { id: file.name, name: file.name })
      setModelName(file.name)
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
      setIrName(file.name)
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

      <FxRow
        label="Pre FX"
        fxChain={rig?.preFx(chain) ?? null}
        context={context}
        effects={preFx}
        onEffectsChange={setPreFx}
      />

      <div className={styles.row}>
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
