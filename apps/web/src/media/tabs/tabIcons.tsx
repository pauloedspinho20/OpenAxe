/**
 * Icons for the tab editor, on the design system's Icon primitive (24-unit
 * grid, 1.5 stroke, currentColor) so they sit with the rest of the app.
 */
import { Dot, Icon, type IconProps } from '@openaxe/ui'
import { model } from '@coderline/alphatab'
import type { ComponentType } from 'react'

type I = IconProps
const mk = (paths: React.ReactNode) =>
  function TabIcon(p: I) {
    return <Icon {...p}>{paths}</Icon>
  }

// ── Note values ──────────────────────────────────────────────────────────
const head = (filled: boolean) => (
  <ellipse
    cx="9"
    cy="17.5"
    rx="3.6"
    ry="2.6"
    transform="rotate(-20 9 17.5)"
    fill={filled ? 'currentColor' : 'none'}
  />
)
const stem = <path d="M12.3 16.6V3.5" />
export const WholeNoteIcon = mk(
  <ellipse cx="12" cy="14" rx="5" ry="3.4" transform="rotate(-20 12 14)" />,
)
export const HalfNoteIcon = mk(
  <>
    {head(false)}
    {stem}
  </>,
)
export const QuarterNoteIcon = mk(
  <>
    {head(true)}
    {stem}
  </>,
)
const flags = (n: number) =>
  Array.from({ length: n }, (_, i) => <path key={i} d={`M12.3 ${3.5 + i * 3.6}c0 3 5 3.4 4.2 7`} />)
export const EighthNoteIcon = mk(
  <>
    {head(true)}
    {stem}
    {flags(1)}
  </>,
)
export const SixteenthNoteIcon = mk(
  <>
    {head(true)}
    {stem}
    {flags(2)}
  </>,
)
export const ThirtySecondNoteIcon = mk(
  <>
    {head(true)}
    {stem}
    {flags(3)}
  </>,
)
export const SixtyFourthNoteIcon = mk(
  <>
    {head(true)}
    <path d="M12.3 16.6V2" />
    {Array.from({ length: 4 }, (_, i) => (
      <path key={i} d={`M12.3 ${2 + i * 2.9}c0 2.4 4.6 2.8 3.9 5.6`} />
    ))}
  </>,
)

export const NOTE_ICON: Record<number, ComponentType<I>> = {
  [model.Duration.Whole]: WholeNoteIcon,
  [model.Duration.Half]: HalfNoteIcon,
  [model.Duration.Quarter]: QuarterNoteIcon,
  [model.Duration.Eighth]: EighthNoteIcon,
  [model.Duration.Sixteenth]: SixteenthNoteIcon,
  [model.Duration.ThirtySecond]: ThirtySecondNoteIcon,
  [model.Duration.SixtyFourth]: SixtyFourthNoteIcon,
}

export const DotIcon = mk(
  <>
    {head(true)}
    {stem}
    <Dot cx={18} cy={17} r={1.6} />
  </>,
)
export const TripletIcon = mk(
  <>
    <path d="M4 7V5h16v2" />
    <text
      x="12"
      y="20"
      textAnchor="middle"
      fontSize="11"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      3
    </text>
  </>,
)
export const RestIcon = mk(
  <path d="M10 3.5l4 4.2-3 3.6 4 4.5c-2.6-.9-4.4 0-3.6 3.6-2.6-2.4-2.3-5.2.7-5.3L8.6 9.7 11 6.9z" />,
)
export const TieIcon = mk(
  <>
    <path d="M4 12c3 5 13 5 16 0" />
    <Dot cx={4} cy={9.5} r={1.4} />
    <Dot cx={20} cy={9.5} r={1.4} />
  </>,
)

// ── Effects ──────────────────────────────────────────────────────────────
const label = (t: string, size = 8.5) => (
  <text
    x="12"
    y="15.2"
    textAnchor="middle"
    fontSize={size}
    fontWeight="700"
    fill="currentColor"
    stroke="none"
    fontFamily="sans-serif"
  >
    {t}
  </text>
)
export const PalmMuteIcon = mk(
  <>
    {label('P.M.', 7.5)}
    <path d="M3 19h18" strokeDasharray="2 2" />
  </>,
)
export const LetRingIcon = mk(
  <>
    {label('L.R.', 7.5)}
    <path d="M3 19h18" strokeDasharray="2 2" />
  </>,
)
export const HammerIcon = mk(
  <>
    <path d="M4 15c3-6 13-6 16 0" />
    {label('H', 7)}
  </>,
)
export const SlideIcon = mk(
  <>
    <path d="M4 18L20 6" />
    <Dot cx={4} cy={18} r={1.6} />
    <Dot cx={20} cy={6} r={1.6} />
  </>,
)
export const BendIcon = mk(
  <>
    <path d="M4 19h5c4 0 7-4 7-12" />
    <path d="M13 9.5l3-3.5 3 3.5" />
  </>,
)
export const VibratoIcon = mk(<path d="M3 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0" />)
export const DeadNoteIcon = mk(<path d="M7 7l10 10M17 7L7 17" />)
export const GhostNoteIcon = mk(
  <>
    <path d="M7 5c-3 4-3 10 0 14M17 5c3 4 3 10 0 14" />
    <ellipse cx="12" cy="12" rx="2.8" ry="2.1" fill="currentColor" />
  </>,
)
export const HarmonicIcon = mk(<path d="M12 4l7 8-7 8-7-8z" />)
export const StaccatoIcon = mk(
  <>
    {head(true)}
    {stem}
    <Dot cx={9} cy={8} r={1.6} />
  </>,
)
export const AccentIcon = mk(<path d="M5 7l14 5-14 5" />)
export const TapIcon = mk(
  <>
    <circle cx="12" cy="12" r="7" />
    {label('T', 8)}
  </>,
)
export const PickDownIcon = mk(<path d="M6 18V7h12v11" />)
export const PickUpIcon = mk(<path d="M6 6l6 13 6-13" />)
export const TremoloIcon = mk(
  <>
    {stem}
    {head(true)}
    <path d="M9 7l7-2M9 10l7-2M9 13l7-2" />
  </>,
)
export const TrillIcon = mk(
  <>
    <text
      x="7"
      y="14"
      textAnchor="middle"
      fontSize="8"
      fontWeight="700"
      fontStyle="italic"
      fill="currentColor"
      stroke="none"
    >
      tr
    </text>
    <path d="M12 11c1-2 2-2 3 0s2 2 3 0 2-2 3 0" />
  </>,
)
export const GraceIcon = mk(
  <>
    <ellipse cx="7" cy="17" rx="2.4" ry="1.7" fill="currentColor" />
    <path d="M9.2 16.5V6" />
    <path d="M6.5 13l5-5" />
    {head(true)}
    <path d="M12.3 16.6V6" transform="translate(4 0)" />
  </>,
)
export const ChordIcon = mk(
  <>
    <rect x="5" y="4" width="14" height="16" rx="1" />
    <path d="M9.7 4v16M14.3 4v16M5 9h14M5 14h14" />
    <Dot cx={9.7} cy={11.5} r={1.6} />
    <Dot cx={14.3} cy={16.5} r={1.6} />
  </>,
)
export const SectionIcon = mk(
  <>
    <rect x="4" y="5" width="16" height="11" rx="2" />
    <path d="M8 20l4-4 4 4" />
    {label('A', 7)}
  </>,
)
export const TextIcon = mk(<path d="M5 6h14M12 6v13M9 19h6" />)
export const LyricIcon = mk(
  <>
    <path d="M4 8h16M4 12h10M4 16h12" />
    <path d="M18 13v6" />
    <ellipse cx="16.6" cy="19" rx="1.6" ry="1.2" fill="currentColor" />
  </>,
)
export const DynamicsIcon = mk(
  <text
    x="12"
    y="16"
    textAnchor="middle"
    fontSize="12"
    fontWeight="700"
    fontStyle="italic"
    fontFamily="serif"
    fill="currentColor"
    stroke="none"
  >
    mf
  </text>,
)
export const VoiceIcon = mk(
  <>
    <path d="M8 15V4M16 13V3" />
    <ellipse cx="6" cy="16" rx="2.6" ry="1.9" fill="currentColor" />
    <ellipse cx="14" cy="14" rx="2.6" ry="1.9" />
  </>,
)

// ── Bars ─────────────────────────────────────────────────────────────────
export const BarInsertIcon = mk(
  <>
    <path d="M4 5v14M20 5v14" />
    <path d="M12 8v8M8 12h8" />
  </>,
)
export const BarDuplicateIcon = mk(
  <>
    <rect x="3" y="6" width="12" height="12" rx="1" />
    <path d="M9 3h12v12" />
  </>,
)
export const BarDeleteIcon = mk(
  <>
    <path d="M4 5v14M20 5v14" />
    <path d="M8 12h8" />
  </>,
)
export const RepeatStartIcon = mk(
  <>
    <path d="M5 4v16" strokeWidth={3} />
    <path d="M9 4v16" />
    <Dot cx={13} cy={9.5} r={1.5} />
    <Dot cx={13} cy={14.5} r={1.5} />
  </>,
)
export const RepeatEndIcon = mk(
  <>
    <path d="M19 4v16" strokeWidth={3} />
    <path d="M15 4v16" />
    <Dot cx={11} cy={9.5} r={1.5} />
    <Dot cx={11} cy={14.5} r={1.5} />
  </>,
)
export const FlatIcon = mk(<path d="M8 3v17c4-1 9-4 9-7.5S12 9 8 12" />)
export const SharpIcon = mk(<path d="M10 4v17M15 3v17M6 10l12-3M6 16l12-3" />)
export const TempoIcon = mk(
  <>
    <path d="M8 21l2.5-17h3L16 21z" />
    <path d="M12 15l5-8" />
  </>,
)
export const TimeSigIcon = mk(
  <>
    <text
      x="12"
      y="11"
      textAnchor="middle"
      fontSize="9"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      4
    </text>
    <text
      x="12"
      y="21"
      textAnchor="middle"
      fontSize="9"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      4
    </text>
  </>,
)

// ── Editing / selection ──────────────────────────────────────────────────
export const UndoIcon = mk(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </>,
)
export const RedoIcon = mk(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </>,
)
export const CopyIcon = mk(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </>,
)
export const CutIcon = mk(
  <>
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M8.1 15.9L20 4M15.9 15.9L4 4" />
  </>,
)
export const PasteIcon = mk(
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 10h6M9 14h6" />
  </>,
)
export const LoopIcon = mk(
  <>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </>,
)
export const StringUpIcon = mk(
  <>
    <path d="M3 8h18M3 16h18" opacity={0.5} />
    <path d="M12 19V5M8 9l4-4 4 4" />
  </>,
)
export const StringDownIcon = mk(
  <>
    <path d="M3 8h18M3 16h18" opacity={0.5} />
    <path d="M12 5v14M8 15l4 4 4-4" />
  </>,
)
export const TrashIcon = mk(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />)

// ── View / workspace ─────────────────────────────────────────────────────
export const EditIcon = mk(<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />)
export const ZoomInIcon = mk(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M21 21l-5.6-5.6M10.5 7.5v6M7.5 10.5h6" />
  </>,
)
export const ZoomOutIcon = mk(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M21 21l-5.6-5.6M7.5 10.5h6" />
  </>,
)
export const PageLayoutIcon = mk(
  <>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>,
)
export const HorizontalLayoutIcon = mk(
  <>
    <rect x="2" y="7" width="20" height="10" rx="1.5" />
    <path d="M5 11h14M5 14h9" />
  </>,
)
export const MetronomeIcon = mk(
  <>
    <path d="M7 21l3-17h4l3 17z" />
    <path d="M5 18h14M12 15l6-9" />
  </>,
)
export const TracksIcon = mk(
  <>
    <path d="M4 6h10M4 12h10M4 18h10" />
    <path d="M18 4v4M18 10v4M18 16v4" />
  </>,
)
export const DownloadIcon = mk(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />)
export const KeyboardIcon = mk(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </>,
)
export const SidebarIcon = mk(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
)
export const CodeIcon = mk(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />)
export const NotationIcon = mk(
  <>
    <path d="M3 7h18M3 10h18M3 13h18" opacity={0.6} />
    <ellipse cx="8" cy="16" rx="2.4" ry="1.8" fill="currentColor" />
    <path d="M10.3 15.5V6" />
    <path d="M3 18h18M3 21h18" opacity={0.6} />
  </>,
)
export const MuteIcon = mk(
  <>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M17 9l4 6M21 9l-4 6" />
  </>,
)
export const SoloIcon = mk(
  <>
    <circle cx="12" cy="9" r="4" />
    <path d="M5 21c1-4 4-6 7-6s6 2 7 6" />
  </>,
)
export const PlusIcon = mk(<path d="M12 5v14M5 12h14" />)
export const MinusIcon = mk(<path d="M5 12h14" />)
export const TabIcon = mk(
  <>
    <path d="M3 6h18M3 10h18M3 14h18M3 18h18" opacity={0.5} />
    <text
      x="8"
      y="12.6"
      textAnchor="middle"
      fontSize="7"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      3
    </text>
    <text
      x="16"
      y="16.6"
      textAnchor="middle"
      fontSize="7"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      5
    </text>
  </>,
)
export const DrumIcon = mk(
  <>
    <ellipse cx="12" cy="9" rx="8" ry="3" />
    <path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9" />
    <path d="M7 3l4 5M17 3l-4 5" />
  </>,
)
export const NoteGlyphIcon = mk(
  <>
    <path d="M9 18V5l11-2v13" />
    <ellipse cx="6.5" cy="18" rx="2.5" ry="2" fill="currentColor" />
    <ellipse cx="17.5" cy="16" rx="2.5" ry="2" fill="currentColor" />
  </>,
)
export const TuningIcon = mk(
  <>
    <path d="M6 21V9a6 6 0 0 1 12 0v12" />
    <path d="M9 21v-9M12 21v-9M15 21v-9" />
    <circle cx="12" cy="6" r="1.5" />
  </>,
)
export const CapoIcon = mk(
  <>
    <path d="M3 10h18v4H3z" />
    <path d="M6 14v6M12 14v6M18 14v6M7 10V5h10v5" />
  </>,
)
export const CountInIcon = mk(
  <>
    <Dot cx={5} cy={16} r={1.8} />
    <Dot cx={10} cy={13} r={1.8} />
    <Dot cx={15} cy={10} r={1.8} />
    <Dot cx={20} cy={7} r={2.4} />
    <path d="M3 20h18" opacity={0.5} />
  </>,
)
export const WaitIcon = mk(
  <>
    <path d="M6 3h12M6 21h12" />
    <path d="M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
  </>,
)
