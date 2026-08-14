import type p5 from 'p5'
import type { ThemeColors } from './theme'

/** One frame's worth of input for a drawer - time-domain + frequency-domain reads of the tapped block's output. */
export interface DrawCtx {
  /** Peak of the current waveform buffer, 0..1 - the same calc LiveMeter uses. */
  level: number
  /** getByteTimeDomainData buffer (0..255, 128 = silence). Empty when there's no analyser. */
  waveform: Uint8Array
  /** getByteFrequencyData buffer (0..255). Empty when there's no analyser. */
  freq: Uint8Array
  colors: ThemeColors
  /** Seconds since the sketch started - for drift/rotation that shouldn't depend on audio alone. */
  t: number
  width: number
  height: number
}

export type DrawFn = (p: p5, ctx: DrawCtx) => void

/** Every non-NAM-core block kind gets its own art; anything else (incl. no selection) falls back to 'master'. */
export type ArtVariant =
  | 'master'
  | 'noise-gate'
  | 'compressor'
  | 'eq'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'delay'
  | 'ping-pong-delay'
  | 'reverb'
  | 'cab'
  | 'mixer'
  | 'splitter'

function withAlpha(p: p5, colorStr: string, alpha: number) {
  const c = p.color(colorStr)
  return p.color(p.red(c), p.green(c), p.blue(c), alpha)
}

/** Paints the "screen" backdrop with a thin translucent layer instead of a hard clear, so motion leaves a brief trail. */
function paintBackdrop(p: p5, ctx: DrawCtx, trailAlpha: number) {
  p.noStroke()
  p.fill(withAlpha(p, ctx.colors.screen, trailAlpha))
  p.rect(0, 0, ctx.width, ctx.height)
}

/** Radial waveform mandala - the default "master output" hero visual. */
function createRingDrawer(): DrawFn {
  let rot = 0
  return (p, ctx) => {
    paintBackdrop(p, ctx, 50)
    const { width: w, height: h, level, waveform, colors, t } = ctx
    const cx = w / 2
    const cy = h / 2
    const baseR = Math.min(w, h) * 0.22
    rot += 0.004 + level * 0.01

    p.push()
    p.translate(cx, cy)
    p.rotate(rot)
    p.noFill()
    p.stroke(p.lerpColor(p.color(colors.ink2), p.color(colors.accent), Math.min(1, level * 1.8)))
    p.strokeWeight(1.5)
    p.beginShape()
    const n = waveform.length || 64
    for (let i = 0; i <= n; i++) {
      const idx = i % n
      const sample = waveform.length ? (waveform[idx]! - 128) / 128 : 0
      const r = baseR + sample * baseR * 0.9 + Math.sin(t * 0.6 + i * 0.15) * 2
      const angle = (i / n) * p.TWO_PI
      p.vertex(Math.cos(angle) * r, Math.sin(angle) * r)
    }
    p.endShape(p.CLOSE)

    p.noStroke()
    p.fill(withAlpha(p, level > 0.85 ? colors.ledHot : colors.ledOn, 40 + level * 120))
    p.ellipse(0, 0, baseR * 0.5 + level * baseR * 0.6, baseR * 0.5 + level * baseR * 0.6)
    p.pop()
  }
}

interface Particle {
  x: number
  y: number
  a: number
  r: number
  seed: number
}

/** Slow-orbiting particle field - modulation/ambience effects (reverb, chorus, flanger). */
function createParticlesDrawer(opts: {
  count: number
  speed: number
  spread: number
  colorRole: keyof ThemeColors
}): DrawFn {
  let particles: Particle[] | null = null
  return (p, ctx) => {
    paintBackdrop(p, ctx, 28)
    const { width: w, height: h, level, colors } = ctx
    particles ??= Array.from({ length: opts.count }, () => ({
      x: p.random(w),
      y: p.random(h),
      a: p.random(p.TWO_PI),
      r: p.random(1.5, 3.5),
      seed: p.random(),
    }))
    const cx = w / 2
    const cy = h / 2
    for (const particle of particles) {
      particle.a += 0.01 * opts.speed * (0.4 + level * 2)
      const orbit = Math.min(w, h) * opts.spread * (0.3 + particle.seed * 0.7)
      const targetX = cx + Math.cos(particle.a + particle.seed * 10) * orbit
      const targetY = cy + Math.sin(particle.a * 1.3 + particle.seed * 6) * orbit * 0.8
      particle.x = p.lerp(particle.x, targetX, 0.05)
      particle.y = p.lerp(particle.y, targetY, 0.05)
      p.noStroke()
      p.fill(withAlpha(p, colors[opts.colorRole], 90 + level * 140))
      p.ellipse(particle.x, particle.y, particle.r + level * 4, particle.r + level * 4)
    }
  }
}

/** A rotating sweep of translucent arcs - phaser's swept-notch character. */
function createSweepDrawer(): DrawFn {
  return (p, ctx) => {
    paintBackdrop(p, ctx, 45)
    const { width: w, height: h, level, colors, t } = ctx
    const sweep = (Math.sin(t * 0.5) + 1) / 2
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.min(w, h) * 0.45
    p.noFill()
    for (let i = 0; i < 3; i++) {
      const r = maxR * (0.3 + i * 0.25) * (0.8 + level * 0.4)
      const alpha = Math.max(20, 60 + level * 160 - i * 20)
      p.stroke(withAlpha(p, colors.ledOn, alpha))
      p.strokeWeight(1.5)
      const startA = sweep * p.TWO_PI - p.PI * 0.35
      p.arc(cx, cy, r * 2, r * 2, startA, startA + p.PI * 0.7)
    }
  }
}

interface Ring {
  r: number
  alpha: number
  originX: number
}

/** Concentric rings triggered by rising transients - delay/echo repeats. */
function createPulseRingsDrawer(opts: { stereo: boolean }): DrawFn {
  let rings: Ring[] = []
  let prevLevel = 0
  let toggle = false
  return (p, ctx) => {
    paintBackdrop(p, ctx, 35)
    const { width: w, height: h, level, colors } = ctx
    const rising = level - prevLevel
    prevLevel = level
    if (rising > 0.08 && level > 0.15) {
      toggle = !toggle
      const originX = opts.stereo ? (toggle ? w * 0.3 : w * 0.7) : w / 2
      rings.push({ r: 4, alpha: 220, originX })
    }
    rings = rings.filter((ring) => ring.alpha > 2)
    const cy = h / 2
    for (const ring of rings) {
      ring.r += 1.6
      ring.alpha *= 0.94
      p.noFill()
      p.stroke(withAlpha(p, colors.accent, ring.alpha))
      p.strokeWeight(2)
      p.ellipse(ring.originX, cy, ring.r * 2, ring.r * 2)
    }
  }
}

/** A breathing/pulsing orb - dynamics and periodic-modulation effects. */
function createOrbDrawer(opts: {
  colorRole: keyof ThemeColors
  wobble?: boolean
  squash?: boolean
}): DrawFn {
  let smoothed = 0
  return (p, ctx) => {
    paintBackdrop(p, ctx, 45)
    const { width: w, height: h, level, colors, t } = ctx
    smoothed = p.lerp(smoothed, level, 0.25)
    const cx = w / 2
    const cy = h / 2
    const base = Math.min(w, h) * 0.22
    const breathe = opts.wobble ? (Math.sin(t * 3) + 1) / 2 : 0
    const rx = base + smoothed * base * 1.4
    const ry = opts.squash ? rx * (1 - smoothed * 0.35) : rx + breathe * base * 0.15
    p.noStroke()
    p.fill(withAlpha(p, colors[opts.colorRole], 40 + smoothed * 140))
    p.ellipse(cx, cy, rx * 2, ry * 2)
    p.noFill()
    p.stroke(withAlpha(p, colors.ink2, 120))
    p.strokeWeight(1)
    p.ellipse(cx, cy, base * 2.2, base * 2.2)
  }
}

/** Real frequency-band bars - EQ is the one effect that's literally about these bands. */
function createBarsDrawer(): DrawFn {
  return (p, ctx) => {
    paintBackdrop(p, ctx, 60)
    const { width: w, height: h, freq, colors } = ctx
    const bars = 24
    const step = Math.max(1, Math.floor(freq.length / bars))
    const barW = w / bars
    for (let i = 0; i < bars; i++) {
      const v = freq.length ? (freq[i * step] ?? 0) : 0
      const barH = (v / 255) * h * 0.85
      const col = p.lerpColor(p.color(colors.ink2), p.color(colors.ledOn), v / 255)
      p.noStroke()
      p.fill(col)
      p.rect(i * barW + barW * 0.15, h - barH, barW * 0.7, barH, 1)
    }
  }
}

/** Concentric ripples emanating from a center cap - a speaker cone's own IR response. */
function createConeDrawer(): DrawFn {
  let phase = 0
  return (p, ctx) => {
    paintBackdrop(p, ctx, 45)
    const { width: w, height: h, level, colors } = ctx
    phase += 0.05 + level * 0.1
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.min(w, h) * 0.42
    p.noFill()
    for (let i = 0; i < 5; i++) {
      const r = ((phase * 20 + i * (maxR / 5)) % maxR) + 6
      const alpha = p.map(r, 0, maxR, 200, 0)
      p.stroke(withAlpha(p, colors.accent, alpha * (0.3 + level)))
      p.strokeWeight(1.5)
      p.ellipse(cx, cy, r * 2, r * 2)
    }
    p.noStroke()
    p.fill(withAlpha(p, colors.ink1, 200))
    p.ellipse(cx, cy, maxR * 0.18 + level * 10, maxR * 0.18 + level * 10)
  }
}

/** Lines converging (mixer) or diverging (splitter) toward the right edge. */
function createFlowLinesDrawer(mode: 'merge' | 'split'): DrawFn {
  let phase = 0
  return (p, ctx) => {
    paintBackdrop(p, ctx, 40)
    const { width: w, height: h, level, colors } = ctx
    phase += 0.02 + level * 0.05
    const lines = 3
    const step = Math.max(4, w / 24)
    for (let i = 0; i < lines; i++) {
      const spread = (i - (lines - 1) / 2) * (h * 0.18)
      p.noFill()
      p.stroke(withAlpha(p, colors.ledOn, 90 + level * 140))
      p.strokeWeight(1.5 + level * 1.5)
      p.beginShape()
      for (let x = 0; x <= w; x += step) {
        const progress = x / w
        const converge = mode === 'merge' ? progress : 1 - progress
        const y =
          h / 2 + spread * converge + Math.sin(phase + x * 0.05 + i) * 4 * (1 - converge * 0.6)
        p.vertex(x, y)
      }
      p.endShape()
    }
  }
}

const ART_VARIANT_KINDS = new Set<string>([
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'ping-pong-delay',
  'reverb',
  'cab',
  'mixer',
  'splitter',
])

/** Maps a grid block kind to its art variant - anything not on the list (incl. no selection) is 'master'. */
export function toArtVariant(kind: string): ArtVariant {
  return (ART_VARIANT_KINDS.has(kind) ? kind : 'master') as ArtVariant
}

/** Selects the drawer for a block kind - each effect family gets a visual apt to what it does to the signal. */
export function createArtDrawer(variant: ArtVariant): DrawFn {
  switch (variant) {
    case 'reverb':
      return createParticlesDrawer({ count: 70, speed: 0.6, spread: 0.42, colorRole: 'ink2' })
    case 'chorus':
      return createParticlesDrawer({ count: 40, speed: 1, spread: 0.3, colorRole: 'ledOn' })
    case 'flanger':
      return createParticlesDrawer({ count: 26, speed: 1.8, spread: 0.22, colorRole: 'accent' })
    case 'phaser':
      return createSweepDrawer()
    case 'delay':
      return createPulseRingsDrawer({ stereo: false })
    case 'ping-pong-delay':
      return createPulseRingsDrawer({ stereo: true })
    case 'tremolo':
      return createOrbDrawer({ colorRole: 'ledOn', wobble: true })
    case 'compressor':
      return createOrbDrawer({ colorRole: 'accent', squash: true })
    case 'noise-gate':
      return createOrbDrawer({ colorRole: 'ledWarn' })
    case 'eq':
      return createBarsDrawer()
    case 'cab':
      return createConeDrawer()
    case 'mixer':
      return createFlowLinesDrawer('merge')
    case 'splitter':
      return createFlowLinesDrawer('split')
    case 'master':
    default:
      return createRingDrawer()
  }
}
