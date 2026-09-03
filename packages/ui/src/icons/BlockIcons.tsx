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
      <circle cx="5" cy="8" r={1.6} fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r={1.6} fill="currentColor" stroke="none" />
      <circle cx="19" cy="16" r={1.6} fill="currentColor" stroke="none" />
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
  const { size = 12 } = rest
  if (kind === 'mixer') {
    return (
      <svg
        viewBox="3.4 6 17.2 12"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        <path d="M5 5v14m7-14v14m7-14v14" />
        <circle cx="5" cy="8" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="16" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (kind === 'reverb') {
    return (
      <svg
        fill="currentColor"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        {...rest}
      >
        <g>
          <g>
            <path
              d="M12,24L1,18.6V5.4L12,0l11,5.4v13.2L12,24z M13,11.6v9.7l8-3.9V7.6L13,11.6z M3,17.4l8,3.9v-9.7l-8-4V17.4z M4.2,6L12,9.9
			L19.8,6L12,2L4.2,6z"
            />
          </g>
        </g>
      </svg>
    )
  }

  if (kind === 'delay') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <circle cx="4" cy="12" r="4" fill="currentColor" stroke="none" />
        <circle cx="13.5" cy="12" r="3" fill="currentColor" stroke="none" />
        <circle cx="21.5" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (kind === 'pedal') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="3" y="1" width="18" height="22" rx="1.5" />
        <circle cx="7" cy="5" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="17" cy="5" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="12" cy="18" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (kind === 'amp') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="1" y="4" width="22" height="16" rx="1.2" />
        <circle cx="6" cy="9" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="10" cy="9" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="14" cy="9" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="18" cy="9" r="1.2" fill="currentColor" stroke="none" />
        <path d="M1 14.1h22" />
      </svg>
    )
  }

  if (kind === 'amp-cab') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="1" y="1" width="22" height="22" rx="1.2" />
        <circle cx="6" cy="5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="10" cy="5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="14" cy="5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="18" cy="5" r="1.2" fill="currentColor" stroke="none" />
        <path d="M1 9.1h22" />
        <circle cx="7" cy="16" r="4" fill="currentColor" stroke="none" />
        <circle cx="17" cy="16" r="4" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (kind === 'cab') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="1" y="1" width="22" height="22" rx="2" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (kind === 'compressor') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        <path d="M12 1v22"></path>
        <path d="M1 4v16l10-8z"></path>
        <path d="M23 4v16l-10-8z"></path>
      </svg>
    )
  }

  if (['send-1', 'send-2'].includes(kind)) {
    return (
      <svg
        stroke="currentColor"
        fill="none"
        strokeWidth="2.1"
        viewBox="0 0 24 24"
        strokeLinecap="round"
        strokeLinejoin="round"
        height={size}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        <path d="M7 7h10v10M7 17 17 7" />
      </svg>
    )
  }

  if (['return-1', 'return-2'].includes(kind)) {
    return (
      <svg
        stroke="currentColor"
        fill="none"
        strokeWidth="2.1"
        viewBox="0 0 24 24"
        strokeLinecap="round"
        strokeLinejoin="round"
        height={size}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        transform="matrix(-1,1.2246467991473532e-16,-1.2246467991473532e-16,-1,0,0)"
        {...rest}
      >
        <path d="M7 7h10v10M7 17 17 7" />
      </svg>
    )
  }

  if (kind === 'eq') {
    return (
      <svg
        viewBox="0 0 24 24"
        height={size}
        width={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="1" y="13" width="5.4" height="10" rx="0.1" />
        <rect x="6.5" y="1" width="5.4" height="22" rx="0.1" />
        <rect x="11.9" y="4" width="5.4" height="19" rx="0.1" />
        <rect x="17.3" y="9" width="5.4" height="14" rx="0.1" />
      </svg>
    )
  }

  if (kind === 'noise-gate') {
    return (
      <svg
        viewBox="0 0 24 24"
        height={size}
        width={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        transform="rotate(-90)"
        {...rest}
      >
        <path d="M19 2v20L5 12z" />
      </svg>
    )
  }

  if (kind === 'chorus') {
    return (
      <svg
        viewBox="0 0 24 24"
        height={size}
        width={size}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <path d="M1 13c2-6 4-2 5 0s3 13 7 0 8-16 10 10" />
      </svg>
    )
  }

  return <Icon {...rest}>{GLYPHS[kind]}</Icon>
}

/** Curved undo arrow — 24x24 stroke 1.5, matches blockIcons tone. */
export function UndoIcon(props: IconProps) {
  const { size = 12 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 512 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z"></path>
    </svg>
  )
}

/** Curved redo arrow — mirrored undo. */
export function RedoIcon(props: IconProps) {
  const { size = 12 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 512 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M500.33 0h-47.41a12 12 0 0 0-12 12.57l4 82.76A247.42 247.42 0 0 0 256 8C119.34 8 7.9 119.53 8 256.19 8.1 393.07 119.1 504 256 504a247.1 247.1 0 0 0 166.18-63.91 12 12 0 0 0 .48-17.43l-34-34a12 12 0 0 0-16.38-.55A176 176 0 1 1 402.1 157.8l-101.53-4.87a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12h200.33a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12z"></path>
    </svg>
  )
}
