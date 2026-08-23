import styles from './Wordmark.module.css'

// Inline copy of packages/ui/assets/brand/openaxe-mark.svg's axe group so the
// Wordmark needs no runtime asset fetch (works in Storybook, the web app and
// the desktop bundle alike). Regenerate from the source SVG if it changes.
function AxeMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect width="1024" height="1024" fill="#000000" />
      <path
        d="M0 345 L520 345 L840 95 L860 45 L980 95 L1024 160 L1024 240 L980 290 L850 330 L825 310 L540 430 L280 545 L145 1024 Z"
        fill="#ff2b2b"
      />
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
