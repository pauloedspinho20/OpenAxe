import type { ReactNode } from 'react'
import type { BlockKind } from '../../engine/blocks/Block'

export interface IconProps {
  size?: number | undefined
  className?: string | undefined
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function Icon({ size, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 14}
      height={size ?? 14}
      className={className}
      aria-hidden="true"
      {...STROKE}
    >
      {children}
    </svg>
  )
}

/** A dot needed inside stroke-only icons - solid fill reads better at 24px. */
function Dot({
  cx,
  cy,
  r = 1.1,
}: {
  cx: number | string
  cy: number | string
  r?: number | string
}) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
}

const GLYPHS: Record<BlockKind, ReactNode> = {
  amp: (
    <>
      <rect x="3" y="4" width="18" height="9" rx="1" />
      <Dot cx="6.5" cy="8.5" />
      <Dot cx="10" cy="8.5" />
      <Dot cx="13.5" cy="8.5" />
      <path d="M17.5 7.5h3M17.5 9.5h3" />
      <path d="M6 16h12" />
      <path d="M6 16v4" />
    </>
  ),
  'amp-cab': (
    <>
      <rect x="3" y="3" width="18" height="7" rx="1" />
      <Dot cx="6.5" cy="6.5" />
      <Dot cx="9.5" cy="6.5" />
      <path d="M17 5.5h4M17 7.5h4" />
      <rect x="3" y="13" width="18" height="8" rx="1" />
      <path d="M10 16l2 3 2-3-2-3z" />
    </>
  ),
  cab: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <Dot cx="6" cy="9" r={0.8} />
      <Dot cx="18" cy="9" r={0.8} />
      <path d="M9 10l3 6 3-6" />
    </>
  ),
  pedal: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <Dot cx="12" cy="12" r={1.4} />
      <circle cx="6" cy="17" r="0.7" />
      <circle cx="18" cy="17" r="0.7" />
      <path d="M8 4.5h8M8 4.5l2 2M16 4.5l-2 2" />
    </>
  ),
  outboard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="1" />
      <Dot cx="7" cy="11" r={1.8} />
      <Dot cx="13" cy="11" r={1.8} />
      <Dot cx="19" cy="11" r={1.1} />
      <path d="M4 17h16" />
    </>
  ),
  space: (
    <>
      <path d="M3 18c2.5-8 6-11 9-11s6.5 3 9 11" />
      <path d="M2 19.5c3-11 7-15 10-15s7 4 10 15" />
      <Dot cx="12" cy="5.5" />
    </>
  ),
  mixer: (
    <>
      <path d="M4 5.5v13.5M9.3 5.5v13.5M14.7 5.5v13.5M20 5.5v13.5" />
      <Dot cx="4" cy="9.5" />
      <Dot cx="9.3" cy="12" />
      <Dot cx="14.7" cy="15" />
      <Dot cx="20" cy="10.5" />
    </>
  ),
  splitter: (
    <>
      <path d="M3 12h4" />
      <Dot cx="3" cy="12" />
      <path d="M7 12l6-6M7 12l6-2M7 12l6 2M7 12l6 6" />
      <Dot cx="20" cy="6" r={0.9} />
      <Dot cx="20" cy="10" r={0.9} />
      <Dot cx="20" cy="14" r={0.9} />
      <Dot cx="20" cy="18" r={0.9} />
    </>
  ),
  'noise-gate': (
    <>
      <path d="M3 14v-4l3-2M3 10h3M6 8h0" />
      <path d="M6 8h15" />
      <path d="M12 8v10" />
      <path d="M18 8l3 2v4" />
    </>
  ),
  compressor: (
    <>
      <path d="M12 3v18" />
      <path d="M4.5 7.5v9l7.5-4.5z" />
      <path d="M19.5 7.5l-7.5 4.5 7.5 4.5z" />
    </>
  ),
  eq: (
    <>
      <rect x="3.5" y="6" width="4" height="12" rx="0.5" />
      <rect x="10" y="3" width="4" height="18" rx="0.5" />
      <rect x="16.5" y="9" width="4" height="6" rx="0.5" />
    </>
  ),
  chorus: (
    <>
      <path d="M3 14c2.5-5 4.5-2 6 0s3.5 5 6 0 2.5-6 6 0" />
      <path d="M5 17.5c2-3.5 3.5-1.5 5 0s3 3.5 5 0 2-4.5 4.5 0" />
    </>
  ),
  flanger: (
    <>
      <path d="M3 8h18M3 16h18" />
      <path d="M6 8v5h5v3M18 16v-5h-5V8" />
    </>
  ),
  phaser: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5c4 4.5-4 12.5 0 17" />
      <Dot cx="12" cy="12" r={0.8} />
    </>
  ),
  tremolo: (
    <>
      <path d="M3 12h3l2.2-6 3 12 3-12 2.2 6H21" />
    </>
  ),
  delay: (
    <>
      <rect x="3" y="8" width="6" height="8" rx="0.5" />
      <Dot cx="6" cy="12" r={0.8} />
      <rect x="10.5" y="10" width="6" height="4" rx="0.5" />
      <Dot cx="13.5" cy="12" r={0.7} />
      <rect x="18" y="11" width="4" height="2" rx="0.5" />
    </>
  ),
  'ping-pong-delay': (
    <>
      <path d="M4 4v16M20 4v16" />
      <path d="M7 12h3M14 12h3" />
      <path d="M10 9.5l4 2.5-4 2.5z" />
    </>
  ),
  reverb: (
    <>
      <path d="M4 17c1.5-7 14.5-7 16 0" />
      <path d="M7 18.5c1.2-4.5 8.8-4.5 10 0" />
      <path d="M10 20c.8-2.7 3.2-2.7 4 0" />
    </>
  ),
  'ring-mod': (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M3 12h18M12 5v14" />
      <Dot cx="12" cy="12" />
    </>
  ),
  filter: (
    <>
      <path d="M3 6h18l-6 8v4l-6-4v-8z" />
      <path d="M9 11h6" />
    </>
  ),
  'pitch-shifter': (
    <>
      <path d="M4 16l4-8 4 8M6 14h4" />
      <path d="M13 8l5 4-5 4" />
    </>
  ),
  'granular-delay': (
    <>
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path d="M6 12h3M10.5 12h3M15 12h3" />
      <Dot cx="7.5" cy="12" r={0.6} />
      <Dot cx="12" cy="12" r={0.6} />
      <Dot cx="16.5" cy="12" r={0.6} />
    </>
  ),
  rotary: (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="M12 15v5M8 18h8" />
      <path d="M9 8c1.5 2 4.5 2 6 0" />
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
      <path d="M7.5 22v-6a4.5 4.5 0 0 1 9 0v6M7.5 22h9M7.5 18H5M16.5 18H19" />
    </Icon>
  )
}
