/**
 * Procedural geometry for Digital Core - a direct port of the original's
 * buildRoom / buildCore / buildLines / buildParticles / buildHaze. Pure data:
 * returns instanced geometries plus the 12 core edges the CPU edge lights
 * follow. Same seeds and RNG as the original, so a seed gives the same layout.
 */
import * as THREE from 'three/webgpu'

export interface GeometryParams {
  seed: number
  coreDensity: number
  roomDepth: number
  blockDetail: number
  lineCount: number
  particleCount: number
}

export interface CoreEdge {
  a: THREE.Vector3
  b: THREE.Vector3
  rate: number
  phase: number
  blocks: { slot: number; bright: number }[]
}

interface Box {
  c: number[]
  s: number[]
  p: number[]
  m?: number[]
}

export const ROOM_HALF = 8.5
const ROOM_CLEAR = 6.2
const CELL = 0.25
const STATIC_MOTION = [-1, 0, 0, 0]

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeBoxGeometry(boxes: Box[], base: THREE.BoxGeometry) {
  const n = boxes.length
  const center = new Float32Array(n * 3)
  const size = new Float32Array(n * 3)
  const prm = new Float32Array(n * 4)
  const motion = new Float32Array(n * 4)
  boxes.forEach((b, i) => {
    center.set(b.c, i * 3)
    size.set(b.s, i * 3)
    prm.set(b.p, i * 4)
    motion.set(b.m ?? STATIC_MOTION, i * 4)
  })
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  g.setAttribute('normal', base.getAttribute('normal'))
  g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3))
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3))
  g.setAttribute('aParams', new THREE.InstancedBufferAttribute(prm, 4))
  g.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4))
  g.instanceCount = n
  return g
}

function roomMaxHeight(p: GeometryParams) {
  return Math.min(2.2 * p.roomDepth, ROOM_HALF - ROOM_CLEAR)
}

/** Six inner walls of stepped blocks (quadtree slabs of varying height). */
export function buildRoom(p: GeometryParams, base: THREE.BoxGeometry) {
  const rand = mulberry32(p.seed * 9973 + 1)
  const H = ROOM_HALF
  const maxH = roomMaxHeight(p)
  const detail = p.blockDetail
  const boxes: Box[] = []
  for (let axis = 0; axis < 3; axis++) {
    const a1 = (axis + 1) % 3
    const a2 = (axis + 2) % 3
    for (const sign of [-1, 1]) {
      const leaves: number[][] = []
      const split = (u: number, v: number, su: number, sv: number, level: number): void => {
        const pr = [0.9, 0.62 * detail, 0.42 * detail, 0.22 * detail][level] ?? 0
        if (rand() < pr && Math.min(su, sv) > 0.6) {
          if (level >= 3 || rand() < 0.2) {
            if (su >= sv) {
              split(u, v, su / 2, sv, 4)
              split(u + su / 2, v, su / 2, sv, 4)
            } else {
              split(u, v, su, sv / 2, 4)
              split(u, v + sv / 2, su, sv / 2, 4)
            }
          } else {
            const hu = su / 2
            const hv = sv / 2
            split(u, v, hu, hv, level + 1)
            split(u + hu, v, hu, hv, level + 1)
            split(u, v + hv, hu, hv, level + 1)
            split(u + hu, v + hv, hu, hv, level + 1)
          }
        } else {
          leaves.push([u, v, su, sv])
        }
      }
      const tile = (2 * H) / 4
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) split(-H + i * tile, -H + j * tile, tile, tile, 0)

      for (const [u, v, su, sv] of leaves as [number, number, number, number][]) {
        const h = Math.round((0.2 + maxH * Math.pow(rand(), 1.6)) / 0.125) * 0.125
        const inner = H - h
        const outer = H + 0.6
        const c = [0, 0, 0]
        const s = [0, 0, 0]
        c[axis] = sign * (inner + outer) * 0.5
        s[axis] = outer - inner
        const gap = 0.035
        c[a1] = u + su * 0.5
        s[a1] = su - gap
        c[a2] = v + sv * 0.5
        s[a2] = sv - gap
        const r = rand()
        const bright =
          r < 0.45 ? 0.03 + 0.1 * rand() : r < 0.85 ? 0.4 + 0.45 * rand() : 1.0 + 0.7 * rand()
        boxes.push({ c, s, p: [rand() * 100, 0, bright, 0] })
      }
    }
  }
  return makeBoxGeometry(boxes, base)
}

/** Dark centre cube, orange glow cells on the cube edges, glass shell, panels and beams. */
export function buildCore(p: GeometryParams, base: THREE.BoxGeometry) {
  const rand = mulberry32(p.seed * 7919 + 2)
  const density = p.coreDensity
  const glow: Box[] = []
  const dark: Box[] = []
  dark.push({ c: [0, 0, 0], s: [1.42, 1.42, 1.42], p: [rand() * 100, 1, 1, 0] })

  const G = 0.5
  const edges: CoreEdge[] = []
  for (let axis = 0; axis < 3; axis++) {
    const a1 = (axis + 1) % 3
    const a2 = (axis + 2) % 3
    for (const s1 of [-1, 1])
      for (const s2 of [-1, 1]) {
        const rate = (0.22 + 0.2 * rand()) * (rand() < 0.5 ? -1 : 1)
        const phase = rand() * 10
        const ea = [0, 0, 0]
        ea[a1] = s1
        ea[a2] = s2
        ea[axis] = -1
        const eb = ea.slice()
        eb[axis] = 1
        const edge: CoreEdge = {
          a: new THREE.Vector3(ea[0], ea[1], ea[2]),
          b: new THREE.Vector3(eb[0], eb[1], eb[2]),
          rate,
          phase,
          blocks: [],
        }
        edges.push(edge)
        for (let slot = 0; slot < 4; slot++) {
          if (rand() >= 0.62 * Math.min(1.5, density)) continue
          const c = [0, 0, 0]
          c[a1] = s1
          c[a2] = s2
          const s = [0, 0, 0]
          for (let a = 0; a < 3; a++) s[a] = G * (0.72 + 0.16 * rand())
          if (rand() < 0.25) s[axis] = G * 0.92
          const seed = rand() * 100
          const bright = 0.5 + 0.95 * Math.pow(rand(), 1.4)
          const m = [axis, -0.75 + slot * G, phase, rate]
          edge.blocks.push({ slot: m[1]!, bright })
          dark.push({ c, s, p: [seed, 2, bright, 0], m })
          glow.push({ c, s: s.map((v) => v + 0.1), p: [seed, 1, bright, 0], m })
        }
      }
  }

  for (let i = -7; i <= 7; i++)
    for (let j = -7; j <= 7; j++)
      for (let k = -7; k <= 7; k++) {
        const x = i * CELL
        const y = j * CELL
        const z = k * CELL
        const ax = Math.abs(x)
        const ay = Math.abs(y)
        const az = Math.abs(z)
        const r = Math.max(ax, ay, az)
        if (r < 1.25) continue
        const onShell = Number(ax === r) + Number(ay === r) + Number(az === r)
        const roll = rand()
        const b = r === 1.25 ? 0.26 : r === 1.5 ? 0.13 : 0.06
        const pGlass = (b + (onShell >= 2 ? 0.2 : 0)) * density
        if (roll < pGlass) {
          const sc = CELL * 0.94
          glow.push({ c: [x, y, z], s: [sc, sc, sc], p: [rand() * 100, 0, 0.55 + 0.6 * rand(), 0] })
        }
      }

  const panelCount = Math.round(34 * density)
  for (let n = 0; n < panelCount; n++) {
    const axis = Math.floor(rand() * 3)
    const sign = rand() < 0.5 ? -1 : 1
    const shell = [1.25, 1.5, 1.75, 2.0][Math.floor(rand() * 4)]!
    const c = [0, 0, 0]
    const s = [0, 0, 0]
    c[axis] = sign * shell
    s[axis] = CELL * 0.94
    for (const a of [(axis + 1) % 3, (axis + 2) % 3]) {
      const cells = 2 + Math.floor(rand() * 5)
      const start = Math.floor(rand() * (17 - cells)) - 8
      c[a] = (start + (cells - 1) * 0.5) * CELL
      s[a] = cells * CELL - CELL * 0.06
    }
    glow.push({ c, s, p: [rand() * 100, 0, 0.45 + 0.5 * rand(), 0] })
  }

  const beamCount = Math.round(22 * density)
  for (let n = 0; n < beamCount; n++) {
    const axis = Math.floor(rand() * 3)
    const c = [0, 0, 0]
    const s = [0, 0, 0]
    const len = CELL * (2 + Math.floor(rand() * 6))
    for (let a = 0; a < 3; a++) {
      if (a === axis) {
        c[a] = (rand() - 0.5) * 2.4
        s[a] = len
      } else {
        c[a] = (Math.floor(rand() * 16) - 8) * CELL + CELL * 0.5
        s[a] = 0.012 + 0.018 * rand()
      }
    }
    const perp = [0, 1, 2].filter((a) => a !== axis) as [number, number]
    if (Math.abs(c[perp[0]]!) < 0.9 && Math.abs(c[perp[1]]!) < 0.9)
      c[perp[0]] = Math.sign(c[perp[0]]! || 1) * 1.125
    glow.push({ c, s, p: [rand() * 100, 2, 0.5 + 0.8 * rand(), 0] })
  }

  return { dark: makeBoxGeometry(dark, base), glow: makeBoxGeometry(glow, base), edges }
}

/** Thin axis-aligned light lines on the core lattice and along the room walls. */
export function buildLines(p: GeometryParams) {
  const rand = mulberry32(p.seed * 6151 + 3)
  const n = Math.max(0, Math.round(p.lineCount))
  const start = new Float32Array(n * 3)
  const dirLen = new Float32Array(n * 4)
  const lp = new Float32Array(n * 4)
  const H = ROOM_HALF
  const maxH = roomMaxHeight(p)
  for (let i = 0; i < n; i++) {
    const axis = Math.floor(rand() * 3)
    const pt = [0, 0, 0]
    let len: number
    let colorMix = 0
    if (rand() < 0.62) {
      len = CELL * (1 + Math.floor(rand() * 4))
      for (let a = 0; a < 3; a++) pt[a] = (Math.floor(rand() * 16) - 8) * CELL + CELL * 0.5
      pt[axis] = (Math.floor(rand() * 15) - 7) * CELL - len * 0.5
      const perp = [0, 1, 2].filter((a) => a !== axis) as [number, number]
      const rr = Math.max(Math.abs(pt[perp[0]]!), Math.abs(pt[perp[1]]!))
      if (rr < 0.9) pt[perp[0]] = Math.sign(pt[perp[0]]! || 1) * 1.125
      if (rr < 1.3 && rand() < 0.3) colorMix = 1
    } else {
      const wall = (axis + 1 + Math.floor(rand() * 2)) % 3
      const sign = rand() < 0.5 ? -1 : 1
      len = 1 + rand() * 5
      for (let a = 0; a < 3; a++) pt[a] = (rand() * 2 - 1) * (H - 1)
      pt[wall] = sign * (H - 0.2 - rand() * maxH)
      pt[axis] = pt[axis]! - len * 0.5
    }
    start.set(pt, i * 3)
    const d = [0, 0, 0]
    d[axis] = 1
    dirLen.set([d[0]!, d[1]!, d[2]!, len], i * 4)
    const speed = rand() < 0.45 ? 0.12 + rand() * 0.45 : 0
    lp.set([0.35 + rand() * 0.9, speed, rand(), colorMix], i * 4)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3),
  )
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3))
  g.setAttribute('aDirLen', new THREE.InstancedBufferAttribute(dirLen, 4))
  g.setAttribute('aParams', new THREE.InstancedBufferAttribute(lp, 4))
  g.instanceCount = n
  return g
}

/**
 * Floating square sparks. WebGPU has no point size, so each spark is an
 * instanced quad (corners -0.5..0.5) sized in screen pixels by the shader.
 */
export function buildParticles(p: GeometryParams) {
  const rand = mulberry32(p.seed * 4999 + 4)
  const n = Math.max(0, Math.round(p.particleCount))
  const pos = new Float32Array(n * 3)
  const prm = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    let x: number
    let y: number
    let z: number
    let size: number
    let colorMix = 0
    let bright: number
    if (rand() < 0.55) {
      do {
        x = (rand() * 2 - 1) * 2.0
        y = (rand() * 2 - 1) * 2.0
        z = (rand() * 2 - 1) * 2.0
      } while (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 0.65)
      const r = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
      if (r < 1.1 && rand() < 0.35) colorMix = 1
      size = 1.0 + rand() * 1.6
      bright = 0.7 + rand() * 1.6
    } else {
      do {
        x = (rand() * 2 - 1) * 8.5
        y = (rand() * 2 - 1) * 8.5
        z = (rand() * 2 - 1) * 8.5
      } while (Math.hypot(x, y, z) < 2.2)
      size = 1.4 + rand() * 2.4
      bright = 0.15 + rand() * 0.6
    }
    pos.set([x, y, z], i * 3)
    prm.set([size, rand(), colorMix, bright], i * 4)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  )
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
  g.setAttribute('aParams', new THREE.InstancedBufferAttribute(prm, 4))
  g.instanceCount = n
  return g
}

/** Haze puffs: blue clouds around the core, warm glow in the centre. */
export function buildHaze(p: GeometryParams) {
  const rand = mulberry32(p.seed * 3301 + 5)
  const puffs: { c: number[]; p: number[] }[] = []
  puffs.push({ c: [0, 0, 0], p: [7.5, rand(), 2, 0.18] })
  for (let i = 0; i < 6; i++) {
    const t = rand() * Math.PI * 2
    const u = rand() * 2 - 1
    const r = 1.2 + rand() * 1.4
    const sq = Math.sqrt(1 - u * u)
    puffs.push({
      c: [Math.cos(t) * sq * r, u * r, Math.sin(t) * sq * r],
      p: [3.5 + rand() * 2.5, rand(), 0, 0.1 + rand() * 0.1],
    })
  }
  puffs.push({ c: [0, 0, 0], p: [3.8, rand(), 3, 0.35] })
  for (let i = 0; i < 3; i++) {
    puffs.push({
      c: [(rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8],
      p: [2.0 + rand() * 0.8, rand(), 1, 0.2],
    })
  }
  const n = puffs.length
  const center = new Float32Array(n * 3)
  const prm = new Float32Array(n * 4)
  puffs.forEach((q, i) => {
    center.set(q.c, i * 3)
    prm.set(q.p, i * 4)
  })
  const plane = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = plane.index
  g.setAttribute('position', plane.getAttribute('position'))
  g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3))
  g.setAttribute('aParams', new THREE.InstancedBufferAttribute(prm, 4))
  g.instanceCount = n
  return g
}
