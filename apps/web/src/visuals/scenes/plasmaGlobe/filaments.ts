// @ts-nocheck -- vendored as-is from the original, which is written for a tsconfig without
// noUncheckedIndexedAccess (hundreds of `arr[i].x` reads). Kept verbatim so it stays diffable against upstream;
// scene.ts uses it through the returned `Plasma` object.
import * as THREE from 'three/webgpu'
// From Adam Chernick's Codevember 2026, day 21 "Bolt" (Plasma), MIT:
// https://github.com/acher249/codevember-2026/tree/main/21-bolt
// Kept as close to the original as possible: only the two shared-engine imports below (a seeded random and the
// quality tier type) are inlined. The rest is the original simulation, unchanged.

export type QualityTier = 'low' | 'medium' | 'high'

// Lehmer's generator, with Park and Miller's constants (from the original's shared/engine/random.ts).
function lehmer(seed: number) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

// The discharge inside the globe, worked out on the processor each frame, as a real globe behaves. Each filament is a
// lasting channel: a thin, gently curving tendril from the electrode to the glass that lives for seconds while its foot
// slides slowly over the inner surface, rising with the hot gas until it dies near the top and another strikes lower
// down. Its trunk is steady; only its last stretch frays into hair-fine branches that fizz and re-form. The filaments
// keep apart from one another. A hand on the glass takes one of them and swings half a dozen of its neighbours over to
// the same point in a few tenths of a second: a loose fan of separate strands, pinched together at both ends, swaying
// round each other, while every other filament in the globe goes thin and dim.

// The globe: glass of radius 1 about the origin, the electrode a ball in its middle.
export const GLASS = 1
export const INNER = 0.972
export const CORE = 0.085

// Up to five fingers on the glass at once, each drawing a bolt and up to six more.
export const CONTACTS = 5
const FOLLOWERS = 6
// A camera fingertip (IRL Hands) pulls more gently than a mouse or a finger on the screen: this share of the followers,
// from nearby only, swung this share of the way over. And all the hands together gather at most HAND_SHARE of the
// filaments, so the rest of the globe keeps writhing.
export const HAND_PULL = 0.55
const HAND_SHARE = 0.38
// How near a camera fingertip a filament must end to be drawn over (the cosine of the angle between them).
const HAND_REACH = 0.35
// Room for the most filaments a stormy globe shows; fewer are lit at calmer settings, and fewer still on a phone.
export const MAX = 56

// How finely each tier draws them: strands in each, points along it, the most filaments, branches at each tip.
// twig and sub: points along each branch and along the smaller branch forking off it, enough that their curves never
// show a corner.
// fork: points along each of a filament's branches; split: how its branches are arranged, each entry the parent of one
// (-1 the trunk, otherwise an earlier branch), so ["-1", "-1", "0"] is two off the trunk and one off the first of those.
const DETAIL: Record<
  QualityTier,
  {
    strands: number
    main: number
    limit: number
    twigs: number
    twig: number
    sub: number
    fork: number
    split: number[]
  }
> = {
  high: {
    strands: 2,
    main: 48,
    limit: 56,
    twigs: 5,
    twig: 18,
    sub: 12,
    fork: 30,
    split: [-1, -1, 0],
  },
  medium: {
    strands: 2,
    main: 42,
    limit: 44,
    twigs: 4,
    twig: 14,
    sub: 10,
    fork: 26,
    split: [-1, 0],
  },
  low: { strands: 1, main: 32, limit: 30, twigs: 3, twig: 10, sub: 7, fork: 18, split: [-1] },
}
// The most branches a filament can carry, on any tier.
export const SPLITS = 3
// How far a branch's foot may be from its parent's, across the glass: about 20° off a trunk, 11° off a branch.
const CAP = 0.35
const CAP_SUB = 0.2
export const limitFor = (tier: QualityTier) => DETAIL[tier].limit

export type Contact = {
  // Where on the glass, as a direction from the middle.
  at: THREE.Vector3
  // 0 to 1: how firmly the hand is there (a resting mouse is a light touch, a press a full one), eased.
  strength: number
  want: number
  // How long it has been pressed, which makes it crackle harder.
  held: number
  // How hot the glass is under it: builds while held, and fades slowly once let go.
  warm: number
  live: boolean
  // The filament that has locked onto it, and the ones it has drawn alongside.
  bolt: number
  // How hard it pulls: 1 for a mouse or a finger on the screen, HAND_PULL for a camera fingertip.
  pull: number
}

type Filament = {
  end: THREE.Vector3
  velocity: THREE.Vector3
  root: THREE.Vector3
  // A fixed direction across, so its undulation keeps its own plane.
  side: THREE.Vector3
  seed: Float32Array
  life: number
  span: number
  // 0 to 1: how far it has come on; it strikes in fast when it forms, and fades when it breaks.
  shown: number
  strike: number
  dying: boolean
  // 0 to 1: how much it is the bolt to a hand, and how much it has swung over to run beside one.
  lock: number
  gather: number
  // How fast gather is changing: it swings over on a spring, overshooting a little and settling.
  swing: number
  // 0 to 1: how far a new strike has grown out from the electrode; it takes about 50 ms to reach the glass.
  grow: number
  // Which hand it last ran beside, and its place in that hand's fan.
  joined: number
  slot: number
  // Its branches: each splits off smoothly from the trunk or from another branch and runs to the glass on its own.
  branches: Branch[]
  // Where its drawn line actually ends on the glass this frame (a strand of a hand's fan ends where the fan takes it).
  tip: THREE.Vector3
}

type Branch = {
  on: boolean
  // Which it splits from (-1 the trunk), how far along that it leaves, and its swing and phase.
  parent: number
  at: number
  curl: number
  phase: number
  life: number
  span: number
  // Seconds before it strikes again, once gone.
  gap: number
  grow: number
  shown: number
  // Where it meets the glass (following its target on a spring, a little behind), and its target as an offset from its
  // parent's foot, in radians across the glass, with how that offset is drifting. The offset is held within a small
  // cap, so a branch stays by its parent wherever the parent goes, a hand's finger included.
  dir: THREE.Vector3
  drift: THREE.Vector3
  offset: THREE.Vector2
  offsetDrift: THREE.Vector2
  splash: number
  touched: number
  // How it ends: 0 fading, 1 drawing back into its parent, 2 snapping off with a flicker; and whether it has begun to.
  death: number
  ending: boolean
  // Its points as drawn this frame, for a branch of its own to split from, and its width where it leaves.
  points: THREE.Vector3[]
  width: number
  // Where along the lavender-to-magenta gradient it starts: its parent's colour at the split.
  tint: number
}

const v = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  u: new THREE.Vector3(),
  w: new THREE.Vector3(),
  p: new THREE.Vector3(),
  q: new THREE.Vector3(),
  t: new THREE.Vector3(),
  r: new THREE.Vector3(),
  fu: new THREE.Vector3(),
  fw: new THREE.Vector3(),
  fc: new THREE.Vector3(),
  kp: new THREE.Vector3(),
  kt: new THREE.Vector3(),
  across: new THREE.Vector3(),
  look: new THREE.Vector3(),
  eye: new THREE.Vector3(),
  b0: new THREE.Vector3(),
  b1: new THREE.Vector3(),
  b2: new THREE.Vector3(),
  b3: new THREE.Vector3(),
  bt: new THREE.Vector3(),
  bp: new THREE.Vector3(),
  fp: new THREE.Vector3(),
  ft: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
}

// A new filament strikes low and middling, never at the top, where they go to die.
function strikeDirection(random: () => number, out: THREE.Vector3) {
  const y = -0.85 + random() * 1.2
  const a = random() * Math.PI * 2
  const r = Math.sqrt(1 - y * y)
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r)
}

// Turn direction d toward direction e by fraction f (both unit), along the great circle.
function slerpTo(d: THREE.Vector3, e: THREE.Vector3, f: number, out: THREE.Vector3) {
  const cos = THREE.MathUtils.clamp(d.dot(e), -1, 1)
  const angle = Math.acos(cos)
  if (angle < 1e-4) return out.copy(d)
  const s = Math.sin(angle)
  const a = Math.sin((1 - f) * angle) / s
  const b = Math.sin(f * angle) / s
  return out.set(d.x * a + e.x * b, d.y * a + e.y * b, d.z * a + e.z * b)
}

// A hash in 0 to 1 from a few numbers, for flicker that is new each frame.
function hash(a: number, b: number, c: number) {
  const h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453
  return h - Math.floor(h)
}

// Two unit vectors square to d and to each other, from a fixed hint.
function frame(d: THREE.Vector3, hint: THREE.Vector3, u: THREE.Vector3, w: THREE.Vector3) {
  u.crossVectors(d, hint)
  if (u.lengthSq() < 1e-5) u.crossVectors(d, v.up)
  u.normalize()
  w.crossVectors(d, u)
}

export function createPlasma(tier: QualityTier) {
  const {
    strands: STRANDS,
    main: MAIN,
    limit: LIMIT,
    twigs: TWIGS,
    twig: TWIG,
    sub: SUB,
    fork: FORK,
    split: SPLIT,
  } = DETAIL[tier]
  // Each filament's strands, its tip brush, then its branches, each with two small branches of its own at its foot.
  const PER = STRANDS * MAIN + TWIGS * (TWIG + SUB) + SPLIT.length * (FORK + 2 * SUB)
  const random = lehmer(2111)
  const filaments: Filament[] = []
  for (let i = 0; i < MAX; i++) {
    // Spread over the whole globe to begin with, evenly, as if it had been running a while.
    const y = 1 - ((i + 0.5) / MAX) * 1.8
    const a = i * 2.39996
    const end = new THREE.Vector3(
      Math.cos(a) * Math.sqrt(1 - y * y),
      y,
      Math.sin(a) * Math.sqrt(1 - y * y),
    )
    filaments.push({
      end,
      velocity: new THREE.Vector3(),
      root: end.clone(),
      side: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      seed: Float32Array.from({ length: 16 }, () => random()),
      life: random() * 8,
      span: 2.5 + random() * 8,
      shown: 1,
      strike: 0,
      dying: false,
      lock: 0,
      gather: 0,
      swing: 0,
      grow: 1,
      joined: -1,
      slot: 0,
      tip: end.clone(),
      branches: SPLIT.map((parent) => ({
        on: false,
        parent,
        at: 0.4,
        curl: 0,
        phase: 0,
        life: 0,
        span: 1,
        gap: random() * 1.5,
        grow: 0,
        shown: 0,
        dir: new THREE.Vector3(0, 1, 0),
        drift: new THREE.Vector3(),
        offset: new THREE.Vector2(),
        offsetDrift: new THREE.Vector2(),
        splash: 0,
        touched: -1,
        death: 0,
        ending: false,
        points: Array.from({ length: FORK }, () => new THREE.Vector3()),
        width: 0,
        tint: 0.5,
      })),
    })
  }
  const contacts: Contact[] = Array.from({ length: CONTACTS }, () => ({
    at: new THREE.Vector3(0, 0, 1),
    strength: 0,
    want: 0,
    held: 0,
    warm: 0,
    live: false,
    bolt: -1,
    pull: 1,
  }))

  // Two vertices a point, either side of the line: each carries the point on the line and its offset across, so the
  // core and the wider halo can share one buffer.
  const POINTS = MAX * PER
  const position = new Float32Array(POINTS * 2 * 3)
  const side = new Float32Array(POINTS * 2 * 3)
  const info = new Float32Array(POINTS * 2 * 4)
  const halo = new Float32Array(POINTS * 2)
  const indices: number[] = []
  const strip = (start: number, count: number) => {
    for (let i = 0; i < count - 1; i++) {
      const a = (start + i) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  for (let f = 0; f < MAX; f++) {
    for (let k = 0; k < STRANDS; k++) strip(f * PER + k * MAIN, MAIN)
    for (let k = 0; k < TWIGS; k++) {
      strip(f * PER + STRANDS * MAIN + k * (TWIG + SUB), TWIG)
      strip(f * PER + STRANDS * MAIN + k * (TWIG + SUB) + TWIG, SUB)
    }
    for (let b = 0; b < SPLIT.length; b++) {
      const at = f * PER + STRANDS * MAIN + TWIGS * (TWIG + SUB) + b * (FORK + 2 * SUB)
      strip(at, FORK)
      strip(at + FORK, SUB)
      strip(at + FORK + SUB, SUB)
    }
  }
  const geometry = new THREE.BufferGeometry()
  const attribute = (array: Float32Array, size: number) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage)
  const attributes = {
    position: attribute(position, 3),
    aSide: attribute(side, 3),
    aInfo: attribute(info, 4),
    aHalo: attribute(halo, 1),
  }
  for (const [name, value] of Object.entries(attributes)) geometry.setAttribute(name, value)
  const attributeList = Object.values(attributes)
  // Only the filaments that may show are sent to the GPU each frame: those below the highest lit one now or last frame
  // (one frame more, so a filament that has just gone is sent once more, blank). Sending all of them was the biggest
  // cost of a frame on the main thread.
  const vertsPer = position.length / 3 / MAX
  let sentUpTo = MAX
  geometry.setIndex(indices)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2)

  // The glass's view: each filament's tip and how bright; then each hand, and how warm the glass is under it.
  // The glass's view: each filament's tip and how bright.
  const tips = Array.from({ length: MAX }, () => new THREE.Vector4())
  // Each branch's splash, lying flat on the glass: where (xyz) and how bright (w).
  const splashes = new Float32Array(MAX * SPLITS * 4)
  const hands = Array.from({ length: CONTACTS }, () => new THREE.Vector4())
  // The electrode's view: where each filament roots on it, and how bright.
  const roots = Array.from({ length: MAX }, () => new THREE.Vector4())
  // Where a strand leaves the ball heading at the eye, its ribbon has nothing to show side-on: a soft round dot there
  // instead, as the end of a glowing tube looks. xyz the point, w how bright.
  const dots = new Float32Array(MAX * 4)

  let seconds = 0
  // The brief surges: seconds to the next, seconds left of this one, and how far one is in, eased.
  let surgeIn = 6
  let surgeFor = 0
  let surging = 0
  let frameCount = 0
  // What the discharge as a whole is doing, for the light it throws and the sound.
  // flicker: the bundle's flicker, for the sound to pulse with; struck: new filaments this frame.
  const totals = {
    glow: 1,
    bolt: 0,
    surge: 0,
    held: 0,
    surging: 0,
    flicker: 1,
    struck: 0,
    forked: 0,
  }

  // Each line's points, and each hand's bolt as its fan sees it.
  const line: THREE.Vector3[] = Array.from({ length: MAIN }, () => new THREE.Vector3())
  const spines: THREE.Vector3[][] = Array.from({ length: CONTACTS }, () =>
    Array.from({ length: MAIN }, () => new THREE.Vector3()),
  )
  const spineReady: boolean[] = Array.from({ length: CONTACTS }, () => false)
  const fans: number[][] = Array.from({ length: CONTACTS }, () => [])

  // Lens settings for this frame: how wide a pixel is at a distance of one, where the focus lies, and how soft.
  let pixel = 0.001
  let focus = 4
  let defocus = 0

  let cursor = 0
  // The last offset across, so a strip turned toward the eye never flips its side over and folds like a ribbon.
  let stripStart = true
  const lastAcross = new THREE.Vector3()
  // glow: how much halo of heated gas it carries.
  const write = (
    p: THREE.Vector3,
    t: THREE.Vector3,
    half: number,
    bright: number,
    along: number,
    heat: number,
    glow: number,
  ) => {
    const distance = Math.max(0.1, p.distanceTo(v.eye))
    // Out of focus a line spreads, keeping its light; and never thinner than a few pixels, dimming instead.
    // The spread is held to a centimetre or two: a lens close in would otherwise smear the far side into a lilac fog.
    // The far side goes softer and warmer than the near: crisp blue in front, blurred magenta behind.
    const far = THREE.MathUtils.smoothstep(distance - focus, 0.2, 1.4)
    const blur = Math.min(defocus * Math.abs(distance - focus), 0.012 + far * 0.01)
    along = along + far * (1 - along) * 0.75
    let wide = Math.sqrt(half * half + blur * blur)
    bright *= Math.pow(half / wide, 1.25)
    const least = distance * pixel * 3.5
    if (wide < least) {
      bright *= wide / least
      wide = least
    }
    v.look.subVectors(p, v.eye)
    const a = v.across.crossVectors(t, v.look)
    const length = a.length()
    // Seen end-on, a ribbon has no good width to turn across, and turns into a hard-edged shard: fade it out instead.
    const sideOn = length / Math.max(1e-9, t.length() * v.look.length())
    bright *= THREE.MathUtils.smoothstep(sideOn, 0.03, 0.14)
    glow *= THREE.MathUtils.smoothstep(sideOn, 0.1, 0.4)
    if (length < 1e-7) a.copy(lastAcross)
    else a.multiplyScalar(1 / length)
    if (!stripStart && a.dot(lastAcross) < 0) a.negate()
    lastAcross.copy(a)
    stripStart = false
    a.multiplyScalar(wide)
    const i = cursor * 2
    position[i * 3] = position[i * 3 + 3] = p.x
    position[i * 3 + 1] = position[i * 3 + 4] = p.y
    position[i * 3 + 2] = position[i * 3 + 5] = p.z
    side[i * 3] = -a.x
    side[i * 3 + 1] = -a.y
    side[i * 3 + 2] = -a.z
    side[i * 3 + 3] = a.x
    side[i * 3 + 4] = a.y
    side[i * 3 + 5] = a.z
    info[i * 4] = -1
    info[i * 4 + 4] = 1
    info[i * 4 + 1] = info[i * 4 + 5] = bright
    info[i * 4 + 2] = info[i * 4 + 6] = along
    info[i * 4 + 3] = info[i * 4 + 7] = heat
    halo[i] = halo[i + 1] = glow
    cursor++
  }
  const blank = (count: number) => {
    const i = cursor * 2
    position.fill(0, i * 3, (i + count * 2) * 3)
    side.fill(0, i * 3, (i + count * 2) * 3)
    info.fill(0, i * 4, (i + count * 2) * 4)
    halo.fill(0, i, i + count * 2)
    cursor += count
  }

  // Where point n sits along a line: closer together near the electrode, where the line bends up out of the ball.
  // A little closer together at the glass end too, so the pinch to a hand stays smooth.
  const along = (n: number) => {
    const u = n / (MAIN - 1)
    return Math.pow(u, 1.35) * 0.65 + u * u * (3 - 2 * u) * 0.35
  }

  // A lazy undulation: two broad sines and a faint third, with the filament's own frequencies and phases, drifting.
  const wave = (s: Float32Array, o: number, x: number, time: number) =>
    Math.sin(x * (2 + s[o] * 1.6) + time * (0.45 + s[o + 1] * 0.5) + s[o + 2] * 6.28) * 0.65 +
    Math.sin(x * (4.4 + s[o + 1] * 2.2) - time * (0.8 + s[o + 2] * 0.6) + s[o] * 6.28) * 0.28 +
    Math.sin(x * (8 + s[o + 2] * 3) + time * (1.6 + s[o]) + s[o + 1] * 6.28) * 0.05

  // A fork, split from the beam as a beam really splits: at the junction it is the beam itself, running along it and on
  // top of it, and it peels away only gradually, the gap opening slowly and then faster (a smootherstep blend from the
  // beam's own path onto a curve of its own to the glass, flat at the junction), so there is never an angle there. It
  // starts at the beam's own width and brightness and tapers; it writhes more than the beam; it grows out behind a
  // bright leading tip.
  function fork(
    parent: THREE.Vector3[],
    parentCount: number,
    at: number,
    to: THREE.Vector3,
    count: number,
    width: number,
    strength: number,
    tint: number,
    grow: number,
    curl: number,
    phase: number,
    keep: THREE.Vector3[],
    heat: number,
  ) {
    const from = parent[at]
    v.ft.subVectors(parent[at + 1], parent[at - 1]).normalize()
    const span = from.distanceTo(v.b3.copy(to).multiplyScalar(INNER))
    v.b0.copy(from)
    v.b1.copy(from).addScaledVector(v.ft, span * 0.45)
    v.b2
      .copy(from)
      .normalize()
      .lerp(to, 0.7)
      .normalize()
      .multiplyScalar(INNER * 0.96)
    v.fp.subVectors(v.b3, v.b0)
    v.fc.crossVectors(v.fp, to).normalize()
    v.b1.addScaledVector(v.fc, curl * span)
    v.b2.addScaledVector(v.fc, curl * span * 0.5)
    v.fw.crossVectors(v.fp, v.fc).normalize()
    stripStart = true
    for (let n = 0; n < count; n++) {
      const x = n / (count - 1)
      const k = 1 - x
      // Its own curve to the glass.
      const p = v.bp
        .copy(v.b0)
        .multiplyScalar(k * k * k)
        .addScaledVector(v.b1, 3 * k * k * x)
        .addScaledVector(v.b2, 3 * k * x * x)
        .addScaledVector(v.b3, x * x * x)
      // The beam's own path from the junction on, at the same fraction of the way.
      const along = at + x * (parentCount - 1 - at) * 0.9
      const lo = Math.floor(along)
      v.r.copy(parent[lo]).lerp(parent[Math.min(parentCount - 1, lo + 1)], along - lo)
      // Peeling away: smootherstep, flat in value, slope and curvature at the junction.
      const u = Math.min(1, x / 0.65)
      const peel = u * u * u * (u * (u * 6 - 15) + 10)
      p.lerp(v.r, 1 - peel)
      // Writhing, more than the beam, travelling outward; none at all until it has begun to peel away.
      const pinned = Math.sin(Math.PI * x) * peel
      p.addScaledVector(
        v.fw,
        pinned * (0.032 * Math.sin(x * 5 - phase) + 0.013 * Math.sin(x * 11 - phase * 1.6)),
      )
      p.addScaledVector(v.fc, pinned * 0.02 * Math.sin(x * 4 - phase * 0.8 + 1.3))
      if (n === 0) v.bt.copy(v.ft)
      else v.bt.subVectors(p, v.q)
      v.q.copy(p)
      keep[n].copy(p)
      // Where its tip branches leave it, near its foot, and which way it is heading there.
      if (n === Math.floor(count * 0.86)) {
        v.kp.copy(p)
        v.kt.copy(v.bt).normalize()
      }
      const reached = grow >= 1 ? 1 : 1 - THREE.MathUtils.smoothstep(x, grow - 0.15, grow)
      const lead = grow < 1 ? 1 + 3 * Math.exp(-(((x - grow) / 0.05) ** 2)) : 1
      // The beam's width and light at the junction, tapering to a finer, dimmer line toward the glass.
      const taper = 1 - 0.45 * THREE.MathUtils.smoothstep(x, 0, 0.6)
      // Its light starts exactly at its parent's (strength is the parent's there) and eases down along it.
      const fade =
        (1 - 0.45 * THREE.MathUtils.smoothstep(x, 0.05, 0.6)) *
        (1 - 0.4 * THREE.MathUtils.smoothstep(x, 0.85, 1))
      write(
        p,
        v.bt,
        width * taper * (1 - 0.5 * THREE.MathUtils.smoothstep(x, 0.9, 1)),
        strength * fade * lead * reached,
        tint + x * (1 - tint),
        heat * (1 - x),
        0.5 * Math.sin(Math.PI * x) * peel * reached,
      )
    }
  }

  // One branch as a cubic curve: from a point heading along a direction, bending over onto the glass, to a point on it
  // in direction `to`, swung a little to one side by `curl`. Tapers to a soft point. With `fork`, keeps where it is
  // halfway along, and which way it heads there, in v.fp and v.ft for a smaller branch to leave from.
  function branch(
    from: THREE.Vector3,
    heading: THREE.Vector3,
    to: THREE.Vector3,
    curl: number,
    count: number,
    width: number,
    strength: number,
    tint: number,
    glow: number,
    fork: boolean,
  ) {
    const span = from.distanceTo(v.b3.copy(to).multiplyScalar(INNER))
    v.b0.copy(from)
    v.b1.copy(from).addScaledVector(heading, span * 0.4)
    v.b2
      .copy(from)
      .normalize()
      .lerp(to, 0.65)
      .normalize()
      .multiplyScalar(INNER * 0.985)
    // The sideways swing, square to both the glass and the way the branch runs.
    v.bp.subVectors(v.b3, v.b0)
    v.across
      .crossVectors(v.bp, to)
      .normalize()
      .multiplyScalar(curl * span)
    v.b1.add(v.across)
    v.b2.addScaledVector(v.across, 0.6)
    stripStart = true
    for (let n = 0; n < count; n++) {
      const x = n / (count - 1)
      const k = 1 - x
      const p = v.bp
        .copy(v.b0)
        .multiplyScalar(k * k * k)
        .addScaledVector(v.b1, 3 * k * k * x)
        .addScaledVector(v.b2, 3 * k * x * x)
        .addScaledVector(v.b3, x * x * x)
      v.bt
        .subVectors(v.b1, v.b0)
        .multiplyScalar(3 * k * k)
        .addScaledVector(v.r.subVectors(v.b2, v.b1), 6 * k * x)
        .addScaledVector(v.q.subVectors(v.b3, v.b2), 3 * x * x)
      if (fork && n === Math.floor(count * 0.45)) {
        v.fp.copy(p)
        v.ft.copy(v.bt).normalize()
      }
      // Bright where it leaves, fading softly to nothing at its point rather than ending in a cut.
      const fade = (1 - 0.55 * x * x) * (1 - THREE.MathUtils.smoothstep(x, 0.7, 1))
      write(
        p,
        v.bt,
        width * (1 - 0.75 * x),
        strength * fade * THREE.MathUtils.smoothstep(x, 0, 0.15),
        tint + x * (1 - tint),
        0,
        glow * Math.sin(Math.PI * x),
      )
    }
  }

  // The order filaments are laid out in: every hand's bolt first, so its fan can follow it.
  const order: number[] = []
  const taken = new Set<number>()

  // storm 0 to 1: how many filaments, how fast they drift, how much they undulate.
  function step(
    dt: number,
    storm: number,
    eye: THREE.Vector3,
    lens: { pixel: number; focus: number; defocus: number },
  ) {
    seconds += dt
    frameCount++
    v.eye.copy(eye)
    pixel = lens.pixel
    focus = lens.focus
    defocus = lens.defocus
    // How many are lit: set by Storm, drifting a little over time, with now and then a brief surge.
    surgeIn -= dt
    if (surgeIn <= 0) {
      surgeIn = 7 + random() * 14
      surgeFor = 1 + random() * 1.2
    }
    surgeFor = Math.max(0, surgeFor - dt)
    surging += ((surgeFor > 0 ? 1 : 0) - surging) * (1 - Math.exp(-dt * (surgeFor > 0 ? 8 : 2)))
    const drift = 0.88 + 0.12 * Math.sin(seconds * 0.11 + 1.3) * Math.sin(seconds * 0.07)
    const count = Math.min(
      LIMIT,
      Math.round(LIMIT * (0.5 + storm * 0.5) * (drift + surging * 0.25)),
    )
    totals.surging = surging
    const speed = 0.35 + storm * 0.7
    const sway = 0.055 + storm * 0.05
    const t = seconds

    // The hands: eased in and out, each one's bolt and fan chosen or kept, and the glass under it warming.
    let pressing = 0
    let held = 0
    taken.clear()
    for (let k = 0; k < CONTACTS; k++) {
      const c = contacts[k]
      c.strength += (c.want - c.strength) * (1 - Math.exp(-dt * (c.want > c.strength ? 16 : 6)))
      if (c.want > 0.8) c.held += dt
      else c.held = Math.max(0, c.held - dt * 3)
      c.warm +=
        c.want > 0.8
          ? (1 - c.warm) * (1 - Math.exp(-dt * 0.9))
          : -c.warm * (1 - Math.exp(-dt * 0.5))
      spineReady[k] = false
      fans[k].length = 0
      if (c.strength < 0.02 && !c.live) {
        c.bolt = -1
        c.held = 0
        continue
      }
      pressing = Math.max(pressing, c.strength)
      held = Math.max(held, c.held)
      if (c.bolt < 0 || c.bolt >= count || taken.has(c.bolt)) {
        let best = -1
        let near = -2
        for (let i = 0; i < count; i++) {
          if (taken.has(i)) continue
          const d = filaments[i].end.dot(c.at)
          if (d > near) {
            near = d
            best = i
          }
        }
        c.bolt = best
      }
      if (c.bolt >= 0) taken.add(c.bolt)
    }
    // Each hand's fan: the nearest of the rest, a light touch drawing fewer.
    for (let k = 0; k < CONTACTS; k++) {
      const c = contacts[k]
      if (c.strength < 0.02 || c.bolt < 0 || c.pull < 1) continue
      const want = Math.round(FOLLOWERS * Math.min(1, c.strength * 1.1))
      for (let n = 0; n < want; n++) {
        let best = -1
        let near = -2
        for (let i = 0; i < count; i++) {
          if (taken.has(i) || filaments[i].shown < 0.5) continue
          // Those that already run beside this hand keep their place.
          const d =
            filaments[i].end.dot(c.at) +
            (filaments[i].joined === k && filaments[i].gather > 0.3 ? 1 : 0)
          if (d > near) {
            near = d
            best = i
          }
        }
        if (best < 0) break
        taken.add(best)
        fans[k].push(best)
      }
    }
    // Camera fingertips, gentler: fewer followers each, only from nearby, taken in turn so each fingertip gets its
    // nearest, and no more in all than HAND_SHARE of the filaments, their own bolts included.
    {
      let budget = Math.round(count * HAND_SHARE)
      let most = 0
      for (let k = 0; k < CONTACTS; k++) {
        const c = contacts[k]
        if (c.pull < 1 && c.bolt >= 0 && c.strength >= 0.02) {
          budget--
          most = Math.max(most, Math.round(FOLLOWERS * HAND_PULL * Math.min(1, c.strength * 1.1)))
        }
      }
      for (let n = 0; n < most && budget > 0; n++) {
        for (let k = 0; k < CONTACTS && budget > 0; k++) {
          const c = contacts[k]
          if (c.pull >= 1 || c.bolt < 0 || c.strength < 0.02) continue
          if (n >= Math.round(FOLLOWERS * HAND_PULL * Math.min(1, c.strength * 1.1))) continue
          let best = -1
          let near = HAND_REACH
          for (let i = 0; i < count; i++) {
            if (taken.has(i) || filaments[i].shown < 0.5) continue
            const d =
              filaments[i].end.dot(c.at) +
              (filaments[i].joined === k && filaments[i].gather > 0.3 ? 1 : 0)
            if (d > near) {
              near = d
              best = i
            }
          }
          if (best < 0) continue
          taken.add(best)
          fans[k].push(best)
          budget--
        }
      }
    }

    order.length = 0
    for (let k = 0; k < CONTACTS; k++)
      if (contacts[k].bolt >= 0 && contacts[k].strength > 0.02) order.push(contacts[k].bolt)
    for (let i = 0; i < MAX; i++) if (order.indexOf(i) < 0) order.push(i)

    totals.glow = 0
    totals.bolt = 0
    totals.struck = 0
    totals.forked = 0
    let bundleFlicker = 0
    let bundleCount = 0
    for (const i of order) {
      const f = filaments[i]
      const s = f.seed
      const on = i < count
      cursor = i * PER

      // Which hand it answers to, as its bolt or as one of its fan.
      let hand = -1
      let bolt = false
      for (let k = 0; k < CONTACTS; k++) {
        if (contacts[k].strength <= 0.02) continue
        if (contacts[k].bolt === i) {
          hand = k
          bolt = true
        } else {
          const at = fans[k].indexOf(i)
          if (at >= 0) {
            hand = k
            f.slot = at
          }
        }
      }
      if (hand >= 0) f.joined = hand
      const c = hand >= 0 ? contacts[hand] : null
      // They swing over in a few tenths of a second, and relax back out over about half a second.
      f.lock += ((bolt && c ? c.strength : 0) - f.lock) * (1 - Math.exp(-dt * 14))
      // On a spring: it swings over to the hand in a couple of tenths of a second, a touch past and back; let go, it
      // relaxes back out over about half a second.
      {
        const target = !bolt && c ? c.strength * (c.pull < 1 ? 0.4 + 0.6 * HAND_PULL : 1) : 0
        const stiff = target > f.gather ? 160 : 45
        const damping = 2 * 0.62 * Math.sqrt(stiff)
        f.swing += ((target - f.gather) * stiff - f.swing * damping) * dt
        f.gather = THREE.MathUtils.clamp(f.gather + f.swing * dt, 0, 1.15)
      }

      // Life: it lives a while, rising, and breaks near the top or when its time is up, unless a hand holds it; then it
      // strikes again lower down.
      f.life += dt * (c ? 0 : 1)
      // Some go at random as well, well before their time: about one in eight each second.
      if (
        !on ||
        (!c &&
          (f.life > f.span ||
            hash(frameCount, i, 11) < dt * 0.12 ||
            (f.end.y > 0.86 && hash(frameCount, i, 7) < dt * 1.2)))
      )
        f.dying = true
      if (f.dying) {
        f.shown = Math.max(0, f.shown - dt * 6)
        if (f.shown === 0 && on) {
          f.dying = false
          f.life = 0
          f.span = 2.5 + random() * 8
          strikeDirection(random, f.end)
          f.root.copy(f.end)
          f.velocity.set(0, 0, 0)
          f.strike = 1
          totals.struck++
          f.grow = 0
        }
      } else {
        f.shown = Math.min(1, f.shown + dt * 14)
      }
      f.strike *= Math.exp(-dt * 9)
      f.grow = Math.min(1, f.grow + dt / 0.05)

      if (f.shown <= 0) {
        blank(PER)
        dots[i * 4 + 3] = 0
        for (let b = 0; b < SPLIT.length; b++) {
          f.branches[b].on = false
          f.branches[b].splash = 0
          splashes[(i * SPLITS + b) * 4 + 3] = 0
        }
        continue
      }

      // The foot slides slowly over the glass: a lazy push of its own, a rise with the hot gas, apart from its neighbours.
      const e = f.end
      const vel = f.velocity
      v.a
        .set(
          wave(s, 0, 0.3, t * 0.3 * speed),
          wave(s, 3, 0.7, t * 0.3 * speed),
          wave(s, 6, 1.1, t * 0.3 * speed),
        )
        .multiplyScalar(0.6 * speed)
      v.a.addScaledVector(v.up, 0.16 * speed)
      for (let j = 0; j < count; j++) {
        if (j === i || filaments[j].shown <= 0) continue
        v.b.subVectors(e, filaments[j].end)
        const d2 = v.b.lengthSq()
        if (d2 > 0.5) continue
        v.a.addScaledVector(v.b, (0.012 * filaments[j].shown * (1 - f.gather)) / (d2 * d2 + 0.002))
      }
      if (c) {
        // The bolt goes straight to the hand; its fan swings over beside it.
        v.b.subVectors(c.at, e)
        const pull = bolt ? 1 : f.gather
        v.a.multiplyScalar(1 - pull * 0.9).addScaledVector(v.b, (bolt ? 60 : 30) * pull)
        vel.multiplyScalar(Math.exp(-dt * 12 * pull))
      }
      vel.addScaledVector(v.a, dt)
      vel.multiplyScalar(Math.exp(-dt * 2.2))
      // A few centimetres a second at most, for a globe of about ten.
      const most = c ? 6 : 0.35 + storm * 0.25
      if (vel.length() > most) vel.setLength(most)
      e.addScaledVector(vel, dt).normalize()
      vel.addScaledVector(e, -vel.dot(e))
      // The root on the electrode trails the foot, a little apart, so the line leaves at a slant and curves; a held one
      // swings round to leave straight toward the hand.
      v.b
        .set(wave(s, 9, 0.2, t * 0.35), wave(s, 12, 0.5, t * 0.35), wave(s, 1, 0.9, t * 0.35))
        .multiplyScalar(0.45 * (1 - f.lock * 0.8))
      v.b.add(e).normalize()
      f.root.lerp(v.b, 1 - Math.exp(-dt * (1.2 + f.lock * 8 + f.gather * 6))).normalize()

      // How it looks: steady, with a fine fast flicker from the drive; a struck filament flashes; a hand's bolt is a
      // little brighter, and everything not taken by a hand goes thin, dim and magenta while one is pressed.
      const steal = c ? 0 : pressing
      const flicker =
        0.93 +
        0.07 * (hash(frameCount, i, 1) * 2 - 1) +
        0.05 * Math.sin(t * (1.7 + s[14]) + s[13] * 40)
      if (c) {
        bundleFlicker += flicker
        bundleCount++
      }
      // A hand's bundle is the brightest, thickest thing in the globe, white-hot through its cores; everything else gives
      // its energy up to it and goes thin and dim.
      const taken = Math.max(f.lock, Math.min(1, f.gather))
      const bright =
        f.shown *
        flicker *
        (1 + f.lock * 0.9 + Math.min(1, f.gather) * 0.8 + f.strike * 1.4) *
        (1 - steal * 0.8)
      const width =
        (0.85 + s[15] * 0.3) * (1 + f.lock * 1.1 + Math.min(1, f.gather) * 1.0) * (1 - steal * 0.45)
      const heat = Math.min(1, taken * 0.45 + f.strike * 0.5)
      totals.glow += bright
      totals.bolt = Math.max(totals.bolt, f.lock)

      frame(e, f.side, v.u, v.w)
      const calm = 1 - f.lock * 0.6 - f.gather * 0.4
      for (let n = 0; n < MAIN; n++) {
        const x = along(n)
        // Out of the ball along its surface's normal, curving over to the foot, and onto the glass nearly square to it.
        slerpTo(f.root, e, x * 0.35 + x * x * (3 - 2 * x) * 0.65, v.d)
        // From just inside the ball, so there is never a gap: the ball itself hides the part within it.
        const r = CORE * 0.8 + (INNER - CORE * 0.8) * x
        const p = line[n].copy(v.d).multiplyScalar(r)
        const envelope = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.02)), 0.8)
        const amount = sway * envelope * calm * (0.5 + r)
        p.addScaledVector(
          v.u,
          wave(s, 2, x * 1.6, t * speed * 0.45) * amount * 1.25,
        ).addScaledVector(v.w, wave(s, 5, x * 1.6, t * speed * 0.42) * amount * 1.25)
        // A writhing at middling length, its strength swelling and fading for each filament in its own time.
        const writhe =
          amount *
          0.45 *
          (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (0.25 + s[9] * 0.3) + s[10] * 20), 2))
        p.addScaledVector(
          v.u,
          Math.sin(x * (7 + s[11] * 4) - t * (1.4 + s[12]) + s[13] * 9) * writhe,
        ).addScaledVector(
          v.w,
          Math.sin(x * (6 + s[12] * 4) + t * (1.2 + s[11]) + s[14] * 9) * writhe,
        )
        // The faint shimmer: a whisper of fine movement over the lazy shape.
        const shimmer = 0.0012 * envelope * Math.sin(x * 23 + t * 11 + s[7] * 30)
        p.addScaledVector(v.w, shimmer)
        // Held by a hand, the bolt writhes like a live channel: travelling waves running out along it, pinned at both ends.
        if (f.lock > 0.01) {
          const pin = Math.sin(Math.PI * x) * f.lock * 0.035
          p.addScaledVector(v.u, Math.sin(x * 5.5 - t * 3.1 + s[2] * 9) * pin).addScaledVector(
            v.w,
            Math.sin(x * 3.4 - t * 2.2 + s[3] * 9) * pin * 0.8,
          )
        }
      }
      // One of a hand's fan: it runs beside the bolt, pinched to it at the electrode and at the glass, fanned apart in
      // between, and swaying slowly round it.
      const k = f.joined
      if (!bolt && k >= 0 && f.gather > 0.002 && spineReady[k]) {
        const spine = spines[k]
        // Spread as a fan across the view, as in a photograph of a touched globe, rather than all round the bolt: wound
        // right round, the strands' projections reversed on themselves and showed as hooks and Z-folds.
        const turn = ((f.slot + 0.5) / FOLLOWERS - 0.5) * 1.8 + (s[4] - 0.5) * 0.3
        // The overshoot of its swing shows as the fan bulging a little wider and swaying, never as the line itself being
        // pushed past the fan, which kinked it.
        const settle = Math.min(1, f.gather)
        const bulge = 1 + Math.max(0, f.gather - 1) * 3
        for (let n = 0; n < MAIN; n++) {
          const x = along(n)
          v.t.subVectors(spine[Math.min(MAIN - 1, n + 1)], spine[Math.max(0, n - 1)]).normalize()
          // A frame carried along the spine without turning about it (parallel transport): one built afresh at each
          // point from a fixed up flips wherever the spine passes near vertical, and kinked the strands there.
          if (n === 0) {
            v.look.subVectors(v.eye, spine[0]).normalize()
            frame(v.t, v.look, v.fu, v.fw)
          } else {
            v.fu.addScaledVector(v.t, -v.fu.dot(v.t)).normalize()
            v.fw.crossVectors(v.t, v.fu)
          }
          // Wound slowly round the bundle's line: less than a third of a turn from end to end, each strand twisting round
          // the others as they sway.
          const angle =
            turn + x * 0.5 + Math.sin(t * (0.6 + s[5] * 0.5) + s[6] * 9) * 0.25 + f.swing * 0.06
          // Widest a little before halfway, then a long, gentle taper into the hand, so the pinch never hooks.
          const spread =
            (0.05 + 0.07 * s[7]) *
            bulge *
            Math.pow(Math.sin(Math.PI * Math.pow(x, 0.75)), 1.3) *
            (1 + 0.1 * Math.sin(t * 1.3 + x * 3 + s[8] * 9))
          v.p
            .copy(spine[n])
            .addScaledVector(v.fu, Math.cos(angle) * spread)
            .addScaledVector(v.fw, Math.sin(angle) * spread)
          // And its own waves on top, low and middling, travelling outward, each strand in its own phase.
          const ripple = Math.sin(Math.PI * x) * 0.022
          const w1 = Math.sin(x * 4.2 - t * (2.4 + s[9]) + s[10] * 12) * ripple
          const w2 = Math.sin(x * 9 - t * (3.6 + s[11]) + s[12] * 12) * ripple * 0.45
          v.p.addScaledVector(v.fu, w1 + w2 * 0.6).addScaledVector(v.fw, (w1 + w2) * 0.7)
          line[n].lerp(v.p, settle)
        }
      }
      if (bolt) {
        spineReady[hand] = true
        for (let n = 0; n < MAIN; n++) spines[hand][n].copy(line[n])
      }

      // The trunk: a thin, near-even line with a white-hot core, and (above Low) a fainter twin strand wound close round
      // it, as the channel's own structure.
      {
        const p = line[3]
        v.t.subVectors(line[4], line[2])
        v.look.subVectors(p, v.eye)
        const sideOn =
          v.across.crossVectors(v.t, v.look).length() /
          Math.max(1e-9, v.t.length() * v.look.length())
        const endOn = 1 - THREE.MathUtils.smoothstep(sideOn, 0.05, 0.3)
        dots.set([p.x, p.y, p.z, bright * endOn * (1 + taken)], i * 4)
      }
      f.tip.copy(line[MAIN - 1]).normalize()
      for (let j = 0; j < STRANDS; j++) {
        const lead = j === 0
        stripStart = true
        for (let n = 0; n < MAIN; n++) {
          const x = along(n)
          v.t.subVectors(line[Math.min(MAIN - 1, n + 1)], line[Math.max(0, n - 1)])
          let p = line[n]
          if (!lead) {
            const twist = s[3] * 6.28 + x * (9 + s[2] * 6) - t * (0.8 + s[1])
            const radius = 0.0035 * Math.sin(Math.PI * x) * (1 + f.lock)
            p = v.r
              .copy(line[n])
              .addScaledVector(v.u, Math.cos(twist) * radius)
              .addScaledVector(v.w, Math.sin(twist) * radius)
          }
          // Its foot: the strand itself flares where it leaves the ball, to three times its width at the surface and back
          // within a fifth of the ball's radius, concave like a meniscus and hot white there. Being the strand's own
          // ribbon, it is on the strand's line and soft-edged from every side.
          const rise = Math.max(0, line[n].length() - CORE)
          const foot = Math.exp(-rise / 0.009)
          // Tapering into its splash at the glass, never ending in a flat cut.
          const half =
            0.0085 *
            width *
            (lead ? 1 : 0.5) *
            (1.1 - 0.2 * x) *
            (1 + 2 * foot) *
            (1 - 0.55 * THREE.MathUtils.smoothstep(x, 0.9, 1))
          // Even along the trunk, brighter at its foot, and fading into the splash rather than ending in a blob.
          const glow =
            bright *
            (lead ? 1 : 0.35) *
            (0.85 + 0.35 * Math.exp(-x * 20)) *
            (1 + 0.6 * Math.exp(-x * 11) + 1.2 * foot) *
            (1 - 0.6 * THREE.MathUtils.smoothstep(x, 0.88, 1))
          // Toward magenta along its outer third; drained of energy, magenta all along.
          const toward = x + (1 - x) * steal * 0.75
          // A new strike grows out from the electrode, its front soft.
          const reached = f.grow >= 1 ? 1 : 1 - THREE.MathUtils.smoothstep(x, f.grow - 0.12, f.grow)
          write(
            p,
            v.t,
            half,
            glow * reached,
            toward,
            Math.max(heat, Math.exp(-x * 10) * 0.5, foot),
            lead
              ? (1 - steal * 0.5) *
                  (1 - taken * 0.7) *
                  THREE.MathUtils.smoothstep(x, 0.04, 0.25) *
                  (1 - THREE.MathUtils.smoothstep(x, 0.8, 1))
              : 0,
          )
        }
      }

      // Branches: only over the last stretch, fine as hairs. Each is a smooth cubic curve that leaves the trunk along its
      // own direction and bends over to run along the inside of the glass, tapering to a soft point, and forks once the
      // same way; together they fan out over the glass like a feathery brush. They fizz, re-forming many times a second,
      // while the trunk holds steady. Fewer on a hand's bolt and its fan.
      const fray =
        (1 - f.lock * 0.75) *
        (1 - Math.min(1, f.gather) * 0.6) *
        f.shown *
        (1 - steal * 0.4) *
        THREE.MathUtils.smoothstep(f.grow, 0.85, 1)
      const hop = Math.floor(t * 20)
      for (let m = 0; m < TWIGS; m++) {
        const o = (m * 3) % 13
        // From the last fifth or so of the trunk (points are spaced closer toward the root, so the index runs ahead).
        const at = Math.floor((MAIN - 1) * (0.83 + s[o] * 0.09))
        const angle =
          s[(m * 5) % 16] * 6.28 +
          Math.sin(t * (0.5 + s[o + 1]) + m) * 0.6 +
          (hash(hop, i, m) - 0.5) * 0.35
        const reach = (0.035 + 0.075 * s[(m * 7) % 16]) * (0.8 + 0.4 * hash(hop, i, m + 20))
        v.c
          .copy(e)
          .addScaledVector(v.u, Math.cos(angle) * reach)
          .addScaledVector(v.w, Math.sin(angle) * reach)
          .normalize()
        const strength = fray * (0.3 + 0.3 * s[(m * 11) % 16]) * (0.35 + 0.65 * hash(hop, i, m + 9))
        const curl = (s[(m * 9) % 16] - 0.5) * 0.5 + Math.sin(t * (0.8 + s[o]) + m * 1.7) * 0.15
        branch(
          line[at],
          v.t.subVectors(line[Math.min(MAIN - 1, at + 1)], line[at - 1]).normalize(),
          v.c,
          curl,
          TWIG,
          0.0042,
          strength,
          0.8,
          0.35,
          true,
        )
        // The fork: from partway along the branch to a point further round.
        const turn = angle + (s[(m * 13) % 16] - 0.5) * 2.4
        v.c
          .addScaledVector(v.u, Math.cos(turn) * reach * 0.55)
          .addScaledVector(v.w, Math.sin(turn) * reach * 0.55)
          .normalize()
        branch(v.fp, v.ft, v.c, -curl, SUB, 0.0032, strength * 0.7, 0.9, 0.2, false)
      }

      // Its branches: each splits off the trunk (or off another branch) as a smooth Y, the child running along its
      // parent and peeling away, and runs on to a foot of its own on the glass, its splash and fine brush with it. They
      // last a few seconds, wander, writhe, and end (fading, drawing back, or snapping off), striking again elsewhere
      // a moment later: a lacy, shifting tree on every filament.
      for (let b = 0; b < SPLIT.length; b++) {
        const br = f.branches[b]
        const up = br.parent < 0 ? null : f.branches[br.parent]
        const parentPts = up ? up.points : line
        const parentCount = up ? FORK : MAIN
        const parentReady = up ? up.on && !up.ending && up.grow >= 1 : true
        const parentFoot = up ? up.dir : e
        if (!br.on) {
          br.gap -= dt
          // On a hand's bundle, only one short branch a strand, so the cluster at the finger stays clean.
          if (br.gap <= 0 && parentReady && f.grow >= 1 && !f.dying && !(taken > 0.5 && b > 0)) {
            br.on = true
            // Late along its parent, and not far from it: the tree is a trunk fraying toward its end.
            br.at = up ? 0.4 + random() * 0.3 : 0.45 + random() * 0.3
            const turn = random() * Math.PI * 2
            const cap = up ? CAP_SUB : CAP
            const reach = cap * (0.45 + random() * 0.55)
            br.offset.set(Math.cos(turn) * reach, Math.sin(turn) * reach)
            br.offsetDrift.set(0, 0)
            frame(parentFoot, f.side, v.fu, v.fw)
            br.dir
              .copy(parentFoot)
              .addScaledVector(v.fu, br.offset.x)
              .addScaledVector(v.fw, br.offset.y)
              .normalize()
            br.drift.set(0, 0, 0)
            br.curl = (random() - 0.5) * 0.6
            br.life = 0
            br.span = taken > 0.5 ? 1 + random() * 3 : 3 + random() * 6
            br.grow = 0
            br.shown = 1
            br.splash = 0
            br.touched = -1
            br.death = Math.floor(random() * 3)
            br.ending = false
            br.phase = random() * 20
            if (taken > 0.5) totals.forked++
          }
        }
        if (br.on) {
          br.life += dt
          if (
            !br.ending &&
            (br.life > br.span || f.dying || !parentReady || (taken > 0.5 && b > 0))
          )
            br.ending = true
          if (!br.ending) {
            br.grow = Math.min(1, br.grow + dt / 0.065)
            if (br.grow >= 1 && br.touched < 0) br.touched = 0
          } else if (br.death === 1) {
            br.grow = Math.max(0, br.grow - dt / 0.16)
            if (br.grow === 0) br.shown = 0
          } else if (br.death === 2) {
            br.shown = Math.max(0, br.shown - dt / 0.12)
          } else {
            br.shown = Math.max(0, br.shown - dt * 4)
          }
          if (br.touched >= 0) br.touched += dt
          const landed = !br.ending && br.grow >= 1 ? 1 : 0
          br.splash += (landed - br.splash) * (1 - Math.exp(-dt * (landed ? 30 : 7)))
          // The foot's place is its parent's foot plus an offset, which wanders within a small cap round it; the foot
          // follows that place on a spring, a little behind, so it is carried along when the parent moves (a hand's
          // finger, a drag) and never left on the far side.
          const hop = Math.floor(br.life * 1.5)
          const cap = (up ? CAP_SUB : CAP) * (taken > 0.5 ? 0.6 : 1)
          const push = (taken > 0.5 ? 0.9 : 0.4) * cap
          br.offsetDrift.x += (hash(hop, i * 4 + b, 51) - 0.5) * push * dt * 4
          br.offsetDrift.y += (hash(hop, i * 4 + b, 52) - 0.5) * push * dt * 4
          br.offsetDrift.multiplyScalar(Math.exp(-dt * 1.2))
          br.offset.addScaledVector(br.offsetDrift, dt)
          const reach = br.offset.length()
          if (reach > cap) {
            br.offset.multiplyScalar(cap / reach)
            br.offsetDrift.multiplyScalar(-0.3)
          } else if (reach < cap * 0.35)
            br.offset.multiplyScalar((cap * 0.35) / Math.max(reach, 1e-4))
          frame(parentFoot, f.side, v.fu, v.fw)
          v.a
            .copy(parentFoot)
            .addScaledVector(v.fu, br.offset.x)
            .addScaledVector(v.fw, br.offset.y)
            .normalize()
          // A stiff, slightly underdamped spring toward that place.
          v.b.subVectors(v.a, br.dir)
          br.drift.addScaledVector(v.b, dt * 140).multiplyScalar(Math.exp(-dt * 16))
          br.dir.addScaledVector(br.drift, dt).normalize()
          br.drift.addScaledVector(br.dir, -br.drift.dot(br.dir))
          br.at = THREE.MathUtils.clamp(
            br.at + Math.sin(br.life * 0.9 + br.phase) * dt * 0.03,
            0.35,
            0.8,
          )
          if (br.shown <= 0 && br.splash < 0.02) {
            br.on = false
            br.gap = 0.3 + random() * 2.2
          }
        }
        const slot = (i * SPLITS + b) * 4
        if (br.on && parentReady !== false) {
          const ai = Math.max(
            1,
            Math.min(
              parentCount - 3,
              Math.round((up ? br.at : Math.pow(br.at, 0.8)) * (parentCount - 1)),
            ),
          )
          v.c.copy(br.dir)
          const snapping =
            br.ending && br.death === 2 ? (hash(frameCount, i * 4 + b, 61) > 0.5 ? 1 : 0.15) : 1
          const generation = up ? 2 : 1
          // At the split it is its parent there: the same width, light and colour, which it carries on from, so the
          // split never shows as a jump.
          const xj = up ? ai / (FORK - 1) : along(ai)
          if (up) {
            br.width = up.width * (1 - 0.45 * xj)
            br.tint = up.tint + xj * (1 - up.tint)
          } else {
            br.width = 0.0085 * width * (1.1 - 0.2 * xj + 2.4 * Math.exp(-xj * 11))
            br.tint = xj + (1 - xj) * steal * 0.75
          }
          const parentLight = up
            ? 0.85 * (1 - 0.45 * THREE.MathUtils.smoothstep(xj, 0.05, 0.6))
            : (0.85 + 0.35 * Math.exp(-xj * 20)) * (1 + 0.8 * Math.exp(-xj * 11))
          const strength = bright * parentLight * br.shown * snapping
          fork(
            parentPts,
            parentCount,
            ai,
            v.c,
            FORK,
            br.width,
            strength,
            br.tint,
            br.grow,
            br.curl,
            t * (taken > 0.5 ? 3.4 : 1.6) + br.phase,
            br.points,
            Math.min(1, taken * 0.45),
          )
          const flare = br.touched >= 0 ? 1 + 1.4 * Math.exp(-br.touched * 10) : 1
          splashes[slot] = v.c.x
          splashes[slot + 1] = v.c.y
          splashes[slot + 2] = v.c.z
          splashes[slot + 3] =
            br.splash *
            flare *
            (0.55 + 0.45 * hash(frameCount, i * 4 + b, 41)) *
            (1 - steal * 0.7) *
            (generation === 1 ? 1 : 0.7)
          // Two fine branches at its foot, fizzing, fanning out flat over the glass ahead of it.
          const fizz =
            br.grow >= 1 && !br.ending
              ? strength * 0.55 * (0.4 + 0.6 * hash(Math.floor(t * 20), i * 4 + b, 71))
              : 0
          v.fu.copy(v.kt).addScaledVector(v.c, -v.kt.dot(v.c))
          if (v.fu.lengthSq() < 1e-6) frame(v.c, v.up, v.fu, v.fw)
          v.fu.normalize()
          v.fw.crossVectors(v.c, v.fu)
          for (let m = 0; m < 2; m++) {
            const ang =
              (m === 0 ? 1 : -1) * (0.35 + 0.3 * s[(m + 3 + b) % 16]) +
              Math.sin(t * 2 + m + br.phase) * 0.12
            const reach = 0.04 + 0.03 * s[(m + 7 + b) % 16]
            v.b
              .copy(v.c)
              .addScaledVector(v.fu, Math.cos(ang) * reach)
              .addScaledVector(v.fw, Math.sin(ang) * reach)
              .normalize()
            branch(v.kp, v.kt, v.b, 0, SUB, 0.0026, fizz, 0.85, 0.15, false)
          }
        } else {
          splashes[slot + 3] = 0
          blank(FORK + 2 * SUB)
        }
      }
    }
    let upTo = 0
    for (let i = MAX - 1; i >= 0; i--) {
      if (filaments[i].shown > 0 || i < count) {
        upTo = i + 1
        break
      }
    }
    const send = Math.max(upTo, sentUpTo)
    sentUpTo = upTo
    for (const value of attributeList) {
      value.clearUpdateRanges()
      value.addUpdateRange(0, send * vertsPer * value.itemSize)
      value.needsUpdate = true
    }

    // The glass: each filament's tip, flickering harder than its trunk, and each hand.
    for (let i = 0; i < MAX; i++) {
      const f = filaments[i]
      const steal = f.lock > 0.1 || f.gather > 0.1 ? 0 : pressing
      // Every end keeps its glow, at the point the line really ends: only right at a hand, where the hand's own flare
      // takes over, does it give way.
      let covered = 0
      for (const c of contacts)
        if (c.strength > 0.02)
          covered = Math.max(
            covered,
            c.strength * (1 - THREE.MathUtils.smoothstep(f.tip.angleTo(c.at), 0.03, 0.09)),
          )
      const b =
        f.shown <= 0 || f.grow < 0.9
          ? 0
          : f.shown *
            (0.75 + f.strike * 1.5) *
            (0.7 + 0.6 * hash(frameCount, i, 3)) *
            (1 - steal * 0.7) *
            (1 - 0.85 * covered)
      tips[i].set(f.tip.x, f.tip.y, f.tip.z, b)
      roots[i].set(
        f.root.x,
        f.root.y,
        f.root.z,
        f.shown <= 0
          ? 0
          : f.shown *
              (1 + f.lock * 0.8) *
              (1 - (f.lock > 0.1 || f.gather > 0.1 ? 0 : pressing) * 0.5),
      )
    }
    for (let k = 0; k < CONTACTS; k++) {
      const c = contacts[k]
      hands[k].set(c.at.x, c.at.y, c.at.z, c.warm * 0.5 + c.strength * 0.6)
    }
    totals.surge = pressing
    totals.flicker = bundleCount > 0 ? bundleFlicker / bundleCount : 1
    totals.held = held
    totals.glow /= Math.max(1, count)
  }

  return {
    geometry,
    contacts,
    filaments,
    tips,
    hands,
    roots,
    dots,
    splashes,
    step,
    totals,
    limit: LIMIT,
  }
}

export type Plasma = ReturnType<typeof createPlasma>
