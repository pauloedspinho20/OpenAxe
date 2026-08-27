import { useEffect, useMemo, useRef, useState } from 'react'
import { usePresetManager } from '../../../state/presetManager'
import { useGraphStore } from '../../../state/graphStore'
import { useSceneStore } from '../../../state/sceneStore'
import { usePresetBankStore } from '../../../state/presetBankStore'
import { capturePreset } from '../../../presets/capture'
import { applyPreset } from '../../../presets/apply'
import { deletePreset, getPreset, listPresets, savePreset } from '../../../presets/presetStore'
import { downloadPresetAsFile, readPresetFromFile } from '../../../presets/presetIO'
import { PRESET_SLOT_COUNT } from '../../../presets/presetBank'
import type { Preset } from '../../../presets/types'
import type { GraphRig } from '../../../engine/GraphRig'
import { Dialog, HardwareButton, OutlineButton, toast } from '@openaxe/ui'
import styles from './PresetManager.module.css'

export interface PresetManagerProps {
  rig: GraphRig | null
  context: AudioContext | null
}

type ConfirmState =
  | { kind: 'delete'; slot: number | null; presetId: string; name: string }
  | { kind: 'overwrite'; slot: number; name: string }

/**
 * The preset bank surface: a fixed 512-slot grid (see presets/presetBank.ts)
 * where every saved preset lives in a numbered slot, plus the save-as-new /
 * import / export / delete actions around it. Scenes reference bank slots,
 * so in "pick" mode (opened from a scene slot's "Pick…" action) each filled
 * slot offers Assign, which points the targeted scene slot at this bank slot.
 * Presets that aren't placed in the bank yet (e.g. imported files, legacy
 * rows) are listed under "Unplaced" and can be placed or assigned from there.
 */
export function PresetManager({ rig, context }: PresetManagerProps) {
  const open = usePresetManager((s) => s.open)
  const pickTarget = usePresetManager((s) => s.pickTarget)
  const closeManager = usePresetManager((s) => s.closeManager)
  const bankSlots = usePresetBankStore((s) => s.slots)
  const setBankSlot = usePresetBankStore((s) => s.setSlot)
  const [presets, setPresets] = useState<Preset[]>([])
  const [newName, setNewName] = useState('')
  const [renamingSlot, setRenamingSlot] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [savingSlot, setSavingSlot] = useState<number | null>(null)
  const [saveName, setSaveName] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
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

  const presetsById = useMemo(() => new Map(presets.map((p) => [p.id, p])), [presets])
  const unplaced = useMemo(
    () => presets.filter((p) => !bankSlots.includes(p.id)),
    [presets, bankSlots],
  )

  if (!open) return null

  const captureCurrent = (
    id: string,
    name: string,
    opts: { tags?: string[]; favorite?: boolean; createdAt?: number } = {},
  ) => capturePreset(id, name, rig!, useGraphStore, opts)

  const handleSave = async () => {
    const name = newName.trim()
    if (!name || !rig) return
    setBusy(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const preset = captureCurrent(id, name, { tags: [] })
      await savePreset(preset)
      const firstEmpty = bankSlots.findIndex((s) => s == null)
      if (firstEmpty >= 0) setBankSlot(firstEmpty, id)
      setNewName('')
      await refresh()
      toast.success(`Saved "${name}"`, {
        description:
          firstEmpty >= 0
            ? `Placed in preset slot ${firstEmpty + 1}`
            : 'No free bank slot - kept unplaced',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Save action for a bank slot: empty slots prompt for a name inline; occupied slots ask before overwriting. */
  const startSave = (slot: number) => {
    if (!rig) {
      setError('Power on to save the current grid as a preset.')
      return
    }
    const presetId = bankSlots[slot]
    if (presetId != null) {
      setConfirm({
        kind: 'overwrite',
        slot,
        name: presetsById.get(presetId)?.name ?? presetId,
      })
      return
    }
    setSavingSlot(slot)
    setSaveName('')
  }

  /** Capture the current rig into a brand-new preset placed in `slot`. */
  const commitSave = async (slot: number) => {
    const name = saveName.trim() || `Preset ${slot + 1}`
    setSavingSlot(null)
    if (!rig) return
    setBusy(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const preset = captureCurrent(id, name, { tags: [] })
      await savePreset(preset)
      setBankSlot(slot, id)
      await refresh()
      toast.success(`Saved "${name}"`, { description: `Placed in preset slot ${slot + 1}` })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Replace the preset currently occupying `slot` with the live rig (after confirmation). */
  const overwriteSlot = async (slot: number) => {
    if (!rig) return
    const existingId = bankSlots[slot]
    const existing = existingId ? await getPreset(existingId) : null
    if (!existing) return
    const updated = captureCurrent(existing.id, existing.name, {
      tags: existing.tags,
      favorite: existing.favorite,
      createdAt: existing.createdAt,
    })
    await savePreset(updated)
    toast.info(`Updated preset in slot ${slot + 1}`, {
      description: `"${existing.name}" now holds the current rig`,
    })
  }

  /** Ask for confirmation before deleting a placed or unplaced preset. */
  const requestDelete = (slot: number | null, presetId: string, name: string) => {
    setConfirm({ kind: 'delete', slot, presetId, name })
  }

  /** Runs the confirmed delete/overwrite action. */
  const handleConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    setError(null)
    try {
      if (confirm.kind === 'delete') {
        await deletePreset(confirm.presetId)
        if (confirm.slot != null) setBankSlot(confirm.slot, null)
        toast.success(`Deleted "${confirm.name}"`)
      } else {
        await overwriteSlot(confirm.slot)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirm(null)
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
      toast.success(`Loaded "${preset.name}"`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Pick mode: point the targeted scene slot at an existing bank slot. */
  const handleAssignBankSlot = (bankSlot: number) => {
    if (!pickTarget || bankSlots[bankSlot] == null) return
    useSceneStore.getState().assignSlot(pickTarget.scene, pickTarget.slot, bankSlot)
    closeManager()
    toast.info(
      `Assigned preset slot ${bankSlot + 1} to scene ${pickTarget.scene + 1} · slot ${pickTarget.slot + 1}`,
    )
  }

  /** Pick mode: place an unplaced preset into the first free bank slot, then point the scene slot at it. */
  const handleAssignPreset = (preset: Preset) => {
    if (!pickTarget) return
    const firstEmpty = bankSlots.findIndex((s) => s == null)
    if (firstEmpty < 0) {
      setError('No free preset bank slots.')
      return
    }
    setBankSlot(firstEmpty, preset.id)
    useSceneStore.getState().assignSlot(pickTarget.scene, pickTarget.slot, firstEmpty)
    closeManager()
    toast.info(
      `Assigned "${preset.name}" to scene ${pickTarget.scene + 1} · slot ${pickTarget.slot + 1}`,
    )
  }

  const handlePlace = (preset: Preset) => {
    const firstEmpty = bankSlots.findIndex((s) => s == null)
    if (firstEmpty < 0) {
      setError('No free preset bank slots.')
      return
    }
    setBankSlot(firstEmpty, preset.id)
    toast.info(`Placed "${preset.name}"`, { description: `Preset slot ${firstEmpty + 1}` })
  }

  const startRename = (bankSlot: number) => {
    const id = bankSlots[bankSlot]
    if (!id) return
    setRenamingSlot(bankSlot)
    setRenameValue(presetsById.get(id)?.name ?? '')
  }

  const commitRename = async (bankSlot: number) => {
    const id = bankSlots[bankSlot]
    setRenamingSlot(null)
    if (!id) return
    const trimmed = renameValue.trim()
    if (!trimmed) return
    const existing = await getPreset(id)
    if (existing) {
      const renamed = { ...existing, name: trimmed, updatedAt: Date.now() }
      await savePreset(renamed)
      await refresh()
      toast.info(`Renamed to "${trimmed}"`)
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
      const firstEmpty = bankSlots.findIndex((s) => s == null)
      if (firstEmpty >= 0) setBankSlot(firstEmpty, preset.id)
      await refresh()
      toast.success(`Imported "${preset.name}"`, {
        description:
          firstEmpty >= 0
            ? `Placed in preset slot ${firstEmpty + 1}`
            : 'No free bank slot - kept unplaced',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const renderBankSlotRow = (slot: number) => {
    const presetId = bankSlots[slot]
    const preset = presetId ? (presetsById.get(presetId) ?? null) : null
    return (
      <div key={slot} className={styles.row}>
        <span className={styles.slotIndex}>{String(slot + 1).padStart(3, '0')}</span>
        {savingSlot === slot ? (
          <input
            autoFocus
            className={styles.nameInput}
            placeholder="Preset name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitSave(slot)
              if (e.key === 'Escape') setSavingSlot(null)
            }}
            onBlur={() => void commitSave(slot)}
          />
        ) : renamingSlot === slot ? (
          <input
            autoFocus
            className={styles.nameInput}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename(slot)
              if (e.key === 'Escape') setRenamingSlot(null)
            }}
            onBlur={() => void commitRename(slot)}
          />
        ) : preset ? (
          <div className={styles.rowInfo}>
            <span className={styles.rowName}>{preset.name}</span>
            <span className={styles.rowMeta}>
              {preset.blocks.length} block{preset.blocks.length === 1 ? '' : 's'}
              {preset.tags.length > 0 ? ` · ${preset.tags.join(', ')}` : ''}
            </span>
          </div>
        ) : (
          <div className={styles.rowInfo}>
            <span className={`${styles.rowName} ${styles.emptySlot}`}>Empty</span>
          </div>
        )}
        <div className={styles.rowActions}>
          {pickTarget ? (
            preset ? (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => handleAssignBankSlot(slot)}
                aria-label={`Assign ${preset.name}`}
              >
                Assign
              </button>
            ) : (
              <span className={styles.emptyLabel}>—</span>
            )
          ) : preset ? (
            <>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleLoad(preset)}
                disabled={busy}
                aria-label={`Load ${preset.name}`}
              >
                Load
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => startSave(slot)}
                disabled={busy || !rig}
                aria-label={`Save current rig into slot ${slot + 1}`}
                title="Replace this slot's preset with the current rig"
              >
                Save
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => startRename(slot)}
                aria-label={`Rename ${preset.name}`}
              >
                Rename
              </button>
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
                onClick={() => requestDelete(slot, presetId!, preset.name)}
                disabled={busy}
                aria-label={`Delete ${preset.name}`}
              >
                Delete
              </button>
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
            </>
          ) : (
            rig && (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => startSave(slot)}
                disabled={busy}
                aria-label={`Save current rig into slot ${slot + 1}`}
                title="Save the current rig into this slot"
              >
                Save
              </button>
            )
          )}
        </div>
      </div>
    )
  }

  const renderUnplaced = () =>
    unplaced.length > 0 && (
      <>
        <p className={styles.sectionHeading}>Unplaced</p>
        {unplaced.map((preset) => (
          <div key={preset.id} className={styles.row}>
            <span className={styles.slotIndex}>—</span>
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
                  onClick={() => handleAssignPreset(preset)}
                  aria-label={`Assign ${preset.name}`}
                >
                  Assign
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => handlePlace(preset)}
                    aria-label={`Place ${preset.name}`}
                    title="Put this preset in the first free bank slot"
                  >
                    Place
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => void handleLoad(preset)}
                    disabled={busy}
                    aria-label={`Load ${preset.name}`}
                  >
                    Load
                  </button>
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
                    className={styles.favoriteBtn}
                    onClick={() => void handleToggleFavorite(preset)}
                    aria-label={
                      preset.favorite ? `Unfavorite ${preset.name}` : `Favorite ${preset.name}`
                    }
                    title={preset.favorite ? 'Unfavorite' : 'Favorite'}
                  >
                    {preset.favorite ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={() => requestDelete(null, preset.id, preset.name)}
                    disabled={busy}
                    aria-label={`Delete ${preset.name}`}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </>
    )

  return (
    <>
      <Dialog
        open={true}
        onClose={closeManager}
        title={
          pickTarget
            ? `ASSIGN TO SCENE ${pickTarget.scene + 1} · SLOT ${pickTarget.slot + 1}`
            : 'PRESETS'
        }
        width="min(680px, 92vw)"
        maxHeight="min(80svh, 720px)"
        zIndex={300}
      >
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
              className="srOnly"
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
          {Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => renderBankSlotRow(i))}
          {renderUnplaced()}
        </div>
      </Dialog>

      {confirm && (
        <Dialog
          open
          title={confirm.kind === 'delete' ? 'DELETE PRESET' : 'OVERWRITE PRESET'}
          onClose={() => setConfirm(null)}
          width="min(380px, 90vw)"
          zIndex={400}
        >
          <p className={styles.hint}>
            {confirm.kind === 'delete'
              ? `Delete "${confirm.name}"` +
                (confirm.slot != null ? ` from preset slot ${confirm.slot + 1}` : '') +
                '? This cannot be undone.'
              : `Preset slot ${confirm.slot + 1} already holds "${confirm.name}". Replace it with the current rig?`}
          </p>
          <div className={styles.confirmRow}>
            <OutlineButton onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </OutlineButton>
            <HardwareButton
              label={confirm.kind === 'delete' ? 'Delete' : 'Overwrite'}
              variant="danger"
              onClick={() => void handleConfirm()}
              disabled={busy}
            />
          </div>
        </Dialog>
      )}
    </>
  )
}
