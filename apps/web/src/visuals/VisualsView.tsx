import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HardwareButton, Select, Toggle, toast } from '@openaxe/ui'

import { VIDEO_SIZES } from '../media/videoFormats'
import { FeatureMeters } from './ui/FeatureMeters'
import { ModulationEditor } from './ui/ModulationEditor'
import { ParamControl } from './ui/ParamControl'
import { PresetBar } from './ui/PresetBar'
import { VisualsEngine, type AudioTap, type EngineStatus } from './engine/VisualsEngine'
import { downloadBlob, recordingSupported, startRecording, type Recording } from './engine/recorder'
import { SCENES, findScene } from './registry'
import type { AudioFeatures } from './audio/features'
import type { SceneParam } from './types'
import { useVisualsMidi } from './useVisualsMidi'
import {
  resolveModulations,
  resolveParams,
  useVisualsStore,
  type AudioSourceMode,
} from './visualsStore'
import styles from './ui/Visuals.module.css'

export interface VisualsViewProps {
  /** The view is on screen (rendering pauses while hidden, unless recording). */
  active: boolean
  context: AudioContext | null
  rig: { outputNode?: unknown } | null
  /** Post-rig output tap (256-pt; used where a bigger tap cannot be made, e.g. desktop). */
  outputAnalyser: AudioTap | null
  /** Dry input tap (4096-pt, the tuner's). */
  inputAnalyser: AudioTap | null
}

const SOURCE_LABEL: Record<AudioSourceMode, string> = {
  hybrid: 'Hybrid: pitch from input, tone from output',
  input: 'Input: dry guitar',
  output: 'Output: what you hear',
}

const isWebAudio = (context: unknown): context is AudioContext =>
  typeof AudioContext !== 'undefined' && context instanceof AudioContext
const isAudioNode = (node: unknown): node is AudioNode =>
  typeof AudioNode !== 'undefined' && node instanceof AudioNode

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VisualsView({
  active,
  context,
  rig,
  outputAnalyser,
  inputAnalyser,
}: VisualsViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<VisualsEngine | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [status, setStatus] = useState<EngineStatus>({ kind: 'idle' })
  const [fps, setFps] = useState(0)
  const [backend, setBackend] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [recording, setRecording] = useState<{
    rec: Recording
    startedAt: number
    cleanup: () => void
  } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [features, setFeatures] = useState<Readonly<AudioFeatures> | null>(null)
  const [canRecord, setCanRecord] = useState(false)

  const store = useVisualsStore()
  const def = findScene(store.sceneId)
  const sceneState = store.scenes[def.id]
  const params = useMemo(() => resolveParams(def, sceneState), [def, sceneState])
  const mods = useMemo(() => resolveModulations(def, sceneState), [def, sceneState])
  const rebuildKey = useMemo(
    () =>
      JSON.stringify(
        def.params.filter((p) => p.type === 'number' && p.rebuild).map((p) => params[p.key]),
      ),
    [def, params],
  )

  // ——— Engine lifecycle ———
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new VisualsEngine(canvas, { status: setStatus, fps: setFps })
    engineRef.current = engine
    let cancelled = false
    engine
      .init()
      .then(() => {
        if (cancelled) return
        setBackend(engine.backend)
        setFeatures(engine.features)
        setCanRecord(recordingSupported(canvas))
        setEngineReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[visuals] renderer init failed', error)
        setStatus({
          kind: 'error',
          message: 'Neither WebGPU nor WebGL2 is available in this browser, so visuals cannot run.',
        })
      })
    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
      setEngineReady(false)
    }
  }, [])

  // Viewport size.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect()
      engineRef.current?.setViewport(r.width, r.height)
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [engineReady])

  // ——— Audio taps ———
  // Wider than the meters' 256-pt tap: timbre needs real frequency resolution.
  // Web Audio only; the desktop shell falls back to its own output tap.
  const bigOutputTap = useMemo(
    () =>
      isWebAudio(context) && isAudioNode(rig?.outputNode)
        ? new AnalyserNode(context, { fftSize: 2048, smoothingTimeConstant: 0 })
        : null,
    [context, rig],
  )
  useEffect(() => {
    const out = rig?.outputNode
    if (!bigOutputTap || !isAudioNode(out)) return
    out.connect(bigOutputTap)
    return () => {
      try {
        out.disconnect(bigOutputTap)
      } catch {
        // already gone with the rig
      }
    }
  }, [bigOutputTap, rig])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const output: AudioTap | null = bigOutputTap ?? outputAnalyser
    const input = inputAnalyser
    const pick = (a: AudioTap | null, b: AudioTap | null) => a ?? b
    const taps =
      store.source === 'input'
        ? { spectral: pick(input, output), pitch: pick(input, output) }
        : store.source === 'output'
          ? { spectral: pick(output, input), pitch: pick(output, input) }
          : { spectral: pick(output, input), pitch: pick(input, output) }
    engine.setTaps({ ...taps, sampleRate: context?.sampleRate ?? 48000 })
  }, [engineReady, bigOutputTap, outputAnalyser, inputAnalyser, store.source, context])

  // ——— Settings -> engine ———
  useEffect(() => {
    engineRef.current?.setAnalysis(store.analysis)
  }, [engineReady, store.analysis])

  useEffect(() => {
    engineRef.current?.setPerformance(
      store.performance.resolution,
      recording ? store.record.fps : store.performance.fpsCap,
    )
  }, [engineReady, store.performance, store.record.fps, recording])

  useEffect(() => {
    engineRef.current?.setPaused(!active && !recording)
  }, [engineReady, active, recording])

  // Scene load / rebuild. params are read through a ref so ordinary param
  // edits do not reload the scene - only a scene switch or a rebuild param.
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  }, [params])
  useEffect(() => {
    if (!engineReady) return
    void engineRef.current?.loadScene(def, paramsRef.current)
  }, [engineReady, def, rebuildKey])

  useEffect(() => {
    engineRef.current?.setParams(params)
  }, [engineReady, params])

  useEffect(() => {
    engineRef.current?.setModulations(mods)
  }, [engineReady, mods])

  const runAction = useCallback((key: string) => engineRef.current?.action(key), [])
  useVisualsMidi(runAction)

  // ——— Pointer -> scene ———
  const onPointer =
    (type: 'down' | 'move' | 'up') => (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      if (type === 'down') e.currentTarget.setPointerCapture(e.pointerId)
      engineRef.current?.pointer({
        type,
        id: e.pointerId,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
      if (fullscreen) poke()
    }

  // ——— Fullscreen ———
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = useCallback(() => {
    setChromeVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChromeVisible(false), 2500)
  }, [])
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === stageRef.current
      setFullscreen(fs)
      if (fs) poke()
      else {
        setChromeVisible(true)
        if (hideTimer.current) clearTimeout(hideTimer.current)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [poke])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else
      stageRef.current?.requestFullscreen?.().catch(() => {
        toast.error('Fullscreen was blocked by the browser.')
      })
  }

  // ——— Recording ———
  const recordSize = VIDEO_SIZES.find((s) => s.id === store.record.sizeId) ?? VIDEO_SIZES[0]!
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((performance.now() - recording.startedAt) / 1000), 250)
    return () => clearInterval(id)
  }, [recording])

  const startRec = async () => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas) return
    engine.setFixedSize({ width: recordSize.width, height: recordSize.height })
    // Let one frame render at the new size before capture starts.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    let audio: MediaStream | null = null
    let disconnect = () => {}
    const out = rig?.outputNode
    if (isWebAudio(context) && isAudioNode(out)) {
      const dest = context.createMediaStreamDestination()
      out.connect(dest)
      audio = dest.stream
      disconnect = () => {
        try {
          out.disconnect(dest)
        } catch {
          // rig already torn down
        }
      }
    }
    try {
      const rec = startRecording(canvas, store.record.fps, audio)
      setElapsed(0)
      setRecording({
        rec,
        startedAt: performance.now(),
        cleanup: () => {
          disconnect()
          engine.setFixedSize(null)
        },
      })
      if (!audio) toast('Recording without audio: no audio graph is available here.')
    } catch (error) {
      disconnect()
      engine.setFixedSize(null)
      toast.error(error instanceof Error ? error.message : 'Could not start recording')
    }
  }

  const stopRec = async () => {
    if (!recording) return
    const { rec, cleanup } = recording
    setRecording(null)
    try {
      const blob = await rec.stop()
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      downloadBlob(blob, `openaxe-${def.id}-${stamp}.${rec.ext}`)
      toast.success('Video saved to your downloads.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Recording failed')
    } finally {
      cleanup()
    }
  }

  const recordingRef = useRef(recording)
  useEffect(() => {
    recordingRef.current = recording
  }, [recording])
  useEffect(
    () => () => {
      // Unmount mid-recording: stop capture and drop it.
      recordingRef.current?.rec.cancel()
      recordingRef.current?.cleanup()
    },
    [],
  )

  // ——— Panel model ———
  const groups = useMemo(() => {
    const map = new Map<string, SceneParam[]>()
    for (const p of def.params) map.set(p.group, [...(map.get(p.group) ?? []), p])
    return [...map.entries()]
  }, [def])
  const modulatedKeys = useMemo(
    () => new Set(mods.filter((m) => m.enabled && m.amount !== 0).map((m) => m.param)),
    [mods],
  )

  const statusOverlay =
    status.kind === 'loading' ? (
      <div className={styles.overlayMessage}>Compiling {def.name}…</div>
    ) : status.kind === 'error' ? (
      <div className={`${styles.overlayMessage} ${styles.overlayError}`} role="alert">
        {status.message}
      </div>
    ) : null

  return (
    <div className={`${styles.root} ${store.panelOpen ? '' : styles.panelClosed}`}>
      <nav className={styles.sceneList} aria-label="Visuals">
        <span className={styles.sectionLabel}>Visuals</span>
        {SCENES.map((s) => (
          <div key={s.id} className={styles.sceneItem}>
            <HardwareButton
              label={s.name}
              fullWidth
              ariaCurrent={s.id === def.id ? 'page' : false}
              title={s.description}
              onClick={() => store.selectScene(s.id)}
            />
          </div>
        ))}
      </nav>

      <div
        ref={stageRef}
        className={`${styles.stage} ${fullscreen && !chromeVisible ? styles.stageIdle : ''}`}
        onPointerMove={fullscreen ? poke : undefined}
      >
        <canvas
          ref={canvasRef}
          className={`${styles.canvas} ${recording ? styles.canvasFixed : ''}`}
          onPointerDown={onPointer('down')}
          onPointerMove={onPointer('move')}
          onPointerUp={onPointer('up')}
          onPointerCancel={onPointer('up')}
        />
        {statusOverlay}
        <div className={`${styles.stageChrome} ${chromeVisible ? '' : styles.stageChromeHidden}`}>
          <div className={styles.stageBadges}>
            {backend && <span className={styles.badge}>{backend}</span>}
            {status.kind === 'running' && <span className={styles.badge}>{fps} fps</span>}
            {recording && (
              <span className={`${styles.badge} ${styles.badgeRec}`}>
                ● REC {formatTime(elapsed)} · {recordSize.width}×{recordSize.height}
              </span>
            )}
          </div>
          <div className={styles.stageButtons}>
            {recording ? (
              <HardwareButton
                label="Stop"
                size="small"
                variant="danger"
                active
                className={styles.stageButton}
                onClick={() => void stopRec()}
              />
            ) : (
              <HardwareButton
                label="● Rec"
                size="small"
                className={styles.stageButton}
                onClick={() => void startRec()}
                disabled={!canRecord || status.kind !== 'running'}
                title={
                  canRecord
                    ? `Record ${recordSize.label}`
                    : 'Recording is not supported in this browser'
                }
              />
            )}
            {!fullscreen && (
              <HardwareButton
                label="Panel"
                size="small"
                className={styles.stageButton}
                active={store.panelOpen}
                title={store.panelOpen ? 'Hide the control panel' : 'Show the control panel'}
                onClick={() => store.setPanelOpen(!store.panelOpen)}
              />
            )}
            <HardwareButton
              label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              size="small"
              className={styles.stageButton}
              onClick={toggleFullscreen}
            />
          </div>
        </div>
      </div>

      {store.panelOpen && (
        <aside className={styles.panel} aria-label={`${def.name} controls`}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>{def.name}</h2>
            {def.description && <p className={styles.hint}>{def.description}</p>}
            {def.credit && (
              <p className={styles.credit}>
                By{' '}
                {def.credit.url ? (
                  <a href={def.credit.url} target="_blank" rel="noreferrer noopener">
                    {def.credit.author}
                  </a>
                ) : (
                  def.credit.author
                )}
                {def.credit.license ? ` · ${def.credit.license}` : ''}
                {def.credit.note ? (
                  <span className={styles.creditNote}>{def.credit.note}</span>
                ) : null}
              </p>
            )}
            <PresetBar sceneId={def.id} sceneState={sceneState} />
          </header>

          <details className={styles.section} open>
            <summary>Audio</summary>
            <div className={styles.sectionBody}>
              <Select
                label="Listen to"
                value={store.source}
                onChange={(e) => store.setSource(e.target.value as AudioSourceMode)}
              >
                {(Object.keys(SOURCE_LABEL) as AudioSourceMode[]).map((k) => (
                  <option key={k} value={k}>
                    {SOURCE_LABEL[k]}
                  </option>
                ))}
              </Select>
              <SliderRow
                label="Responsiveness"
                hint={
                  store.analysis.responsiveness < 0.34
                    ? 'smooth'
                    : store.analysis.responsiveness > 0.66
                      ? 'punchy'
                      : 'balanced'
                }
                min={0}
                max={1}
                step={0.01}
                value={store.analysis.responsiveness}
                onChange={(v) => store.setAnalysis({ responsiveness: v })}
              />
              <SliderRow
                label="Sensitivity"
                hint={`${store.analysis.sensitivity.toFixed(2)}×`}
                min={-2}
                max={2}
                step={0.01}
                value={Math.log2(store.analysis.sensitivity)}
                onChange={(v) => store.setAnalysis({ sensitivity: 2 ** v })}
              />
              <SliderRow
                label="Noise gate"
                hint={`${store.analysis.gateDb} dB`}
                min={-90}
                max={-30}
                step={1}
                value={store.analysis.gateDb}
                onChange={(v) => store.setAnalysis({ gateDb: v })}
              />
              <Toggle
                label="Feature meters"
                checked={store.showMeters}
                onChange={store.setShowMeters}
              />
              {store.showMeters && <FeatureMeters features={features} />}
            </div>
          </details>

          <details className={styles.section} open>
            <summary>Audio routes</summary>
            <div className={styles.sectionBody}>
              <ModulationEditor
                def={def}
                mods={mods}
                customized={sceneState?.modulations != null}
                onChange={(next) => store.setModulations(def.id, next)}
                onReset={() => store.resetModulations(def.id)}
              />
            </div>
          </details>

          {groups.map(([group, list]) => (
            <details
              key={group}
              className={styles.section}
              open={group !== 'Quality' && group !== 'Mouse'}
            >
              <summary>{group}</summary>
              <div className={styles.sectionBody}>
                {list.map((p) => {
                  const binding = store.midi.find((b) => b.sceneId === def.id && b.param === p.key)
                  const learning =
                    store.learning?.sceneId === def.id && store.learning.param === p.key
                  return (
                    <ParamControl
                      key={p.key}
                      param={p}
                      value={params[p.key]}
                      onChange={(v) => store.setParam(def.id, p.key, v)}
                      onAction={runAction}
                      binding={binding}
                      learning={learning}
                      onLearn={() => store.startLearn(def.id, p.key)}
                      onUnbind={() => {
                        if (learning) store.cancelLearn()
                        else store.removeBinding(def.id, p.key)
                      }}
                      modulated={modulatedKeys.has(p.key)}
                    />
                  )
                })}
              </div>
            </details>
          ))}

          <details className={styles.section}>
            <summary>Performance</summary>
            <div className={styles.sectionBody}>
              <SliderRow
                label="Resolution"
                hint={`${Math.round(store.performance.resolution * 100)}%`}
                min={0.25}
                max={1.5}
                step={0.05}
                value={store.performance.resolution}
                onChange={(v) => store.setPerformance({ resolution: v })}
              />
              <Select
                label="Frame rate cap"
                value={String(store.performance.fpsCap)}
                onChange={(e) => store.setPerformance({ fpsCap: Number(e.target.value) })}
              >
                <option value="30">30 fps</option>
                <option value="45">45 fps</option>
                <option value="60">60 fps</option>
                <option value="0">Display rate</option>
              </Select>
              <p className={styles.hint}>
                Renderer: {backend ?? '…'}
                {backend === 'WebGL2' ? ' (WebGPU unavailable, using the fallback)' : ''}.
              </p>
            </div>
          </details>

          <details className={styles.section}>
            <summary>Record</summary>
            <div className={styles.sectionBody}>
              <Select
                label="Size"
                value={recordSize.id}
                onChange={(e) => store.setRecord({ sizeId: e.target.value })}
                disabled={recording !== null}
              >
                {VIDEO_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Frame rate"
                value={String(store.record.fps)}
                onChange={(e) => store.setRecord({ fps: Number(e.target.value) })}
                disabled={recording !== null}
              >
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </Select>
              {recording ? (
                <HardwareButton
                  label={`Stop and save (${formatTime(elapsed)})`}
                  variant="danger"
                  active
                  fullWidth
                  onClick={() => void stopRec()}
                />
              ) : (
                <HardwareButton
                  label="Start recording"
                  variant="accent"
                  fullWidth
                  onClick={() => void startRec()}
                  disabled={!canRecord || status.kind !== 'running'}
                />
              )}
              <p className={styles.hint}>
                Records live at the chosen size with what you hear (rig + backing track). The
                preview keeps running, letterboxed to the recording shape.
              </p>
            </div>
          </details>

          <div className={styles.rowActions}>
            <HardwareButton
              label="Reset scene params"
              size="small"
              onClick={() => store.resetParams(def.id)}
            />
          </div>
        </aside>
      )}
    </div>
  )
}

function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className={styles.paramRow}>
      <span className={styles.paramLabel}>{label}</span>
      <span className={styles.sliderCell}>
        <input
          type="range"
          className={styles.slider}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className={styles.paramValue}>{hint}</span>
      </span>
      <span />
    </div>
  )
}
