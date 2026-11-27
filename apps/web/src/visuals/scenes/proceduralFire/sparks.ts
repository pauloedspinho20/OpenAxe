/**
 * GPU burning sparks / embers particle system carried by the fire's velocity
 * field and rendered as energy-conserving motion-blurred streaks, ported from
 * Leon Lin's `procedural-fire` (MIT License, Copyright (c) 2026 Leon Lin,
 * https://github.com/Leonxlnx/procedural-fire).
 */
import { type ComputePipe, UniformStruct, computePipeline, layoutFromWGSL } from './gpu'
import type { Vec3 } from './math'
import type { FireRenderer } from './renderer'
import { HASH } from './shaders'
import type { FireSim } from './sim'

export const SPARK_FIELDS = [
  'dt',
  'time',
  'frame',
  'count',
  'nBase',
  'nBurst',
  'burstX',
  'burstY',
  'burstZ',
  'burstSpeed',
  'burstRadius',
  'ox',
  'oy',
  'oz',
  'sx',
  'sy',
  'sz',
  'turb',
  'lifeK',
  'bedRadius',
  'seed',
  'sizeK',
  'upK',
  'burstFan',
  'burstSize',
  'aimX',
  'aimZ',
] as const

export type SparkField = (typeof SPARK_FIELDS)[number]

const STRIDE = 64 // 4 x vec4f

interface BurstSpec {
  readonly t0: number
  readonly n: number
  readonly pos: Vec3
  readonly speed: number
  readonly radius: number
  readonly dur: number
  readonly fan: number
  readonly size: number
  readonly aim: Vec3 | null
  emitted: number
}

export interface BurstOptions {
  readonly n?: number
  readonly pos?: Vec3
  readonly speed?: number
  readonly radius?: number
  readonly dur?: number
  readonly fan?: number
  readonly size?: number
  readonly aim?: Vec3 | null
}

export interface SparksOptions {
  readonly count?: number
  readonly sim: FireSim
  readonly renderer: FireRenderer
  readonly curlTex: GPUTexture
}

export class Sparks {
  readonly device: GPUDevice
  readonly count: number
  readonly sim: FireSim
  readonly renderer: FireRenderer
  readonly curlTex: GPUTexture
  readonly params = { turb: 1.0, lifeK: 1.0, sizeK: 1.0, upK: 1.0, brightness: 13.0 }

  rate = 3.0
  private carry = 0
  private bursts: BurstSpec[] = []
  private time = 0
  private frame = 0

  private readonly U: UniformStruct<SparkField>
  private readonly buf: GPUBuffer
  private readonly counter: GPUBuffer
  private readonly X: GPUBuffer
  private readonly lin: GPUSampler
  private readonly rep: GPUSampler

  private pUpdate!: ComputePipe
  private pDraw!: GPURenderPipeline
  private drawBgl!: GPUBindGroupLayout
  private bgUpdate!: GPUBindGroup
  private bgDrawFor!: (depthTex: GPUTexture) => GPUBindGroup
  private _depth: GPUTexture | null = null
  private _bg: GPUBindGroup | null = null

  constructor(device: GPUDevice, opts: SparksOptions) {
    this.device = device
    this.count = opts.count ?? 8192
    this.sim = opts.sim
    this.renderer = opts.renderer
    this.curlTex = opts.curlTex

    this.U = new UniformStruct(device, 'SP', SPARK_FIELDS)
    this.buf = device.createBuffer({
      label: 'sparkBuf',
      size: this.count * STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.counter = device.createBuffer({
      label: 'sparkCounter',
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.X = device.createBuffer({
      label: 'sparkDrawX',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.lin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.rep = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    })
    this.build()
  }

  reset(): void {
    this.device.queue.writeBuffer(this.buf, 0, new Uint8Array(this.count * STRIDE))
    this.carry = 0
    this.bursts = []
    this.time = 0
    this.frame = 0
  }

  burst({
    n = 60,
    pos = [0, 0.1, 0],
    speed = 3,
    radius = 0.05,
    dur = 0.12,
    fan = 0.6,
    size = 1.3,
    aim = null,
  }: BurstOptions = {}): void {
    this.bursts.push({ t0: this.time, n, pos, speed, radius, dur, fan, size, aim, emitted: 0 })
  }

  private build(): void {
    const d = this.device
    const struct = /* wgsl */ `
struct Spark { p: vec4f, v: vec4f, q: vec4f, m: vec4f };
`
    this.pUpdate = computePipeline(
      d,
      `${this.U.wgsl()}${HASH}${struct}
@group(0) @binding(0) var<uniform> S: SP;
@group(0) @binding(1) var<storage, read_write> sp: array<Spark>;
@group(0) @binding(2) var<storage, read_write> ctr: array<atomic<u32>, 4>;
@group(0) @binding(3) var velT: texture_3d<f32>;
@group(0) @binding(4) var lin: sampler;
@group(0) @binding(5) var curlT: texture_3d<f32>;
@group(0) @binding(6) var rep: sampler;

fn r(slot: u32, k: u32) -> f32 { return rand2(slot * 7919u + k * 104729u + u32(S.seed), u32(S.frame)); }
fn gauss(slot: u32, k: u32) -> f32 {
  let u1 = max(r(slot, k), 1e-6); let u2 = r(slot, k + 1u);
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}
fn fluidVel(p: vec3f) -> vec3f {
  let g = (p - vec3f(S.ox, S.oy, S.oz)) / vec3f(S.sx, S.sy, S.sz);
  if (any(g < vec3f(0.0)) || any(g > vec3f(1.0))) {
    if (g.y > 1.0 && length(p.xz) < 0.5) { return vec3f(0.0, 1.6 / (1.0 + (g.y - 1.0) * 1.5), 0.0); }
    return vec3f(0.0);
  }
  return textureSampleLevel(velT, lin, g, 0.0).xyz;
}

@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(S.count)) { return; }
  var s = sp[i];
  let dt = S.dt;
  if (s.m.z < 0.5) {
    let want = u32(S.nBase + S.nBurst);
    if (want == 0u) { return; }
    let slot = atomicAdd(&ctr[0], 1u);
    if (slot >= want) { return; }
    let burst = slot >= u32(S.nBase);
    var p: vec3f; var v: vec3f;
    if (burst) {
      p = vec3f(S.burstX, S.burstY, S.burstZ) + (vec3f(r(slot, 7u), r(slot, 8u), r(slot, 9u)) - 0.5) * S.burstRadius * 2.0;
      var radial = vec3f(p.x, 0.0, p.z);
      radial = select(vec3f(0.0), normalize(radial), length(radial) > 1e-3);
      let aim = vec3f(S.aimX, 0.0, S.aimZ);
      let dir = normalize(vec3f(gauss(slot, 1u), abs(gauss(slot, 3u)) * 1.2 + 0.7, gauss(slot, 5u)) + (radial + aim) * S.burstFan);
      v = dir * S.burstSpeed * (0.5 + 0.8 * r(slot, 10u));
    } else {
      let a = r(slot, 1u) * 6.2831853; let rr = sqrt(r(slot, 2u)) * S.bedRadius;
      p = vec3f(cos(a) * rr, 0.05 + r(slot, 3u) * 0.12, sin(a) * rr);
      v = vec3f(gauss(slot, 4u) * 0.4, 0.6 + r(slot, 6u) * 1.8, gauss(slot, 11u) * 0.4);
    }
    let dmm = clamp(0.5 * exp(0.55 * gauss(slot, 13u)) * S.sizeK * select(1.0, S.burstSize, burst), 0.15, 2.5);
    let tb = (0.25 + 2.0 * dmm * dmm) * (0.6 + 0.8 * r(slot, 15u)) * S.lifeK;
    let T0 = 1230.0 + 70.0 * gauss(slot, 16u) + select(0.0, 80.0, burst);
    let fl = select(0.0, 5.0 + 15.0 * r(slot, 18u), r(slot, 20u) < 0.45);
    s.p = vec4f(p, 0.0); s.v = vec4f(v, tb); s.q = vec4f(p, T0); s.m = vec4f(dmm, r(slot, 19u), 1.0, fl);
    sp[i] = s;
    return;
  }
  let dmm = s.m.x;
  var p = s.p.xyz; var v = s.v.xyz;
  let tau = max(0.4 * dmm * dmm, 0.01);
  var u = fluidVel(p) * S.upK;
  let tq = p * 0.9 + vec3f(0.0, -S.time * 0.5, S.time * 0.13 + s.m.y * 3.0);
  let turbAmp = S.turb * (0.3 + 3.0 * smoothstep(0.4, 1.2, p.y)) / 12.0;
  u += textureSampleLevel(curlT, rep, tq, 0.0).xyz * turbAmp;
  let k = 1.0 - exp(-dt / tau);
  v = mix(v, u, k);
  v.y -= 9.81 * (1.0 - 0.004) * dt * select(1.0, 0.2, dmm < 0.3);
  s.q = vec4f(p, s.q.w);
  p += v * dt;
  var T = s.q.w;
  var tb = s.v.w - dt;
  if (tb > 0.0) {
    let rel = length(u - v);
    T = mix(T, 1180.0 + 60.0 * min(rel, 3.0) + 60.0 * (s.m.y - 0.5), 1.0 - exp(-dt / 0.3));
  } else {
    T = 293.0 + (T - 293.0) * exp(-dt / (0.06 + 0.08 * dmm));
  }
  let age = s.p.w + dt;
  var alive = 1.0;
  if (T < 760.0 || p.y < 0.0 || p.y > 4.5 || length(p.xz) > 3.0 || age > 12.0) { alive = 0.0; }
  s.p = vec4f(p, age); s.v = vec4f(v, tb); s.q.w = T; s.m.z = alive;
  sp[i] = s;
}`,
      'main',
      'sparkUpdate',
    )

    const R = this.renderer
    const drawCode = `${R.header()}${struct}
@group(0) @binding(1) var<storage, read> sp: array<Spark>;
@group(0) @binding(2) var bbT: texture_2d<f32>;
@group(0) @binding(3) var depthT: texture_2d<f32>;
@group(0) @binding(4) var<uniform> X: vec4f;

struct VO { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) uv: vec2f, @location(2) dist: f32, @location(3) halfw: f32, @location(4) lenp: f32 };

fn analyticDof() -> bool { return R.focus > 0.0 && R.aperture > 0.0; }
fn toCam(p: vec3f) -> vec3f {
  var o = vec3f(R.camX, R.camY, R.camZ);
  if (R.focus > 0.0 && !analyticDof()) { o += vec3f(R.rgtX, R.rgtY, R.rgtZ) * R.lensX + vec3f(R.upX, R.upY, R.upZ) * R.lensY; }
  let c = p - o;
  return vec3f(dot(c, vec3f(R.rgtX, R.rgtY, R.rgtZ)), dot(c, vec3f(R.upX, R.upY, R.upZ)), dot(c, vec3f(R.fwdX, R.fwdY, R.fwdZ)));
}
fn toPx(c: vec3f) -> vec2f {
  var sx = c.x / c.z; var sy = c.y / c.z;
  if (R.focus > 0.0 && !analyticDof()) { sx += R.lensX / R.focus; sy += R.lensY / R.focus; }
  let ndc = vec2f(sx / (R.tanFov * R.aspect), sy / R.tanFov);
  return vec2f((ndc.x * 0.5 + 0.5) * R.width, (0.5 - ndc.y * 0.5) * R.height) - vec2f(R.jitX, R.jitY);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(2.0, 2.0, 0.0, 1.0);
  let s = sp[ii];
  if (s.m.z < 0.5) { return o; }
  let p1 = s.p.xyz;
  let p0 = p1 - s.v.xyz * X.x;
  let c0 = toCam(p0); let c1 = toCam(p1);
  if (c0.z < 0.05 || c1.z < 0.05) { return o; }
  let a = toPx(c0); let b = toPx(c1);
  let focalPx = R.height * 0.5 / R.tanFov;
  let rPx = 0.5 * s.m.x * 0.001 / c1.z * focalPx;
  var cocPx = 0.0;
  if (analyticDof()) { cocPx = R.aperture * abs(c1.z - R.focus) / c1.z * focalPx / R.focus; }
  let hw = max(max(rPx, cocPx), 0.7);
  var dir = b - a;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / max(len, 1e-4), len > 1e-3);
  let nrm = vec2f(-dir.y, dir.x);
  let corner = array<vec2f, 6>(vec2f(0, -1), vec2f(1, -1), vec2f(1, 1), vec2f(0, -1), vec2f(1, 1), vec2f(0, 1))[vi];
  let along = mix(-hw * 1.5, len + hw * 1.5, corner.x);
  let px = a + dir * along + nrm * corner.y * hw * 1.6;
  o.pos = vec4f(px.x / R.width * 2.0 - 1.0, 1.0 - px.y / R.height * 2.0, 0.0, 1.0);
  let T = s.q.w;
  var flick = 1.0;
  if (s.m.w > 0.0) { flick = 1.0 + 0.45 * sin(X.z * s.m.w * 6.2831853 + s.m.y * 40.0); }
  let L = 0.9 * bbLoad(bbT, T) * R.emitK * flick * X.y;
  let trueArea = 3.14159 * rPx * rPx;
  let drawnArea = max(len, hw / 3.0) * 1.2533 * hw;
  o.col = L * trueArea / drawnArea;
  o.uv = vec2f(along, corner.y * 1.6);
  o.dist = length(p1 - vec3f(R.camX, R.camY, R.camZ));
  o.halfw = hw;
  o.lenp = len;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let dd = vec2f(textureDimensions(depthT));
  let d = textureLoad(depthT, vec2i(i.pos.xy / vec2f(R.width, R.height) * dd), 0).x;
  if (i.dist > d) { discard; }
  let hw = i.halfw;
  let wa = clamp((i.uv.x + hw) / (2.0 * hw), 0.0, 1.0) * clamp((i.lenp + hw - i.uv.x) / (2.0 * hw), 0.0, 1.0);
  let w = exp(-i.uv.y * i.uv.y * 2.0) * wa;
  let col = i.col * w;
  if (any(col != col) || any(col > vec3f(6e4))) { discard; }
  return vec4f(col, 0.0);
}`
    const mod = d.createShaderModule({ label: 'sparkDraw', code: drawCode })
    void mod.getCompilationInfo?.().then((info) => {
      for (const m of info.messages) {
        if (m.type === 'error') {
          console.error(`[procedural-fire:sparkDraw] ${m.lineNum}:${m.linePos} ${m.message}`)
        }
      }
    })
    this.drawBgl = layoutFromWGSL(
      d,
      drawCode,
      GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      [2, 3],
    )
    this.pDraw = d.createRenderPipeline({
      label: 'sparkDraw',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawBgl] }),
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })

    this.makeBindGroups()
  }

  private makeBindGroups(): void {
    const d = this.device
    const sim = this.sim
    const R = this.renderer
    this.bgUpdate = d.createBindGroup({
      layout: this.pUpdate.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.U.buffer } },
        { binding: 1, resource: { buffer: this.buf } },
        { binding: 2, resource: { buffer: this.counter } },
        { binding: 3, resource: sim.vel.createView() },
        { binding: 4, resource: this.lin },
        { binding: 5, resource: this.curlTex.createView() },
        { binding: 6, resource: this.rep },
      ],
    })
    this.bgDrawFor = (depthTex: GPUTexture) =>
      d.createBindGroup({
        layout: this.drawBgl,
        entries: [
          { binding: 0, resource: { buffer: R.U.buffer } },
          { binding: 1, resource: { buffer: this.buf } },
          { binding: 2, resource: R.bbTex.createView() },
          { binding: 3, resource: depthTex.createView() },
          { binding: 4, resource: { buffer: this.X } },
        ],
      })
  }

  step(enc: GPUCommandEncoder, dt: number): void {
    this.carry += this.rate * dt
    const nBase = Math.floor(this.carry)
    this.carry -= nBase
    let nBurst = 0
    let B: BurstSpec | null = null
    for (const b of this.bursts) {
      const due = Math.min(b.n, Math.round(b.n * Math.min((this.time + dt - b.t0) / b.dur, 1)))
      const k = due - b.emitted
      if (k > 0 && !B) {
        B = b
        nBurst = k
        b.emitted += k
      }
    }
    this.bursts = this.bursts.filter((b) => b.emitted < b.n)
    const sim = this.sim
    this.U.set({
      dt,
      time: this.time,
      frame: this.frame,
      count: this.count,
      nBase,
      nBurst,
      burstX: B ? B.pos[0] : 0,
      burstY: B ? B.pos[1] : 0,
      burstZ: B ? B.pos[2] : 0,
      burstSpeed: B ? B.speed : 0,
      burstRadius: B ? B.radius : 0,
      burstFan: B ? B.fan : 0,
      burstSize: B ? B.size : 1,
      aimX: B?.aim ? B.aim[0] : 0,
      aimZ: B?.aim ? B.aim[2] : 0,
      ox: sim.origin[0],
      oy: sim.origin[1],
      oz: sim.origin[2],
      sx: sim.size[0],
      sy: sim.size[1],
      sz: sim.size[2],
      turb: this.params.turb,
      lifeK: this.params.lifeK,
      bedRadius: 0.2,
      seed: 1234,
      sizeK: this.params.sizeK,
      upK: this.params.upK,
    }).upload()
    this.device.queue.writeBuffer(this.counter, 0, new Uint32Array(4))
    const pass = enc.beginComputePass()
    pass.setPipeline(this.pUpdate.pipeline)
    pass.setBindGroup(0, this.bgUpdate)
    pass.dispatchWorkgroups(Math.ceil(this.count / 64))
    pass.end()
    this.time += dt
    this.frame++
  }

  draw(enc: GPUCommandEncoder, exposureTime: number, brightness = 1): void {
    const R = this.renderer
    if (this._depth !== R.depth || !this._bg) {
      this._depth = R.depth
      this._bg = this.bgDrawFor(R.depth)
    }
    this.device.queue.writeBuffer(
      this.X,
      0,
      new Float32Array([exposureTime, brightness * this.params.brightness, this.time, 0]),
    )
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: R.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(this.pDraw)
    pass.setBindGroup(0, this._bg)
    pass.draw(6, this.count)
    pass.end()
  }

  dispose(): void {
    this.U.dispose()
    this.buf.destroy()
    this.counter.destroy()
    this.X.destroy()
  }
}
