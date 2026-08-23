import styles from './Wordmark.module.css'
import markUrl from './assets/openaxe-256.png'

// PNG mark so the Wordmark needs no runtime SVG fetch (works in Storybook,
// the web app and the desktop bundle alike). Uses the final 256 png.
function AxeMark({ size = 24 }: { size?: number }) {
  return (
    <img
      src={markUrl}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', objectFit: 'contain' }}
    />
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
