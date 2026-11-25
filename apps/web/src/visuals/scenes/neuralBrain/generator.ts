// @ts-nocheck
/* eslint-disable */
// Vendored unchanged from "Neural Brain" by sabosugi (CodePen) apart from the
// `export` on generateBrain and the types below; the pen ran it from an inline
// <script> in a worker. Kept as written (loose JS) so it stays diffable against
// the original, hence the nocheck. See ./definition.ts for credit.
// ---------------------------------------------------------------------------
// Procedural brain generator (CPU, runs once / on regenerate)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createSimplex3(rand) {
  const grad = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1,
    1, 0, 1, -1, 0, -1, -1,
  ])
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  const perm = new Uint8Array(512)
  const permMod12 = new Uint8Array(512)
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]
    permMod12[i] = perm[i] % 12
  }
  const F3 = 1 / 3,
    G3 = 1 / 6

  return function noise(xin, yin, zin) {
    let n0, n1, n2, n3
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s),
      j = Math.floor(yin + s),
      k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t),
      y0 = yin - (j - t),
      z0 = zin - (k - t)
    let i1, j1, k1, i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1
        j1 = 0
        k1 = 0
        i2 = 1
        j2 = 1
        k2 = 0
      } else if (x0 >= z0) {
        i1 = 1
        j1 = 0
        k1 = 0
        i2 = 1
        j2 = 0
        k2 = 1
      } else {
        i1 = 0
        j1 = 0
        k1 = 1
        i2 = 1
        j2 = 0
        k2 = 1
      }
    } else {
      if (y0 < z0) {
        i1 = 0
        j1 = 0
        k1 = 1
        i2 = 0
        j2 = 1
        k2 = 1
      } else if (x0 < z0) {
        i1 = 0
        j1 = 1
        k1 = 0
        i2 = 0
        j2 = 1
        k2 = 1
      } else {
        i1 = 0
        j1 = 1
        k1 = 0
        i2 = 1
        j2 = 1
        k2 = 0
      }
    }
    const x1 = x0 - i1 + G3,
      y1 = y0 - j1 + G3,
      z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3,
      y2 = y0 - j2 + 2 * G3,
      z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 0.5,
      y3 = y0 - 1 + 0.5,
      z3 = z0 - 1 + 0.5
    const ii = i & 255,
      jj = j & 255,
      kk = k & 255
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
    if (t0 < 0) n0 = 0
    else {
      const g = permMod12[ii + perm[jj + perm[kk]]] * 3
      t0 *= t0
      n0 = t0 * t0 * (grad[g] * x0 + grad[g + 1] * y0 + grad[g + 2] * z0)
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
    if (t1 < 0) n1 = 0
    else {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3
      t1 *= t1
      n1 = t1 * t1 * (grad[g] * x1 + grad[g + 1] * y1 + grad[g + 2] * z1)
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
    if (t2 < 0) n2 = 0
    else {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3
      t2 *= t2
      n2 = t2 * t2 * (grad[g] * x2 + grad[g + 1] * y2 + grad[g + 2] * z2)
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
    if (t3 < 0) n3 = 0
    else {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3
      t3 *= t3
      n3 = t3 * t3 * (grad[g] * x3 + grad[g + 1] * y3 + grad[g + 2] * z3)
    }
    return 32 * (n0 + n1 + n2 + n3)
  }
}

function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const ax = px / rx,
    ay = py / ry,
    az = pz / rz
  const bx = px / (rx * rx),
    by = py / (ry * ry),
    bz = pz / (rz * rz)
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az)
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz) + 1e-9
  return (k0 * (k0 - 1)) / k1
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
function smax(a, b, k) {
  return -smin(-a, -b, k)
}
function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = px - ax,
    pay = py - ay,
    paz = pz - az
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az
  let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)
  h = h < 0 ? 0 : h > 1 ? 1 : h
  const dx = pax - bax * h,
    dy = pay - bay * h,
    dz = paz - baz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h)
}

export function generateBrain(opts) {
  const rand = mulberry32(opts.seed * 9301 + 49297)
  const noise = createSimplex3(rand)
  const gyriDepth = opts.gyriDepth
  const gyriScale = opts.gyriScale

  // --- Gyri field: zero-crossings of domain-warped noise form meandering sulci ---
  function gyriField(x, y, z) {
    const f = gyriScale
    const w = 0.55 * noise(x * f * 0.45 + 11.1, y * f * 0.45, z * f * 0.45 - 4.2)
    const px = x * f + w * 0.8,
      py = y * f * 1.1 - w * 0.6,
      pz = z * f + w * 0.7
    return noise(px, py, pz) + 0.3 * noise(px * 2.1 + 7.3, py * 2.1, pz * 2.1 - 3.1)
  }

  // --- Outer brain SDF (cerebrum + temporal lobes + cerebellum + stem) ---
  // gy = 1 adds the folds; gy = 0 gives the smooth base shape (used for shading normals)
  function sdOuterG(x, y, z, gy) {
    const ax = Math.abs(x)
    // Hemisphere: egg shape, slightly wider and lower at the back
    const wz = 1.0 - 0.07 * z
    let dH = sdEllipsoid(ax - 0.18 * wz, y - 0.04 - 0.04 * z, z + 0.01, 0.57 * wz, 0.74, 0.97)
    dH = smax(dH, -(y + 0.31 + 0.04 * Math.max(0, -z)), 0.16) // flattened base
    // longitudinal fissure
    const fy = Math.min(Math.max((y + 0.05) / 0.45, 0), 1)
    dH += 0.03 * fy * Math.exp(-(x * x) / 0.0016)
    // Temporal lobe: tip forward and down
    const ty = y + 0.27,
      tz = z - 0.16
    const ca = 0.97,
      sa = -0.24
    const ry = ty * ca - tz * sa,
      rz = ty * sa + tz * ca
    const dT = sdEllipsoid(ax - 0.4, ry, rz, 0.27, 0.23, 0.52)
    let dC = smin(dH, dT, 0.05)
    // Sulci: narrow V-shaped grooves between rounded gyri
    if (gy > 0) {
      const g = gyriField(x, y, z)
      const ag = Math.min(1, Math.abs(g) / 0.32)
      dC += gyriDepth * (0.75 * Math.exp(-(g * g) / 0.0081) + 0.25 * (1 - ag) - 0.3)
    }
    // Cerebellum (two lobes, horizontal folia)
    const cbx = ax - 0.2
    let dCb = sdEllipsoid(cbx, y + 0.43, z + 0.56, 0.38, 0.24, 0.38)
    dCb = smin(dCb, sdEllipsoid(x, y + 0.45, z + 0.5, 0.22, 0.2, 0.3), 0.08)
    const fol = Math.sin((y + 0.03 * noise(x * 4, y * 4, z * 4)) * 95.0)
    dCb += 0.006 * fol * fol
    // Brainstem + pons
    let dS = sdCapsule(x, y, z, 0, -0.3, -0.1, 0, -1.45, -0.26, 0.09, 0.07)
    dS = smin(dS, sdEllipsoid(x, y + 0.52, z + 0.04, 0.15, 0.14, 0.13), 0.06)
    let d = Math.min(dC, dCb)
    d = smin(d, dS, 0.05)
    return d
  }
  const sdOuter = (x, y, z) => sdOuterG(x, y, z, 1)
  const sdOuterSmooth = (x, y, z) => sdOuterG(x, y, z, 0)

  // --- Inner core (rounded box-like body visible through the shell) ---
  function sdCore(x, y, z) {
    const qx = Math.abs(x) / 0.33,
      qy = Math.abs(y + 0.07) / 0.4,
      qz = Math.abs(z - 0.08) / 0.51
    const r = Math.cbrt(qx * qx * qx + Math.pow(qy, 2.6) + Math.pow(qz, 2.2))
    const g = gyriField(x * 1.3 + 4.0, y * 1.3, z * 1.3)
    return (r - 1) * 0.36 + 0.012 * Math.exp(-(g * g) / 0.02)
  }

  const N = new Float64Array(4)
  const NB = new Float64Array(4)
  // Returns the distance estimate; out = unit normal, out[3] = |gradient|.
  // Newton steps use d / |grad| so non-unit gradients (sulci) still converge.
  function evalSdf(sdf, x, y, z, out) {
    const h = 0.003
    const a = sdf(x + h, y - h, z - h),
      b = sdf(x - h, y - h, z + h)
    const c = sdf(x - h, y + h, z - h),
      d = sdf(x + h, y + h, z + h)
    const gx = a - b - c + d,
      gy = -a - b + c + d,
      gz = -a + b - c + d
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1e-9
    out[0] = gx / l
    out[1] = gy / l
    out[2] = gz / l
    const gm = Math.max(0.25, l / (4 * h))
    out[3] = gm
    return ((a + b + c + d) * 0.25) / gm
  }

  // Sample a point on a surface (rejection in a band + Newton projection)
  const bbox = { min: [-0.8, -1.0, -1.05], max: [0.8, 0.85, 1.05] }
  function samplePoint(sdf, out, bb, band) {
    for (let it = 0; it < 400; it++) {
      let x = bb.min[0] + rand() * (bb.max[0] - bb.min[0])
      let y = bb.min[1] + rand() * (bb.max[1] - bb.min[1])
      let z = bb.min[2] + rand() * (bb.max[2] - bb.min[2])
      let d = sdf(x, y, z)
      if (Math.abs(d) > band) continue
      for (let k = 0; k < 4; k++) {
        d = evalSdf(sdf, x, y, z, N)
        x -= N[0] * d
        y -= N[1] * d
        z -= N[2] * d
      }
      if (Math.abs(d) > 0.01) continue
      out[0] = x
      out[1] = y
      out[2] = z
      return true
    }
    return false
  }

  // Growable float buffer
  function Buf(stride) {
    this.stride = stride
    this.a = new Float32Array(stride * 4096)
    this.n = 0
  }
  Buf.prototype.push = function (...v) {
    if ((this.n + 1) * this.stride > this.a.length) {
      const b = new Float32Array(this.a.length * 2)
      b.set(this.a)
      this.a = b
    }
    const o = this.n * this.stride
    for (let i = 0; i < this.stride; i++) this.a[o + i] = v[i]
    this.n++
  }
  Buf.prototype.trim = function () {
    return this.a.slice(0, this.n * this.stride)
  }

  const fiberPos = new Buf(3)
  const fiberData = new Buf(4) // t along fiber, rand, gain, crown
  const fiberNrm = new Buf(3)
  const fiberRel = new Buf(3)
  const dotPos = new Buf(3)
  const dotData = new Buf(4) // size, rand, warm, layer
  const dotNrm = new Buf(3)
  const tmpX = new Float32Array(400),
    tmpY = new Float32Array(400),
    tmpZ = new Float32Array(400)
  const tmpNX = new Float32Array(400),
    tmpNY = new Float32Array(400),
    tmpNZ = new Float32Array(400)
  const tmpDX = new Float32Array(400),
    tmpDY = new Float32Array(400),
    tmpDZ = new Float32Array(400)

  // Trace one polyline on a surface
  function trace(sdf, sx, sy, sz, steps, step, cfg, shell = 0) {
    let x = sx,
      y = sy,
      z = sz
    let d = evalSdf(sdf, x, y, z, N) + shell
    // random initial tangent
    let dx = rand() - 0.5,
      dy = rand() - 0.5,
      dz = rand() - 0.5
    if (cfg.vertical && y < -0.42) {
      dx *= 0.2
      dz *= 0.2
      dy = -Math.abs(dy) - 0.6
    }
    let dn = dx * N[0] + dy * N[1] + dz * N[2]
    dx -= N[0] * dn
    dy -= N[1] * dn
    dz -= N[2] * dn
    let l = Math.hypot(dx, dy, dz) || 1
    dx /= l
    dy /= l
    dz /= l
    const wavePhase = rand() * 6.283,
      waveFreq = cfg.waveFreq * (0.7 + rand() * 0.6)
    const waveAmp = cfg.waveAmp * (0.5 + rand())
    const ff = cfg.flowFreq,
      off = rand() * 100
    let count = 0
    const maxJump = step * (cfg.contour !== undefined ? 2.8 : 1.9)
    for (let i = 0; i < steps; i++) {
      d = evalSdf(sdf, x, y, z, N) + shell
      x -= N[0] * d
      y -= N[1] * d
      z -= N[2] * d
      d = evalSdf(sdf, x, y, z, N) + shell
      x -= N[0] * d
      y -= N[1] * d
      z -= N[2] * d
      if (y < -1.5 || Math.abs(d) > 0.02) break
      if (cfg.cerebrumOnly && !inCerebrum(x, y, z)) break
      if (count > 0) {
        const jx = x - tmpX[count - 1],
          jy = y - tmpY[count - 1],
          jz = z - tmpZ[count - 1]
        if (jx * jx + jy * jy + jz * jz > maxJump * maxJump) break // crease jump: end the fibre
      }
      tmpX[count] = x
      tmpY[count] = y
      tmpZ[count] = z
      if (cfg.reliefSdf) {
        // detailed normal of the folded surface: drives the relief lighting
        evalSdf(cfg.reliefSdf, x, y, z, NB)
        tmpDX[count] = NB[0]
        tmpDY[count] = NB[1]
        tmpDZ[count] = NB[2]
      } else {
        tmpDX[count] = N[0]
        tmpDY[count] = N[1]
        tmpDZ[count] = N[2]
      }
      if (cfg.normalSdf) {
        // shading normal from the smooth shape: fold walls keep their brightness
        evalSdf(cfg.normalSdf, x, y, z, NB)
        tmpNX[count] = NB[0]
        tmpNY[count] = NB[1]
        tmpNZ[count] = NB[2]
      } else {
        tmpNX[count] = N[0]
        tmpNY[count] = N[1]
        tmpNZ[count] = N[2]
      }
      count++
      // flow field
      let fx = noise(x * ff + off, y * ff, z * ff)
      let fy = noise(x * ff, y * ff + 31.7, z * ff + off)
      let fz = noise(x * ff - 17.1, y * ff + off, z * ff + 5.3)
      // fold-following direction (along sulci)
      let ox = 0,
        oy = 0,
        oz = 0
      if (cfg.fold > 0) {
        const e = 0.01
        const g0 = gyriField(x, y, z)
        const gx = gyriField(x + e, y, z) - g0,
          gy = gyriField(x, y + e, z) - g0,
          gz = gyriField(x, y, z + e) - g0
        ox = N[1] * gz - N[2] * gy
        oy = N[2] * gx - N[0] * gz
        oz = N[0] * gy - N[1] * gx
        const ol = Math.hypot(ox, oy, oz) || 1
        const sgn = ox * dx + oy * dy + oz * dz < 0 ? -1 : 1
        ox *= sgn / ol
        oy *= sgn / ol
        oz *= sgn / ol
        if (cfg.contour !== undefined) {
          // keep the fibre on the level line g = contour (traces the sulcus)
          const gn = gx * N[0] + gy * N[1] + gz * N[2]
          const tgx = (gx - N[0] * gn) / e,
            tgy = (gy - N[1] * gn) / e,
            tgz = (gz - N[2] * gn) / e
          const t2 = tgx * tgx + tgy * tgy + tgz * tgz + 1e-6
          let k = (g0 - cfg.contour) / t2
          const corr = Math.abs(k) * Math.sqrt(t2),
            lim = step * 0.6
          if (corr > lim) k *= lim / corr
          x -= tgx * k
          y -= tgy * k
          z -= tgz * k
        }
      }
      let tx = dx * cfg.inertia + fx * cfg.flow + ox * cfg.fold
      let ty = dy * cfg.inertia + fy * cfg.flow + oy * cfg.fold
      let tz = dz * cfg.inertia + fz * cfg.flow + oz * cfg.fold
      if (cfg.vertical && y < -0.42) {
        ty -= 1.2
      }
      if (cfg.horizontal && y < -0.25 && z < -0.15) {
        ty *= 0.2
      }
      // wave + jitter in the tangent plane
      const bx = N[1] * dz - N[2] * dy,
        by = N[2] * dx - N[0] * dz,
        bz = N[0] * dy - N[1] * dx
      const w = waveAmp * Math.sin(i * step * waveFreq + wavePhase) + (rand() - 0.5) * cfg.jitter
      tx += bx * w
      ty += by * w
      tz += bz * w
      dn = tx * N[0] + ty * N[1] + tz * N[2]
      tx -= N[0] * dn
      ty -= N[1] * dn
      tz -= N[2] * dn
      l = Math.hypot(tx, ty, tz) || 1
      dx = tx / l
      dy = ty / l
      dz = tz / l
      x += dx * step
      y += dy * step
      z += dz * step
    }
    return count
  }

  const fiberCfg = {
    inertia: 2.2,
    flow: 1.0,
    fold: opts.foldFollow,
    jitter: 1.0,
    waveAmp: opts.waviness,
    waveFreq: 22,
    flowFreq: 2.3,
    vertical: true,
    horizontal: true,
    normalSdf: sdOuterSmooth,
  }
  const coreCfg = {
    inertia: 2.6,
    flow: 1.0,
    fold: 0.0,
    jitter: 0.7,
    waveAmp: opts.waviness,
    waveFreq: 20,
    flowFreq: 2.0,
    vertical: false,
    horizontal: false,
  }
  const P = new Float64Array(3)

  function inCerebrum(x, y, z) {
    if (y < -0.26 && z < -0.12) return false // cerebellum
    if (y < -0.45 && Math.abs(x) < 0.22) return false // brainstem
    return true
  }

  function acceptStart(x, y, z, layer) {
    if (layer !== 0) return true
    if (y < -0.52 && Math.abs(x) < 0.2 && z > -0.35) return rand() < 0.22 // sparse brainstem
    const g = Math.abs(gyriField(x, y, z))
    return rand() < 0.45 + 0.55 * Math.min(1, g / 0.25) // fewer fibres in sulci
  }

  function addFibers(sdf, count, cfg, bb, gainBase, dotRate, layer) {
    for (let f = 0; f < count; f++) {
      if (!samplePoint(sdf, P, bb, 0.06)) continue
      if (!acceptStart(P[0], P[1], P[2], layer)) {
        f--
        continue
      }
      const steps = Math.floor(opts.fiberLength * (0.3 + rand() * 1.2))
      const sh = rand()
      const shell = layer === 0 ? sh * sh * sh * opts.shell : 0
      const c = trace(sdf, P[0], P[1], P[2], steps, 0.017, cfg, shell)
      if (c < 4) continue
      const r = rand()
      // a few thicker/brighter "vessel" fibers
      const rg = rand()
      const gain = gainBase * (r < 0.1 ? 2.0 : 0.3 + rg * rg * 1.6)
      for (let i = 0; i < c; i++) {
        const gv = gyriField(tmpX[i], tmpY[i], tmpZ[i])
        const crown = layer === 0 ? Math.min(1, Math.max(0, (Math.abs(gv) - 0.015) / 0.22)) : 1
        fiberPos.push(tmpX[i], tmpY[i], tmpZ[i])
        fiberData.push(c === 1 ? 1 : i / (c - 1), r, gain, crown)
        fiberNrm.push(tmpNX[i], tmpNY[i], tmpNZ[i])
        fiberRel.push(tmpDX[i], tmpDY[i], tmpDZ[i])
        if (rand() < dotRate) {
          const warm = rand() < opts.warmDots ? 1 : 0
          dotPos.push(tmpX[i], tmpY[i], tmpZ[i])
          dotData.push(0.6 + rand() * rand() * 1.6, rand(), warm, layer)
          dotNrm.push(tmpNX[i], tmpNY[i], tmpNZ[i])
        }
      }
    }
  }

  const density = opts.density
  addFibers(sdOuter, Math.round(opts.fiberCount * density), fiberCfg, bbox, 1.0, opts.dotRate, 0)

  // --- Sulcus lines: fibres that follow the fold level lines and draw the gyri ---
  const sulcusCfg = {
    inertia: 1.0,
    flow: 0.12,
    fold: 3.0,
    jitter: 0.3,
    waveAmp: 0.12,
    waveFreq: 30,
    flowFreq: 2.0,
    vertical: false,
    horizontal: false,
    normalSdf: sdOuterSmooth,
    reliefSdf: sdOuter,
    cerebrumOnly: true,
    contour: 0,
  }
  const sulcusCount = Math.round(opts.sulcusLines * density)
  for (let f = 0, guard = 0; f < sulcusCount && guard < sulcusCount * 40; guard++) {
    // traced on the smooth hull just inside the fold tops: robust and reads the same from outside
    if (!samplePoint(sdOuterSmooth, P, bbox, 0.06)) continue
    if (!inCerebrum(P[0], P[1], P[2])) continue
    // two outlines per sulcus (one on each bank) so every gyrus gets a rim
    const target = (rand() < 0.5 ? -1 : 1) * (0.06 + (rand() - 0.5) * 0.025)
    if (Math.abs(gyriField(P[0], P[1], P[2]) - target) > 0.035) continue
    sulcusCfg.contour = target
    const steps = Math.floor(opts.fiberLength * (0.9 + rand() * 1.35))
    const c = trace(sdOuterSmooth, P[0], P[1], P[2], steps, 0.02, sulcusCfg, 0.035 + rand() * 0.02)
    f++
    if (c < 6) continue
    const r = rand()
    const gain = 0.7 + rand() * 0.7
    for (let i = 0; i < c; i++) {
      fiberPos.push(tmpX[i], tmpY[i], tmpZ[i])
      fiberData.push(i / (c - 1), r * 0.92 + 0.08, gain, 1) // r >= 0.08: never a thick vessel
      fiberNrm.push(tmpNX[i], tmpNY[i], tmpNZ[i])
      fiberRel.push(tmpDX[i], tmpDY[i], tmpDZ[i])
      if (rand() < opts.dotRate * 0.7) {
        dotPos.push(tmpX[i], tmpY[i], tmpZ[i])
        dotData.push(0.6 + rand() * rand() * 1.6, rand(), rand() < opts.warmDots ? 1 : 0, 0)
        dotNrm.push(tmpNX[i], tmpNY[i], tmpNZ[i])
      }
    }
  }
  addFibers(
    sdCore,
    Math.round(opts.fiberCount * 0.16 * density),
    coreCfg,
    { min: [-0.4, -0.5, -0.5], max: [0.4, 0.4, 0.65] },
    1.15,
    opts.dotRate * 0.8,
    1,
  )

  // --- Volume dust: faint points filling the inside of the brain ---------------
  const dustCount = Math.round(opts.dust * density)
  for (let i = 0, guard = 0; i < dustCount && guard < dustCount * 20; guard++) {
    const x = (rand() * 2 - 1) * 0.78,
      y = -0.7 + rand() * 1.5,
      z = (rand() * 2 - 1) * 1.0
    const d = sdOuter(x, y, z)
    if (d > -0.015 || y < -0.75) continue
    const e = 0.01,
      g0 = d
    let nx = sdOuter(x + e, y, z) - g0,
      ny = sdOuter(x, y + e, z) - g0,
      nz = sdOuter(x, y, z + e) - g0
    const nl = Math.hypot(nx, ny, nz) || 1
    dotPos.push(x, y, z)
    dotData.push(0.5 + rand() * 0.6, rand(), 0, 2)
    dotNrm.push(nx / nl, ny / nl, nz / nl)
    i++
  }

  // --- Impulse paths ---------------------------------------------------------
  const pulsePos = new Buf(3)
  const pulseA = new Buf(4) // s (arc length), path length, delay, cluster id
  const pulseB = new Buf(4) // hot (deep), rand, 0, 0
  const clusterCount = opts.clusters
  const centers = []
  for (let c = 0; c < clusterCount; c++) {
    samplePoint(sdOuter, P, { min: [-0.8, -0.75, -1.05], max: [0.8, 0.85, 1.05] }, 0.06)
    centers.push([P[0], P[1], P[2]])
  }
  const pulseCfg = {
    inertia: 3.6,
    flow: 0.6,
    fold: 0.6,
    jitter: 0.85,
    waveAmp: 0.3,
    waveFreq: 26,
    flowFreq: 1.8,
    vertical: false,
    horizontal: false,
  }

  function emitPath(c, delay, hot) {
    if (c < 4) return
    let s = 0
    const r = rand()
    const sArr = new Float32Array(c)
    for (let i = 1; i < c; i++) {
      s += Math.hypot(tmpX[i] - tmpX[i - 1], tmpY[i] - tmpY[i - 1], tmpZ[i] - tmpZ[i - 1])
      sArr[i] = s
    }
    for (let i = 0; i < c; i++) {
      // break on the last point and before any long jump
      const jump = i < c - 1 && sArr[i + 1] - sArr[i] > 0.045
      pulsePos.push(tmpX[i], tmpY[i], tmpZ[i])
      pulseA.push(sArr[i], s, delay, pulseA.cluster)
      pulseB.push(hot * Math.exp(-sArr[i] * 1.6), r, i === c - 1 || jump ? 1 : 0, 0)
    }
  }

  for (let c = 0; c < clusterCount; c++) {
    pulseA.cluster = c
    const n = opts.pathsPerCluster
    for (let k = 0; k < n; k++) {
      const cc = centers[c]
      let x = cc[0] + (rand() - 0.5) * 0.18,
        y = cc[1] + (rand() - 0.5) * 0.18,
        z = cc[2] + (rand() - 0.5) * 0.18
      for (let it = 0; it < 4; it++) {
        const d = evalSdf(sdOuter, x, y, z, N)
        x -= N[0] * d
        y -= N[1] * d
        z -= N[2] * d
      }
      const steps = Math.floor(45 + rand() * 80)
      const cnt = trace(sdOuter, x, y, z, steps, 0.016, pulseCfg)
      emitPath(cnt, rand() * 0.12, 0)
    }
  }
  // Deep paths: from the centre of the brain outwards to the surface
  const deepClusters = opts.deepClusters
  for (let c = 0; c < deepClusters; c++) {
    pulseA.cluster = clusterCount + c
    const n = opts.pathsPerCluster
    const ox = (rand() - 0.5) * 0.2,
      oy = -0.25 + (rand() - 0.5) * 0.25,
      oz = -0.05 + (rand() - 0.5) * 0.2
    for (let k = 0; k < n; k++) {
      samplePoint(sdOuter, P, { min: [-0.8, -0.6, -1.0], max: [0.8, 0.85, 1.0] }, 0.06)
      const txp = P[0],
        typ = P[1],
        tzp = P[2]
      let x = ox + (rand() - 0.5) * 0.06,
        y = oy + (rand() - 0.5) * 0.06,
        z = oz + (rand() - 0.5) * 0.06
      let cnt = 0,
        reached = false
      const off = rand() * 50
      for (let i = 0; i < 220 && cnt < 300; i++) {
        tmpX[cnt] = x
        tmpY[cnt] = y
        tmpZ[cnt] = z
        cnt++
        let vx = txp - x,
          vy = typ - y,
          vz = tzp - z
        const dist = Math.hypot(vx, vy, vz)
        if (dist < 0.03) {
          reached = true
          break
        }
        vx /= dist
        vy /= dist
        vz /= dist
        const f = 3.0
        vx += 1.1 * noise(x * f + off, y * f, z * f) + (rand() - 0.5) * 1.4
        vy += 1.1 * noise(x * f, y * f + off, z * f) + (rand() - 0.5) * 1.4
        vz += 1.1 * noise(x * f, y * f, z * f + off) + (rand() - 0.5) * 1.4
        const l2 = Math.hypot(vx, vy, vz) || 1
        x += (vx / l2) * 0.016
        y += (vy / l2) * 0.016
        z += (vz / l2) * 0.016
      }
      // continue along the surface for a bit
      if (reached && cnt > 2 && cnt < 300) {
        const extra = Math.min(300 - cnt, Math.floor(10 + rand() * 30))
        const startCnt = cnt
        const keepX = tmpX.slice(0, cnt),
          keepY = tmpY.slice(0, cnt),
          keepZ = tmpZ.slice(0, cnt)
        const c2 = trace(sdOuter, x, y, z, extra, 0.016, pulseCfg)
        // trace overwrote tmp from 0: shift and restore
        const tailX = tmpX.slice(0, c2),
          tailY = tmpY.slice(0, c2),
          tailZ = tmpZ.slice(0, c2)
        tmpX.set(keepX, 0)
        tmpY.set(keepY, 0)
        tmpZ.set(keepZ, 0)
        tmpX.set(tailX, startCnt)
        tmpY.set(tailY, startCnt)
        tmpZ.set(tailZ, startCnt)
        cnt = startCnt + c2
      }
      emitPath(cnt, rand() * 0.08, 1)
    }
  }

  return {
    fiberPos: fiberPos.trim(),
    fiberData: fiberData.trim(),
    fiberNrm: fiberNrm.trim(),
    fiberRel: fiberRel.trim(),
    dotPos: dotPos.trim(),
    dotData: dotData.trim(),
    dotNrm: dotNrm.trim(),
    pulsePos: pulsePos.trim(),
    pulseA: pulseA.trim(),
    pulseB: pulseB.trim(),
    clusterTotal: clusterCount + deepClusters,
  }
}

export interface BrainOptions {
  seed: number
  density: number
  fiberCount: number
  fiberLength: number
  gyriDepth: number
  gyriScale: number
  foldFollow: number
  sulcusLines: number
  shell: number
  waviness: number
  dotRate: number
  warmDots: number
  dust: number
  clusters: number
  deepClusters: number
  pathsPerCluster: number
}

/** Polylines (consecutive points) plus per-point data, as flat float arrays. */
export interface BrainData {
  fiberPos: Float32Array
  /** t along fibre, rand, gain, gyrus crown */
  fiberData: Float32Array
  fiberNrm: Float32Array
  fiberRel: Float32Array
  dotPos: Float32Array
  /** size, rand, warm, layer */
  dotData: Float32Array
  dotNrm: Float32Array
  pulsePos: Float32Array
  /** arc length, path length, delay, cluster id */
  pulseA: Float32Array
  /** hot, rand, break, - */
  pulseB: Float32Array
  clusterTotal: number
}
