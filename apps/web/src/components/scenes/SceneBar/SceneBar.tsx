import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphRig } from '../../../engine/GraphRig'
import { SceneNavigator } from '../../../scenes/sceneNavigator'
import { SLOTS_PER_SCENE } from '../../../scenes/types'
import { useGraphStore } from '../../../state/graphStore'
import { useCurrentPresetStore } from '../../../state/currentPresetStore'
import { usePresetBankStore } from '../../../state/presetBankStore'
import { useSceneStore } from '../../../state/sceneStore'
import { useSceneManager } from '../../../state/sceneManager'
import { usePresetManager } from '../../../state/presetManager'
import { capturePreset } from '../../../presets/capture'
import { getPreset, listPresets, savePreset } from '../../../presets/presetStore'
import type { Preset } from '../../../presets/types'
import { Dialog, HardwareButton, toast } from '@openaxe/ui'
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
  const bankSlots = usePresetBankStore((s) => s.slots)
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
  const [namingOpen, setNamingOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Preset switch waiting on the user's decision about unsaved edits.
  const pendingRef = useRef<(() => void) | null>(null)
  const [newName, setNewName] = useState('')
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
    // Mid-switch the graph still holds the previous preset; not user edits.
    if (!rig || switching) return false
    // Empty slot: anything on the grid is unsaved work worth naming.
    if (!saved) return blocks.length > 0
    const current = capturePreset(saved.id, saved.name, rig, useGraphStore, {})
    return !presetContentEquals(saved, current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, rig, switching, blocks, edges, masterLevel, masterMuted])

  const handleSaveNew = async (): Promise<boolean> => {
    if (!rig) return false
    const { activeScene: sceneIdx, activeSlot: slotIdx } = useSceneStore.getState()
    const bank = usePresetBankStore.getState()
    const firstEmpty = bank.slots.findIndex((s) => s == null)
    if (firstEmpty < 0) {
      toast.warning('Every preset slot is full', {
        description: 'Free one in the Presets library first.',
      })
      return false
    }
    const name = newName.trim() || `Preset ${firstEmpty + 1}`
    setSaveBusy(true)
    try {
      const created = capturePreset(crypto.randomUUID(), name, rig, useGraphStore, { tags: [] })
      await savePreset(created)
      bank.setSlot(firstEmpty, created.id)
      useSceneStore.getState().assignSlot(sceneIdx, slotIdx, firstEmpty)
      useCurrentPresetStore.getState().setSaved(created)
      await refreshNames()
      setNamingOpen(false)
      setNewName('')
      finishPending()
      toast.success(`Saved "${created.name}"`, {
        description: `Placed in slot ${slotIdx + 1} of scene ${sceneIdx + 1}`,
      })
      return true
    } finally {
      setSaveBusy(false)
    }
  }

  const handleSaveCurrent = async (): Promise<boolean> => {
    if (!rig) return false
    if (!saved) {
      setNewName('')
      setNamingOpen(true)
      return false
    }
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
      toast.success(`Saved changes to "${updated.name}"`)
      return true
    } finally {
      setSaveBusy(false)
    }
  }

  /** Run a preset switch, first asking what to do with unsaved edits. */
  const guardUnsaved = (action: () => void) => {
    if (!isDirty) {
      action()
      return
    }
    pendingRef.current = action
    setConfirmOpen(true)
  }

  const finishPending = () => {
    const action = pendingRef.current
    pendingRef.current = null
    action?.()
  }

  const cancelPending = () => {
    pendingRef.current = null
    setConfirmOpen(false)
  }

  const handleConfirmSave = async () => {
    setConfirmOpen(false)
    if (!saved) {
      // Empty slot: needs a name first; the switch continues once it's saved.
      setNewName('')
      setNamingOpen(true)
      return
    }
    if (await handleSaveCurrent()) finishPending()
    else pendingRef.current = null
  }

  if (!hydrated) return null
  const scene = scenes[activeScene]
  if (!scene) return null

  const handleClear = (slot: number) => {
    useSceneStore.getState().assignSlot(activeScene, slot, null)
    if (slot === activeSlot) useCurrentPresetStore.getState().setSaved(null)
    toast.info(`Cleared slot ${slot + 1} of scene ${activeScene + 1}`)
  }

  const startRename = (slot: number) => {
    const bankSlot = scene.slots[slot]
    if (bankSlot == null) return
    const id = bankSlots[bankSlot]
    setRenamingSlot(slot)
    setRenameValue(id ? (names.get(id) ?? '') : '')
  }

  const commitRename = async (slot: number) => {
    const bankSlot = scene.slots[slot]
    setRenamingSlot(null)
    if (bankSlot == null) return
    const id = bankSlots[bankSlot]
    if (!id) return
    const trimmed = renameValue.trim()
    if (!trimmed) return
    const existing = await getPreset(id)
    if (existing) {
      const renamed = { ...existing, name: trimmed, updatedAt: Date.now() }
      await savePreset(renamed)
      if (slot === activeSlot) useCurrentPresetStore.getState().setSaved(renamed)
      toast.info(`Renamed to "${trimmed}"`)
    }
    await refreshNames()
  }

  const sceneLabel = scene.name || `Scene ${activeScene + 1}`
  const saveTitle = !rig
    ? 'Power on to save'
    : !saved
      ? isDirty
        ? 'Save the grid as a new preset in this slot'
        : 'Add a block to save a new preset'
      : isDirty
        ? 'Save changes to the current preset'
        : 'No changes to save'

  return (
    <div className={styles.bar} role="group" aria-label="Scenes">
      <div className={styles.group}>
        <div className={styles.groupRow}>
          <HardwareButton
            label={`SCENES`}
            onClick={openSceneManager}
            title="Open scene list"
            ariaLabel={`${sceneLabel} — open scene list`}
          />
          <span className={`label ${styles.groupLabel}`}>
            {`${String(activeScene + 1).padStart(2, '0')} ${sceneLabel}`}
          </span>
        </div>
      </div>

      <div className={`${styles.group} ${styles.groupEnd}`}>
        <div className={styles.groupRow}>
          <span
            className={`label ${styles.groupLabel}`}
            title={saved?.name ?? 'No preset in this slot'}
            aria-label={`Current preset: ${saved?.name ?? 'none'}${isDirty ? ' (unsaved changes)' : ''}`}
          >
            {saved?.name ?? 'Empty'}
          </span>
          <div className={styles.slots}>
            {Array.from({ length: SLOTS_PER_SCENE }, (_, i) => {
              const bankSlot = scene.slots[i]
              const presetId = bankSlot != null ? (bankSlots[bankSlot] ?? null) : null
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
                      label={`${i + 1}`}
                      active={isActive}
                      onClick={() =>
                        guardUnsaved(() => void SceneNavigator.goToSlot(i, { source: 'ui' }))
                      }
                      title={name ?? 'Empty'}
                    />
                  )}
                  <div className={styles.slotActions}>
                    <div className={styles.slotActionLabel}>{name ?? 'Empty'}</div>
                    <button
                      type="button"
                      className={styles.slotActionBtn}
                      onClick={() =>
                        guardUnsaved(() => openPicker({ scene: activeScene, slot: i }))
                      }
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
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={cancelPending} title="Unsaved changes">
        <p>
          {saved
            ? `"${saved.name}" has changes that haven't been saved.`
            : 'This slot has a rig that has not been saved as a preset.'}{' '}
          Switching presets will lose them.
        </p>
        <div className={styles.nameForm}>
          <HardwareButton label="CANCEL" onClick={cancelPending} fullWidth />
          <HardwareButton
            label="DISCARD"
            variant="danger"
            fullWidth
            onClick={() => {
              setConfirmOpen(false)
              finishPending()
            }}
          />
          <HardwareButton
            label={saved ? 'SAVE & SWITCH' : 'SAVE…'}
            variant="accent"
            fullWidth
            disabled={saveBusy}
            onClick={() => void handleConfirmSave()}
          />
        </div>
      </Dialog>

      <Dialog
        open={namingOpen}
        onClose={() => {
          setNamingOpen(false)
          pendingRef.current = null
        }}
        title="Save preset"
      >
        <form
          className={styles.nameForm}
          onSubmit={(e) => {
            e.preventDefault()
            void handleSaveNew()
          }}
        >
          <input
            autoFocus
            type="text"
            className={styles.renameInput}
            placeholder="Preset name"
            aria-label="Preset name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <HardwareButton label="SAVE" onClick={() => void handleSaveNew()} disabled={saveBusy} />
        </form>
      </Dialog>

      {!rig && <span className={`label ${styles.hint}`}>Power on to hear preset changes</span>}
    </div>
  )
}
