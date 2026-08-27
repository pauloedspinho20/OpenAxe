import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'
import { themeSchema, getTheme } from '../theme'
import { Frame, TopBar, ScreenCard, KnobMini, GridBlock } from './shared'

export const ampSchema = z.object({ theme: themeSchema.default('carbon') })
export type AmpProps = z.infer<typeof ampSchema>

export const Amp: React.FC<AmpProps> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = getTheme(theme)

  const cardIn = interpolate(frame, [0.2 * fps, 0.8 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })

  return (
    <Frame theme={theme}>
      <TopBar theme={theme} title="AMP · NAM captures" subtitle="Tone3000 → .nam → Amp block" />
      <AbsoluteFill style={{ display: 'flex', gap: 18, padding: '22px 28px 24px' }}>
        {/* Left: Tone3000 browser */}
        <div
          style={{
            flex: 1.05,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            opacity: cardIn,
            translate: `0 ${interpolate(frame, [0.2 * fps, 0.8 * fps], [16, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: '-0.02em', color: t.ink1 }}>
            Any <span style={{ color: t.accent }}>.nam</span> — amps, pedals, outboard
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: t.ink2, lineHeight: 1.5 }}>
            Browse Tone3000, audition, then load directly into the Amp block. Same{' '}
            <code
              style={{
                fontSize: 11,
                background: t.panelRaised,
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${t.seam}`,
              }}
            >
              NamAmp
            </code>{' '}
            inference on web (WASM) and native (C++).
          </p>

          <ScreenCard theme={theme}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: t.ink2 }}
                >
                  TONE3000
                </span>
                <span style={{ flex: 1, height: 1, background: t.seam }} />
                <span
                  style={{
                    fontSize: 9,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: t.accentDim,
                    border: `1px solid ${t.accent}`,
                    color: t.accent,
                    fontWeight: 700,
                  }}
                >
                  ● LIVE
                </span>
              </div>

              {[
                { name: 'JCM800 — Crunch', gain: 6.2, tone: 'British', hot: false },
                { name: 'Twin Reverb — Clean', gain: 3.1, tone: 'American', hot: true },
                { name: '5150 — High Gain', gain: 8.4, tone: 'Modern', hot: false },
              ].map((r, i) => {
                const isSelected = r.hot
                const appear = 1.0 + i * 0.35
                return (
                  <div
                    key={r.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 10px',
                      borderRadius: 8,
                      background: isSelected ? t.panelRaised : 'transparent',
                      border: `1px solid ${isSelected ? t.accent : t.seam}`,
                      boxShadow: isSelected ? `0 0 10px ${t.accent}22` : undefined,
                      opacity: interpolate(frame, [appear * fps, (appear + 0.4) * fps], [0, 1], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                      }),
                      scale: interpolate(frame, [appear * fps, (appear + 0.4) * fps], [0.97, 1], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                        easing: Easing.spring({ damping: 200 }),
                        output: 'perceptual-scale',
                      }) as unknown as number,
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: isSelected ? t.accent : t.panelRecessed,
                        border: `1px solid ${isSelected ? t.accent : t.seam}`,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 11,
                      }}
                    >
                      ♪
                    </span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: isSelected ? t.ink1 : t.ink2,
                        }}
                      >
                        {r.name}
                      </div>
                      <div style={{ fontSize: 9, color: t.ink3 }}>
                        {r.tone} · Gain {r.gain.toFixed(1)}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: isSelected ? t.accent : 'transparent',
                        color: isSelected ? t.accentInk : t.ink3,
                        border: `1px solid ${isSelected ? t.accent : t.seam}`,
                      }}
                    >
                      {isSelected ? 'LOAD' : 'PREVIEW'}
                    </span>
                  </div>
                )
              })}

              <div
                style={{
                  height: 2,
                  background: t.seamStrong,
                  borderRadius: 999,
                  overflow: 'hidden',
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: '100%',
                    background: t.accent,
                    scale: `${interpolate(frame, [2.6 * fps, 3.4 * fps], [0, 1], {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                    })} 1`,
                    transformOrigin: 'left center',
                  }}
                />
              </div>
              <span style={{ fontSize: 9, color: t.ink3, textAlign: 'center' }}>
                {interpolate(frame, [2.6 * fps, 3.4 * fps], [0, 100], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }).toFixed(0)}
                % — loading .nam capture
              </span>
            </div>
          </ScreenCard>
        </div>

        {/* Right: Amp block */}
        <div
          style={{
            flex: 0.95,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            opacity: interpolate(frame, [1.6 * fps, 2.2 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: `0 ${interpolate(frame, [1.6 * fps, 2.2 * fps], [18, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <div
            style={{
              background: t.panel,
              border: `1px solid ${t.accent}`,
              borderRadius: 10,
              padding: 14,
              boxShadow: `0 0 18px ${t.accent}22, 0 1px 0 rgb(255 255 255 / 4%) inset`,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: t.accent }}
              >
                AMP — NAM
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 9,
                  color: t.ledOn,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: t.ledOn,
                    boxShadow: `0 0 6px ${t.ledOn}`,
                  }}
                />
                ACTIVE
              </span>
            </div>

            <GridBlock
              theme={theme}
              label="NAM CAPTURE"
              sublabel="Twin Reverb — Clean · slim_size"
              color={t.blockNam}
              active
            />

            <div
              style={{
                display: 'flex',
                gap: 10,
                justifyContent: 'space-between',
                padding: '6px 4px 2px',
              }}
            >
              <KnobMini
                theme={theme}
                label="GAIN"
                rotation={`${interpolate(frame, [3.2 * fps, 5.0 * fps], [-35, 22], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) })}deg`}
                valueLabel="6.4"
              />
              <KnobMini
                theme={theme}
                label="BASS"
                rotation={`${interpolate(frame, [3.4 * fps, 5.2 * fps], [-20, 10], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg`}
              />
              <KnobMini
                theme={theme}
                label="MID"
                rotation={`${interpolate(frame, [3.5 * fps, 5.3 * fps], [15, -8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg`}
              />
              <KnobMini
                theme={theme}
                label="TREBLE"
                rotation={`${interpolate(frame, [3.6 * fps, 5.4 * fps], [-10, 28], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg`}
              />
              <KnobMini
                theme={theme}
                label="VOLUME"
                rotation={`${interpolate(frame, [3.8 * fps, 5.6 * fps], [-40, 18], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg`}
                valueLabel="7.1"
              />
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <span
                style={{
                  flex: 1,
                  fontSize: 9,
                  color: t.ink3,
                  textAlign: 'center',
                  background: t.panelRecessed,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: `1px solid ${t.seam}`,
                }}
              >
                Input trim
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 9,
                  color: t.ink3,
                  textAlign: 'center',
                  background: t.panelRecessed,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: `1px solid ${t.seam}`,
                }}
              >
                Bypass
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 9,
                  color: t.ink2,
                  textAlign: 'center',
                  background: t.accentDim,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: `1px solid ${t.accent}`,
                }}
              >
                Tone stack ✓
              </span>
            </div>
          </div>

          <span style={{ fontSize: 10, color: t.ink3, textAlign: 'center' }}>
            Tone3000 catalog · per-block I/O trims & bypass
          </span>
        </div>
      </AbsoluteFill>
    </Frame>
  )
}
