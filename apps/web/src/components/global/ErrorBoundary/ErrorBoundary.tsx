import { Component, type ErrorInfo, type ReactNode } from 'react'
import { HardwareButton } from '@nam/ui'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level recoverable fallback (issue #50). React has no hook equivalent
 * for componentDidCatch/getDerivedStateFromError - a class component is the
 * only way to catch a render error. This can't fix whatever crashed, but it
 * stops one bad component from taking the whole app to a blank white page:
 * a reload re-mounts fresh, which recovers the common case (stale/corrupt
 * in-memory state triggering a render bug that fresh state wouldn't).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught a render error:', error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.panel}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>{error.message}</p>
          <HardwareButton label="RELOAD" onClick={() => window.location.reload()} />
        </div>
      </div>
    )
  }
}
