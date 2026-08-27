import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'
import { themeSchema, getTheme, fontDisplay } from '../theme'
import { Frame, TopBar } from './shared'

export const heroSchema = z.object({ theme: themeSchema.default('carbon') })
export type HeroProps = z.infer<typeof heroSchema>

export const Hero: React.FC<HeroProps> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = getTheme(theme)

  // Timings — keep all interpolate() inline for Studio editability
  const titleY = interpolate(frame, [0, 0.6 * fps], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })
  const titleOpacity = interpolate(frame, [0, 0.6 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <Frame theme={theme}>
      <TopBar theme={theme} title="HERO · 720p" subtitle="Modular 3×8 grid" />
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '24px 32px 28px',
          gap: 18,
        }}
      >
        {/* Headline */}
        <div
          style={{
            opacity: titleOpacity,
            translate: `0 ${titleY}px`,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              letterSpacing: '0.14em',
              color: t.accent,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: t.accent,
                boxShadow: `0 0 6px ${t.accentDim}`,
              }}
            />
            FREE & OPEN SOURCE · GPLv3
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: fontDisplay,
              fontSize: 44,
              lineHeight: 0.95,
              letterSpacing: '-0.02em',
              fontWeight: 800,
              color: t.ink1,
            }}
          >
            A guitar rig that <span style={{ color: t.ledHot }}>lives</span>
            <br />
            everywhere you play.
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: t.ink2,
              fontSize: 14,
              maxWidth: 560,
              lineHeight: 1.5,
            }}
          >
            Amp + cab + 10 effects in a modular 3×8 grid — one C++ engine, no latency tricks.
          </p>
        </div>

        {/* Signal chain card — mimics apps/landing hero .screen but animated */}
        <div
          style={{
            background: t.panel,
            border: `1px solid ${t.seam}`,
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 1px 0 rgb(255 255 255 / 4%) inset, 0 2px 10px rgb(0 0 0 / 30%)',
            opacity: interpolate(frame, [0.4 * fps, 1.0 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `0 ${interpolate(frame, [0.4 * fps, 1.0 * fps], [16, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <div
            style={{
              background: t.screenBg,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Row: Input → IN … OUT → Master */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: t.screenDim, fontSize: 11 }}>Input →</span>
              {[
                { label: 'IN', dim: true },
                { label: 'AMP', hot: true, delay: 1.0 },
                { label: 'CAB', hot: true, delay: 1.2 },
                { label: 'GATE', delay: 1.4 },
                { label: 'COMP', delay: 1.6 },
                { label: 'EQ', delay: 1.8 },
                { label: 'CHORUS', delay: 2.0 },
                { label: 'DELAY', delay: 2.15 },
                { label: 'REVERB', delay: 2.3 },
                { label: 'OUT', dim: true, delay: 2.5 },
              ].map((b) => {
                const d = (b as { delay?: number }).delay ?? 0.8
                return (
                  <span
                    key={b.label}
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: (b as { hot?: boolean }).hot
                        ? t.ledHot
                        : (b as { dim?: boolean }).dim
                          ? t.screenDim
                          : t.screenText,
                      background: (b as { hot?: boolean }).hot
                        ? 'rgb(255 59 48 / 12%)'
                        : 'transparent',
                      border: `1px solid ${(b as { hot?: boolean }).hot ? 'rgb(255 59 48 / 35%)' : 'transparent'}`,
                      borderRadius: 6,
                      padding: '2px 7px',
                      opacity: interpolate(frame, [d * fps, (d + 0.5) * fps], [0, 1], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                      }),
                      scale: interpolate(frame, [d * fps, (d + 0.5) * fps], [0.92, 1], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                        easing: Easing.spring({ damping: 200 }),
                        output: 'perceptual-scale',
                      }) as unknown as number,
                    }}
                  >
                    {b.label}
                  </span>
                )
              })}
              <span style={{ color: t.screenDim, fontSize: 11 }}>→ Master</span>
            </div>

            {/* Grid visualization — 3×8 dots + moving blocks */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '56px 1fr 56px',
                gap: 10,
                alignItems: 'center',
                marginTop: 4,
              }}
            >
              <div
                style={{
                  background: t.panelRecessed,
                  border: `1px solid ${t.seam}`,
                  borderRadius: 8,
                  padding: '8px 6px',
                  textAlign: 'center',
                  fontSize: 9,
                  color: t.ink2,
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                IN
                <br />
                <span style={{ color: t.ink3, fontWeight: 600 }}>rail</span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(8, 1fr)',
                  gridTemplateRows: 'repeat(3, 1fr)',
                  gap: 6,
                  padding: 8,
                  background: t.screenBg,
                  border: `1px solid ${t.seamStrong}`,
                  borderRadius: 8,
                }}
              >
                {Array.from({ length: 24 }).map((_, i) => {
                  const occupied = [1, 2, 9, 10, 11, 17, 18, 19].includes(i)
                  const isHot = [1, 2].includes(i)
                  const delay = 1.2 + i * 0.04
                  return (
                    <div
                      key={i}
                      style={{
                        height: 22,
                        borderRadius: 5,
                        background: occupied
                          ? isHot
                            ? 'rgb(255 90 31 / 22%)'
                            : 'rgb(95 220 122 / 14%)'
                          : 'transparent',
                        border: `1px dashed ${occupied ? (isHot ? t.accent : t.ledOn) : t.seam}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 7,
                        color: occupied ? (isHot ? t.accent : t.ledOn) : t.ink3,
                        fontWeight: 700,
                        opacity: interpolate(frame, [delay * fps, (delay + 0.4) * fps], [0, 1], {
                          extrapolateLeft: 'clamp',
                          extrapolateRight: 'clamp',
                        }),
                        scale: interpolate(frame, [delay * fps, (delay + 0.4) * fps], [0.7, 1], {
                          extrapolateLeft: 'clamp',
                          extrapolateRight: 'clamp',
                          easing: Easing.spring({ damping: 180 }),
                          output: 'perceptual-scale',
                        }) as unknown as number,
                      }}
                    >
                      {occupied ? (i === 1 ? 'AMP' : i === 2 ? 'CAB' : '●') : ''}
                    </div>
                  )
                })}
              </div>

              <div
                style={{
                  background: t.panelRecessed,
                  border: `1px solid ${t.seam}`,
                  borderRadius: 8,
                  padding: '8px 6px',
                  textAlign: 'center',
                  fontSize: 9,
                  color: t.ink2,
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                OUT
                <br />
                <span style={{ color: t.ink3, fontWeight: 600 }}>rail</span>
              </div>
            </div>

            <div
              style={{
                fontSize: 10,
                color: t.screenDim,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>3 rows × 8 columns · drag to move · cable to connect</span>
              <span style={{ color: t.ledOn }}>● zero added latency</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: t.panelRaised,
              borderTop: `1px solid ${t.seam}`,
              fontSize: 10,
              color: t.ink2,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
                letterSpacing: '0.06em',
                fontSize: 10,
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
              Engine: openaxe_core
            </span>
            <span style={{ color: t.ink3, fontSize: 10 }}>48 kHz · 128 frames</span>
          </div>
        </div>
      </AbsoluteFill>
    </Frame>
  )
}
