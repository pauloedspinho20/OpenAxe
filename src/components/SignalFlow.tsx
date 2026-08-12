import styles from './SignalFlow.module.css'

/**
 * A schematic signal-flow diagram: one input fanning out to the two
 * parallel chains below, converging back into the master bus. Purely
 * decorative/informational - the two branches sit at 25%/75% width to line
 * up with a 2-column chain grid underneath.
 */
export function SignalFlow() {
  return (
    <svg viewBox="0 0 100 32" className={styles.svg} aria-hidden="true">
      <path className={styles.line} d="M 4 16 H 20" />
      <path className={styles.line} d="M 20 16 C 30 16, 20 4, 25 4 H 46" />
      <path className={styles.line} d="M 20 16 C 30 16, 20 28, 25 28 H 46" />
      <path className={styles.line} d="M 54 4 H 75 C 80 4, 70 16, 80 16" />
      <path className={styles.line} d="M 54 28 H 75 C 80 28, 70 16, 80 16" />
      <path className={styles.line} d="M 80 16 H 96" />

      <circle className={styles.node} cx="4" cy="16" r="2.2" />
      <text className={styles.label} x="4" y="22">
        IN
      </text>

      <text className={styles.branchLabel} x="25" y="2.5">
        Chain A
      </text>
      <text className={styles.branchLabel} x="25" y="31.5">
        Chain B
      </text>

      <circle className={styles.node} cx="80" cy="16" r="2.2" />
      <text className={styles.label} x="80" y="22">
        MASTER
      </text>

      <circle className={styles.nodeAccent} cx="96" cy="16" r="2.2" />
      <text className={styles.label} x="96" y="9">
        OUT
      </text>
    </svg>
  )
}
