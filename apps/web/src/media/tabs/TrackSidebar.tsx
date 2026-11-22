/**
 * The tab workspace's right-hand tabbed inspector (issues #206 / #459):
 * clean segmented tabs for Tracks, Practice, Sync, and Tone (instead of
 * stacked nested <details> disclosures), plus slide-over drawer support
 * on narrow/tablet viewports.
 */
import type { model, Settings } from '@coderline/alphatab'
import { HardwareButton, Select } from '@openaxe/ui'
import { useEffect, useState, type ReactNode } from 'react'

import styles from '../MediaCenter.module.css'
import type { EditCursor } from './scoreEdit'
import * as ops from './scoreOps'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => EditCursor | void) => void

export type InspectorTab = 'tracks' | 'practice' | 'sync' | 'tone'

export interface TrackSidebarProps {
  score: model.Score
  trackIndex: number
  shown: Set<number>
  muted: Set<number>
  solo: Set<number>
  apply: Apply
  onSelect: (index: number) => void
  onToggleShown: (index: number) => void
  onMute: (index: number) => void
  onSolo: (index: number) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (index: number) => void
  onRemove: (index: number) => void
  onAdd: (preset: ops.InstrumentPreset) => void
  onClose: () => void
  /** Legacy slot rendered under Song info when tabbed panels aren't passed. */
  extra?: ReactNode
  activeTab?: InspectorTab
  onTabChange?: (tab: InspectorTab) => void
  practiceTab?: ReactNode
  syncTab?: ReactNode
  toneTab?: ReactNode
  practiceBadge?: string | number | undefined
  syncBadge?: string | number | undefined
  toneBadge?: string | number | undefined
  /** Render as a slide-over overlay drawer on narrow viewports. */
  asDrawer?: boolean
  /** Whether the parent Media Center view is active (gates window Escape listener). */
  viewActive?: boolean | undefined
}

function SongInfo({ score, apply }: { score: model.Score; apply: Apply }) {
  const field = (key: keyof ops.SongInfo, label: string) => (
    <label className={t.field}>
      <span>{label}</span>
      <input
        defaultValue={score[key]}
        key={`${key}:${score[key]}`}
        onBlur={(e) => {
          if (e.target.value !== score[key])
            apply((sc, s) => ops.setSongInfo(sc, { [key]: e.target.value }, s))
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
  return (
    <details className={t.sideSection}>
      <summary>
        <I.TextIcon size={14} /> Song info
      </summary>
      <div className={t.songInfo}>
        {field('title', 'Title')}
        {field('artist', 'Artist')}
        {field('subTitle', 'Subtitle')}
        {field('album', 'Album')}
        {field('music', 'Music by')}
        {field('tab', 'Tab by')}
      </div>
    </details>
  )
}

function TrackRow(p: TrackSidebarProps & { index: number }) {
  const { score, index: i, apply } = p
  const track = score.tracks[i]!
  const staff = track.staves[0]!
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const active = i === p.trackIndex
  const strings = staff.stringTuning.tunings.length
  const presets = strings > 0 ? ops.tuningPresets(strings) : []
  const tuning = staff.stringTuning.tunings.join(',')
  const audible = p.solo.size > 0 ? p.solo.has(i) : !p.muted.has(i)

  return (
    <div
      className={`${t.trackRow} ${active ? t.trackRowActive : ''} ${audible ? '' : t.trackRowSilent}`}
    >
      <div className={t.trackRowHead}>
        <button
          type="button"
          className={`${t.eye} ${p.shown.has(i) ? t.eyeOn : ''}`}
          onClick={() => p.onToggleShown(i)}
          title={p.shown.has(i) ? 'Hide from the score' : 'Show in the score'}
          aria-label={p.shown.has(i) ? `Hide ${track.name}` : `Show ${track.name}`}
          aria-pressed={p.shown.has(i)}
        >
          {staff.isPercussion ? <I.DrumIcon size={15} /> : <I.TabIcon size={15} />}
        </button>
        {renaming ? (
          <input
            className={t.cellInput}
            defaultValue={track.name}
            autoFocus
            onBlur={(e) => {
              setRenaming(false)
              if (e.target.value.trim() && e.target.value !== track.name)
                apply((sc, s) => ops.renameTrack(sc, i, e.target.value, s))
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
            aria-label="Track name"
          />
        ) : (
          <button
            type="button"
            className={t.trackRowName}
            onClick={() => p.onSelect(i)}
            onDoubleClick={() => setRenaming(true)}
            title={`${track.name} — click to edit this track, double-click to rename`}
          >
            <strong>{track.name}</strong>
            <span>
              {staff.isPercussion
                ? 'Drums'
                : `${strings} str · ${ops.tuningLabel(staff.stringTuning.tunings)}${staff.capo ? ` · capo ${staff.capo}` : ''}`}
            </span>
          </button>
        )}
        <HardwareButton
          size="small"
          label="M"
          title="Mute in playback"
          active={p.muted.has(i)}
          variant="danger"
          onClick={() => p.onMute(i)}
        />
        <HardwareButton
          size="small"
          label="S"
          title="Solo in playback"
          active={p.solo.has(i)}
          onClick={() => p.onSolo(i)}
        />
        <button
          type="button"
          className={`${t.expand} ${open ? t.expandOpen : ''}`}
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Fewer options' : 'Instrument, tuning, capo, order…'}
          aria-label={open ? 'Fewer options' : 'More options'}
          aria-expanded={open}
        >
          <I.ChevronDownIcon size={14} />
        </button>
      </div>

      <div className={t.mix}>
        <label title={`Volume ${track.playbackInfo.volume}/16`}>
          <I.VolumeIcon size={13} />
          <input
            type="range"
            min={0}
            max={16}
            value={track.playbackInfo.volume}
            onChange={(e) =>
              apply((sc, s) => ops.setTrackMix(sc, i, { volume: Number(e.target.value) }, s))
            }
            aria-label={`${track.name} volume`}
          />
        </label>
        <label
          title={`Pan ${track.playbackInfo.balance - 8 === 0 ? 'centre' : track.playbackInfo.balance < 8 ? 'left' : 'right'}`}
        >
          <span className={t.panLabel}>L</span>
          <input
            type="range"
            min={0}
            max={16}
            value={track.playbackInfo.balance}
            onChange={(e) =>
              apply((sc, s) => ops.setTrackMix(sc, i, { balance: Number(e.target.value) }, s))
            }
            onDoubleClick={() => apply((sc, s) => ops.setTrackMix(sc, i, { balance: 8 }, s))}
            aria-label={`${track.name} pan`}
          />
          <span className={t.panLabel}>R</span>
        </label>
      </div>

      {open && (
        <div className={t.trackMore}>
          {!staff.isPercussion && (
            <label className={t.textField} title="Instrument sound">
              <I.NoteGlyphIcon size={14} />
              <Select
                value={track.playbackInfo.program}
                onChange={(e) => apply((sc, s) => ops.setProgram(sc, i, Number(e.target.value), s))}
                aria-label="Instrument"
              >
                {!ops.PROGRAMS.some((pr) => pr.program === track.playbackInfo.program) && (
                  <option value={track.playbackInfo.program}>
                    GM #{track.playbackInfo.program}
                  </option>
                )}
                {ops.PROGRAMS.map((pr) => (
                  <option key={pr.program} value={pr.program}>
                    {pr.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {strings > 0 && (
            <>
              <label className={t.textField} title="Tuning">
                <I.TuningIcon size={14} />
                <Select
                  value={tuning}
                  onChange={(e) =>
                    apply((sc, s) => ops.setTuning(sc, i, e.target.value.split(',').map(Number), s))
                  }
                  aria-label="Tuning"
                >
                  {!presets.some((pr) => pr.tunings.join(',') === tuning) && (
                    <option value={tuning}>{ops.tuningLabel(staff.stringTuning.tunings)}</option>
                  )}
                  {presets.map((pr) => (
                    <option key={pr.name} value={pr.tunings.join(',')}>
                      {pr.name.replace(/^(Guitar|Bass) /, '')} — {ops.tuningLabel(pr.tunings)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={t.textField} title="Capo fret">
                <I.CapoIcon size={14} />
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={staff.capo}
                  onChange={(e) => apply((sc, s) => ops.setCapo(sc, i, Number(e.target.value), s))}
                  aria-label="Capo"
                />
                <span className={styles.dim}>capo</span>
              </label>
            </>
          )}
          <div className={t.trackActions}>
            <HardwareButton
              size="small"
              label="Move up"
              icon={<I.StringUpIcon size={14} />}
              iconOnly
              disabled={i === 0}
              onClick={() => p.onMove(i, i - 1)}
            />
            <HardwareButton
              size="small"
              label="Move down"
              icon={<I.StringDownIcon size={14} />}
              iconOnly
              disabled={i >= score.tracks.length - 1}
              onClick={() => p.onMove(i, i + 1)}
            />
            <HardwareButton
              size="small"
              label="Duplicate track"
              icon={<I.BarDuplicateIcon size={14} />}
              iconOnly
              onClick={() => p.onDuplicate(i)}
            />
            <HardwareButton
              size="small"
              label="Rename"
              icon={<I.TextIcon size={14} />}
              iconOnly
              onClick={() => setRenaming(true)}
            />
            <HardwareButton
              size="small"
              label="Delete track"
              icon={<I.TrashIcon size={14} />}
              iconOnly
              variant="danger"
              disabled={score.tracks.length <= 1}
              onClick={() => {
                if (confirm(`Delete the track "${track.name}"?`)) p.onRemove(i)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function TrackSidebar(p: TrackSidebarProps) {
  const [preset, setPreset] = useState(ops.INSTRUMENTS[0]!.id)
  const [localTab, setLocalTab] = useState<InspectorTab>('tracks')
  const hasTabs = !!(p.practiceTab || p.syncTab || p.toneTab)
  const activeTab = p.activeTab ?? localTab
  const setTab = (tab: InspectorTab) => {
    if (p.onTabChange) p.onTabChange(tab)
    else setLocalTab(tab)
  }

  const { asDrawer, onClose, viewActive = true } = p
  useEffect(() => {
    if (!asDrawer || !viewActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asDrawer, onClose, viewActive])

  const tabs: {
    id: InspectorTab
    label: string
    Icon: typeof I.TracksIcon
    badge?: string | number | undefined
  }[] = [
    { id: 'tracks', label: 'Tracks', Icon: I.TracksIcon, badge: p.score.tracks.length },
    ...(p.practiceTab
      ? [
          {
            id: 'practice' as const,
            label: 'Practice',
            Icon: I.PracticeIcon,
            badge: p.practiceBadge,
          },
        ]
      : []),
    ...(p.syncTab
      ? [{ id: 'sync' as const, label: 'Sync', Icon: I.SyncIcon, badge: p.syncBadge }]
      : []),
    ...(p.toneTab
      ? [{ id: 'tone' as const, label: 'Tone', Icon: I.ToneIcon, badge: p.toneBadge }]
      : []),
  ]

  const tracksContent = (
    <>
      <div className={t.trackList}>
        {p.score.tracks.map((_, i) => (
          <TrackRow key={`${i}:${p.score.tracks[i]!.name}`} {...p} index={i} />
        ))}
      </div>
      <div className={t.textField}>
        <Select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          aria-label="New track instrument"
        >
          {ops.INSTRUMENTS.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.label}
            </option>
          ))}
        </Select>
        <HardwareButton
          size="small"
          label="Add"
          icon={<I.PlusIcon size={14} />}
          onClick={() => p.onAdd(ops.INSTRUMENTS.find((x) => x.id === preset)!)}
        />
      </div>
      <SongInfo score={p.score} apply={p.apply} />
      {p.extra}
      <p className={t.hint}>
        The eye shows a track in the score; several can be shown at once. Click a track's name to
        edit it.
      </p>
    </>
  )

  const panel = (
    <aside className={`${t.sidebar} ${p.asDrawer ? t.inspectorDrawer : ''}`} aria-label="Inspector">
      <div className={t.drawerHead}>
        <strong>
          <I.SidebarIcon size={15} /> Inspector
        </strong>
        <button
          type="button"
          className={t.tbBtn}
          aria-label="Close inspector"
          title="Close inspector"
          onClick={p.onClose}
        >
          <I.CloseIcon size={14} />
        </button>
      </div>

      {hasTabs && (
        <div className={t.inspectorTabs} role="tablist" aria-label="Inspector sections">
          {tabs.map(({ id, label, Icon, badge }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`${t.inspectorTab} ${activeTab === id ? t.inspectorTabOn : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              <span>{label}</span>
              {badge !== undefined && badge !== '' && <em className={t.tabBadge}>{badge}</em>}
            </button>
          ))}
        </div>
      )}

      <div className={t.inspectorBody} role={hasTabs ? 'tabpanel' : undefined}>
        {(!hasTabs || activeTab === 'tracks') && tracksContent}
        {hasTabs && activeTab === 'practice' && p.practiceTab}
        {hasTabs && activeTab === 'sync' && p.syncTab}
        {hasTabs && activeTab === 'tone' && p.toneTab}
      </div>
    </aside>
  )

  if (p.asDrawer) {
    return (
      <div className={t.drawerBackdrop} onClick={p.onClose} role="presentation">
        <div className={t.drawerHostRight} onClick={(e) => e.stopPropagation()}>
          {panel}
        </div>
      </div>
    )
  }

  return panel
}
