import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'
import { themeSchema, getTheme } from '../theme'
import { Frame, TopBar, ScreenCard, MeterBar } from './shared'

export const cabMixerSchema = z.object({ theme: themeSchema.default('carbon') })
export type CabMixerProps = z.infer<typeof cabMixerSchema>

export const CabMixer: React.FC<CabMixerProps> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = getTheme(theme)

  return (
    <Frame theme={theme}>
      <TopBar
        theme={theme}
        title="CAB + MIXER · IR & routing"
        subtitle="Partitioned convolver · 0 latency"
      />
      <AbsoluteFill style={{ display: 'flex', gap: 16, padding: '20px 28px 22px' }}>
        {/* Left: Cab */}
        <div
          style={{
            flex: 1.15,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            opacity: interpolate(frame, [0.2 * fps, 0.8 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `0 ${interpolate(frame, [0.2 * fps, 0.8 * fps], [14, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, color: t.ink1, letterSpacing: '-0.02em' }}>
            Cab — <span style={{ color: t.blockSpace }}>IR convolution</span>
          </h2>
          <p style={{ margin: 0, fontSize: 11, color: t.ink2, lineHeight: 1.5 }}>
            Zero-latency partitioned convolver +{' '}
            <code
              style={{
                fontSize: 10,
                background: t.panelRaised,
                padding: '1px 5px',
                borderRadius: 4,
                border: `1px solid ${t.seam}`,
              }}
            >
              wav.cpp
            </code>{' '}
            decode/resample. Hand the core bytes — no Web Audio decode on native.
          </p>

          <ScreenCard theme={theme}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: t.blockSpace,
                  }}
                >
                  CAB
                </span>
                <span
                  style={{
                    fontSize: 9,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: `${t.blockSpace}18`,
                    border: `1px solid ${t.blockSpace}40`,
                    color: t.blockSpace,
                    fontWeight: 700,
                  }}
                >
                  IR: Greenback 4×12 · SM57
                </span>
              </div>

              {/* IR waveform — animated bars */}
              <div
                style={{
                  height: 72,
                  background: t.screenBg,
                  borderRadius: 8,
                  border: `1px solid ${t.seam}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '0 10px',
                  overflow: 'hidden',
                }}
              >
                {Array.from({ length: 48 }).map((_, i) => {
                  const base = Math.exp(-i * 0.065) * (0.55 + 0.45 * Math.sin(i * 0.7))
                  const env = Math.max(0, base + 0.08 * Math.sin(frame * 0.08 + i * 0.4))
                  const h = 8 + env * 52
                  return (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: h,
                        background: i < 6 ? t.accent : t.blockSpace,
                        opacity: 0.75 + env * 0.25,
                        borderRadius: 2,
                        scale: `${interpolate(
                          frame,
                          [(0.6 + i * 0.02) * fps, (1.0 + i * 0.02) * fps],
                          [0.4, 1],
                          {
                            extrapolateLeft: 'clamp',
                            extrapolateRight: 'clamp',
                            easing: Easing.spring({ damping: 200 }),
                            output: 'perceptual-scale',
                          },
                        )} 1` as unknown as string,
                        transformOrigin: 'center bottom',
                      }}
                    />
                  )
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, color: t.ink3, letterSpacing: '0.06em' }}>IR MIX</span>
                <div
                  style={{
                    flex: 1,
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
                      width: `${interpolate(frame, [1.8 * fps, 3.0 * fps], [20, 72], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`,
                      background: t.blockSpace,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: t.ink2,
                    fontWeight: 700,
                    minWidth: 32,
                    textAlign: 'right',
                  }}
                >
                  {interpolate(frame, [1.8 * fps, 3.0 * fps], [20, 72], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  }).toFixed(0)}
                  %
                </span>
              </div>

              <MeterBar theme={theme} level={0.55 + 0.2 * Math.sin(frame * 0.14)} />
            </div>
          </ScreenCard>
        </div>

        {/* Right: Mixer / Splitter / Master */}
        <div
          style={{
            flex: 0.9,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            opacity: interpolate(frame, [1.0 * fps, 1.6 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: `0 ${interpolate(frame, [1.0 * fps, 1.6 * fps], [16, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'SPLITTER', sub: 'A/B · balance', color: t.blockUtility, delay: 1.1 },
              { label: 'MIXER', sub: '2 → 1 · gain', color: t.blockUtility, delay: 1.3 },
            ].map((b) => (
              <div
                key={b.label}
                style={{
                  background: t.panel,
                  border: `1px solid ${b.color}55`,
                  borderRadius: 10,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  opacity: interpolate(frame, [b.delay * fps, (b.delay + 0.4) * fps], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  }),
                }}
              >
                <span
                  style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: b.color }}
                >
                  {b.label}
                </span>
                <span style={{ fontSize: 9, color: t.ink3 }}>{b.sub}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 28,
                      background: t.panelRecessed,
                      borderRadius: 6,
                      border: `1px solid ${t.seam}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: t.ink2,
                    }}
                  >
                    CH A
                  </div>
                  <span style={{ color: t.ink3, fontSize: 10 }}>⇄</span>
                  <div
                    style={{
                      flex: 1,
                      height: 28,
                      background: t.panelRecessed,
                      borderRadius: 6,
                      border: `1px solid ${t.seam}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: t.ink2,
                    }}
                  >
                    CH B
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: t.panel,
              border: `1px solid ${t.seam}`,
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginTop: 2,
              opacity: interpolate(frame, [1.8 * fps, 2.2 * fps], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: t.ink2 }}
              >
                MASTER BUS
              </span>
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: t.ledOn + '22',
                  border: `1px solid ${t.ledOn}50`,
                  color: t.ledOn,
                  fontWeight: 700,
                }}
              >
                ● 0.0 dB
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <MeterBar theme={theme} level={0.72 + 0.18 * Math.sin(frame * 0.18)} />
                <MeterBar theme={theme} level={0.68 + 0.18 * Math.sin(frame * 0.18 + 0.6)} />
                <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                  <span
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 8,
                      color: t.ink3,
                      background: t.panelRecessed,
                      padding: '3px 0',
                      borderRadius: 4,
                      border: `1px solid ${t.seam}`,
                    }}
                  >
                    MUTE
                  </span>
                  <span
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 8,
                      color: t.ink2,
                      background: `${t.ledOn}18`,
                      padding: '3px 0',
                      borderRadius: 4,
                      border: `1px solid ${t.ledOn}40`,
                    }}
                  >
                    LEVEL
                  </span>
                </div>
              </div>

              {/* Fader */}
              <div
                style={{
                  width: 28,
                  height: 86,
                  background: t.panelRecessed,
                  borderRadius: 6,
                  border: `1px solid ${t.seamStrong}`,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 6,
                    right: 6,
                    top: 8,
                    bottom: 8,
                    background: t.ink3,
                    opacity: 0.2,
                    borderRadius: 999,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 3,
                    right: 3,
                    height: 16,
                    borderRadius: 4,
                    background: `linear-gradient(180deg, ${t.panelRaised}, ${t.panelRecessed})`,
                    border: `1px solid ${t.seamStrong}`,
                    boxShadow: '0 1px 3px rgb(0 0 0 / 30%)',
                    top: interpolate(frame, [2.2 * fps, 4.0 * fps], [58, 14], {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                />
              </div>
            </div>
          </div>

          <span style={{ fontSize: 10, color: t.ink3, textAlign: 'center' }}>
            Mixer / Splitter utilities · Master level & mute
          </span>
        </div>
      </AbsoluteFill>
    </Frame>
  )
}
