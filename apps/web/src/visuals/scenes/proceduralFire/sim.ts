/**
 * 3D Eulerian combustion solver on WebGPU compute (low-Mach, constant-density
 * projection with gas-expansion divergence source, MacCormack advection,
 * age-gated soot, and multigrid Poisson solver) ported from Leon Lin's
 * `procedural-fire` (MIT License, Copyright (c) 2026 Leon Lin,
 * https://github.com/Leonxlnx/procedural-fire).
 */
import {
  type ComputePipe,
  UniformStruct,
  bindGroup,
  computePipeline,
  dispatch3,
  tex3D,
} from './gpu'
import { GNOISE, HASH, SDF } from './shaders'

export const SIM_FIELDS = [
  'nx',
  'ny',
  'nz',
  'dx',
  'dt',
  'time',
  'frame',
  'seed',
  'ox',
  'oy',
  'oz',
  'nLogs',
  'fuelSrc',
  'bedFuel',
  'srcTemp',
  'bedTemp',
  'srcVel',
  'srcFreq',
  'srcSpeed',
  'srcThresh',
  'ignT',
  'kMix',
  'rs',
  'heatOut',
  'expansion',
  'sootForm',
  'sootOx',
  'radCool',
  'coolRate',
  'sootDissip',
  'smokeDissip',
  'vitDecay',
  'fuelDissip',
  'buoyancy',
  'vortEps',
  'turbAmp',
  'turbFreq',
  'turbRise',
  'turbEvolve',
  'windX',
  'windZ',
  'gust',
  'intensity',
  'velDissip',
  'bedRadius',
  'logSrc',
  'burstX',
  'burstY',
  'burstZ',
  'burstAmt',
  'smolder',
  'sponge',
  'hotR0',
  'hotR1',
  'hotY1',
  'visc',
  'lamAge',
  'anchorFreq',
  'srcFloor',
  'anchorGain',
] as const

export type SimField = (typeof SIM_FIELDS)[number]

export const SIM_DEFAULTS = {
  fuelSrc: 0.13,
  bedFuel: 0.16,
  srcTemp: 0.75,
  bedTemp: 0.82,
  srcVel: 0.25,
  srcFreq: 35.0,
  srcSpeed: 0.06,
  srcThresh: 0.0,
  ignT: 550,
  kMix: 30,
  rs: 4.7,
  heatOut: 7700,
  expansion: 0.7,
  sootForm: 25,
  sootOx: 30,
  radCool: 0.25,
  coolRate: 3.0,
  sootDissip: 0.4,
  smokeDissip: 0.3,
  vitDecay: 1.5,
  fuelDissip: 0.3,
  buoyancy: 26.8,
  vortEps: 8,
  turbAmp: 0.8,
  turbFreq: 1.5,
  turbRise: 1.5,
  turbEvolve: 0.6,
  windX: 0,
  windZ: 0,
  gust: 0,
  intensity: 1,
  velDissip: 0.05,
  bedRadius: 0.22,
  hotR0: 0.12,
  hotR1: 0.45,
  hotY1: 0.5,
  logSrc: 1,
  burstX: 0,
  burstY: 0,
  burstZ: 0,
  burstAmt: 0,
  smolder: 0.02,
  sponge: 1,
  visc: 0,
  lamAge: 0,
  anchorFreq: 1.6,
  srcFloor: 0.25,
  anchorGain: 0.95,
}

export type SimParams = typeof SIM_DEFAULTS & { seed?: number }

const WG: readonly [number, number, number] = [8, 8, 4]

interface MGLevel {
  readonly dims: readonly [number, number, number]
  readonly h: number
  readonly p: GPUTexture
  readonly b: GPUTexture
  readonly u: readonly [GPUBuffer, GPUBuffer]
  bgSmooth?: readonly [GPUBindGroup, GPUBindGroup]
  bgRestrict?: GPUBindGroup
  bgProlong?: GPUBindGroup
}

export interface FireSimOptions {
  readonly res?: readonly [number, number, number]
  readonly size?: readonly [number, number, number]
  readonly logs: Float32Array<ArrayBuffer>
  readonly vcycles?: number
  readonly mgSmooth?: number
  readonly coarseCap?: number
  readonly maccormack?: boolean
  readonly noiseTex: GPUTexture
  readonly curlTex: GPUTexture
  readonly seed?: number
  readonly dbg?: number
}

export class FireSim {
  readonly device: GPUDevice
  readonly res: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly dx: number
  readonly origin: readonly [number, number, number]
  readonly vcycles: number
  readonly mgSmooth: number
  readonly maccormack: boolean
  readonly dbg: number
  readonly params: SimParams
  readonly U: UniformStruct<SimField>
  readonly logBuf: GPUBuffer
  readonly nLogs: number
  readonly noiseTex: GPUTexture
  readonly curlTex: GPUTexture

  readonly lin: GPUSampler
  readonly rep: GPUSampler
  readonly vel: GPUTexture
  readonly velX: GPUTexture
  readonly velY: GPUTexture
  readonly S: GPUTexture
  readonly SX: GPUTexture
  readonly SY: GPUTexture
  readonly S2: GPUTexture
  readonly S2X: GPUTexture
  readonly S2Y: GPUTexture
  readonly vort: GPUTexture
  readonly geo: GPUTexture

  readonly levels: MGLevel[] = []
  readonly coarseIters: number

  time = 0
  frame = 0
  geoReady = false

  private pAdv1!: ComputePipe
  private pAdv2!: ComputePipe
  private pCurl!: ComputePipe
  private pForces!: ComputePipe
  private pDiv!: ComputePipe
  private pSmooth!: ComputePipe
  private pRestrict!: ComputePipe
  private pProlong!: ComputePipe
  private pGeo!: ComputePipe
  private pProject!: ComputePipe

  private bgAdv1!: GPUBindGroup
  private bgAdv2!: GPUBindGroup
  private bgCurl!: GPUBindGroup
  private bgForces!: GPUBindGroup
  private bgGeo!: GPUBindGroup
  private bgDiv!: GPUBindGroup
  private bgProject!: GPUBindGroup

  constructor(device: GPUDevice, opts: FireSimOptions) {
    this.device = device
    this.res = opts.res ?? [80, 120, 80]
    this.size = opts.size ?? [1.2, 1.8, 1.2]
    this.dx = this.size[0] / this.res[0]
    this.origin = [-this.size[0] / 2, 0, -this.size[2] / 2]
    this.vcycles = opts.vcycles ?? 2
    this.mgSmooth = opts.mgSmooth ?? 2
    this.maccormack = opts.maccormack ?? true
    this.dbg = opts.dbg ?? 0
    this.params = { ...SIM_DEFAULTS, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) }
    this.noiseTex = opts.noiseTex
    this.curlTex = opts.curlTex

    this.U = new UniformStruct(device, 'SimParams', SIM_FIELDS)
    this.logBuf = device.createBuffer({
      label: 'simLogs',
      size: opts.logs.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.logBuf, 0, opts.logs)
    this.nLogs = opts.logs.length / 8

    this.lin = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    })
    this.rep = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    })

    const T = (l: string) => tex3D(device, this.res, 'rgba16float', l)
    this.vel = T('vel')
    this.velX = T('velX')
    this.velY = T('velY')
    this.S = T('S')
    this.SX = T('SX')
    this.SY = T('SY')
    this.S2 = T('S2')
    this.S2X = T('S2X')
    this.S2Y = T('S2Y')
    this.vort = T('vort')
    this.geo = T('geo')

    let [x, y, z] = this.res
    let h = this.dx
    while (true) {
      const i = this.levels.length
      const u0 = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const u1 = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(u0, 0, new Float32Array([x, y, z, h, 0, 0, 0, 0]))
      device.queue.writeBuffer(u1, 0, new Float32Array([x, y, z, h, 1, 0, 0, 0]))
      this.levels.push({
        dims: [x, y, z],
        h,
        p: tex3D(device, [x, y, z], 'r32float', `p${i}`),
        b: tex3D(device, [x, y, z], 'r32float', `b${i}`),
        u: [u0, u1],
      })
      if (x % 2 || y % 2 || z % 2 || Math.min(x, y, z) <= 6) break
      x /= 2
      y /= 2
      z /= 2
      h *= 2
    }

    const [cx, cy, cz] = this.levels[this.levels.length - 1]!.dims
    const mu = (Math.cos(Math.PI / cx) + Math.cos(Math.PI / (2 * cy)) + Math.cos(Math.PI / cz)) / 3
    this.coarseIters = Math.max(
      8,
      Math.min(opts.coarseCap ?? 64, Math.ceil(Math.log(0.05) / Math.log(mu * mu))),
    )

    this.build()
  }

  private header(): string {
    const [nx, ny, nz] = this.res
    return /* wgsl */ `
${this.U.wgsl()}
${HASH}
${GNOISE}
${SDF}
const DBG = ${this.dbg}u;
const DIMS = vec3i(${nx}, ${ny}, ${nz});
const DIMSF = vec3f(${nx}.0, ${ny}.0, ${nz}.0);
fn inside(id: vec3u) -> bool { return all(vec3i(id) < DIMS); }
fn ld(t: texture_3d<f32>, c: vec3i) -> vec4f { return textureLoad(t, clamp(c, vec3i(0), DIMS - 1), 0); }
`
  }

  private build(): void {
    const d = this.device
    const H = this.header()

    const advCommon = /* wgsl */ `
@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var velT: texture_3d<f32>;
@group(0) @binding(2) var sT: texture_3d<f32>;
@group(0) @binding(3) var s2T: texture_3d<f32>;
@group(0) @binding(4) var lin: sampler;
fn sampleVel(c: vec3f) -> vec3f { return textureSampleLevel(velT, lin, c / DIMSF, 0.0).xyz; }
fn backtrace(c: vec3f, dt: f32) -> vec3f {
  let v0 = sampleVel(c);
  let mid = c - 0.5 * dt * v0 / P.dx;
  let v1 = sampleVel(mid);
  return c - dt * v1 / P.dx;
}
fn outsideFade(c: vec3f) -> f32 {
  let lo = min(c.x, c.z); let hi = max(c.x - DIMSF.x, max(c.y - DIMSF.y, c.z - DIMSF.z));
  return clamp(1.0 - max(-lo, hi), 0.0, 1.0);
}
`
    this.pAdv1 = computePipeline(
      d,
      H +
        advCommon +
        /* wgsl */ `
@group(0) @binding(5) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var sOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var s2Out: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = vec3f(id) + 0.5;
  let b = backtrace(c, P.dt);
  let f = outsideFade(b);
  let uvw = b / DIMSF;
  let wind = vec3f(P.windX, 0.0, P.windZ) * smoothstep(0.03, 0.4, b.y * P.dx);
  textureStore(velOut, id, vec4f(mix(wind, textureSampleLevel(velT, lin, uvw, 0.0).xyz, f), 0.0));
  textureStore(sOut, id, textureSampleLevel(sT, lin, uvw, 0.0) * f);
  textureStore(s2Out, id, textureSampleLevel(s2T, lin, uvw, 0.0) * f);
}`,
      'main',
      'adv1',
    )

    this.pAdv2 = computePipeline(
      d,
      H +
        advCommon +
        /* wgsl */ `
@group(0) @binding(5) var velHat: texture_3d<f32>;
@group(0) @binding(6) var sHat: texture_3d<f32>;
@group(0) @binding(7) var s2Hat: texture_3d<f32>;
@group(0) @binding(8) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(9) var sOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(10) var s2Out: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let ci = vec3i(id);
  let c = vec3f(id) + 0.5;
  let v = textureLoad(velT, ci, 0).xyz;
  let fw = (c + P.dt * v / P.dx) / DIMSF;
  let vH = textureLoad(velHat, ci, 0).xyz;
  let sH = textureLoad(sHat, ci, 0);
  let s2H = textureLoad(s2Hat, ci, 0);
  var vN = vH + 0.5 * (v - textureSampleLevel(velHat, lin, fw, 0.0).xyz);
  var sN = sH + 0.5 * (textureLoad(sT, ci, 0) - textureSampleLevel(sHat, lin, fw, 0.0));
  var s2N = s2H + 0.5 * (textureLoad(s2T, ci, 0) - textureSampleLevel(s2Hat, lin, fw, 0.0));
  let b = backtrace(c, P.dt) - 0.5;
  let b0 = vec3i(floor(b));
  var vmn = vec3f(1e9); var vmx = vec3f(-1e9);
  var smn = vec4f(1e9); var smx = vec4f(-1e9);
  var tmn = vec4f(1e9); var tmx = vec4f(-1e9);
  for (var k = 0; k < 8; k++) {
    let q = b0 + vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    let vv = ld(velT, q).xyz; let ss = ld(sT, q); let tt = ld(s2T, q);
    vmn = min(vmn, vv); vmx = max(vmx, vv); smn = min(smn, ss); smx = max(smx, ss); tmn = min(tmn, tt); tmx = max(tmx, tt);
  }
  if (outsideFade(b + 0.5) < 1.0) { vN = vH; sN = sH; s2N = s2H; }
  vN = clamp(vN, min(vmn, vH), max(vmx, vH));
  sN = clamp(sN, min(smn, sH), max(smx, sH));
  s2N = clamp(s2N, min(tmn, s2H), max(tmx, s2H));
  textureStore(velOut, id, vec4f(vN, 0.0));
  textureStore(sOut, id, max(sN, vec4f(0.0)));
  textureStore(s2Out, id, max(s2N, vec4f(0.0)));
}`,
      'main',
      'adv2',
    )

    this.pCurl = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(0) var velT: texture_3d<f32>;
@group(0) @binding(1) var vortOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = vec3i(id);
  let L = ld(velT, c - vec3i(1,0,0)).xyz; let R = ld(velT, c + vec3i(1,0,0)).xyz;
  let B = ld(velT, c - vec3i(0,1,0)).xyz; let T = ld(velT, c + vec3i(0,1,0)).xyz;
  let K = ld(velT, c - vec3i(0,0,1)).xyz; let F = ld(velT, c + vec3i(0,0,1)).xyz;
  let w = vec3f((T.z - B.z) - (F.y - K.y), (F.x - K.x) - (R.z - L.z), (R.y - L.y) - (T.x - B.x)) * 0.5;
  textureStore(vortOut, id, vec4f(w, length(w)));
}`,
      'main',
      'curl',
    )

    this.pForces = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var velT: texture_3d<f32>;
@group(0) @binding(2) var sT: texture_3d<f32>;
@group(0) @binding(3) var s2T: texture_3d<f32>;
@group(0) @binding(4) var vortT: texture_3d<f32>;
@group(0) @binding(5) var noiseT: texture_3d<f32>;
@group(0) @binding(6) var curlT: texture_3d<f32>;
@group(0) @binding(7) var rep: sampler;
@group(0) @binding(8) var geoT: texture_3d<f32>;
@group(0) @binding(9) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(10) var sOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(11) var s2Out: texture_storage_3d<rgba16float, write>;

fn noise4(q: vec3f) -> vec4f { return textureSampleLevel(noiseT, rep, q, 0.0) * 2.0 - 1.0; }

@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let ci = vec3i(id);
  let p = vec3f(P.ox, P.oy, P.oz) + (vec3f(id) + 0.5) * P.dx;
  let dt = P.dt;
  var v = textureLoad(velT, ci, 0).xyz;
  var s = textureLoad(sT, ci, 0);
  var s2 = textureLoad(s2T, ci, 0);
  let geo = textureLoad(geoT, ci, 0);
  let I = P.intensity;

  var src = 0.0;
  var anchor = 0.0;
  if (geo.r > 0.001) {
    let qa = p * P.anchorFreq + vec3f(P.seed * 0.37, 0.0, 0.11);
    anchor = smoothstep(-0.05, 0.25, noise4(qa).z);
    let qn = p * (P.srcFreq * 0.06) + vec3f(P.seed * 0.131, 0.0, P.time * P.srcSpeed);
    let pulse = smoothstep(P.srcThresh - 0.25, P.srcThresh + 0.25, noise4(qn).x);
    src = clamp(geo.r * P.logSrc * (P.srcFloor + P.anchorGain * anchor) * mix(0.55, 1.0, pulse) * 1.2, 0.0, 1.0) * I;
    src *= 1.0 - geo.b;
  }
  let srcW = min(src, 1.0);
  let bedHot = geo.g;
  var bed = geo.g * clamp(I * 1.4, 0.3, 1.0);
  if (bed > 0.001) {
    let qb = p * 2.4 + vec3f(0.17, -P.time * 0.12, P.time * 0.05);
    bed *= smoothstep(0.0, 0.3, noise4(qb).y);
  }
  s.y = max(s.y, src * P.fuelSrc);
  s.y = max(s.y, bed * P.bedFuel);
  s.x = max(s.x, src * P.srcTemp);
  s.x = max(s.x, bedHot * P.bedTemp);
  let srcAll = max(srcW, bed);
  s2.w = mix(s2.w, 1.0, bed * (1.0 - srcW));
  s2.w = mix(s2.w, 0.0, srcW);
  s2.y = s2.y * (1.0 - srcAll);
  s2.x = max(s2.x, (1.0 - s.y) * srcW);
  s2.x = max(s2.x, (1.0 - s.y) * bed * 0.6);
  let wsrc = 1.0 - pow(1.0 - clamp(srcW + bed * 0.4, 0.0, 1.0) * 0.5, dt * 90.0);
  v.y = mix(v.y, max(v.y, P.srcVel), wsrc);
  s2.z += geo.r * (1.0 - anchor) * P.smolder * dt * I;

  if (P.burstAmt > 0.0) {
    let bd = length(p - vec3f(P.burstX, P.burstY, P.burstZ));
    let bw = clamp(exp(-bd * bd / 0.006) * P.burstAmt, 0.0, 1.0);
    s.y = max(s.y, 0.17 * bw);
    s.x = max(s.x, 0.9 * bw);
    s2.x *= 1.0 - bw;
    s2.w *= 1.0 - bw;
    s2.y = max(s2.y, 0.05 * bw * clamp(s.y + s2.x, 0.0, 1.0));
  }
  var ageF = s2.y / max(s.y + s2.x, 1e-4);

  let T0 = 293.0 + 1000.0 * s.x;
  let o = clamp(1.0 - s.y - s2.x, 0.0, 1.0);
  let ign = smoothstep(P.ignT - 50.0, P.ignT + 50.0, T0);
  let b = min(s.y, o / P.rs) * (1.0 - exp(-P.kMix * ign * dt));
  s.y -= b;
  s2.x = min(s2.x + (1.0 + P.rs) * b, 1.0);
  let dT = min(P.heatOut * b, max(2100.0 - T0, 0.0));
  var T = T0 + dT;
  let q = dT / dt;
  let phi = select(min(P.expansion * q / T, 60.0), 0.0, geo.b > 0.5);

  ageF = min(ageF + dt, 4.0);
  s.z += P.sootForm * b * smoothstep(0.015, 0.05, ageF) * smoothstep(1000.0, 1400.0, T) * (1.0 - s2.w);
  s.z *= exp(-P.sootOx * (0.25 + o) * smoothstep(1100.0, 1400.0, T) * dt);
  s.z *= exp(-P.sootOx * 0.5 * o * smoothstep(850.0, 1100.0, T) * (1.0 - smoothstep(1100.0, 1300.0, T)) * dt);
  s.z *= exp(-P.sootDissip * dt);

  let th = T * 0.001;
  T -= min(P.radCool * 970.0 * s.z * th * th * (th * th * th * th - 0.00737), 6000.0) * dt;
  let notBurning = 1.0 - smoothstep(500.0, 5000.0, q);
  T = 293.0 + max(T - 293.0, 0.0) * exp(-P.coolRate * notBurning * dt);
  s.x = (T - 293.0) * 0.001;
  s.w = q * 1e-4;
  s.y *= exp(-P.fuelDissip * dt);
  s2.x *= exp(-P.vitDecay * dt);
  s2.z *= exp(-P.smokeDissip * dt);
  s2.y = ageF * clamp(s.y + s2.x, 0.0, 1.0);

  v.y += P.buoyancy * s.x * dt;

  if (P.visc > 0.0) {
    let lapV = ld(velT, ci + vec3i(1, 0, 0)).xyz + ld(velT, ci - vec3i(1, 0, 0)).xyz
             + ld(velT, ci + vec3i(0, 1, 0)).xyz + ld(velT, ci - vec3i(0, 1, 0)).xyz
             + ld(velT, ci + vec3i(0, 0, 1)).xyz + ld(velT, ci - vec3i(0, 0, 1)).xyz
             - 6.0 * textureLoad(velT, ci, 0).xyz;
    let nu = P.visc * 1.5e-5 * pow(max(T, 293.0) / 293.0, 1.7);
    v += min(nu * dt / (P.dx * P.dx), 0.15) * lapV;
  }
  let lam = select(1.0, smoothstep(0.5 * P.lamAge, max(P.lamAge, 1e-3), ageF), P.lamAge > 0.0);

  let w = textureLoad(vortT, ci, 0).xyz;
  let g = vec3f(ld(vortT, ci + vec3i(1,0,0)).w - ld(vortT, ci - vec3i(1,0,0)).w,
                ld(vortT, ci + vec3i(0,1,0)).w - ld(vortT, ci - vec3i(0,1,0)).w,
                ld(vortT, ci + vec3i(0,0,1)).w - ld(vortT, ci - vec3i(0,0,1)).w);
  let gl = length(g);
  if (gl > 1e-6) {
    let gate = smoothstep(450.0, 900.0, T) * (1.0 - srcAll) * smoothstep(0.02, 0.08, p.y) * lam;
    v += P.vortEps * gate * cross(g / gl, w) * dt;
  }

  let tq = (p - vec3f(0.0, P.time * P.turbRise, 0.0)) * P.turbFreq + vec3f(0.0, 0.0, P.time * P.turbEvolve);
  let cn = textureSampleLevel(curlT, rep, tq, 0.0).xyz;
  let tgate = max(smoothstep(500.0, 1100.0, T), smoothstep(0.0, 3.0, s.w)) * (1.0 - srcAll) * mix(0.6, 1.8, smoothstep(0.2, 0.75, p.y)) * lam;
  v += cn * (P.turbAmp / 12.0) * tgate * dt * 10.0;

  let windK = smoothstep(0.05, 0.5, p.y) * (1.0 + P.gust);
  v.x += (P.windX * windK - v.x) * dt * 0.35 * windK;
  v.z += (P.windZ * windK - v.z) * dt * 0.35 * windK;
  v *= exp(-P.velDissip * dt);

  if (geo.b > 0.5) { v = vec3f(0.0); s.y = 0.0; s2.y = 0.0; }
  let fp = vec3f(id) + 0.5;
  let side = min(min(fp.x, DIMSF.x - fp.x), min(fp.z, DIMSF.z - fp.z));
  let sp = (1.0 - smoothstep(0.0, 5.0, side)) * P.sponge;
  let wSide = vec2f(P.windX, P.windZ) * smoothstep(0.03, 0.4, p.y);
  let ks = 1.0 - pow(1.0 - 0.15 * clamp(sp, 0.0, 1.0), dt * 90.0);
  v.x = mix(v.x, wSide.x, ks); v.z = mix(v.z, wSide.y, ks);
  let top = smoothstep(DIMSF.y - 10.0, DIMSF.y, fp.y);
  let kt = pow(1.0 - 0.1 * top, dt * 90.0);
  s.z *= kt; s2.z *= kt;

  let vl = length(v);
  if (vl > 15.0) { v *= 15.0 / vl; }
  if (any(s != s) || any(s2 != s2) || any(v != v)) { s = vec4f(0.0); s2 = vec4f(0.0); v = vec3f(0.0); }
  textureStore(velOut, id, vec4f(v, phi));
  textureStore(sOut, id, s);
  textureStore(s2Out, id, s2);
}`,
      'main',
      'forces',
    )

    this.pDiv = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(0) var velT: texture_3d<f32>;
@group(0) @binding(1) var<uniform> P: SimParams;
@group(0) @binding(2) var divOut: texture_storage_3d<r32float, write>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = vec3i(id);
  let me = textureLoad(velT, c, 0);
  let L = ld(velT, c - vec3i(1,0,0)).x; let R = ld(velT, c + vec3i(1,0,0)).x;
  var B = ld(velT, c - vec3i(0,1,0)).y; let T = ld(velT, c + vec3i(0,1,0)).y;
  let K = ld(velT, c - vec3i(0,0,1)).z; let F = ld(velT, c + vec3i(0,0,1)).z;
  if (c.y == 0) { B = -me.y; }
  let div = ((R - L) + (T - B) + (F - K)) / (2.0 * P.dx) - me.w;
  textureStore(divOut, id, vec4f(div, 0.0, 0.0, 0.0));
}`,
      'main',
      'div',
    )

    const lvl =
      'struct Lvl { nx: f32, ny: f32, nz: f32, h: f32, color: f32, _a: f32, _b: f32, _c: f32 };'
    this.pSmooth = computePipeline(
      d,
      /* wgsl */ `
${lvl}
@group(0) @binding(0) var<uniform> L: Lvl;
@group(0) @binding(1) var p: texture_storage_3d<r32float, read_write>;
@group(0) @binding(2) var b: texture_3d<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = vec3i(i32(L.nx), i32(L.ny), i32(L.nz));
  let y = i32(gid.y); let z = i32(gid.z);
  let x = i32(gid.x) * 2 + ((y + z + i32(L.color)) & 1);
  if (x >= n.x || y >= n.y || z >= n.z) { return; }
  let c = vec3i(x, y, z);
  var sum = 0.0; var diag = 6.0;
  if (x > 0) { sum += textureLoad(p, c - vec3i(1,0,0)).x; } else { diag += 1.0; }
  if (x < n.x - 1) { sum += textureLoad(p, c + vec3i(1,0,0)).x; } else { diag += 1.0; }
  if (z > 0) { sum += textureLoad(p, c - vec3i(0,0,1)).x; } else { diag += 1.0; }
  if (z < n.z - 1) { sum += textureLoad(p, c + vec3i(0,0,1)).x; } else { diag += 1.0; }
  if (y > 0) { sum += textureLoad(p, c - vec3i(0,1,0)).x; } else { diag -= 1.0; }
  if (y < n.y - 1) { sum += textureLoad(p, c + vec3i(0,1,0)).x; } else { diag += 1.0; }
  textureStore(p, c, vec4f((sum - L.h * L.h * textureLoad(b, c, 0).x) / diag, 0.0, 0.0, 0.0));
}`,
      'main',
      'mgSmooth',
      [2],
    )

    this.pRestrict = computePipeline(
      d,
      /* wgsl */ `
${lvl}
@group(0) @binding(0) var<uniform> L: Lvl;
@group(0) @binding(1) var p: texture_storage_3d<r32float, read_write>;
@group(0) @binding(2) var b: texture_3d<f32>;
@group(0) @binding(3) var bc: texture_storage_3d<r32float, write>;
@group(0) @binding(4) var pc: texture_storage_3d<r32float, write>;
fn P(c: vec3i, n: vec3i, me: f32) -> f32 {
  if (c.x < 0 || c.z < 0 || c.x >= n.x || c.z >= n.z || c.y >= n.y) { return -me; }
  if (c.y < 0) { return me; }
  return textureLoad(p, c).x;
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = vec3i(i32(L.nx), i32(L.ny), i32(L.nz));
  let cc = vec3i(gid);
  if (any(cc * 2 >= n)) { return; }
  var acc = 0.0;
  let ih2 = 1.0 / (L.h * L.h);
  for (var k = 0; k < 8; k++) {
    let c = cc * 2 + vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    let me = textureLoad(p, c).x;
    let lap = (P(c - vec3i(1,0,0), n, me) + P(c + vec3i(1,0,0), n, me) + P(c - vec3i(0,1,0), n, me) +
               P(c + vec3i(0,1,0), n, me) + P(c - vec3i(0,0,1), n, me) + P(c + vec3i(0,0,1), n, me) - 6.0 * me) * ih2;
    acc += textureLoad(b, c, 0).x - lap;
  }
  textureStore(bc, cc, vec4f(acc * 0.125, 0.0, 0.0, 0.0));
  textureStore(pc, cc, vec4f(0.0));
}`,
      'main',
      'mgRestrict',
      [2],
    )

    this.pProlong = computePipeline(
      d,
      /* wgsl */ `
${lvl}
@group(0) @binding(0) var<uniform> L: Lvl;
@group(0) @binding(1) var p: texture_storage_3d<r32float, read_write>;
@group(0) @binding(2) var pc: texture_3d<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = vec3i(i32(L.nx), i32(L.ny), i32(L.nz));
  let c = vec3i(gid);
  if (any(c >= n)) { return; }
  let nc = n / 2;
  let g = (vec3f(c) + 0.5) * 0.5 - 0.5;
  let g0 = vec3i(floor(g));
  let f = g - vec3f(g0);
  var acc = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    let q = g0 + o;
    var val = textureLoad(pc, clamp(q, vec3i(0), nc - 1), 0).x;
    if (q.x < 0 || q.x >= nc.x) { val = -val; }
    if (q.z < 0 || q.z >= nc.z) { val = -val; }
    if (q.y >= nc.y) { val = -val; }
    let wv = mix(1.0 - f, f, vec3f(o));
    acc += val * wv.x * wv.y * wv.z;
  }
  textureStore(p, c, vec4f(textureLoad(p, c).x + acc, 0.0, 0.0, 0.0));
}`,
      'main',
      'mgProlong',
      [2],
    )

    this.pGeo = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> logs: array<vec4f>;
@group(0) @binding(2) var geoOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let p = vec3f(P.ox, P.oy, P.oz) + (vec3f(id) + 0.5) * P.dx;
  let nl = i32(P.nLogs);
  var dmin = 1e9; var band = 0.0;
  for (var i = 0; i < nl; i++) {
    let A = logs[i * 2]; let B = logs[i * 2 + 1];
    var dd = sdCapsule(p, A.xyz, B.xyz, A.w);
    dd += A.w * 0.3 * (1.0 - smoothstep(0.0, 0.16, length(p.xz))) * B.w;
    dmin = min(dmin, dd);
    let bnd = 1.0 - smoothstep(0.0, 1.6 * P.dx, abs(dd - 0.6 * P.dx));
    let hot = B.w * (1.0 - smoothstep(P.hotR0, P.hotR1, length(p.xz))) * (1.0 - smoothstep(0.08, P.hotY1, p.y));
    band = max(band, bnd * hot);
  }
  let r = length(p.xz);
  let bedH = 0.05 * (1.0 - smoothstep(0.0, P.bedRadius, r)) + 0.02;
  let bed = (1.0 - smoothstep(0.0, 2.0 * P.dx, p.y - bedH)) * (1.0 - smoothstep(P.bedRadius * 0.6, P.bedRadius * 1.15, r));
  let solid = select(0.0, 1.0, dmin < -0.5 * P.dx);
  textureStore(geoOut, id, vec4f(band, bed, solid, dmin));
}`,
      'main',
      'geo',
    )

    this.pProject = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var velT: texture_3d<f32>;
@group(0) @binding(2) var pT: texture_3d<f32>;
@group(0) @binding(3) var geoT: texture_3d<f32>;
@group(0) @binding(4) var velOut: texture_storage_3d<rgba16float, write>;
fn pr(c: vec3i, me: f32) -> f32 {
  if (c.x < 0 || c.z < 0 || c.x >= DIMS.x || c.z >= DIMS.z || c.y >= DIMS.y) { return -me; }
  if (c.y < 0) { return me; }
  return textureLoad(pT, c, 0).x;
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = vec3i(id);
  let me = textureLoad(pT, c, 0).x;
  let g = vec3f(pr(c + vec3i(1,0,0), me) - pr(c - vec3i(1,0,0), me),
                pr(c + vec3i(0,1,0), me) - pr(c - vec3i(0,1,0), me),
                pr(c + vec3i(0,0,1), me) - pr(c - vec3i(0,0,1), me)) / (2.0 * P.dx);
  var v = textureLoad(velT, c, 0).xyz - g;
  if (textureLoad(geoT, c, 0).b > 0.5) { v = vec3f(0.0); }
  if (c.y == 0) { v.y = max(v.y, 0.0); }
  let vl = length(v);
  if (vl > 20.0 || vl != vl) { v = select(v * 20.0 / vl, vec3f(0.0), vl != vl); }
  textureStore(velOut, id, vec4f(v, 0.0));
}`,
      'main',
      'project',
      [2],
    )

    this.makeBindGroups()
  }

  private makeBindGroups(): void {
    const d = this.device
    const U = this.U.buffer
    this.bgAdv1 = bindGroup(d, this.pAdv1.bgl, [
      U,
      this.vel,
      this.S,
      this.S2,
      this.lin,
      this.maccormack ? this.velX : this.velY,
      this.maccormack ? this.SX : this.SY,
      this.maccormack ? this.S2X : this.S2Y,
    ])
    this.bgAdv2 = bindGroup(d, this.pAdv2.bgl, [
      U,
      this.vel,
      this.S,
      this.S2,
      this.lin,
      this.velX,
      this.SX,
      this.S2X,
      this.velY,
      this.SY,
      this.S2Y,
    ])
    this.bgCurl = bindGroup(d, this.pCurl.bgl, [this.velY, this.vort])
    this.bgForces = bindGroup(d, this.pForces.bgl, [
      U,
      this.velY,
      this.SY,
      this.S2Y,
      this.vort,
      this.noiseTex,
      this.curlTex,
      this.rep,
      this.geo,
      this.velX,
      this.S,
      this.S2,
    ])
    this.bgGeo = bindGroup(d, this.pGeo.bgl, [U, this.logBuf, this.geo])
    const L0 = this.levels[0]!
    this.bgDiv = bindGroup(d, this.pDiv.bgl, [this.velX, U, L0.b])
    for (let i = 0; i < this.levels.length; i++) {
      const L = this.levels[i]!
      L.bgSmooth = [
        bindGroup(d, this.pSmooth.bgl, [L.u[0], L.p, L.b]),
        bindGroup(d, this.pSmooth.bgl, [L.u[1], L.p, L.b]),
      ]
      if (i + 1 < this.levels.length) {
        const C = this.levels[i + 1]!
        L.bgRestrict = bindGroup(d, this.pRestrict.bgl, [L.u[0], L.p, L.b, C.b, C.p])
        L.bgProlong = bindGroup(d, this.pProlong.bgl, [L.u[0], L.p, C.p])
      }
    }
    this.bgProject = bindGroup(d, this.pProject.bgl, [U, this.velX, L0.p, this.geo, this.vel])
  }

  private smooth(pass: GPUComputePassEncoder, i: number, iters: number): void {
    const L = this.levels[i]!
    const [x, y, z] = L.dims
    for (let k = 0; k < iters; k++) {
      for (const color of [0, 1] as const) {
        pass.setPipeline(this.pSmooth.pipeline)
        pass.setBindGroup(0, L.bgSmooth![color])
        pass.dispatchWorkgroups(
          Math.ceil(x / 2 / WG[0]),
          Math.ceil(y / WG[1]),
          Math.ceil(z / WG[2]),
        )
      }
    }
  }

  private vcycle(
    pass: GPUComputePassEncoder,
    pre = this.mgSmooth,
    post = this.mgSmooth,
    coarse = this.coarseIters,
  ): void {
    const n = this.levels.length
    for (let i = 0; i < n - 1; i++) {
      this.smooth(pass, i, pre)
      dispatch3(pass, this.pRestrict, this.levels[i]!.bgRestrict!, this.levels[i + 1]!.dims, WG)
    }
    this.smooth(pass, n - 1, coarse)
    for (let i = n - 2; i >= 0; i--) {
      dispatch3(pass, this.pProlong, this.levels[i]!.bgProlong!, this.levels[i]!.dims, WG)
      this.smooth(pass, i, post)
    }
  }

  setParams(p: Partial<SimParams>): void {
    if ('hotR0' in p || 'hotR1' in p || 'hotY1' in p || 'bedRadius' in p) this.geoReady = false
    Object.assign(this.params, p)
  }

  reset(): void {
    const [x, y, z] = this.res
    const zeros = new Uint16Array(x * y * 4)
    for (const t of [
      this.vel,
      this.velX,
      this.velY,
      this.S,
      this.SX,
      this.SY,
      this.S2,
      this.S2X,
      this.S2Y,
      this.vort,
    ]) {
      for (let k = 0; k < z; k++) {
        this.device.queue.writeTexture(
          { texture: t, origin: [0, 0, k] },
          zeros,
          { bytesPerRow: x * 8, rowsPerImage: y },
          [x, y, 1],
        )
      }
    }
    for (const L of this.levels) {
      const [lx, ly, lz] = L.dims
      const zf = new Float32Array(lx * ly)
      for (let k = 0; k < lz; k++) {
        this.device.queue.writeTexture(
          { texture: L.p, origin: [0, 0, k] },
          zf,
          { bytesPerRow: lx * 4, rowsPerImage: ly },
          [lx, ly, 1],
        )
      }
    }
    this.time = 0
    this.frame = 0
  }

  private uploadUniforms(dt: number): void {
    const [nx, ny, nz] = this.res
    this.U.set({
      ...this.params,
      nx,
      ny,
      nz,
      dx: this.dx,
      dt,
      time: this.time,
      frame: this.frame,
      ox: this.origin[0],
      oy: this.origin[1],
      oz: this.origin[2],
      nLogs: this.nLogs,
      seed: this.params.seed ?? 0,
    }).upload()
  }

  /** NOTE: uniforms are written with queue.writeBuffer, so callers submit one step per command buffer. */
  step(enc: GPUCommandEncoder, dt: number): void {
    this.uploadUniforms(dt)
    const pass = enc.beginComputePass()
    if (!this.geoReady) {
      dispatch3(pass, this.pGeo, this.bgGeo, this.res, WG)
      this.geoReady = true
    }
    dispatch3(pass, this.pAdv1, this.bgAdv1, this.res, WG)
    if (this.maccormack) dispatch3(pass, this.pAdv2, this.bgAdv2, this.res, WG)
    dispatch3(pass, this.pCurl, this.bgCurl, this.res, WG)
    dispatch3(pass, this.pForces, this.bgForces, this.res, WG)
    dispatch3(pass, this.pDiv, this.bgDiv, this.res, WG)
    for (let i = 0; i < this.vcycles; i++) this.vcycle(pass)
    dispatch3(pass, this.pProject, this.bgProject, this.res, WG)
    pass.end()
    this.time += dt
    this.frame++
  }

  dispose(): void {
    this.U.dispose()
    this.logBuf.destroy()
    for (const t of [
      this.vel,
      this.velX,
      this.velY,
      this.S,
      this.SX,
      this.SY,
      this.S2,
      this.S2X,
      this.S2Y,
      this.vort,
      this.geo,
    ]) {
      t.destroy()
    }
    for (const L of this.levels) {
      L.p.destroy()
      L.b.destroy()
      L.u[0].destroy()
      L.u[1].destroy()
    }
  }
}
