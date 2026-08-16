import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { dismiss, getToasts, subscribeToasts, type ToastType } from './toast'
import styles from './Toaster.module.css'

const ROLE_BY_TYPE: Record<ToastType, 'alert' | 'status'> = {
  success: 'status',
  error: 'alert',
  warning: 'alert',
  info: 'status',
}

/**
 * Renders the app-wide toast stack (bottom-right, sonner-style). Mount once,
 * near the app root; any code can then fire a toast via the imperative
 * `toast()` API. Backed by a tiny module store so calls from outside React
 * (engine code, event handlers, async flows) just work.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (toasts.length === 0) return null
  return createPortal(
    <ol className={styles.viewport} aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <li key={t.id} className={`${styles.toast} ${styles[t.type]}`} role={ROLE_BY_TYPE[t.type]}>
          <div className={styles.content}>
            <span className={styles.title}>{t.title}</span>
            {t.description && <span className={styles.description}>{t.description}</span>}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ol>,
    document.body,
  )
}
