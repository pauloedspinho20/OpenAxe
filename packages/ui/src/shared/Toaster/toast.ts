export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  /** Secondary line shown under the title. */
  description?: string
  /** Auto-dismiss after this many ms. Pass 0 to keep it until manually dismissed. Defaults to 4000. */
  duration?: number
}

export interface ToastItem {
  id: number
  title: string
  description?: string
  type: ToastType
  duration: number
}

type Listener = () => void

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** React store subscription (used by <Toaster> via useSyncExternalStore). */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): ToastItem[] {
  return toasts
}

function push(title: string, type: ToastType, opts?: ToastOptions): number {
  const id = nextId++
  const duration = opts?.duration ?? 4000
  const item: ToastItem = { id, title, type, duration }
  if (opts?.description !== undefined) item.description = opts.description
  toasts = [...toasts, item]
  emit()
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration)
  }
  return id
}

export function dismiss(id?: number): void {
  toasts = id === undefined ? [] : toasts.filter((t) => t.id !== id)
  emit()
}

export interface ToastApi {
  (title: string, opts?: ToastOptions): number
  success(title: string, opts?: ToastOptions): number
  error(title: string, opts?: ToastOptions): number
  warning(title: string, opts?: ToastOptions): number
  info(title: string, opts?: ToastOptions): number
  dismiss(id?: number): void
}

/** Imperative toast API - callable from anywhere (event handlers, async flows, engine code). */
export const toast: ToastApi = Object.assign(
  (title: string, opts?: ToastOptions) => push(title, 'info', opts),
  {
    success: (title: string, opts?: ToastOptions) => push(title, 'success', opts),
    error: (title: string, opts?: ToastOptions) => push(title, 'error', opts),
    warning: (title: string, opts?: ToastOptions) => push(title, 'warning', opts),
    info: (title: string, opts?: ToastOptions) => push(title, 'info', opts),
    dismiss,
  },
)
