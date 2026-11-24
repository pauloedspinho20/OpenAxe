/**
 * Set lists in the library sidebar (issue #459): make a set, add songs in
 * order with their own speed and transpose, then play it song by song.
 */
import { HardwareButton, PlusIcon, Select } from '@openaxe/ui'
import { useState } from 'react'

import styles from './MediaCenter.module.css'
import { useMediaStore } from './mediaStore'
import { addEntry, moveEntry, newSetList, removeEntry, updateEntry, type SetList } from './setlists'

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.25]
const SEMIS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]

export function SetListsPanel() {
  const setLists = useMediaStore((s) => s.setLists)
  const [openId, setOpenId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const open = setLists.find((x) => x.id === openId) ?? null
  const create = () => {
    const list = newSetList(name)
    void useMediaStore.getState().saveSet(list)
    setName('')
    setOpenId(list.id)
  }
  if (open) return <SetEditor list={open} onBack={() => setOpenId(null)} />
  return (
    <div className={styles.sets}>
      <div className={styles.setCreate}>
        <input
          value={name}
          placeholder="Set name, e.g. Friday gig"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          aria-label="New set name"
        />
        <HardwareButton
          size="small"
          onClick={create}
          label="New set"
          iconOnly
          icon={<PlusIcon />}
        />
      </div>
      {setLists.length === 0 && (
        <p className={styles.emptyList}>
          Make a set list for a gig or a practice routine: songs in order, each with its own speed
          and transpose, played one after another.
        </p>
      )}
      <ul className={styles.list}>
        {setLists.map((l) => (
          <li key={l.id} className={styles.item}>
            <button type="button" className={styles.itemMain} onClick={() => setOpenId(l.id)}>
              <span className={styles.itemText}>
                <span className={styles.itemName}>{l.name}</span>
                <span className={styles.itemMeta}>
                  {l.entries.length} song{l.entries.length === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SetEditor({ list, onBack }: { list: SetList; onBack: () => void }) {
  const items = useMediaStore((s) => s.items)
  const activeSet = useMediaStore((s) => s.activeSet)
  const [pick, setPick] = useState('')
  const [name, setName] = useState(list.name)
  const s = useMediaStore.getState()
  const save = (next: SetList) => void s.saveSet(next)
  const byId = new Map(items.map((i) => [i.id, i]))
  const live = list.entries.filter((e) => byId.has(e.itemId))
  return (
    <div className={styles.sets}>
      <div className={styles.setHead}>
        <HardwareButton size="small" label="◀ Sets" onClick={onBack} />
        <input
          className={styles.setName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== list.name && save({ ...list, name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Set name"
        />
      </div>
      <div className={styles.setHead}>
        <HardwareButton
          size="small"
          label="▶ Play set"
          disabled={live.length === 0}
          onClick={() => void s.playSet(list.id, 0)}
        />
        <HardwareButton
          size="small"
          label="Delete set"
          variant="danger"
          onClick={() => {
            if (confirm(`Delete the set "${list.name}"? The songs stay in the library.`)) {
              void s.removeSet(list.id)
              onBack()
            }
          }}
        />
      </div>
      <ol className={styles.setEntries}>
        {list.entries.map((e, i) => {
          const item = byId.get(e.itemId)
          const playingHere =
            activeSet?.id === list.id &&
            live[activeSet.index]?.itemId === e.itemId &&
            live.indexOf(e) === activeSet.index
          return (
            <li key={`${e.itemId}-${i}`} className={playingHere ? styles.setEntryOn : ''}>
              <span className={styles.setEntryName} title={item?.name ?? 'Missing song'}>
                {item ? item.name : <em>(removed from the library)</em>}
              </span>
              <span className={styles.setEntryTools}>
                <Select
                  value={e.speed}
                  onChange={(ev) => save(updateEntry(list, i, { speed: Number(ev.target.value) }))}
                  aria-label={`Speed for ${item?.name ?? 'song'}`}
                >
                  {SPEEDS.map((v) => (
                    <option key={v} value={v}>
                      {Math.round(v * 100)}%
                    </option>
                  ))}
                </Select>
                <Select
                  value={e.semitones}
                  onChange={(ev) =>
                    save(updateEntry(list, i, { semitones: Number(ev.target.value) }))
                  }
                  aria-label={`Transpose for ${item?.name ?? 'song'}`}
                >
                  {SEMIS.map((v) => (
                    <option key={v} value={v}>
                      {v > 0 ? `+${v}` : v} st
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className={styles.itemDelete}
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => save(moveEntry(list, i, -1))}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.itemDelete}
                  aria-label="Move down"
                  disabled={i === list.entries.length - 1}
                  onClick={() => save(moveEntry(list, i, 1))}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={styles.itemDelete}
                  aria-label={`Remove ${item?.name ?? 'song'} from the set`}
                  onClick={() => save(removeEntry(list, i))}
                >
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      <div className={styles.setCreate}>
        <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Song to add">
          <option value="">Add a song…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.artist ? `${i.artist} – ` : ''}
              {i.name}
            </option>
          ))}
        </Select>
        <HardwareButton
          size="small"
          label="Add"
          disabled={!pick}
          onClick={() => {
            save(addEntry(list, pick))
            setPick('')
          }}
        />
      </div>
    </div>
  )
}

/** Shown while a set plays: where you are, and previous / next. */
export function SetBar() {
  const activeSet = useMediaStore((s) => s.activeSet)
  const setLists = useMediaStore((s) => s.setLists)
  const items = useMediaStore((s) => s.items)
  const list = setLists.find((x) => x.id === activeSet?.id)
  if (!activeSet || !list) return null
  const byId = new Map(items.map((i) => [i.id, i]))
  const live = list.entries.filter((e) => byId.has(e.itemId))
  const next = live[activeSet.index + 1]
  const s = useMediaStore.getState()
  return (
    <div className={styles.setBar} role="region" aria-label="Set list">
      <strong>{list.name}</strong>
      <span className={styles.dim}>
        {activeSet.index + 1}/{live.length}
      </span>
      <HardwareButton
        size="small"
        label="◀ Prev"
        disabled={activeSet.index === 0}
        onClick={() => void s.stepSet(-1)}
      />
      <HardwareButton
        size="small"
        label={next ? `Next ▶ ${byId.get(next.itemId)?.name ?? ''}` : 'Last song'}
        disabled={!next}
        onClick={() => void s.stepSet(1)}
      />
      <span className={styles.setBarSpacer} />
      <HardwareButton size="small" label="End set" onClick={() => s.stopSet()} />
    </div>
  )
}
