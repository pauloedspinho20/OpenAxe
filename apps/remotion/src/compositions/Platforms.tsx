import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'
import { themeSchema, getTheme } from '../theme'
import { Frame, TopBar } from './shared'

export const platformsSchema = z.object({ theme: themeSchema.default('carbon') })
export type PlatformsProps = z.infer<typeof platformsSchema>

const PLATFORMS = [
  {
    label: 'Web',
    status: 'Live',
    detail: 'Vite + AudioWorklet + WASM',
    latency: '~15 ms',
    tone: 'green' as const,
    delay: 0.5,
  },
  {
    label: 'Desktop',
    status: 'Live',
    detail: 'C++ + webview.h + JUCE',
    latency: '<5 ms',
    tone: 'green' as const,
    delay: 0.75,
  },
  {
    label: 'VST3 / CLAP / AU',
    status: 'Beta',
    detail: 'iPlug2 + WHOLE_ARCHIVE',
    latency: '0 ms host',
    tone: 'amber' as const,
    delay: 1.0,
  },
  {
    label: 'iOS / Android',
    status: 'Planned',
    detail: 'SwiftUI / Compose + C++',
    latency: '5–20 ms',
    tone: 'ink' as const,
    delay: 1.25,
  },
] as const

export const Platforms: React.FC<PlatformsProps> = ({ theme }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = getTheme(theme)

  return (
    <Frame theme={theme}>
      <TopBar
        theme={theme}
        title="ONE ENGINE · FOUR SHELLS"
        subtitle="extern C ABI — same routing, same sound"
      />
      <AbsoluteFill
        style={{ display: 'flex', flexDirection: 'column', padding: '22px 28px 20px', gap: 14 }}
      >
        <div
          style={{
            textAlign: 'center',
            opacity: interpolate(frame, [0.1 * fps, 0.6 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: `0 ${interpolate(frame, [0.1 * fps, 0.6 * fps], [10, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 19, letterSpacing: '-0.02em', color: t.ink1 }}>
            One <span style={{ color: t.accent }}>C++ engine</span> — four shells
          </h2>
          <p style={{ margin: '6px auto 0', fontSize: 11, color: t.ink2, maxWidth: 620 }}>
            Every front end talks to the same{' '}
            <code
              style={{
                fontSize: 10,
                background: t.panelRaised,
                padding: '1px 5px',
                borderRadius: 4,
                border: `1px solid ${t.seam}`,
              }}
            >
              extern "C"
            </code>{' '}
            ABI —
            <code
              style={{
                fontSize: 10,
                background: t.panelRaised,
                padding: '1px 5px',
                borderRadius: 4,
                border: `1px solid ${t.seam}`,
              }}
            >
              packages/core/include/openaxe/api.h
            </code>
          </p>
        </div>

        {/* Engine pill */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            opacity: interpolate(frame, [0.4 * fps, 0.9 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
              borderRadius: 999,
              background: t.panel,
              border: `1px solid ${t.seamStrong}`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: t.ink2,
              boxShadow: '0 1px 6px rgb(0 0 0 / 18%)',
              scale: interpolate(frame, [0.4 * fps, 0.9 * fps], [0.96, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.spring({ damping: 200 }),
                output: 'perceptual-scale',
              }) as unknown as number,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: t.ledOn,
                boxShadow: `0 0 6px ${t.ledOn}`,
              }}
            />
            openaxe_core
            <span style={{ color: t.ink3, fontWeight: 600 }}>·</span>
            NAM · Dragonfly · DSPark · BYOD
            <span
              style={{
                marginLeft: 6,
                width: 28,
                height: 2,
                background: t.ledOn,
                borderRadius: 999,
                opacity: interpolate(frame, [1.6 * fps, 2.4 * fps], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }),
                scale: `${interpolate(frame, [1.6 * fps, 2.4 * fps], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })} 1` as unknown as string,
                transformOrigin: 'left center',
              }}
            />
          </div>
        </div>

        {/* Platform cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: 1 }}>
          {PLATFORMS.map((p) => {
            const appear = p.delay
            const active = interpolate(frame, [appear * fps, (appear + 0.5) * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            const badgeBg =
              p.tone === 'green'
                ? `${t.ledOn}18`
                : p.tone === 'amber'
                  ? `${t.ledWarn}18`
                  : t.panelRaised
            const badgeColor =
              p.tone === 'green' ? t.ledOn : p.tone === 'amber' ? t.ledWarn : t.ink3
            const badgeBorder =
              p.tone === 'green' ? `${t.ledOn}40` : p.tone === 'amber' ? `${t.ledWarn}40` : t.seam

            return (
              <div
                key={p.label}
                style={{
                  background: t.panel,
                  border: `1px solid ${active > 0.6 ? (p.tone === 'ink' ? t.seam : `${badgeColor}55`) : t.seam}`,
                  borderRadius: 10,
                  padding: '14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  position: 'relative',
                  overflow: 'hidden',
                  opacity: active,
                  translate: `0 ${interpolate(
                    frame,
                    [appear * fps, (appear + 0.5) * fps],
                    [16, 0],
                    {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  )}px`,
                  scale: interpolate(frame, [appear * fps, (appear + 0.5) * fps], [0.98, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                    easing: Easing.spring({ damping: 200 }),
                    output: 'perceptual-scale',
                  }) as unknown as number,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: badgeBg,
                    color: badgeColor,
                    border: `1px solid ${badgeBorder}`,
                  }}
                >
                  {p.status}
                </span>

                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: t.panelRaised,
                    border: `1px solid ${t.seam}`,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 16,
                    color: p.tone === 'green' ? t.ledOn : p.tone === 'amber' ? t.ledWarn : t.ink2,
                  }}
                >
                  {p.label === 'Web'
                    ? '◈'
                    : p.label === 'Desktop'
                      ? '▣'
                      : p.label.startsWith('VST')
                        ? '⬢'
                        : '⬣'}
                </div>

                <span
                  style={{ fontSize: 12, fontWeight: 800, color: t.ink1, letterSpacing: '-0.01em' }}
                >
                  {p.label}
                </span>
                <span style={{ fontSize: 10, color: t.ink2, lineHeight: 1.4 }}>{p.detail}</span>
                <span
                  style={{
                    marginTop: 'auto',
                    fontSize: 9,
                    color: t.ink3,
                    background: t.panelRecessed,
                    border: `1px solid ${t.seam}`,
                    borderRadius: 999,
                    padding: '2px 8px',
                    alignSelf: 'flex-start',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  {p.latency}
                </span>
              </div>
            )
          })}
        </div>

        {/* Bottom cable that draws across */}
        <div
          style={{
            height: 2,
            background: t.seamStrong,
            borderRadius: 999,
            overflow: 'hidden',
            opacity: interpolate(frame, [1.8 * fps, 2.2 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <div
            style={{
              height: '100%',
              background: `linear-gradient(90deg, ${t.ledOn}, ${t.accent}, ${t.blockMod})`,
              scale: `${interpolate(frame, [1.8 * fps, 4.0 * fps], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })} 1` as unknown as string,
              transformOrigin: 'left center',
            }}
          />
        </div>

        <div
          style={{
            textAlign: 'center',
            fontSize: 9,
            color: t.ink3,
            letterSpacing: '0.04em',
            opacity: interpolate(frame, [2.8 * fps, 3.4 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Design tokens — single source{' '}
          <code
            style={{
              fontSize: 8,
              background: t.panelRaised,
              padding: '1px 4px',
              borderRadius: 3,
              border: `1px solid ${t.seam}`,
            }}
          >
            design-tokens.json
          </code>{' '}
          → CSS +{' '}
          <code
            style={{
              fontSize: 8,
              background: t.panelRaised,
              padding: '1px 4px',
              borderRadius: 3,
              border: `1px solid ${t.seam}`,
            }}
          >
            tokens.h
          </code>{' '}
          · Carbon / Aluminum
        </div>
      </AbsoluteFill>
    </Frame>
  )
}
