import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphRig } from '../../engine/GraphRig'
import { SceneNavigator } from '../../scenes/sceneNavigator'
import { SLOTS_PER_SCENE } from '../../scenes/types'
import { useGraphStore } from '../../state/graphStore'
import { useCurrentPresetStore } from '../../state/currentPresetStore'
import { useSceneStore } from '../../state/sceneStore'
import { useSceneManager } from '../../state/sceneManager'
import { usePresetManager } from '../../state/presetManager'
import { capturePreset } from '../../presets/capture'
import { getPreset, listPresets, savePreset } from '../../presets/presetStore'
import type { Preset } from '../../presets/types'
import { HardwareButton } from '../primitives/HardwareButton'
import styles from './SceneBar.module.css'

export interface SceneBarProps {
  rig: GraphRig | null
  context: AudioContext | null
}

/** Content-only comparison - ignores id/name/tags/favorite/timestamps, which aren't "unsaved changes." */
function presetContentEquals(a: Preset, b: Preset): boolean {
  return (
    JSON.stringify(a.blocks) === JSON.stringify(b.blocks) &&
    JSON.stringify(a.edges) === JSON.stringify(b.edges) &&
    a.masterLevel === b.masterLevel &&
    a.masterMuted === b.masterMuted
  )
}

/**
 * Always-visible bar: prev/next scene + a readout that opens SceneManager,
 * the 8 preset-slot buttons for the current scene, and the current-preset
 * Save button - this is the one place presets and scenes meet, so there's
 * no separate top-level "Presets" surface anymore (see the Library button
 * below, which opens the same PresetManager modal in its normal browse/
 * save-as-new/import/export mode). Navigation itself never touches
 * `rig`/`context` - it goes through SceneNavigator, which already holds the
 * live target (see useSceneEngine). The props here exist only for the
 * "save current rig" actions.
 */
export function SceneBar({ rig }: SceneBarProps) {
  const scenes = useSceneStore((s) => s.scenes)
  const hydrated = useSceneStore((s) => s.hydrated)
  const activeScene = useSceneStore((s) => s.activeScene)
  const activeSlot = useSceneStore((s) => s.activeSlot)
  const switching = useSceneStore((s) => s.switching)
  const openSceneManager = useSceneManager((s) => s.openManager)
  const openPicker = usePresetManager((s) => s.openPicker)
  const openLibrary = usePresetManager((s) => s.openManager)
  const presetManagerOpen = usePresetManager((s) => s.open)
  const saved = useCurrentPresetStore((s) => s.saved)
  const blocks = useGraphStore((s) => s.blocks)
  const edges = useGraphStore((s) => s.edges)
  const masterLevel = useGraphStore((s) => s.masterLevel)
  const masterMuted = useGraphStore((s) => s.masterMuted)

  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [renamingSlot, setRenamingSlot] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const wasPresetManagerOpen = useRef(false)

  const refreshNames = async () => {
    const all = await listPresets()
    setNames(new Map(all.map((p) => [p.id, p.name])))
  }

  useEffect(() => {
    void refreshNames()
  }, [activeScene, scenes])

  // Catches renames/deletes made in PresetManager while it was open.
  useEffect(() => {
    if (wasPresetManagerOpen.current && !presetManagerOpen) void refreshNames()
    wasPresetManagerOpen.current = presetManagerOpen
  }, [presetManagerOpen])

  // Recomputed only when the live graph or the saved baseline actually change.
  const isDirty = useMemo(() => {
    if (!saved || !rig) return false
    const current = capturePreset(saved.id, saved.name, rig, useGraphStore, {})
    return !presetContentEquals(saved, current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, rig, blocks, edges, masterLevel, masterMuted])

  const handleSaveCurrent = async () => {
    if (!rig || !saved) return
    setSaveBusy(true)
    try {
      const updated = capturePreset(saved.id, saved.name, rig, useGraphStore, {
        tags: saved.tags,
        favorite: saved.favorite,
        createdAt: saved.createdAt,
      })
      await savePreset(updated)
      useCurrentPresetStore.getState().setSaved(updated)
      await refreshNames()
    } finally {
      setSaveBusy(false)
    }
  }

  if (!hydrated) return null
  const scene = scenes[activeScene]
  if (!scene) return null

  const handleClear = (slot: number) => {
    useSceneStore.getState().assignSlot(activeScene, slot, null)
    if (slot === activeSlot) useCurrentPresetStore.getState().setSaved(null)
  }

  const startRename = (slot: number) => {
    const id = scene.slots[slot]
    if (!id) return
    setRenamingSlot(slot)
    setRenameValue(names.get(id) ?? '')
  }

  const commitRename = async (slot: number) => {
    const id = scene.slots[slot]
    setRenamingSlot(null)
    if (!id) return
    const trimmed = renameValue.trim()
    if (!trimmed) return
    const existing = await getPreset(id)
    if (existing) {
      const renamed = { ...existing, name: trimmed, updatedAt: Date.now() }
      await savePreset(renamed)
      if (slot === activeSlot) useCurrentPresetStore.getState().setSaved(renamed)
    }
    await refreshNames()
  }

  const sceneLabel = scene.name || `Scene ${activeScene + 1}`
  const saveTitle = !rig
    ? 'Power on to save'
    : !saved
      ? 'No preset loaded in this slot'
      : isDirty
        ? 'Save changes to the current preset'
        : 'No changes to save'

  return (
    <div className={styles.bar} role="group" aria-label="Scenes">
      <div className={styles.sceneNav}>
        {/*   <button
          type="button"
          className={styles.navArrow}
          onClick={() => void SceneNavigator.prevScene({ source: 'ui' })}
          aria-label="Previous scene"
        >
          ‹
        </button> */}
        <button
          type="button"
          className={styles.readout}
          onClick={openSceneManager}
          aria-label={`${sceneLabel} — open scene list`}
        >
          <span className={styles.sceneIndex}>{String(activeScene + 1).padStart(2, '0')}</span>
          <span className={styles.sceneName}>{sceneLabel}</span>
        </button>
        {/*    <HardwareButton
          label="›"
          onClick={() => void SceneNavigator.nextScene({ source: 'ui' })}
          title="Next scene"
        /> */}
        {/*   <button
          type="button"
          className={styles.navArrow}
          onClick={() => void SceneNavigator.nextScene({ source: 'ui' })}
          aria-label="Next scene"
        >
          ›
        </button> */}
      </div>

      <div className={styles.slots}>
        {Array.from({ length: SLOTS_PER_SCENE }, (_, i) => {
          const presetId = scene.slots[i]
          const name = presetId ? (names.get(presetId) ?? '…') : null
          const isActive = i === activeSlot
          return (
            <div
              key={i}
              className={`${styles.slot} ${switching && isActive ? styles.pending : ''}`}
            >
              {renamingSlot === i ? (
                <input
                  autoFocus
                  className={styles.renameInput}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(i)
                    if (e.key === 'Escape') setRenamingSlot(null)
                  }}
                  onBlur={() => void commitRename(i)}
                />
              ) : (
                <HardwareButton
                  fullWidth
                  label={`${i + 1} ${name ?? 'Empty'}`}
                  active={isActive}
                  onClick={() => void SceneNavigator.goToSlot(i, { source: 'ui' })}
                  title={name ?? 'Empty'}
                />
              )}
              <div className={styles.slotActions}>
                <button
                  type="button"
                  className={styles.slotActionBtn}
                  onClick={() => openPicker({ scene: activeScene, slot: i })}
                  aria-label={`Pick a different preset for slot ${i + 1}`}
                  title="Pick a saved preset"
                >
                  Pick…
                </button>
                <button
                  type="button"
                  className={styles.slotActionBtn}
                  onClick={() => startRename(i)}
                  disabled={!presetId}
                  aria-label={`Rename slot ${i + 1}`}
                  title="Rename"
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={styles.slotActionBtn}
                  onClick={() => handleClear(i)}
                  disabled={!presetId}
                  aria-label={`Clear slot ${i + 1}`}
                  title="Clear slot"
                >
                  Clear
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className={styles.currentPreset}>
        <span className={styles.currentPresetName}>{saved?.name ?? '—'}</span>
        <HardwareButton
          label="PRESETS"
          onClick={openLibrary}
          title="Browse, save-as-new, import, export, or delete presets"
        />

        <HardwareButton
          label="SAVE"
          active={isDirty}
          disabled={!isDirty || saveBusy}
          onClick={() => void handleSaveCurrent()}
          title={saveTitle}
        />
      </div>

      {!rig && <span className={`label ${styles.hint}`}>Power on to hear preset changes</span>}
    </div>
  )
}
