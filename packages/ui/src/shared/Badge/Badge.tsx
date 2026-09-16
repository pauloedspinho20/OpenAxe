import type { ReactNode } from 'react'
import '../../../vanilla/surfaces.css'

export type BadgeTone = 'live' | 'beta' | 'planned' | 'accent'

export interface BadgeProps {
  tone?: BadgeTone | undefined
  className?: string | undefined
  children: ReactNode
  'aria-label'?: string | undefined
}

/**
 * Status badge — the promoted replacement for landing's bespoke
 * `.status-live|beta|planned`, `.pill` and `.beta`. Styles live in
 * `vanilla/surfaces.css` so the vanilla landing consumes the exact
 * same rules via `@openaxe/ui/vanilla/surfaces.css`.
 */
export function Badge({
  tone = 'planned',
  className = '',
  children,
  'aria-label': ariaLabel,
}: BadgeProps) {
  const cls = ['ox-badge', `ox-badge-${tone}`, className].filter(Boolean).join(' ')
  return (
    <span className={cls} aria-label={ariaLabel}>
      {children}
    </span>
  )
}
