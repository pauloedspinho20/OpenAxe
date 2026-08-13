import { useEffect, useRef, useState } from 'react'
import { usePresetManager } from '../../state/presetManager'
import { useGraphStore } from '../../state/graphStore'
import { useSceneStore } from '../../state/sceneStore'
import { capturePreset } from '../../presets/capture'
import { applyPreset } from '../../presets/apply'
import { deletePreset, listPresets, savePreset } from '../../presets/presetStore'
import { downloadPresetAsFile, readPresetFromFile } from '../../presets/presetIO'
import type { Preset } from '../../presets/types'
import type { GraphRig } from '../../engine/GraphRig'
import { HardwareButton } from '../primitives/HardwareButton'
import styles from './PresetManager.module.css'

export interface PresetManagerProps {
  rig: GraphRig | null
  context: AudioContext | null
}

/**
 * Manage/save/import/export the grid's blocks + parameters as presets.
 * Wires the existing capture/apply/presetStore/presetIO backend (already
 * fully built and tested, just never had a UI) into an actual panel.
 */
export function PresetManager({ rig, context }: PresetManagerProps) {
  const open = usePresetManager((s) => s.open)
  const pickTarget = usePresetManager((s) => s.pickTarget)
  const closeManager = usePresetManager((s) => s.closeManager)
  const [presets, setPresets] = useState<Preset[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingAssetsNote, setMissingAssetsNote] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setPresets(await listPresets())
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  if (!open) return null

  const handleSave = async () => {
    const name = newName.trim()
    if (!name || !rig) return
    setBusy(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const preset = capturePreset(id, name, rig, useGraphStore, { tags: [] })
      await savePreset(preset)
      setNewName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleLoad = async (preset: Preset) => {
    if (!rig || !context) {
      setError('Power on before loading a preset.')
      return
    }
    setBusy(true)
    setError(null)
    setMissingAssetsNote(null)
    try {
      const result = await applyPreset(context, preset, rig, useGraphStore)
      if (result.missingAssets.length > 0) {
        setMissingAssetsNote(
          `Loaded, but ${result.missingAssets.length} model/IR reference(s) aren't cached on this device: ` +
            result.missingAssets.map((a) => a.name).join(', '),
        )
      }
      closeManager()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleAssign = (preset: Preset) => {
    if (!pickTarget) return
    useSceneStore.getState().assignSlot(pickTarget.scene, pickTarget.slot, preset.id)
    closeManager()
  }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await deletePreset(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleToggleFavorite = async (preset: Preset) => {
    await savePreset({ ...preset, favorite: !preset.favorite, updatedAt: Date.now() })
    await refresh()
  }

  const handleImportFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const preset = await readPresetFromFile(file)
      await savePreset(preset)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...presets].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Preset manager">
      <div className={styles.modal}>
        <header className={styles.header}>
          <span className={`label ${styles.heading}`}>
            {pickTarget
              ? `ASSIGN TO SCENE ${pickTarget.scene + 1} · SLOT ${pickTarget.slot + 1}`
              : 'PRESETS'}
          </span>
          <HardwareButton label="Close" onClick={closeManager} />
        </header>

        {!pickTarget && (
          <div className={styles.saveRow}>
            <input
              type="text"
              className={styles.nameInput}
              placeholder="Preset name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy || !rig}
            />
            <HardwareButton
              label="Save Current"
              onClick={() => void handleSave()}
              disabled={busy || !rig || newName.trim().length === 0}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className={styles.hiddenInput}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImportFile(file)
                e.target.value = ''
              }}
            />
            <HardwareButton
              label="Import…"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            />
          </div>
        )}

        {!pickTarget && !rig && (
          <p className={styles.hint}>Power on to save the current grid as a preset.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {missingAssetsNote && <p className={styles.hint}>{missingAssetsNote}</p>}

        <div className={styles.list}>
          {sorted.length === 0 && <p className={styles.hint}>No saved presets yet.</p>}
          {sorted.map((preset) => (
            <div key={preset.id} className={styles.row}>
              <button
                type="button"
                className={styles.favoriteBtn}
                onClick={() => void handleToggleFavorite(preset)}
                aria-label={
                  preset.favorite ? `Unfavorite ${preset.name}` : `Favorite ${preset.name}`
                }
                title={preset.favorite ? 'Unfavorite' : 'Favorite'}
              >
                {preset.favorite ? '★' : '☆'}
              </button>
              <div className={styles.rowInfo}>
                <span className={styles.rowName}>{preset.name}</span>
                <span className={styles.rowMeta}>
                  {preset.blocks.length} block{preset.blocks.length === 1 ? '' : 's'}
                  {preset.tags.length > 0 ? ` · ${preset.tags.join(', ')}` : ''}
                </span>
              </div>
              <div className={styles.rowActions}>
                {pickTarget ? (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => handleAssign(preset)}
                    aria-label={`Assign ${preset.name}`}
                  >
                    Assign
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => void handleLoad(preset)}
                    disabled={busy}
                    aria-label={`Load ${preset.name}`}
                  >
                    Load
                  </button>
                )}
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => downloadPresetAsFile(preset)}
                  aria-label={`Export ${preset.name}`}
                >
                  Export
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={() => void handleDelete(preset.id)}
                  disabled={busy}
                  aria-label={`Delete ${preset.name}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
