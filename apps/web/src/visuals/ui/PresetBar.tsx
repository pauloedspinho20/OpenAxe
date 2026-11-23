import { useState } from 'react'
import { HardwareButton, Select, toast } from '@openaxe/ui'

import { presetIsDirty, useVisualsStore, type SceneState } from '../visualsStore'
import styles from './Visuals.module.css'

const NONE = ''

/**
 * Save / load named presets for the open scene. A preset is the scene's
 * params plus its audio routes; the shared audio-analysis settings are not
 * part of it, so a preset looks the same whatever input it is played with.
 */
export function PresetBar({
  sceneId,
  sceneState,
}: {
  sceneId: string
  sceneState: SceneState | undefined
}) {
  const presets = useVisualsStore((s) => s.presets[sceneId]) ?? []
  const activeId = useVisualsStore((s) => s.activePreset[sceneId] ?? null)
  const { savePreset, updatePreset, loadPreset, renamePreset, deletePreset } =
    useVisualsStore.getState()
  const active = presets.find((p) => p.id === activeId) ?? null
  const dirty = active ? presetIsDirty(active, sceneState) : false
  // 'new' = typing a name for Save as; 'rename' = renaming the active one.
  const [editing, setEditing] = useState<{ mode: 'new' | 'rename'; name: string } | null>(null)

  const commit = () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) return
    if (editing.mode === 'new') {
      savePreset(sceneId, name)
      toast.success(`Saved preset “${name}”`)
    } else if (active) {
      renamePreset(sceneId, active.id, name)
    }
    setEditing(null)
  }

  if (editing) {
    return (
      <form
        className={styles.presetBar}
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        <input
          className={styles.presetName}
          autoFocus
          value={editing.name}
          maxLength={60}
          placeholder="Preset name"
          aria-label="Preset name"
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null)
          }}
        />
        <HardwareButton
          type="submit"
          size="small"
          variant="accent"
          label={editing.mode === 'new' ? 'Save' : 'Rename'}
          disabled={!editing.name.trim()}
        />
        <HardwareButton size="small" label="Cancel" onClick={() => setEditing(null)} />
      </form>
    )
  }

  return (
    <div className={styles.presetBar}>
      <span className={styles.presetSelect}>
        <Select
          value={active?.id ?? NONE}
          aria-label="Preset"
          onChange={(e) => {
            if (e.target.value !== NONE) loadPreset(sceneId, e.target.value)
          }}
        >
          <option value={NONE}>{presets.length ? 'Unsaved settings' : 'No presets yet'}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </span>
      {dirty && <span className={styles.presetDirty} title="Changed since the preset was saved" />}
      {active && dirty && (
        <HardwareButton
          size="small"
          variant="accent"
          label="Save"
          onClick={() => {
            updatePreset(sceneId, active.id)
            toast.success(`Updated preset “${active.name}”`)
          }}
          title={`Overwrite “${active.name}” with the current settings`}
        />
      )}
      {active && dirty && (
        <HardwareButton
          size="small"
          label="Revert"
          onClick={() => loadPreset(sceneId, active.id)}
          title={`Discard changes and go back to “${active.name}”`}
        />
      )}
      <HardwareButton
        size="small"
        label="Save as…"
        onClick={() => setEditing({ mode: 'new', name: active ? `${active.name} copy` : '' })}
      />
      {active && (
        <>
          <HardwareButton
            size="small"
            label="Rename"
            onClick={() => setEditing({ mode: 'rename', name: active.name })}
          />
          <HardwareButton
            size="small"
            variant="danger"
            label="Delete"
            onClick={() => {
              if (window.confirm(`Delete preset “${active.name}”?`))
                deletePreset(sceneId, active.id)
            }}
          />
        </>
      )}
    </div>
  )
}
