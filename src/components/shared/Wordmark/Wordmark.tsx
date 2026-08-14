import styles from './Wordmark.module.css'

export interface WordmarkProps {
  variant?: 'inline' | 'hero'
}

export function Wordmark({ variant = 'inline' }: WordmarkProps) {
  if (variant === 'hero') {
    return (
      <span className={styles.hero}>
        <img src="./logo.png" className={styles.logo} alt="" />
        NAM WEB STUDIO
      </span>
    )
  }

  return (
    <span className={styles.inline}>
      <span className={styles.inlineDot} />
      NAM WEB STUDIO
    </span>
  )
}
