import type { MouseEventHandler, ReactNode } from 'react'
import '../../../vanilla/actions.css'

export type ButtonVariant = 'primary' | 'ghost'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  /** Renders an anchor instead of a button when present. */
  href?: string | undefined
  target?: string | undefined
  rel?: string | undefined
  download?: string | boolean | undefined
  type?: 'button' | 'submit' | 'reset' | undefined
  disabled?: boolean | undefined
  onClick?: MouseEventHandler<HTMLElement> | undefined
  className?: string | undefined
  children: ReactNode
  'aria-label'?: string | undefined
}

/**
 * Unified action — the promoted replacement for landing's bespoke
 * `.btn`/`.btn-primary`/`.btn-ghost` and the ghost pattern in
 * `OutlineButton`. Styles live in `vanilla/actions.css` so the
 * vanilla landing consumes the exact same rules via
 * `@openaxe/ui/vanilla/actions.css`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  href,
  target,
  rel,
  download,
  type = 'button',
  disabled = false,
  onClick,
  className = '',
  children,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const cls = ['ox-btn', `ox-btn-${variant}`, size === 'sm' ? 'ox-btn-sm' : '', className]
    .filter(Boolean)
    .join(' ')
  if (href !== undefined) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        download={download}
        onClick={onClick}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        className={cls}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cls}
    >
      {children}
    </button>
  )
}
