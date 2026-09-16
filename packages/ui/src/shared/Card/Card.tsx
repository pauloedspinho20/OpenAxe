import type { ReactNode } from 'react'
import '../../../vanilla/surfaces.css'

export interface CardProps {
  title?: string | undefined
  className?: string | undefined
  children: ReactNode
}

/**
 * Content card — the promoted replacement for landing's bespoke `.card`.
 * Styles live in `vanilla/surfaces.css` so the vanilla landing consumes
 * the exact same rules via `@openaxe/ui/vanilla/surfaces.css`.
 */
export function Card({ title, className = '', children }: CardProps) {
  const cls = ['ox-card', className].filter(Boolean).join(' ')
  return (
    <article className={cls}>
      {title ? <h3 className="ox-card-title">{title}</h3> : null}
      {children}
    </article>
  )
}
