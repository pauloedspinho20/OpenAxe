import type { ReactNode } from 'react'

export interface IconProps {
  size?: number | undefined
  className?: string | undefined
  title?: string | undefined
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function Icon({ size, className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 14}
      height={size ?? 14}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...STROKE}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/** A dot needed inside stroke-only icons — solid fill reads better at 24px. */
export function Dot({
  cx,
  cy,
  r = 1.1,
}: {
  cx: number | string
  cy: number | string
  r?: number | string
}) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
}
