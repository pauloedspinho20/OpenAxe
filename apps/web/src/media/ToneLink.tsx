/**
 * Song -> rig tone (issue #205): the scene a song uses, the slot each section
 * plays, and the follower that switches the rig while the song plays.
 * Switching goes through SceneNavigator, the same serialized path the scene
 * bar, keyboard and MIDI footswitches use.
 */
import { HardwareButton, Select } from '@openaxe/ui'
import { useEffect, useRef, useState } from 'react'

import { getPreset } from '../presets/presetStore'
import { SceneNavigator } from '../scenes/sceneNavigator'
import { SLOTS_PER_SCENE } from '../scenes/types'
import { usePresetBankStore } from '../state/presetBankStore'
import { useSceneStore } from '../state/sceneStore'
import styles from './MediaCenter.module.css'
import type { SongTone } from './mediaDb'
import * as I from './tabs/tabIcons'
import t from './tabs/TabWorkspace.module.css'
import { slotAt, START_KEY, withSection, type ToneSection } from './tone'

/** Names of the presets a song's tone uses (its sections' slots), for a practice pack. */
export async function tonePresetNames(tone: SongTone | null | undefined): Promise<string[]> {
  if (!tone || tone.scene === null) return []
  const slots = useSceneStore.getState().scenes[tone.scene]?.slots ?? []
  const bank = usePresetBankStore.getState().slots
  const used = [...new Set(Object.values(tone.sections))]
  const names = await Promise.all(
    (used.length ? used : [0]).map(async (i) => {
      const bankSlot = slots[i]
      const id = bankSlot != null ? bank[bankSlot] : null
      return id ? ((await getPreset(id))?.name ?? null) : null
    }),
  )
  return names.filter((n): n is string => !!n)
}

/** Preset names for the 8 slots of a scene (null = empty slot). */
function useSlotNames(scene: number | null): (string | null)[] {
  const scenes = useSceneStore((s) => s.scenes)
  const bank = usePresetBankStore((s) => s.slots)
  const [names, setNames] = useState<(string | null)[]>([])
  useEffect(() => {
    let cancelled = false
    const slots = scene === null ? [] : (scenes[scene]?.slots ?? [])
    void Promise.all(
      Array.from({ length: SLOTS_PER_SCENE }, async (_, i) => {
        const bankSlot = slots[i]
        const id = bankSlot != null ? bank[bankSlot] : null
        return id ? ((await getPreset(id))?.name ?? null) : null
      }),
    ).then((n) => {
      if (!cancelled) setNames(n)
    })
    return () => {
      cancelled = true
    }
  }, [scene, scenes, bank])
  return names
}

interface ToneLinkProps {
  tone: SongTone | null
  sections: ToneSection[]
  onChange: (tone: SongTone) => void
}

export function ToneLink({ tone, sections, onChange }: ToneLinkProps) {
  const scenes = useSceneStore((s) => s.scenes)
  const scene = tone?.scene ?? null
  const names = useSlotNames(scene)
  const base: SongTone = tone ?? { scene: null, sections: {}, follow: true }
  const slotLabel = (i: number) => `${i + 1}${names[i] ? ` · ${names[i]}` : ' · (empty)'}`
  return (
    <div className={t.recPanel}>
      <label className={t.textField} title="The rig scene (bank of 8 presets) this song uses">
        <I.ToneIcon size={14} />
        <Select
          value={scene ?? ''}
          onChange={(e) =>
            onChange({ ...base, scene: e.target.value === '' ? null : Number(e.target.value) })
          }
          aria-label="Rig scene for this song"
        >
          <option value="">No linked tone</option>
          {scenes.map((s) => (
            <option key={s.index} value={s.index}>
              Scene {s.index + 1}
              {s.name ? ` · ${s.name}` : ''}
            </option>
          ))}
        </Select>
      </label>
      {scene !== null && (
        <>
          <div className={t.tapRow}>
            <HardwareButton
              size="small"
              label="Apply now"
              title="Switch the rig to this song's tone"
              onClick={() => {
                void SceneNavigator.goToScene(scene).then(() => {
                  const slot = slotAt(base, sections, 0)
                  if (slot !== null) void SceneNavigator.goToSlot(slot)
                })
              }}
            />
            <label
              className={styles.check}
              title="Switch slots at each section while the song plays"
            >
              <input
                type="checkbox"
                checked={base.follow}
                onChange={(e) => onChange({ ...base, follow: e.target.checked })}
              />
              Follow sections
            </label>
          </div>
          <ul className={t.toneList}>
            {sections.map((s) => (
              <li key={s.key}>
                <span title={s.label}>{s.label}</span>
                <Select
                  value={base.sections[s.key] ?? ''}
                  onChange={(e) =>
                    onChange(
                      withSection(
                        base,
                        s.key,
                        e.target.value === '' ? null : Number(e.target.value),
                      ),
                    )
                  }
                  aria-label={`Slot for ${s.label}`}
                >
                  <option value="">{s.key === START_KEY ? '(scene default)' : '(keep)'}</option>
                  {Array.from({ length: SLOTS_PER_SCENE }, (_, i) => (
                    <option key={i} value={i}>
                      {slotLabel(i)}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
          {sections.length <= 1 && (
            <p className={t.hint}>Add section markers to switch tones as the song moves on.</p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Follow the song: switch to its scene when it opens, then to each section's
 * slot while it plays. `at` is the playback position on the sections' scale,
 * already looked ahead a little so the preset is in place on the downbeat.
 */
export function useToneFollower(
  tone: SongTone | null | undefined,
  sections: ToneSection[],
  at: number,
  playing: boolean,
): void {
  const scene = tone?.scene ?? null
  const busy = useRef(false)
  // Opening the song (or linking a scene) switches the rig to it.
  useEffect(() => {
    if (scene === null || !SceneNavigator.isReady()) return
    if (SceneNavigator.getActive().scene === scene) return
    busy.current = true
    void SceneNavigator.goToScene(scene).finally(() => {
      busy.current = false
    })
  }, [scene])

  const wanted = playing && tone?.follow ? slotAt(tone, sections, at) : null
  useEffect(() => {
    if (wanted === null || scene === null || busy.current || !SceneNavigator.isReady()) return
    const active = SceneNavigator.getActive()
    if (active.scene === scene && active.slot === wanted) return
    busy.current = true
    const go =
      active.scene === scene
        ? SceneNavigator.goToSlot(wanted)
        : SceneNavigator.goToScene(scene).then(() => SceneNavigator.goToSlot(wanted))
    void go.finally(() => {
      busy.current = false
    })
  }, [wanted, scene])
}
