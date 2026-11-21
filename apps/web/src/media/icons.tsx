/** Small transport/media glyphs, drawn in currentColor. */
import type { ReactNode } from 'react'

interface P {
  size?: number
}

const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
)

export const PlayGlyph = ({ size = 16 }: P) => svg(size, <path d="M7 4.5v15l13-7.5z" />)
export const PauseGlyph = ({ size = 16 }: P) =>
  svg(size, <path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z" />)
export const StopGlyph = ({ size = 16 }: P) =>
  svg(size, <rect x="5.5" y="5.5" width="13" height="13" rx="1" />)
export const BackGlyph = ({ size = 16 }: P) =>
  svg(size, <path d="M11 6.5v11L3 12zM20 6.5v11L12 12z" />)
export const ForwardGlyph = ({ size = 16 }: P) =>
  svg(size, <path d="M13 6.5v11l8-5.5zM4 6.5v11l8-5.5z" />)
export const ToStartGlyph = ({ size = 16 }: P) =>
  svg(size, <path d="M5 5h2.5v14H5zM19 5v14L8.5 12z" />)
export const LoopGlyph = ({ size = 16 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)
export const NoteGlyph = ({ size = 16 }: P) =>
  svg(size, <path d="M9 17.5a3 3 0 1 1-2-2.83V4l12-2v13.5a3 3 0 1 1-2-2.83V6.3L9 7.6z" />)
export const TabGlyph = ({ size = 16 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M3 6h18M3 10h18M3 14h18M3 18h18" opacity=".55" />
    <text x="6" y="12.2" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">
      3
    </text>
    <text x="13" y="16.2" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">
      5
    </text>
  </svg>
)
export const MediaGlyph = ({ size = 16 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M10 9v6l5-3z" fill="currentColor" />
  </svg>
)
