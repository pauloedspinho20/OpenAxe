/**
 * The tab editor's toolbox:
 * - Desktop (`layout === 'rail'`): vertical icon rail (Note, Effects, Bar,
 *   Selection, Text & chords) + collapsible 248px panel with readable controls.
 * - Tablet & mobile (`layout === 'dock'`): bottom edit dock with Entry
 *   (Keypad / Fretboard / Piano or DrumLane) + Note / Effects / Bar / Select /
 *   Text tabs, Undo/Redo, and collapse toggle so the sheet keeps the screen.
 */
import { model, type Settings } from '@coderline/alphatab'
import { HardwareButton, RedoIcon, UndoIcon, type IconProps, Select } from '@openaxe/ui'
import { useRef, useState, type ComponentType, type ReactNode } from 'react'

import { ChordLibrary } from './ChordLibrary'
import { FindReplace } from './FindReplace'
import * as rhythm from './rhythm'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'
import { ToolbarButton, useRovingToolbar } from './WorkspaceControls'

type Apply = (fn: (score: model.Score, s: Settings) => edit.EditCursor | void) => void
export type ToolGroup = 'entry' | 'note' | 'effects' | 'bar' | 'select' | 'text'

const RAIL_GROUPS: { id: ToolGroup; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'note', label: 'Note', Icon: I.QuarterNoteIcon },
  { id: 'effects', label: 'Effects', Icon: I.BendIcon },
  { id: 'bar', label: 'Bar', Icon: I.RepeatStartIcon },
  { id: 'select', label: 'Selection', Icon: I.CopyIcon },
  { id: 'text', label: 'Text & chords', Icon: I.ChordIcon },
]

const DOCK_GROUPS: { id: ToolGroup; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'entry', label: 'Entry', Icon: I.KeypadIcon },
  { id: 'note', label: 'Note', Icon: I.QuarterNoteIcon },
  { id: 'effects', label: 'Effects', Icon: I.BendIcon },
  { id: 'bar', label: 'Bar', Icon: I.RepeatStartIcon },
  { id: 'select', label: 'Select', Icon: I.CopyIcon },
  { id: 'text', label: 'Text', Icon: I.ChordIcon },
]

export interface ToolboxProps {
  score: model.Score
  cursor: edit.EditCursor
  apply: Apply
  group: ToolGroup | null
  onGroup: (g: ToolGroup | null) => void
  selectionSize: number
  hasClip: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onCopy: (cut: boolean) => void
  onPaste: () => void
  onLoopSelection: () => void
  targets: () => ops.BeatRef[]
  /** Bars moved: shift the selection's anchor by this many bars. */
  onShiftSelection: (bars: number) => void
  /** The cursor bar's personal practice note, and saving it. */
  barNote: string
  onBarNote: (text: string) => void
  /** Move the edit cursor (find: next / previous match). */
  onCursor: (c: edit.EditCursor) => void
  onVoice: (voice: number) => void
  keepRhythm: boolean
  onKeepRhythm: (on: boolean) => void
  layout?: 'rail' | 'dock'
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** Touch fret entry / drum lane rendered on the 'entry' tab in dock layout. */
  entryContent?: ReactNode
}

/**
 * Tool button: wraps ToolbarButton with readable sizing and proper toggle vs
 * action ARIA semantics (`pressed` is only set when `on !== undefined`).
 */
export function Tool({
  icon: Icon,
  title,
  tag,
  on,
  disabled,
  onClick,
}: {
  icon?: ComponentType<IconProps> | undefined
  title: string
  tag?: string | number | undefined
  on?: boolean | undefined
  disabled?: boolean | undefined
  onClick: () => void
}) {
  const icon = Icon ? <Icon size={15} /> : undefined
  const hasTag = tag !== undefined && tag !== ''
  return (
    <ToolbarButton
      label={title}
      text={hasTag ? String(tag) : undefined}
      icon={icon}
      pressed={on}
      disabled={!!disabled}
      title={title}
      onClick={onClick}
    />
  )
}

/** Re-pick strings/frets for the selection (or the cursor's bar). */
function AutoFingering({
  score,
  c,
  targets,
  apply,
}: {
  score: model.Score
  c: edit.EditCursor
  targets: () => ops.BeatRef[]
  apply: Apply
}) {
  const [position, setPosition] = useState(5)
  const [result, setResult] = useState<string | null>(null)
  const run = (options: { position?: number | null }, label: string) => {
    let refs = targets()
    // No selection: the whole bar.
    if (refs.length < 2) {
      const beats = edit.voiceAt(score, c)?.beats.length ?? 0
      refs = Array.from({ length: beats }, (_, beat) => ({ bar: c.bar, beat }))
    }
    apply((sc, s) => {
      const moved = ops.autoFingerRange(sc, c, refs, options, s)
      setResult(`${label}: ${moved} note${moved === 1 ? '' : 's'} moved`)
    })
  }
  return (
    <section className={t.boxSection}>
      <h4>Auto-fingering</h4>
      <p className={t.hint}>
        Re-picks strings and frets for the selection (or this bar). The notes sound the same.
      </p>
      <div className={t.toolGrid}>
        <HardwareButton
          size="small"
          label="Least movement"
          title="Keep the hand as still as possible"
          onClick={() => run({}, 'Least movement')}
        />
        <label className={t.textField} title="Hand position (lowest fret of the box)">
          <span>pos.</span>
          <input
            type="number"
            min={1}
            max={20}
            value={position}
            onChange={(e) => setPosition(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Hand position"
          />
        </label>
        <HardwareButton
          size="small"
          label="Stay in position"
          title={`Keep notes between frets ${position} and ${position + 4} (plus open strings)`}
          onClick={() => run({ position }, `Position ${position}`)}
        />
      </div>
      {result && <p className={t.hint}>{result}.</p>}
    </section>
  )
}

/** Several bars at once: the selection's bars, or the cursor's bar. */
function BarRangeTools({
  score,
  c,
  span,
  apply,
  onMoved,
}: {
  score: model.Score
  c: edit.EditCursor
  span: [number, number]
  apply: Apply
  onMoved: (bars: number) => void
}) {
  const move = (delta: number) => {
    let moved = 0
    apply((sc, s) => {
      const at = ops.moveBars(sc, a, b, delta, s)
      moved = at - a
      return { ...c, bar: c.bar + moved }
    })
    if (moved) onMoved(moved)
  }
  const [count, setCount] = useState(1)
  const [a, b] = span
  const label = a === b ? `bar ${a + 1}` : `bars ${a + 1}–${b + 1}`
  const total = score.masterBars.length
  const repeat = score.masterBars[b]?.repeatCount ?? 0
  const repeatOn = !!score.masterBars[a]?.isRepeatStart && repeat > 1
  return (
    <Section title={a === b ? 'Bars' : `Bars ${a + 1}–${b + 1}`}>
      <label className={t.textField} title="How many bars to insert">
        <I.BarInsertIcon size={16} />
        <input
          type="number"
          min={1}
          max={64}
          value={count}
          onChange={(e) => setCount(Math.min(64, Math.max(1, Number(e.target.value) || 1)))}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Bars to insert"
        />
      </label>
      <HardwareButton
        size="small"
        label={`Insert ${count}`}
        title={`Insert ${count} empty bar${count > 1 ? 's' : ''} after ${label}`}
        onClick={() => apply((sc, s) => ({ ...c, bar: ops.insertBars(sc, b, count, s), beat: 0 }))}
      />
      <HardwareButton
        size="small"
        label="Delete"
        variant="danger"
        title={`Delete ${label}`}
        disabled={b - a + 1 >= total}
        onClick={() =>
          apply((sc, s) => {
            ops.deleteBars(sc, a, b, s)
            return { ...c, bar: Math.min(a, sc.masterBars.length - 1), beat: 0 }
          })
        }
      />
      <HardwareButton
        size="small"
        label="◀ Move"
        title={`Move ${label} one bar earlier`}
        disabled={a === 0}
        onClick={() => move(-1)}
      />
      <HardwareButton
        size="small"
        label="Move ▶"
        title={`Move ${label} one bar later`}
        disabled={b >= total - 1}
        onClick={() => move(1)}
      />
      <label className={t.textField} title={`Play ${label} this many times`}>
        <I.RepeatEndIcon size={16} />
        <Select
          value={repeatOn ? repeat : 1}
          onChange={(e) => apply((sc, s) => ops.setRepeat(sc, a, b, Number(e.target.value), s))}
          aria-label={`Repeat ${label}`}
        >
          <option value={1}>no repeat</option>
          {[2, 3, 4, 5, 6, 8].map((n) => (
            <option key={n} value={n}>
              ×{n}
            </option>
          ))}
        </Select>
      </label>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={t.boxSection}>
      <h4>{title}</h4>
      <div className={t.toolGrid}>{children}</div>
    </section>
  )
}

function TextField({
  label,
  icon: Icon,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  icon: ComponentType<IconProps>
  value: string
  placeholder: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <label className={t.textField} title={label}>
      <Icon size={16} />
      <input
        value={draft ?? value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    </label>
  )
}

export function TabToolbox(p: ToolboxProps) {
  const { score, cursor: c, apply, group, layout = 'rail', collapsed = false } = p
  const [tupNum, setTupNum] = useState(3)
  const [tupDen, setTupDen] = useState(2)
  const [quantizeGrid, setQuantizeGrid] = useState<rhythm.QuantizeGrid>('1/16')
  const railRef = useRef<HTMLDivElement | null>(null)
  const railRoving = useRovingToolbar(railRef, layout === 'rail' ? 'vertical' : 'horizontal')

  const beat = edit.beatAt(score, c)
  const note = edit.noteAt(score, c)
  const mb = score.masterBars[c.bar]
  const staff = score.tracks[c.track]?.staves[c.staff]
  const drums = !!staff?.isPercussion
  const voices = staff?.bars[c.bar]?.voices.length ?? 1
  const fx = (e: edit.NoteEffect) => () => apply((sc, s) => void edit.toggleNoteEffect(sc, c, e, s))
  const bfx = (e: edit.BeatEffect) => () =>
    apply((sc, s) => void edit.toggleBeatEffect(sc, c, e, s))
  const range = (fn: (sc: model.Score, refs: ops.BeatRef[], s: Settings) => void) => () => {
    const refs = p.targets()
    apply((sc, s) => fn(sc, refs, s))
  }

  const activeGroup: ToolGroup | null =
    layout === 'dock' ? (group ?? 'entry') : group === 'entry' ? 'note' : group

  const bodyContent = (
    <>
      {activeGroup === 'entry' && layout === 'dock' && p.entryContent}

      {activeGroup === 'note' && (
        <>
          <Section title="Length">
            {edit.DURATIONS.map((d) => (
              <Tool
                key={d}
                icon={I.NOTE_ICON[d]}
                title={`${edit.DURATION_LABEL[d]} note (+ / − to step)`}
                on={beat?.duration === d}
                onClick={() =>
                  apply((sc, s) =>
                    p.keepRhythm
                      ? rhythm.setDurationKeepRhythm(sc, c, d, s)
                      : edit.setDuration(sc, c, d, s),
                  )
                }
              />
            ))}
            <Tool
              icon={I.DotIcon}
              title="Dotted (.)"
              on={!!beat?.dots}
              onClick={() =>
                apply((sc, s) =>
                  p.keepRhythm ? rhythm.toggleDotKeepRhythm(sc, c, s) : edit.toggleDot(sc, c, s),
                )
              }
            />
            <Tool
              icon={I.RestIcon}
              title="Rest (R)"
              on={beat?.isRest}
              onClick={() =>
                apply((sc, s) =>
                  p.keepRhythm ? rhythm.makeRestAndMerge(sc, c, s) : edit.makeRest(sc, c, s),
                )
              }
            />
            <Tool
              icon={I.TieIcon}
              title="Tie to previous (T)"
              on={note?.isTieDestination}
              disabled={!note}
              onClick={fx('tie')}
            />
          </Section>
          <Section title="Rhythm">
            <ToolbarButton
              label="Keep rhythm"
              text="Keep rhythm"
              pressed={p.keepRhythm}
              title="Split/merge rests to keep bar length when changing durations or pasting"
              onClick={() => p.onKeepRhythm(!p.keepRhythm)}
            />
            <ToolbarButton
              label="Clean up rests"
              text="Clean up rests"
              title="Pad and merge rests in this bar"
              onClick={() => apply((sc, s) => rhythm.normalizeBarRests(sc, c, s))}
            />
          </Section>
          <Section title="Tuplet">
            {rhythm.TUPLET_PRESETS.map((tp) => (
              <Tool
                key={tp.label}
                icon={tp.num === 3 && tp.den === 2 ? I.TripletIcon : undefined}
                tag={tp.num === 3 && tp.den === 2 ? undefined : tp.label}
                title={tp.title}
                on={beat?.tupletNumerator === tp.num && beat?.tupletDenominator === tp.den}
                onClick={() =>
                  apply((sc, s) =>
                    rhythm.applyTuplet(sc, c, p.targets(), tp.num, tp.den, p.keepRhythm, s),
                  )
                }
              />
            ))}
            <div className={t.tapRow}>
              <label className={t.textField} title="Tuplet notes">
                <input
                  type="number"
                  min={2}
                  max={15}
                  value={tupNum}
                  onChange={(e) =>
                    setTupNum(Math.min(15, Math.max(2, Number(e.target.value) || 2)))
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Tuplet numerator"
                />
              </label>
              <span>:</span>
              <label className={t.textField} title="In the time of">
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={tupDen}
                  onChange={(e) =>
                    setTupDen(Math.min(15, Math.max(1, Number(e.target.value) || 1)))
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Tuplet denominator"
                />
              </label>
              <HardwareButton
                size="small"
                label="Apply"
                title={`Apply ${tupNum}:${tupDen} tuplet`}
                onClick={() =>
                  apply((sc, s) =>
                    rhythm.applyTuplet(sc, c, p.targets(), tupNum, tupDen, p.keepRhythm, s),
                  )
                }
              />
              <HardwareButton
                size="small"
                label="Clear"
                title="Remove tuplet grouping"
                disabled={!beat || beat.tupletNumerator <= 0}
                onClick={() => apply((sc, s) => rhythm.clearTuplet(sc, c, p.keepRhythm, s))}
              />
            </div>
          </Section>
          <Section title="Quantize">
            <Select
              value={quantizeGrid}
              onChange={(e) => setQuantizeGrid(e.target.value as rhythm.QuantizeGrid)}
              aria-label="Quantize grid"
            >
              {rhythm.QUANTIZE_GRIDS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
            <HardwareButton
              size="small"
              label="Quantize"
              title="Snap notes in the selection (or current bar) onto the grid"
              onClick={() => {
                const [a, b] = ops.barSpan(c, p.targets())
                apply((sc, s) => rhythm.quantizeBars(sc, c, a, b, quantizeGrid, s))
              }}
            />
          </Section>
          <Section title="Beat">
            <Tool
              icon={I.BarInsertIcon}
              title="Insert beat before (I)"
              onClick={() => apply((sc, s) => edit.insertBeatBefore(sc, c, s))}
            />
            <Tool
              icon={I.TrashIcon}
              title="Delete beat (Shift+Del)"
              onClick={() => apply((sc, s) => edit.deleteBeat(sc, c, s))}
            />
          </Section>
          <Section title="Voice">
            {[0, 1].map((v) => (
              <Tool
                key={v}
                icon={I.VoiceIcon}
                title={v === 0 ? 'Voice 1' : voices > 1 ? 'Voice 2' : 'Add a second voice'}
                on={c.voice === v}
                onClick={() => {
                  if (v >= voices) apply((sc, s) => ops.ensureVoice(sc, c, v, s))
                  p.onVoice(v)
                }}
                tag={v + 1}
              />
            ))}
          </Section>
          {!drums && layout === 'rail' && (
            <p className={t.hint}>
              Type a fret number (two quick digits for 10+). ←/→ beat · ↑/↓ string · Del removes the
              note.
            </p>
          )}
        </>
      )}

      {activeGroup === 'effects' && (
        <>
          <Section title="Articulation">
            <Tool
              icon={I.PalmMuteIcon}
              title="Palm mute (P)"
              on={note?.isPalmMute}
              disabled={!note}
              onClick={fx('palmMute')}
            />
            <Tool
              icon={I.LetRingIcon}
              title="Let ring (L)"
              on={note?.isLetRing}
              disabled={!note}
              onClick={fx('letRing')}
            />
            <Tool
              icon={I.HammerIcon}
              title="Hammer-on / pull-off (H)"
              on={note?.isHammerPullOrigin}
              disabled={!note}
              onClick={fx('hammer')}
            />
            <Tool
              icon={I.VibratoIcon}
              title="Vibrato (V)"
              on={!!note && note.vibrato !== model.VibratoType.None}
              disabled={!note}
              onClick={fx('vibrato')}
            />
            <Tool
              icon={I.DeadNoteIcon}
              title="Dead note (X)"
              on={note?.isDead}
              disabled={!note}
              onClick={fx('dead')}
            />
            <Tool
              icon={I.GhostNoteIcon}
              title="Ghost note"
              on={note?.isGhost}
              disabled={!note}
              onClick={fx('ghost')}
            />
            <Tool
              icon={I.StaccatoIcon}
              title="Staccato"
              on={note?.isStaccato}
              disabled={!note}
              onClick={fx('staccato')}
            />
            <Tool
              icon={I.AccentIcon}
              title="Accent"
              on={!!note && note.accentuated !== model.AccentuationType.None}
              disabled={!note}
              onClick={fx('accent')}
            />
          </Section>
          <Section title="Bend">
            {ops.BEND_PRESETS.filter((b) => b.id !== 'none').map((b) => (
              <Tool
                key={b.id}
                icon={I.BendIcon}
                title={`Bend: ${b.label}`}
                disabled={!note}
                onClick={() => apply((sc, s) => ops.setBend(sc, c, b.id, s))}
                tag={b.label}
              />
            ))}
            <Tool
              icon={I.CloseIcon}
              title="Remove bend"
              disabled={!note?.hasBend}
              onClick={() => apply((sc, s) => ops.setBend(sc, c, 'none', s))}
            />
          </Section>
          <Section title="Slide">
            {ops.SLIDES.map((sl) => (
              <Tool
                key={sl.id}
                icon={sl.id === 'none' ? I.CloseIcon : I.SlideIcon}
                title={sl.title}
                disabled={!note}
                onClick={() => apply((sc, s) => ops.setSlide(sc, c, sl.id, s))}
                tag={sl.id !== 'none' ? sl.label : undefined}
              />
            ))}
          </Section>
          <Section title="Technique">
            <Tool
              icon={I.TapIcon}
              title="Tapping"
              on={beat?.tap}
              disabled={!beat}
              onClick={bfx('tap')}
            />
            <Tool
              icon={I.PickDownIcon}
              title="Pick down"
              on={beat?.pickStroke === model.PickStroke.Down}
              disabled={!beat}
              onClick={bfx('pickDown')}
            />
            <Tool
              icon={I.PickUpIcon}
              title="Pick up"
              on={beat?.pickStroke === model.PickStroke.Up}
              disabled={!beat}
              onClick={bfx('pickUp')}
            />
            {[1, 2, 3].map((m) => (
              <Tool
                key={m}
                icon={I.TremoloIcon}
                title={`Tremolo picking (${['8ths', '16ths', '32nds'][m - 1]})`}
                on={beat?.tremoloPicking?.marks === m}
                disabled={!beat}
                onClick={() =>
                  apply((sc, s) =>
                    ops.setTremolo(sc, c, beat?.tremoloPicking?.marks === m ? 0 : m, s),
                  )
                }
                tag={m}
              />
            ))}
            <Tool
              icon={I.TrillIcon}
              title="Trill with the fret two above"
              on={note?.isTrill}
              disabled={!note}
              onClick={() =>
                apply((sc, s) =>
                  ops.setTrill(sc, c, note?.isTrill ? null : (note?.fret ?? 0) + 2, s),
                )
              }
            />
            <Tool
              icon={I.GraceIcon}
              title="Grace note before (two frets below)"
              disabled={!beat}
              onClick={() =>
                apply((sc, s) => ops.addGraceNote(sc, c, Math.max(0, (note?.fret ?? 2) - 2), s))
              }
            />
          </Section>
          <Section title="Harmonics">
            {ops.HARMONICS.map((h) => (
              <Tool
                key={h.type}
                icon={I.HarmonicIcon}
                title={h.title}
                on={note?.harmonicType === h.type}
                disabled={!note}
                onClick={() => apply((sc, s) => ops.setHarmonic(sc, c, h.type, s))}
                tag={h.label}
              />
            ))}
          </Section>
          <Section title="Whammy bar">
            {ops.WHAMMY_PRESETS.map((w) => (
              <Tool
                key={w.id}
                icon={I.VibratoIcon}
                title={w.title}
                disabled={!beat}
                onClick={() => apply((sc, s) => ops.setWhammy(sc, c, w.id, s))}
                tag={w.label}
              />
            ))}
            <Tool
              icon={I.CloseIcon}
              title="Remove the whammy bar"
              disabled={!beat || beat.whammyBarType === model.WhammyType.None}
              onClick={() => apply((sc, s) => ops.setWhammy(sc, c, 'none', s))}
            />
          </Section>
          <Section title="Fingering (left hand)">
            {(
              [
                [model.Fingers.Thumb, 'T'],
                [model.Fingers.IndexFinger, '1'],
                [model.Fingers.MiddleFinger, '2'],
                [model.Fingers.AnnularFinger, '3'],
                [model.Fingers.LittleFinger, '4'],
              ] as const
            ).map(([f, label]) => (
              <Tool
                key={f}
                title={`Finger ${label === 'T' ? 'thumb' : label} (shown on the notation staff)`}
                on={note?.leftHandFinger === f}
                disabled={!note}
                onClick={() => apply((sc, s) => ops.setFinger(sc, c, f, s))}
                tag={label}
              />
            ))}
          </Section>
          <Section title="Volume">
            {(
              [
                [model.FadeType.FadeIn, 'fade in', '<'],
                [model.FadeType.FadeOut, 'fade out', '>'],
                [model.FadeType.VolumeSwell, 'volume swell', '<>'],
              ] as const
            ).map(([f, label, tag]) => (
              <Tool
                key={f}
                title={`${label[0]!.toUpperCase()}${label.slice(1)}`}
                on={beat?.fade === f}
                disabled={!beat}
                onClick={() => apply((sc, s) => ops.setFade(sc, c, f, s))}
                tag={tag}
              />
            ))}
            <label className={t.textField} title="Rasgueado (flamenco strum)">
              <span>rasg.</span>
              <Select
                value={beat?.rasgueado ?? model.Rasgueado.None}
                disabled={!beat}
                onChange={(e) =>
                  apply((sc, s) =>
                    ops.setRasgueado(sc, c, Number(e.target.value) as model.Rasgueado, s),
                  )
                }
                aria-label="Rasgueado"
              >
                <option value={model.Rasgueado.None}>none</option>
                {ops.RASGUEADOS.map((r) => (
                  <option key={r.type} value={r.type}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          </Section>
          <Section title="Dynamics">
            {ops.DYNAMICS.map((d) => (
              <Tool
                key={d}
                title={`Dynamics ${d.toLowerCase()}`}
                on={beat?.dynamics === model.DynamicValue[d]}
                disabled={!beat}
                onClick={() => apply((sc, s) => ops.setDynamics(sc, c, d, s))}
                tag={d.toLowerCase()}
              />
            ))}
          </Section>
        </>
      )}

      {activeGroup === 'bar' && mb && (
        <>
          <Section title={`Bar ${c.bar + 1}`}>
            <label
              className={t.textField}
              title="Time signature from this bar on (until the next change)"
            >
              <I.TimeSigIcon size={16} />
              <input
                type="number"
                min={1}
                max={32}
                value={mb.timeSignatureNumerator}
                onChange={(e) =>
                  apply((sc, s) =>
                    ops.setTimeSignatureFrom(
                      sc,
                      c.bar,
                      Number(e.target.value),
                      mb.timeSignatureDenominator,
                      s,
                    ),
                  )
                }
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Beats per bar"
              />
              /
              <Select
                value={mb.timeSignatureDenominator}
                onChange={(e) =>
                  apply((sc, s) =>
                    ops.setTimeSignatureFrom(
                      sc,
                      c.bar,
                      mb.timeSignatureNumerator,
                      Number(e.target.value),
                      s,
                    ),
                  )
                }
                aria-label="Beat unit"
              >
                {[2, 4, 8, 16].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </label>
            <label className={t.textField} title="Tempo (BPM) from this bar">
              <I.TempoIcon size={16} />
              <input
                type="number"
                min={20}
                max={400}
                value={edit.tempoAt(score, c.bar)}
                onChange={(e) =>
                  apply((sc, s) => edit.setTempo(sc, c.bar, Number(e.target.value), s))
                }
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Tempo"
              />
            </label>
          </Section>
          <Section title="Structure">
            <Tool
              icon={I.BarInsertIcon}
              title="Insert bar after"
              onClick={() =>
                apply((sc, s) => ({ ...c, bar: edit.insertBar(sc, c.bar, s), beat: 0 }))
              }
            />
            <Tool
              icon={I.BarDuplicateIcon}
              title="Duplicate bar"
              onClick={() =>
                apply((sc, s) => ({ ...c, bar: edit.duplicateBar(sc, c.bar, s), beat: 0 }))
              }
            />
            <Tool
              icon={I.BarDeleteIcon}
              title="Delete bar"
              disabled={score.masterBars.length <= 1}
              onClick={() =>
                apply((sc, s) => {
                  edit.deleteBar(sc, c.bar, s)
                  return { ...c, beat: 0 }
                })
              }
            />
            <Tool
              icon={I.RepeatStartIcon}
              title="Repeat start"
              on={mb.isRepeatStart}
              onClick={() => apply((sc, s) => edit.toggleRepeat(sc, c.bar, 'start', s))}
            />
            <Tool
              icon={I.RepeatEndIcon}
              title="Repeat end (×2)"
              on={mb.repeatCount > 0}
              onClick={() => apply((sc, s) => edit.toggleRepeat(sc, c.bar, 'end', s))}
            />
          </Section>
          <BarRangeTools
            score={score}
            c={c}
            span={ops.barSpan(c, p.targets())}
            apply={apply}
            onMoved={p.onShiftSelection}
          />
          {!drums && (
            <Section title="Transpose bar">
              <Tool
                icon={I.FlatIcon}
                title="Down a semitone"
                onClick={() => apply((sc, s) => edit.transposeBar(sc, c, -1, s))}
              />
              <Tool
                icon={I.SharpIcon}
                title="Up a semitone"
                onClick={() => apply((sc, s) => edit.transposeBar(sc, c, 1, s))}
              />
            </Section>
          )}
        </>
      )}

      {activeGroup === 'select' && (
        <>
          {!drums && (
            <section className={t.boxSection}>
              <h4>Find &amp; replace</h4>
              <FindReplace score={score} c={c} apply={apply} onCursor={p.onCursor} />
            </section>
          )}
          {!drums && <AutoFingering score={score} c={c} targets={p.targets} apply={apply} />}
          <p className={t.hint}>
            {p.selectionSize > 1
              ? `${p.selectionSize} beats selected.`
              : 'Shift+←/→ or drag across the sheet to select. Without a selection, tools act on the cursor beat.'}
          </p>
          <Section title="Clipboard">
            <Tool icon={I.CopyIcon} title="Copy (Ctrl/Cmd+C)" onClick={() => p.onCopy(false)} />
            <Tool icon={I.CutIcon} title="Cut (Ctrl/Cmd+X)" onClick={() => p.onCopy(true)} />
            <Tool
              icon={I.PasteIcon}
              title="Paste at cursor (Ctrl/Cmd+V)"
              disabled={!p.hasClip}
              onClick={p.onPaste}
            />
            <Tool icon={I.LoopIcon} title="Loop the selection" onClick={p.onLoopSelection} />
          </Section>
          {!drums && (
            <Section title="Move">
              <Tool
                icon={I.FlatIcon}
                title="Transpose down (Alt+↓)"
                onClick={range((sc, refs, s) => ops.transposeRange(sc, c, refs, -1, s))}
              />
              <Tool
                icon={I.SharpIcon}
                title="Transpose up (Alt+↑)"
                onClick={range((sc, refs, s) => ops.transposeRange(sc, c, refs, 1, s))}
              />
              <Tool
                icon={I.StringUpIcon}
                title="To higher string, same pitch (Alt+Shift+↑)"
                onClick={range((sc, refs, s) => ops.moveRangeString(sc, c, refs, 1, s))}
              />
              <Tool
                icon={I.StringDownIcon}
                title="To lower string, same pitch (Alt+Shift+↓)"
                onClick={range((sc, refs, s) => ops.moveRangeString(sc, c, refs, -1, s))}
              />
            </Section>
          )}
          <Section title="Set length">
            {edit.DURATIONS.map((d) => (
              <Tool
                key={d}
                icon={I.NOTE_ICON[d]}
                title={`Make every selected beat ${edit.DURATION_LABEL[d]}`}
                onClick={range((sc, refs, s) => ops.setRangeDuration(sc, c, refs, d, s))}
              />
            ))}
          </Section>
        </>
      )}

      {activeGroup === 'text' && !drums && (
        <section className={t.boxSection}>
          <h4>Chord library</h4>
          <ChordLibrary score={score} c={c} apply={apply} />
        </section>
      )}
      {activeGroup === 'text' && (
        <div className={t.boxSection}>
          <TextField
            label="Chord name (diagram from the beat's frets)"
            icon={I.ChordIcon}
            value={beat?.chordId ? (staff?.getChord(beat.chordId)?.name ?? '') : ''}
            placeholder="Chord, e.g. Am7"
            onCommit={(v) => apply((sc, s) => ops.setChord(sc, c, v, s))}
          />
          <TextField
            label="Section marker on this bar"
            icon={I.SectionIcon}
            value={mb?.section?.text ?? ''}
            placeholder="Section, e.g. Chorus"
            onCommit={(v) => apply((sc, s) => ops.setSection(sc, c.bar, v, s))}
          />
          <TextField
            label="Text above the beat"
            icon={I.TextIcon}
            value={beat?.text ?? ''}
            placeholder="Text, e.g. let ring"
            onCommit={(v) => apply((sc, s) => ops.setBeatText(sc, c, v, s))}
          />
          <TextField
            label="Practice note on this bar (just for you, not saved in the tab)"
            icon={I.EditIcon}
            value={p.barNote}
            placeholder="Note to self, e.g. mute the B string"
            onCommit={p.onBarNote}
          />
          <TextField
            label="Lyric syllable"
            icon={I.LyricIcon}
            value={beat?.lyrics?.[0] ?? ''}
            placeholder="Lyric syllable"
            onCommit={(v) => apply((sc, s) => ops.setLyric(sc, c, v, s))}
          />
        </div>
      )}
    </>
  )

  if (layout === 'dock') {
    return (
      <section className={t.editDock} aria-label="Edit dock">
        <div
          ref={railRef}
          className={t.editDockBar}
          role="toolbar"
          aria-label="Edit tools"
          {...railRoving}
        >
          <div className={t.editDockTabs} role="group" aria-label="Tool categories">
            {DOCK_GROUPS.map(({ id, label, Icon }) => {
              const isSelected = activeGroup === id && !collapsed
              return (
                <button
                  key={id}
                  type="button"
                  className={`${t.dockTab} ${isSelected ? t.dockTabOn : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (activeGroup === id && !collapsed) p.onCollapsedChange?.(true)
                    else {
                      p.onGroup(id)
                      p.onCollapsedChange?.(false)
                    }
                  }}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
          <div className={t.editDockActions} role="group" aria-label="History and dock">
            <ToolbarButton
              label="Undo"
              icon={<UndoIcon size={15} />}
              disabled={!p.canUndo}
              title="Undo (Ctrl/Cmd+Z)"
              onClick={p.onUndo}
            />
            <ToolbarButton
              label="Redo"
              icon={<RedoIcon size={15} />}
              disabled={!p.canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              onClick={p.onRedo}
            />
            <ToolbarButton
              label={collapsed ? 'Expand edit dock' : 'Collapse edit dock'}
              icon={collapsed ? <I.ChevronUpIcon size={15} /> : <I.ChevronDownIcon size={15} />}
              pressed={!collapsed}
              onClick={() => p.onCollapsedChange?.(!collapsed)}
            />
          </div>
        </div>
        {!collapsed && <div className={t.editDockBody}>{bodyContent}</div>}
      </section>
    )
  }

  return (
    <aside className={`${t.toolbox} ${activeGroup ? t.toolboxOpen : ''}`} aria-label="Edit tools">
      <div
        ref={railRef}
        className={t.rail}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Edit tool groups"
        {...railRoving}
      >
        {RAIL_GROUPS.map(({ id, label, Icon }) => (
          <ToolbarButton
            key={id}
            label={label}
            title={activeGroup === id ? `${label} (click to collapse)` : label}
            icon={<Icon size={17} />}
            pressed={activeGroup === id}
            onClick={() => p.onGroup(activeGroup === id ? null : id)}
          />
        ))}
        <span className={t.railSpacer} />
        <ToolbarButton
          label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
          icon={<UndoIcon size={15} />}
          disabled={!p.canUndo}
          onClick={p.onUndo}
        />
        <ToolbarButton
          label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          icon={<RedoIcon size={15} />}
          disabled={!p.canRedo}
          onClick={p.onRedo}
        />
      </div>

      {activeGroup && <div className={t.panel}>{bodyContent}</div>}
    </aside>
  )
}
