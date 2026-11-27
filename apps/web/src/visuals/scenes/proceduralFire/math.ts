/**
 * Pure CPU math, blackbody colorimetry, procedural campfire layout, and camera
 * helpers adapted from Leon Lin's `procedural-fire` (MIT License,
 * Copyright (c) 2026 Leon Lin, https://github.com/Leonxlnx/procedural-fire).
 */

export type Vec3 = readonly [number, number, number]
type Mat3 = readonly [Vec3, Vec3, Vec3]

// ── Blackbody spectrum -> CIE 1931 -> Bradford WB -> linear Rec.709/sRGB ───

const PLANCK_H = 6.62607015e-34
const LIGHT_C = 2.99792458e8
const BOLTZMANN_K = 1.380649e-23

function gaussAsym(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2)
  return Math.exp(-0.5 * t * t)
}

export function cie(lambdaNm: number): [number, number, number] {
  const x =
    1.056 * gaussAsym(lambdaNm, 599.8, 37.9, 31.0) +
    0.362 * gaussAsym(lambdaNm, 442.0, 16.0, 26.7) -
    0.065 * gaussAsym(lambdaNm, 501.1, 20.4, 26.2)
  const y =
    0.821 * gaussAsym(lambdaNm, 568.8, 46.9, 40.5) + 0.286 * gaussAsym(lambdaNm, 530.9, 16.3, 31.1)
  const z =
    1.217 * gaussAsym(lambdaNm, 437.0, 11.8, 36.0) + 0.681 * gaussAsym(lambdaNm, 459.0, 26.0, 13.8)
  return [x, y, z]
}

export function planck(lambdaNm: number, T: number): number {
  const l = lambdaNm * 1e-9
  return (
    (2 * PLANCK_H * LIGHT_C * LIGHT_C) /
    (l ** 5 * (Math.exp((PLANCK_H * LIGHT_C) / (l * BOLTZMANN_K * T)) - 1))
  )
}

/** Soot spectral emissivity ~ lambda^-1.39 (Hottel-Broughton), normalised at 550 nm. */
export function blackbodyXYZ(T: number, soot = false): [number, number, number] {
  let X = 0
  let Y = 0
  let Z = 0
  for (let l = 380; l <= 780; l += 2) {
    const p = planck(l, T) * (soot ? Math.pow(l / 550, -1.39) : 1)
    const [x, y, z] = cie(l)
    X += p * x
    Y += p * y
    Z += p * z
  }
  return [X, Y, Z]
}

const XYZ2RGB: Mat3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
]

const XYZ2LMS: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

function mul3(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function inv3(m: Mat3): Mat3 {
  const [a, b, c2] = m[0]
  const [d, e, f] = m[1]
  const [g2, h2, i] = m[2]
  const A = e * i - f * h2
  const B = -(d * i - f * g2)
  const C = d * h2 - e * g2
  const det = a * A + b * B + c2 * C
  return [
    [A / det, -(b * i - c2 * h2) / det, (b * f - c2 * e) / det],
    [B / det, (a * i - c2 * g2) / det, -(a * f - c2 * d) / det],
    [C / det, -(a * h2 - b * g2) / det, (a * e - b * d) / det],
  ]
}

const LMS2XYZ = inv3(XYZ2LMS)
const D65: Vec3 = [0.95047, 1.0, 1.08883]

/** Returns XYZ -> linear sRGB adapted so a blackbody at `Twb` reads neutral white. */
export function whiteBalance(Twb: number): (xyz: Vec3) => [number, number, number] {
  if (!Twb) return (xyz) => mul3(XYZ2RGB, xyz)
  const w = blackbodyXYZ(Twb)
  const wn: Vec3 = [w[0] / w[1], 1, w[2] / w[1]]
  const src = mul3(XYZ2LMS, wn)
  const dst = mul3(XYZ2LMS, D65)
  return (xyz) => {
    const raw = mul3(XYZ2LMS, xyz)
    const lms: Vec3 = [
      (raw[0] * dst[0]) / src[0],
      (raw[1] * dst[1]) / src[1],
      (raw[2] * dst[2]) / src[2],
    ]
    return mul3(XYZ2RGB, mul3(LMS2XYZ, lms))
  }
}

export interface BlackbodyLUT {
  readonly data: Float32Array<ArrayBuffer>
  readonly n: number
  readonly Tmin: number
  readonly Tmax: number
}

/**
 * 2-row RGBA32F LUT over [Tmin, Tmax] K: row 0 blackbody, row 1 soot.
 * Values are radiance relative to the luminance of a 1500 K blackbody.
 */
export function blackbodyLUT({ n = 1024, Tmin = 400, Tmax = 3000, Twb = 5000 } = {}): BlackbodyLUT {
  const toRGB = whiteBalance(Twb)
  const ref = blackbodyXYZ(1500)[1]
  const data = new Float32Array(n * 4 * 2)
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      const T = Tmin + ((Tmax - Tmin) * i) / (n - 1)
      const rawXyz = blackbodyXYZ(T, row === 1)
      const xyz: Vec3 = [rawXyz[0] / ref, rawXyz[1] / ref, rawXyz[2] / ref]
      const rgb = toRGB(xyz)
      data.set(
        [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2]), xyz[1]],
        (row * n + i) * 4,
      )
    }
  }
  return { data, n, Tmin, Tmax }
}

// ── Procedural campfire layout ─────────────────────────────────────────────

export interface LogSpec {
  readonly a: Vec3
  readonly b: Vec3
  readonly r: number
  readonly burn: number
}

export interface StoneSpec {
  readonly c: Vec3
  readonly s: Vec3
  readonly rot: number
  readonly kind: number
}

export interface CampfireLayout {
  readonly logs: LogSpec[]
  readonly stones: StoneSpec[]
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function buildCampfire(seed = 7): CampfireLayout {
  const R = rng(seed)
  const logs: LogSpec[] = []
  const add = (a: Vec3, b: Vec3, r: number, burn: number) => logs.push({ a, b, r, burn })

  // Two heavy base logs, lying roughly parallel, slightly crossed.
  add([-0.4, 0.055, -0.17], [0.38, 0.065, -0.13], 0.062, 0.8)
  add([-0.36, 0.06, 0.15], [0.41, 0.05, 0.19], 0.058, 0.8)

  // Teepee of split wood leaning into the centre.
  const n = 5
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.35 + (R() - 0.5) * 0.4
    const rb = 0.3 + R() * 0.06
    const base: Vec3 = [Math.cos(ang) * rb, 0.03, Math.sin(ang) * rb]
    const topR = 0.035 + R() * 0.03
    const ta = ang + Math.PI + (R() - 0.5) * 0.8
    const top: Vec3 = [Math.cos(ta) * topR, 0.36 + R() * 0.1, Math.sin(ta) * topR]
    add(base, top, 0.032 + R() * 0.012, 1.0)
  }

  // A charred chunk lying in the coals.
  add([-0.12, 0.035, 0.02], [0.1, 0.03, -0.05], 0.035, 1.0)

  // Stone ring walked around the circle, leaving a viewing gap.
  const S = rng(seed * 7919 + 13)
  const stones: StoneSpec[] = []
  const ns = 14
  const SHRINK = 0.64
  const raw: { L: number; W: number; H: number; kind: number; seed: number }[] = []
  for (let i = 0; i < ns; i++) {
    const L = 0.095 + S() * 0.05
    const u = S()
    raw.push({
      L,
      W: L * (0.6 + S() * 0.25),
      H: L * (0.55 + S() * 0.25),
      kind: u < 0.4 ? 0 : u < 0.6 ? 1 : u < 0.8 ? 2 : 3,
      seed: S(),
    })
  }
  const ring = 0.64
  const gapC = Math.atan2(-0.05, -0.56)
  const gapW = 0.62
  const avail = Math.PI * 2 - gapW
  const arcs = raw.map((s) => (2 * s.L) / ring)
  const slack = (avail - arcs.reduce((a, b) => a + b, 0)) / ns
  let phi = gapC + gapW / 2
  for (let i = 0; i < ns; i++) {
    const s = raw[i]!
    const arc = arcs[i]!
    const gap = slack * (0.4 + 1.2 * S())
    phi += arc / 2 + (i === 0 ? 0 : gap * 0.5)
    const rr = ring + (S() - 0.5) * 0.05 + (s.W - 0.08) * 0.3
    const rot = -phi - Math.PI / 2 + (S() - 0.5) * 0.3
    const cy = 0.005 + S() * 0.03
    stones.push({
      c: [Math.cos(phi) * rr, cy, Math.sin(phi) * rr],
      s: [s.L / SHRINK, s.H / SHRINK, s.W / SHRINK],
      rot,
      kind: s.kind + s.seed * 0.999,
    })
    phi += arc / 2 + gap * 0.5
  }

  return { logs, stones }
}

export function packLogs(logs: readonly LogSpec[], max = 16): Float32Array<ArrayBuffer> {
  const f = new Float32Array(max * 8)
  logs.slice(0, max).forEach((l, i) => {
    f.set([...l.a, l.r, ...l.b, l.burn], i * 8)
  })
  return f
}

export function packStones(stones: readonly StoneSpec[], max = 16): Float32Array<ArrayBuffer> {
  const f = new Float32Array(max * 8)
  stones.slice(0, max).forEach((s, i) => {
    f.set([...s.c, s.rot, ...s.s, s.kind ?? 0], i * 8)
  })
  return f
}

// ── Camera + sampling + audio trigger ──────────────────────────────────────

export interface CameraBasis {
  readonly pos: Vec3
  readonly target: Vec3
  readonly fwd: [number, number, number]
  readonly right: [number, number, number]
  readonly up: [number, number, number]
  readonly fovY: number
}

function sub3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function norm3(a: Vec3): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export function lookAt(pos: Vec3, target: Vec3, fovYdeg = 40, roll = 0): CameraBasis {
  const fwd = norm3(sub3(target, pos))
  let right = norm3(cross3(fwd, [0, 1, 0]))
  let up = cross3(right, fwd)
  if (roll) {
    const c = Math.cos(roll)
    const s = Math.sin(roll)
    const r2: [number, number, number] = [
      right[0] * c + up[0] * s,
      right[1] * c + up[1] * s,
      right[2] * c + up[2] * s,
    ]
    const u2: [number, number, number] = [
      up[0] * c - right[0] * s,
      up[1] * c - right[1] * s,
      up[2] * c - right[2] * s,
    ]
    right = r2
    up = u2
  }
  return { pos, target, fwd, right, up, fovY: (fovYdeg * Math.PI) / 180 }
}

export function orbit({
  yaw = 0,
  pitch = 0.15,
  dist = 2.4,
  target = [0, 0.45, 0] as Vec3,
  fov = 40,
} = {}): CameraBasis {
  const pos: Vec3 = [
    target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
    target[1] + dist * Math.sin(pitch),
    target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
  ]
  return lookAt(pos, target, fov)
}

export function halton(i: number, base: number): number {
  let f = 1
  let r = 0
  let k = i
  while (k > 0) {
    f /= base
    r += f * (k % base)
    k = Math.floor(k / base)
  }
  return r
}

/**
 * Rising-edge detector on a 0..1 level (the audio-driven `burst` param):
 * returns the level when it jumps by more than `threshold` since the
 * previous frame, else 0.
 */
export class EdgeTrigger {
  private last = 0
  private readonly threshold: number

  constructor(threshold = 0.05) {
    this.threshold = threshold
  }

  step(level: number): number {
    const rise = level - this.last
    this.last = level
    return rise > this.threshold ? level : 0
  }
}
