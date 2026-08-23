import styles from './Wordmark.module.css'

// Inline copy of packages/ui/assets/brand/openaxe-mark.svg's axe group so the
// Wordmark needs no runtime asset fetch (works in Storybook, the web app and
// the desktop bundle alike). Regenerate from the source SVG if it changes.
function AxeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect x="16" y="16" width="480" height="480" rx="116" fill="#161616" />
      <g transform="rotate(-12 256 256)">
        <rect x="300" y="68" width="42" height="400" rx="21" fill="#eeece6" />
        <path
          d="M 292 96 C 244 92 196 96 150 108 C 134 130 124 154 124 180 C 126 212 142 244 176 268 C 214 278 254 274 292 256 L 292 96 Z"
          fill="#ff5a1f"
        />
        <path
          d="M 150 108 C 134 130 124 154 124 180 C 126 212 142 244 176 268 C 156 236 149 208 149 180 C 149 150 148 128 150 108 Z"
          fill="#ffe9dd"
        />
        <rect x="348" y="108" width="34" height="136" rx="15" fill="#c23503" />
        <rect x="292" y="84" width="56" height="184" rx="14" fill="#9c2b04" />
      </g>
    </svg>
  )
}

export interface WordmarkProps {
  variant?: 'inline' | 'hero'
}

export function Wordmark({ variant = 'inline' }: WordmarkProps) {
  if (variant === 'hero') {
    return (
      <span className={styles.hero}>
        <AxeMark size={200} />
        OPENAXE
      </span>
    )
  }

  return (
    <span className={styles.inline}>
      <AxeMark size={16} />
      OPENAXE
    </span>
  )
}
