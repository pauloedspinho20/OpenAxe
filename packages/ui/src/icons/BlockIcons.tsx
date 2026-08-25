import type { ReactNode } from 'react'
import { Dot, Icon, type IconProps } from './Icon'

// ---------------------------------------------------------------------------
// Slightly simplified vs the former apps/web/src/components/grid/blockIcons.tsx:
// - fewer decorative strokes, larger clear-silhouette shapes
// - max 3-4 paths per glyph so 12px ghost stays legible
// - shared 24x24 viewBox, currentColor stroke 1.5
// ---------------------------------------------------------------------------

export type BlockKind =
  | 'amp'
  | 'amp-cab'
  | 'cab'
  | 'pedal'
  | 'outboard'
  | 'space'
  | 'mixer'
  | 'splitter'
  | 'send-1'
  | 'return-1'
  | 'send-2'
  | 'return-2'
  | 'noise-gate'
  | 'compressor'
  | 'eq'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'delay'
  | 'ping-pong-delay'
  | 'reverb'
  | 'ring-mod'
  | 'filter'
  | 'pitch-shifter'
  | 'granular-delay'
  | 'rotary'

const GLYPHS: Record<BlockKind, ReactNode> = {
  amp: (
    <>
      <rect x="3" y="5" width="18" height="9" rx="1.2" />
      <Dot cx="7" cy="9.5" />
      <Dot cx="11" cy="9.5" />
      <Dot cx="15" cy="9.5" />
      <path d="M18 7.5h3M18 11.5h3" />
      <path d="M7 15.5h10" />
    </>
  ),
  'amp-cab': (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1" />
      <Dot cx="7" cy="7.5" />
      <Dot cx="11" cy="7.5" />
      <rect x="3" y="13.5" width="18" height="7" rx="1" />
      <path d="M12 15.5l2.5 2-2.5 2-2.5-2z" />
    </>
  ),
  cab: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <circle cx="12" cy="12" r="4.5" />
      <Dot cx="12" cy="12" r={1} />
    </>
  ),
  pedal: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="1.5" />
      <Dot cx="12" cy="12" r={1.6} />
      <path d="M9 5h6" />
    </>
  ),
  outboard: (
    <>
      <rect x="3" y="5" width="18" height="13" rx="1" />
      <Dot cx="8" cy="11.5" r={1.6} />
      <Dot cx="14" cy="11.5" r={1.6} />
      <path d="M5 16h14" />
    </>
  ),
  space: (
    <>
      <path d="M3 18c2.6-8 6-11 9-11s6.4 3 9 11" />
      <Dot cx="12" cy="6" />
    </>
  ),
  mixer: (
    <>
      <path d="M5 6v12M12 6v12M19 6v12" />
      <Dot cx="5" cy="10" />
      <Dot cx="12" cy="12" />
      <Dot cx="19" cy="14" />
    </>
  ),
  splitter: (
    <>
      <path d="M4 12h5" />
      <Dot cx="4" cy="12" />
      <path d="M9 12l5-5M9 12l5 5" />
      <Dot cx="16" cy="7" r={0.9} />
      <Dot cx="16" cy="17" r={0.9} />
    </>
  ),
  'send-1': (
    <>
      <path d="M3 12h13" />
      <path d="M16 7l5 5-5 5" />
      <Dot cx="8" cy="17" />
    </>
  ),
  'send-2': (
    <>
      <path d="M3 12h13" />
      <path d="M16 7l5 5-5 5" />
      <Dot cx="6.5" cy="17" />
      <Dot cx="10.5" cy="17" />
    </>
  ),
  'return-1': (
    <>
      <path d="M8 7l-5 5 5 5" />
      <path d="M3 12h18" />
      <Dot cx="8" cy="17" />
    </>
  ),
  'return-2': (
    <>
      <path d="M8 7l-5 5 5 5" />
      <path d="M3 12h18" />
      <Dot cx="6.5" cy="17" />
      <Dot cx="10.5" cy="17" />
    </>
  ),
  'noise-gate': (
    <>
      <path d="M3 12h6M9 7v10" />
      <path d="M9 12h9" />
      <path d="M18 8l3 2v4l-3 2" />
    </>
  ),
  compressor: (
    <>
      <path d="M12 4v16" />
      <path d="M5 8v8l7-4z" />
      <path d="M19 8v8l-7-4z" />
    </>
  ),
  eq: (
    <>
      <rect x="4" y="7" width="3.5" height="10" rx="0.7" />
      <rect x="10.2" y="4" width="3.5" height="16" rx="0.7" />
      <rect x="16.5" y="9" width="3.5" height="6" rx="0.7" />
    </>
  ),
  chorus: (
    <>
      <path d="M3 12c3-6 5-1 6 0s4 6 6 0 4-6 6 0" />
    </>
  ),
  flanger: (
    <>
      <path d="M3 9h18M3 15h18" />
      <path d="M7 9v4h4M17 15v-4h-4" />
    </>
  ),
  phaser: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5c3.5 4-3.5 11 0 15" />
    </>
  ),
  tremolo: (
    <>
      <path d="M3 12h3l2-5 3 10 3-10 2 5H21" />
    </>
  ),
  delay: (
    <>
      <rect x="4" y="8.5" width="7" height="7" rx="0.8" />
      <Dot cx="7.5" cy="12" r={0.9} />
      <rect x="13" y="10" width="7" height="4" rx="0.8" />
      <Dot cx="16.5" cy="12" r={0.7} />
    </>
  ),
  'ping-pong-delay': (
    <>
      <path d="M4 5v14M20 5v14" />
      <path d="M8 12h4M12 12h4" />
      <path d="M11 9l3 3-3 3" />
    </>
  ),
  reverb: (
    <>
      <path d="M4 17c1.8-6.5 14.2-6.5 16 0" />
      <path d="M8 18c1-3.5 6-3.5 8 0" />
    </>
  ),
  'ring-mod': (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M4 12h16M12 5.5v13" />
      <Dot cx="12" cy="12" />
    </>
  ),
  filter: (
    <>
      <path d="M4 7h16l-5 7v4l-6-4v-4z" />
    </>
  ),
  'pitch-shifter': (
    <>
      <path d="M5 16l4-8 4 8M6.5 14h5" />
      <path d="M14 9l4 3-4 3" />
    </>
  ),
  'granular-delay': (
    <>
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <Dot cx="7" cy="12" r={0.7} />
      <Dot cx="12" cy="12" r={0.7} />
      <Dot cx="17" cy="12" r={0.7} />
    </>
  ),
  rotary: (
    <>
      <circle cx="12" cy="10" r="4.5" />
      <path d="M12 14.5v4M8 18.5h8" />
    </>
  ),
}

export function BlockIcon({ kind, ...rest }: { kind: BlockKind } & IconProps) {
  return <Icon {...rest}>{GLYPHS[kind]}</Icon>
}

/** Tuning-fork glyph used by the tuner block section. */
export function TunerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3v7a3 3 0 0 0 6 0V3M9 18h6M12 10v8" />
    </Icon>
  )
}

/** Curved undo arrow — 24x24 stroke 1.5, matches blockIcons tone. */
export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 8H5V4" />
      <path d="M5 8A7 7 0 0 0 14.5 17.5" />
      <path d="M12 14l-2.5 2.5L12 19" />
    </Icon>
  )
}

/** Curved redo arrow — mirrored undo. */
export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 8h4V4" />
      <path d="M19 8A7 7 0 0 1 9.5 17.5" />
      <path d="M12 14l2.5 2.5L12 19" />
    </Icon>
  )
}
