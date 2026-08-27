import React from 'react'
import { getTheme, fontDisplay, type Theme } from '../theme'

// Lightweight presentational primitives that mirror @openaxe/ui + apps/web grid chrome.
// Keep interpolate() inline in style for remotion-studio editability (see remotion-markup skill).

export const Frame: React.FC<{
  theme: Theme
  children: React.ReactNode
}> = ({ theme, children }) => {
  const t = getTheme(theme)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: t.chassis,
        color: t.ink1,
        fontFamily: fontDisplay,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {children}
    </div>
  )
}

export const TopBar: React.FC<{ theme: Theme; title: string; subtitle?: string }> = ({
  theme,
  title,
  subtitle,
}) => {
  const t = getTheme(theme)
  return (
    <div
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        borderBottom: `1px solid ${t.seam}`,
        background: `color-mix(in srgb, ${t.chassis} 88%, transparent)`,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: t.ledOn,
            boxShadow: `0 0 6px ${t.ledOn}`,
          }}
        />
        <span
          style={{
            fontWeight: 800,
            letterSpacing: '0.14em',
            fontSize: 13,
          }}
        >
          OPEN<span style={{ color: t.ledHot }}>AXE</span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: t.accent,
              background: t.accentDim,
              border: `1px solid ${t.accent}`,
              borderRadius: 999,
              padding: '1px 6px',
            }}
          >
            BETA
          </span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: t.ink2, letterSpacing: '0.06em' }}>
          {subtitle ?? 'Free · GPLv3 · NAM'}
        </span>
        <span style={{ fontSize: 11, color: t.ink3 }}>{title}</span>
      </div>
    </div>
  )
}

export const ScreenCard: React.FC<{ theme: Theme; children: React.ReactNode }> = ({
  theme,
  children,
}) => {
  const t = getTheme(theme)
  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.seam}`,
        borderRadius: 10,
        boxShadow: '0 1px 0 var(--seam) inset, 0 2px 6px rgb(0 0 0 / 30%)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

export const GridBlock: React.FC<{
  theme: Theme
  label: string
  sublabel?: string
  color: string
  active?: boolean
  x?: number
  y?: number
  w?: number
  h?: number
  opacity?: number
  scale?: number | string
}> = ({ theme, label, sublabel, color, active, x: _x, y: _y, w: _w, h: _h, opacity, scale }) => {
  const t = getTheme(theme)
  void _x
  void _y
  void _w
  void _h
  return (
    <div
      style={{
        background: active ? t.panelRaised : t.panel,
        border: `1px solid ${active ? color : t.seamStrong}`,
        borderRadius: 8,
        padding: '10px 10px 8px',
        minWidth: 96,
        boxShadow: active ? `0 0 12px ${color}30` : undefined,
        opacity: opacity as number | undefined,
        scale: scale as string | number | undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: active ? color : t.ink2,
          }}
        >
          {label}
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: active ? color : t.ledOff,
            boxShadow: active ? `0 0 6px ${color}` : undefined,
          }}
        />
      </div>
      {sublabel ? (
        <span style={{ fontSize: 9, color: t.ink3, lineHeight: 1.2 }}>{sublabel}</span>
      ) : null}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <span
          style={{
            flex: 1,
            height: 3,
            borderRadius: 999,
            background: active ? color : t.seamStrong,
            opacity: active ? 0.9 : 0.4,
          }}
        />
        <span
          style={{
            flex: 1,
            height: 3,
            borderRadius: 999,
            background: t.seamStrong,
            opacity: 0.25,
          }}
        />
      </div>
    </div>
  )
}

export const KnobMini: React.FC<{
  theme: Theme
  label: string
  rotation: string
  valueLabel?: string
}> = ({ theme, label, rotation, valueLabel }) => {
  const t = getTheme(theme)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          background: `linear-gradient(180deg, ${t.panelRaised}, ${t.panelRecessed})`,
          border: `1px solid ${t.seamStrong}`,
          boxShadow: 'inset 0 1px 1px rgb(255 255 255 / 6%), 0 1px 3px rgb(0 0 0 / 30%)',
          position: 'relative',
          rotate: rotation,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: '50%',
            width: 2,
            height: 10,
            background: t.ink1,
            borderRadius: 999,
            transform: 'translateX(-50%)',
            opacity: 0.9,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 10,
            borderRadius: 999,
            border: `1px solid ${t.seam}`,
            opacity: 0.5,
          }}
        />
      </div>
      <span style={{ fontSize: 8, letterSpacing: '0.08em', color: t.ink2, fontWeight: 700 }}>
        {label}
      </span>
      {valueLabel ? <span style={{ fontSize: 8, color: t.ink3 }}>{valueLabel}</span> : null}
    </div>
  )
}

export const Cable: React.FC<{
  theme: Theme
  progress: number
  color?: string
}> = ({ theme, progress, color }) => {
  const t = getTheme(theme)
  const c = color ?? t.ink2
  // progress 0..1 draws the cable left→right via scaleX
  return (
    <div
      style={{
        height: 2,
        background: c,
        opacity: 0.7 + progress * 0.3,
        transformOrigin: 'left center',
        scale: `${progress} 1`,
        borderRadius: 999,
      }}
    />
  )
}

export const MeterBar: React.FC<{ theme: Theme; level: number }> = ({ theme, level }) => {
  const t = getTheme(theme)
  const pct = Math.max(0, Math.min(1, level))
  return (
    <div
      style={{
        height: 6,
        background: t.panelRecessed,
        borderRadius: 999,
        border: `1px solid ${t.seam}`,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <div
        style={{
          width: `${pct * 100}%`,
          background: pct > 0.85 ? t.ledHot : pct > 0.6 ? t.ledWarn : t.ledOn,
          boxShadow: `0 0 6px ${pct > 0.85 ? t.ledHot : pct > 0.6 ? t.ledWarn : t.ledOn}`,
          transition: 'none',
        }}
      />
    </div>
  )
}
