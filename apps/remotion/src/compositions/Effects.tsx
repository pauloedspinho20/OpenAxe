import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'
import { themeSchema, getTheme } from '../theme'
import { Frame, TopBar, KnobMini } from './shared'

export const effectsSchema = z.object({ theme: themeSchema.default('carbon') })
export type EffectsProps = z.infer<typeof effectsSchema>

const EFFECTS = [
  { id: 'gate', label: 'GATE', colorKey: 'blockDynamics' as const, mix: 0, hasMix: false },
  { id: 'comp', label: 'COMP', colorKey: 'blockDynamics' as const, mix: 42, hasMix: false },
  { id: 'eq', label: 'EQ', colorKey: 'blockFilter' as const, mix: 0, hasMix: false },
  { id: 'chorus', label: 'CHORUS', colorKey: 'blockMod' as const, mix: 28, hasMix: true },
  { id: 'delay', label: 'DELAY', colorKey: 'blockTime' as const, mix: 35, hasMix: true },
  { id: 'reverb', label: 'REVERB', colorKey: 'blockSpace' as const, mix: 22, hasMix: true },
] as const

export const Effects: React.FC<EffectsProps> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = getTheme(theme)

  return (
    <Frame theme={theme}>
      <TopBar
        theme={theme}
        title="EFFECTS · 10 best-in-class"
        subtitle="Gate · Comp · EQ · Chorus · Delay · Reverb"
      />
      <AbsoluteFill
        style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px 18px', gap: 14 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: t.ink1, letterSpacing: '-0.02em' }}>
            10 effects — <span style={{ color: t.ledOn }}>Dragonfly</span> ·{' '}
            <span style={{ color: t.blockMod }}>BYOD</span> ·{' '}
            <span style={{ color: t.blockDynamics }}>LSP</span>
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: t.ink2 }}>
            Engine-generic{' '}
            <code
              style={{
                fontSize: 10,
                background: t.panelRaised,
                padding: '1px 5px',
                borderRadius: 4,
                border: `1px solid ${t.seam}`,
              }}
            >
              mix
            </code>{' '}
            for 7 wet effects · Reverb expert mode · Peak metering from core
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, flex: 1 }}>
          {EFFECTS.map((e, i) => {
            const color = t[e.colorKey]
            const appear = 0.4 + i * 0.28
            const active = interpolate(frame, [appear * fps, (appear + 0.5) * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            const bypassOn = frame > (appear + 1.2) * fps && i % 2 === 0
            const meterLevel = 0.35 + 0.4 * Math.sin(frame * 0.12 + i * 0.9)

            return (
              <div
                key={e.id}
                style={{
                  background: t.panel,
                  border: `1px solid ${active > 0.5 ? color : t.seam}`,
                  borderRadius: 10,
                  padding: '12px 10px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: active > 0.7 ? `0 0 10px ${color}22` : undefined,
                  opacity: interpolate(frame, [appear * fps, (appear + 0.5) * fps], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  }),
                  translate: `0 ${interpolate(
                    frame,
                    [appear * fps, (appear + 0.5) * fps],
                    [14, 0],
                    {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  )}px`,
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      color: active > 0.5 ? color : t.ink2,
                    }}
                  >
                    {e.label}
                  </span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: bypassOn ? t.ledOff : color,
                      boxShadow: bypassOn ? undefined : `0 0 6px ${color}`,
                      opacity: active,
                    }}
                  />
                </div>

                {/* Mini knobs */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: `linear-gradient(180deg, ${t.panelRaised}, ${t.panelRecessed})`,
                      border: `1px solid ${t.seamStrong}`,
                      position: 'relative',
                      rotate: `${interpolate(
                        frame,
                        [(appear + 0.6) * fps, (appear + 2.0) * fps],
                        [-18, 20],
                        {
                          extrapolateLeft: 'clamp',
                          extrapolateRight: 'clamp',
                        },
                      )}deg`,
                      opacity: active,
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: '50%',
                        width: 2,
                        height: 8,
                        background: t.ink1,
                        borderRadius: 999,
                        transform: 'translateX(-50%)',
                      }}
                    />
                  </div>
                  {e.hasMix ? (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 999,
                        background: `linear-gradient(180deg, ${t.panelRaised}, ${t.panelRecessed})`,
                        border: `1px solid ${t.seamStrong}`,
                        position: 'relative',
                        rotate: `${interpolate(
                          frame,
                          [(appear + 0.8) * fps, (appear + 2.2) * fps],
                          [12, -14],
                          {
                            extrapolateLeft: 'clamp',
                            extrapolateRight: 'clamp',
                          },
                        )}deg`,
                        opacity: active,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: 3,
                          left: '50%',
                          width: 2,
                          height: 8,
                          background: color,
                          borderRadius: 999,
                          transform: 'translateX(-50%)',
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span
                    style={{
                      fontSize: 8,
                      color: t.ink3,
                      textAlign: 'center',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {e.hasMix ? `MIX ${e.mix}%` : '—'}
                  </span>
                  <div
                    style={{
                      height: 4,
                      background: t.panelRecessed,
                      borderRadius: 999,
                      border: `1px solid ${t.seam}`,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: e.hasMix ? `${e.mix}%` : '0%',
                        background: color,
                        opacity: active,
                      }}
                    />
                  </div>
                  {/* Meter */}
                  <div
                    style={{
                      height: 4,
                      background: t.panelRecessed,
                      borderRadius: 999,
                      border: `1px solid ${t.seam}`,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(1, meterLevel)) * 100}%`,
                        background:
                          meterLevel > 0.8 ? t.ledHot : meterLevel > 0.6 ? t.ledWarn : t.ledOn,
                        opacity: active,
                      }}
                    />
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textAlign: 'center',
                    padding: '3px 6px',
                    borderRadius: 999,
                    background: bypassOn ? t.panelRecessed : `${color}18`,
                    color: bypassOn ? t.ink3 : color,
                    border: `1px solid ${bypassOn ? t.seam : `${color}40`}`,
                    opacity: active,
                  }}
                >
                  {bypassOn ? 'BYPASS' : 'ACTIVE'}
                </span>
              </div>
            )
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 10,
            color: t.ink3,
            opacity: interpolate(frame, [3.2 * fps, 3.8 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <span style={{ width: 60, height: 1, background: t.seam }} />
          Wet effects share the same{' '}
          <code
            style={{
              fontSize: 9,
              background: t.panelRaised,
              padding: '1px 5px',
              borderRadius: 4,
              border: `1px solid ${t.seam}`,
            }}
          >
            mix
          </code>{' '}
          semantics — pedals/studio coherence
          <span style={{ width: 60, height: 1, background: t.seam }} />
        </div>
      </AbsoluteFill>
    </Frame>
  )
}

// Unused but keep KnobMini import valid for shared pattern
void KnobMini
