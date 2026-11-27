/**
 * Volumetric fire ray-marcher, fire-light extractor, SDF surface shading,
 * depth-aware composite with heat haze, temporal accumulation, dual-filter
 * bloom, and filmic output pass ported from Leon Lin's `procedural-fire`
 * (MIT License, Copyright (c) 2026 Leon Lin, https://github.com/Leonxlnx/procedural-fire).
 */
import {
  type BindResource,
  type ComputePipe,
  UniformStruct,
  bindGroup,
  computePipeline,
  layoutFromWGSL,
  tex2D,
  tex3D,
} from './gpu'
import { type BlackbodyLUT, type CameraBasis, blackbodyLUT } from './math'
import { GNOISE, HASH, IGN, SDF } from './shaders'
import { SCENE_SDF, SCENE_SHADOW, SCENE_SURFACE_GEO, SCENE_SURFACE_LIGHT } from './shaders'
import type { FireSim } from './sim'

export const RP_FIELDS = [
  'width',
  'height',
  'vw',
  'vh',
  'time',
  'frame',
  'nLogs',
  'nStones',
  'camX',
  'camY',
  'camZ',
  'tanFov',
  'fwdX',
  'fwdY',
  'fwdZ',
  'aspect',
  'rgtX',
  'rgtY',
  'rgtZ',
  'jitX',
  'upX',
  'upY',
  'upZ',
  'jitY',
  'ox',
  'oy',
  'oz',
  'dx',
  'sx',
  'sy',
  'sz',
  'tempScale',
  'nx',
  'ny',
  'nz',
  'nLights',
  'exposure',
  'stepMul',
  'sootAbs',
  'sootEmit',
  'emitK',
  'blueK',
  'smokeScat',
  'smokeG',
  'ambient',
  'detailAmt',
  'detailFreq',
  'detailSpeed',
  'hazeK',
  'glowK',
  'bloomK',
  'tonemap',
  'grain',
  'vignette',
  'saturation',
  'contrast',
  'bedGlow',
  'logGlow',
  'lightK',
  'accumN',
  'bbTmin',
  'bbTmax',
  'bbN',
  'emberFlicker',
  'sootEmitMin',
  'flameSharp',
  'moon',
  'fogK',
  'shadowSoft',
  'lift',
  'emitTempLo',
  'glowTemp',
  'inset',
  'knee',
  'surfDetail',
  'matA',
  'matB',
  'matC',
  'sootScat',
  'chroma',
  'lensX',
  'lensY',
  'focus',
  'lightDt',
  'flickerK',
  'cubic',
  'aperture',
  'sootEdge',
  'hueShift',
  'shadowMode',
  'shadowSteps',
] as const

export type RPField = (typeof RP_FIELDS)[number]

export const RP_DEFAULTS = {
  exposure: 15.0,
  stepMul: 0.7,
  sootAbs: 4.0,
  sootEmit: 10.0,
  emitK: 4.0,
  blueK: 0.05,
  smokeScat: 0.02,
  smokeG: 0.5,
  ambient: 1.0,
  detailAmt: 0.6,
  detailFreq: 2.2,
  detailSpeed: 0.9,
  hazeK: 1.0,
  glowK: 1.0,
  bloomK: 0.04,
  tonemap: 2,
  grain: 0.02,
  vignette: 0.6,
  saturation: 1.0,
  contrast: 1.0,
  bedGlow: 1.0,
  logGlow: 1.0,
  lightK: 1.0,
  emberFlicker: 1.0,
  sootEmitMin: 0.0,
  flameSharp: 0.0,
  moon: 1.0,
  fogK: 1.0,
  shadowSoft: 6.0,
  lift: 0.0,
  emitTempLo: 900,
  glowTemp: 1.0,
  tempScale: 1000,
  inset: 0.06,
  knee: 0.6,
  surfDetail: 1,
  matA: 0,
  matB: 0,
  matC: 0,
  sootScat: 0.015,
  chroma: 0.0025,
  lensX: 0,
  lensY: 0,
  focus: 0,
  lightDt: -1,
  flickerK: 0.35,
  cubic: 0,
  aperture: 0,
  sootEdge: 0,
  hueShift: 0,
  shadowMode: 1,
  shadowSteps: 14,
}

export type RendererParams = typeof RP_DEFAULTS

const NLIGHTS = 8

interface FinalPipe {
  readonly pipeline: GPURenderPipeline
  readonly bgl: GPUBindGroupLayout
}

interface BlurLevel {
  readonly down: GPUTexture
  readonly up: GPUTexture
  readonly w: number
  readonly h: number
}

export interface FireRendererOptions {
  readonly sim: FireSim
  readonly nLogs: number
  readonly nStones: number
  readonly noiseTex: GPUTexture
  readonly curlTex: GPUTexture
  readonly logsF32: Float32Array<ArrayBuffer>
  readonly stonesF32: Float32Array<ArrayBuffer>
  readonly format: GPUTextureFormat
}

export class FireRenderer {
  readonly device: GPUDevice
  readonly sim: FireSim
  readonly noiseTex: GPUTexture
  readonly curlTex: GPUTexture
  readonly format: GPUTextureFormat
  readonly params: RendererParams
  readonly U: UniformStruct<RPField>
  readonly Usurf: UniformStruct<RPField>
  readonly nLogs: number
  readonly nStones: number

  readonly logBuf: GPUBuffer
  readonly stoneBuf: GPUBuffer
  readonly lightBuf: GPUBuffer
  readonly lightState: GPUBuffer
  readonly lin: GPUSampler
  readonly rep: GPUSampler
  readonly bbTex: GPUTexture

  bb!: BlackbodyLUT
  Twb = 5000

  surf!: GPUTexture
  depth!: GPUTexture
  gGeo!: GPUTexture
  gAlb!: GPUTexture
  gEmit!: GPUTexture
  vol!: GPUTexture
  aux!: GPUTexture
  hdr!: GPUTexture
  hdrAvg!: GPUTexture
  hist!: GPUTexture
  histReset = true

  w = 0
  h = 0
  vw = 0
  vh = 0
  sw = 0
  sh = 0
  volScale = 0.5
  surfScale = 1
  private _surfScale = 0

  private cam!: CameraBasis
  private lastLightTime: number | null = null
  private sharpStamp = ''
  private occStamp = ''
  private geoStamp = ''
  private readonly occDims: readonly [number, number, number]
  private readonly occ0: GPUTexture
  private readonly occ1: GPUTexture
  private readonly sSharp: GPUTexture
  private readonly uBloomKaris: GPUBuffer
  private readonly uBloomPlain: GPUBuffer
  private readonly uBloomUp: GPUBuffer
  private readonly taU: GPUBuffer

  private targets: GPUTexture[] = []
  private blur: BlurLevel[] = []

  private pLights!: ComputePipe
  private pOccBuild!: ComputePipe
  private pOccDilate!: ComputePipe
  private pSurfaceGeo!: ComputePipe
  private pSurfaceLight!: ComputePipe
  private pSharpen!: ComputePipe
  private pVolume!: ComputePipe
  private pComposite!: ComputePipe
  private pTemporal!: ComputePipe
  private pDown!: ComputePipe
  private pUp!: ComputePipe

  private finalModule!: GPUShaderModule
  private finalBgl!: GPUBindGroupLayout
  private readonly finalPipes: Record<string, FinalPipe> = {}
  private readonly bgFinalCache = new Map<string, GPUBindGroup>()

  private bgLights!: GPUBindGroup
  private bgOccBuild!: GPUBindGroup
  private bgOccDilate!: GPUBindGroup
  private bgSurfaceGeo!: GPUBindGroup
  private bgSurfaceLight!: GPUBindGroup
  private bgVolume!: GPUBindGroup
  private bgSharpen!: GPUBindGroup
  private bgVolumeSharp!: GPUBindGroup
  private bgComposite!: GPUBindGroup
  private bgTemporal!: GPUBindGroup
  private bgDownHdr: GPUBindGroup[] = []
  private bgDownAvg: GPUBindGroup[] = []
  private bgUp: { readonly bg: GPUBindGroup; readonly w: number; readonly h: number }[] = []
  private bloomOut!: GPUTexture
  private bgFinalHdr!: GPUBindGroup
  private bgFinalAvg!: GPUBindGroup

  constructor(device: GPUDevice, opts: FireRendererOptions) {
    this.device = device
    this.sim = opts.sim
    this.noiseTex = opts.noiseTex
    this.curlTex = opts.curlTex
    this.format = opts.format
    this.params = { ...RP_DEFAULTS }
    this.U = new UniformStruct(device, 'RP', RP_FIELDS)
    this.Usurf = new UniformStruct(device, 'RP', RP_FIELDS, 'RPsurf')
    this.nLogs = opts.nLogs
    this.nStones = opts.nStones

    this.logBuf = device.createBuffer({
      label: 'renderLogs',
      size: opts.logsF32.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.logBuf, 0, opts.logsF32)

    this.stoneBuf = device.createBuffer({
      label: 'renderStones',
      size: opts.stonesF32.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.stoneBuf, 0, opts.stonesF32)

    this.lightBuf = device.createBuffer({
      label: 'lights',
      size: NLIGHTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.lightState = device.createBuffer({
      label: 'lightState',
      size: NLIGHTS * 3 * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

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

    this.sSharp = tex3D(device, this.sim.res, 'rgba16float', 'sSharp')
    this.occDims = [
      Math.ceil(this.sim.res[0] / 4),
      Math.ceil(this.sim.res[1] / 4),
      Math.ceil(this.sim.res[2] / 4),
    ]
    this.occ0 = tex3D(device, this.occDims, 'rgba16float', 'volOcc0')
    this.occ1 = tex3D(device, this.occDims, 'rgba16float', 'volOcc1')

    const makeU = (v: readonly [number, number, number, number], label: string) => {
      const b = device.createBuffer({
        label,
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(b, 0, new Float32Array(v))
      return b
    }
    this.uBloomKaris = makeU([1, 0, 0, 0], 'bloomKaris')
    this.uBloomPlain = makeU([0, 0, 0, 0], 'bloomPlain')
    this.uBloomUp = makeU([1.0, 0, 0, 0], 'bloomUp')
    this.taU = makeU([0.4, 1, 0, 0], 'taU')

    this.bbTex = device.createTexture({
      label: 'blackbody',
      size: [1024, 2],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.setWhiteBalance(5000)
    this.build()
  }

  setWhiteBalance(Twb: number): void {
    const lut = blackbodyLUT({ n: 1024, Tmin: 400, Tmax: 3000, Twb })
    this.bb = lut
    this.device.queue.writeTexture({ texture: this.bbTex }, lut.data, { bytesPerRow: lut.n * 16 }, [
      lut.n,
      2,
    ])
    this.Twb = Twb
  }

  resetLights(): void {
    this.device.queue.writeBuffer(this.lightState, 0, new Uint8Array(NLIGHTS * 3 * 16))
    this.lastLightTime = null
    this.occStamp = ''
  }

  header(): string {
    return /* wgsl */ `
${this.U.wgsl()}
${HASH}
${GNOISE}
${SDF}
${IGN}
@group(0) @binding(0) var<uniform> R: RP;
const PI = 3.14159265;
fn hueRotate(c: vec3f, turns: f32) -> vec3f {
  let a = turns * 6.2831853;
  let cs = cos(a); let sn = sin(a);
  let k = vec3f(0.57735027);
  return max(c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs), vec3f(0.0));
}
fn bbRowRaw(t: texture_2d<f32>, T: f32, row: u32) -> vec3f {
  let x = clamp((T - R.bbTmin) / (R.bbTmax - R.bbTmin), 0.0, 1.0) * (R.bbN - 1.0);
  let i = u32(floor(x)); let f = x - floor(x);
  let a = textureLoad(t, vec2u(i, row), 0).rgb;
  let b = textureLoad(t, vec2u(min(i + 1u, u32(R.bbN) - 1u), row), 0).rgb;
  return mix(a, b, f);
}
fn bbLoadRaw(t: texture_2d<f32>, T: f32) -> vec3f { return bbRowRaw(t, T, 0u); }
fn bbRow(t: texture_2d<f32>, T: f32, row: u32) -> vec3f {
  var rgb = bbRowRaw(t, T, row);
  let hs = fract(R.hueShift);
  if (hs > 0.0001 && hs < 0.9999) { rgb = hueRotate(rgb, hs); }
  return rgb;
}
fn bbLoad(t: texture_2d<f32>, T: f32) -> vec3f { return bbRow(t, T, 0u); }
fn bbSoot(t: texture_2d<f32>, T: f32) -> vec3f { return bbRow(t, T, 1u); }
struct Light { pos: vec4f, col: vec4f };
struct Ray { o: vec3f, d: vec3f };
fn lensRay(dPin: vec3f) -> Ray {
  let c = vec3f(R.camX, R.camY, R.camZ);
  if (R.focus <= 0.0) { return Ray(c, dPin); }
  let fwd = vec3f(R.fwdX, R.fwdY, R.fwdZ);
  let o = c + vec3f(R.rgtX, R.rgtY, R.rgtZ) * R.lensX + vec3f(R.upX, R.upY, R.upZ) * R.lensY;
  let q = c + dPin * (R.focus / dot(dPin, fwd));
  return Ray(o, normalize(q - o));
}
`
  }

  private build(): void {
    const d = this.device
    const H = this.header()

    this.pLights = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(1) var sT: texture_3d<f32>;
@group(0) @binding(2) var bbT: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> lights: array<Light>;
@group(0) @binding(4) var<storage, read_write> lstate: array<vec4f>;
var<workgroup> accP: array<vec4f, 256>;
var<workgroup> accC: array<vec4f, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  let n = vec3u(u32(R.nx), u32(R.ny), u32(R.nz));
  let bandH = n.y / ${NLIGHTS}u;
  let y0 = wg.x * bandH;
  var P = vec4f(0.0); var C = vec4f(0.0);
  let total = (n.x / 2u) * (bandH / 2u) * (n.z / 2u);
  for (var i = li; i < total; i += 256u) {
    let ix = (i % (n.x / 2u)) * 2u;
    let iy = ((i / (n.x / 2u)) % (bandH / 2u)) * 2u + y0;
    let iz = (i / ((n.x / 2u) * (bandH / 2u))) * 2u;
    let s = textureLoad(sT, vec3u(ix, iy, iz), 0);
    let T = 293.0 + s.x * R.tempScale;
    if (T < 700.0) { continue; }
    let e = s.z * R.sootEmit * bbSoot(bbT, T) * R.emitK;
    let w = dot(e, vec3f(0.2126, 0.7152, 0.0722));
    let pos = vec3f(R.ox, R.oy, R.oz) + (vec3f(f32(ix), f32(iy), f32(iz)) + 1.0) * R.dx;
    P += vec4f(pos * w, w);
    C += vec4f(e, dot(pos, pos) * w);
  }
  accP[li] = P; accC[li] = C;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { accP[li] += accP[li + s]; accC[li] += accC[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let w = accP[0].w;
    let cen = select(vec3f(0.0, (f32(y0) + f32(bandH) * 0.5) * R.dx, 0.0), accP[0].xyz / w, w > 1e-6);
    let spread = select(0.04, max(accC[0].w / w - dot(cen, cen), 0.0), w > 1e-6);
    let J = accC[0].rgb * (f32(n.x * bandH * n.z) / f32(total)) * R.dx * R.dx * R.dx;
    let N = ${NLIGHTS}u;
    let k = wg.x;
    var sp = lstate[k]; var sc = lstate[N + k]; var sm = lstate[2u * N + k];
    if (R.lightDt < 0.0 || sm.w <= 0.0) { sp = vec4f(cen, spread); sc = vec4f(J, 0.0); sm = vec4f(J, 1.0); }
    else {
      let a = 1.0 - exp(-R.lightDt / 0.08); let ap = 1.0 - exp(-R.lightDt / 0.15); let am = 1.0 - exp(-R.lightDt / 1.5);
      sp = mix(sp, vec4f(cen, spread), ap); sc = vec4f(mix(sc.rgb, J, a), 0.0); sm = vec4f(mix(sm.rgb, J, am), 1.0);
    }
    lstate[k] = sp; lstate[N + k] = sc; lstate[2u * N + k] = sm;
    let lum = vec3f(0.2126, 0.7152, 0.0722);
    let ratio = dot(sc.rgb, lum) / max(dot(sm.rgb, lum), 1e-9);
    let Jc = sc.rgb * pow(max(ratio, 1e-4), R.flickerK - 1.0);
    let wl = dot(Jc, lum);
    let on = wl > 1e-3 * dot(sm.rgb, lum) && wl > 0.0;
    lights[wg.x] = Light(vec4f(sp.xyz, select(0.0, wl, on)), vec4f(select(vec3f(0.0), Jc, on), sp.w));
  }
}`,
      'main',
      'lights',
      [2],
    )

    this.pOccBuild = computePipeline(
      d,
      /* wgsl */ `
@group(0) @binding(0) var sT: texture_3d<f32>;
@group(0) @binding(1) var s2T: texture_3d<f32>;
@group(0) @binding(2) var occOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let odim = vec3i(textureDimensions(occOut));
  let oc = vec3i(id);
  if (any(oc >= odim)) { return; }
  let sdim = vec3i(textureDimensions(sT));
  let base = oc * 4;
  let hi = min(base + 4, sdim);
  var mx = vec4f(0.0);
  for (var z = base.z; z < hi.z; z++) {
    for (var y = base.y; y < hi.y; y++) {
      for (var x = base.x; x < hi.x; x++) {
        let c = vec3i(x, y, z);
        let s = textureLoad(sT, c, 0);
        let smoke = textureLoad(s2T, c, 0).z;
        mx = max(mx, vec4f(s.x, s.z, s.w, smoke));
      }
    }
  }
  textureStore(occOut, oc, mx);
}`,
      'main',
      'occBuild',
    )

    this.pOccDilate = computePipeline(
      d,
      /* wgsl */ `
@group(0) @binding(0) var occIn: texture_3d<f32>;
@group(0) @binding(1) var occOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let odim = vec3i(textureDimensions(occOut));
  let oc = vec3i(id);
  if (any(oc >= odim)) { return; }
  var mx = vec4f(0.0);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = clamp(oc + vec3i(dx, dy, dz), vec3i(0), odim - 1);
        mx = max(mx, textureLoad(occIn, q, 0));
      }
    }
  }
  textureStore(occOut, oc, mx);
}`,
      'main',
      'occDilate',
    )

    this.pSurfaceGeo = computePipeline(
      d,
      H + SCENE_SDF + SCENE_SURFACE_GEO,
      'main',
      'surfaceGeo',
      [5],
    )

    this.pSurfaceLight = computePipeline(
      d,
      H + SCENE_SHADOW + SCENE_SURFACE_LIGHT(NLIGHTS),
      'main',
      'surfaceLight',
      [3, 5],
    )

    this.pSharpen = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(1) var sIn: texture_3d<f32>;
@group(0) @binding(2) var sOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec3i(textureDimensions(sIn));
  let c = vec3i(id);
  if (any(c >= dims)) { return; }
  let hi = dims - 1;
  let s = textureLoad(sIn, c, 0);
  var n = vec4f(0.0); var lo = s; var up = s;
  for (var k = 0; k < 6; k++) {
    let o = select(vec3i(0), vec3i(select(-1, 1, (k & 1) == 0)), vec3<bool>(k / 2 == 0, k / 2 == 1, k / 2 == 2));
    let v = textureLoad(sIn, clamp(c + o, vec3i(0), hi), 0);
    n += v; lo = min(lo, v); up = max(up, v);
  }
  textureStore(sOut, c, clamp(s + R.flameSharp * (s - n / 6.0), lo, up));
}`,
      'main',
      'sharpen',
    )

    this.pVolume = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(1) var sT: texture_3d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var noiseT: texture_3d<f32>;
@group(0) @binding(4) var rep: sampler;
@group(0) @binding(5) var bbT: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var depthT: texture_2d<f32>;
@group(0) @binding(8) var volOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var auxOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(10) var s2T: texture_3d<f32>;
@group(0) @binding(11) var curlT: texture_3d<f32>;
@group(0) @binding(12) var occT: texture_3d<f32>;

fn camRay(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x / R.vw * 2.0 - 1.0, 1.0 - px.y / R.vh * 2.0);
  let fwd = vec3f(R.fwdX, R.fwdY, R.fwdZ); let rgt = vec3f(R.rgtX, R.rgtY, R.rgtZ); let up = vec3f(R.upX, R.upY, R.upZ);
  return normalize(fwd + rgt * ndc.x * R.tanFov * R.aspect + up * ndc.y * R.tanFov);
}
fn hg(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
fn sampleCubic(g: vec3f, dims: vec3f) -> vec4f {
  let c = g - 0.5;
  let i = floor(c); let f = c - i;
  let f2 = f * f; let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1; let g1 = w2 + w3;
  let h0 = (i - 0.5 + w1 / g0) / dims; let h1 = (i + 1.5 + w3 / g1) / dims;
  var acc = vec4f(0.0);
  for (var k = 0; k < 8; k++) {
    let o = vec3<bool>((k & 1) != 0, (k & 2) != 0, (k & 4) != 0);
    let p = select(h0, h1, o);
    let wv = select(g0, g1, o);
    acc += textureSampleLevel(sT, lin, p, 0.0) * (wv.x * wv.y * wv.z);
  }
  return acc;
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= R.vw || f32(id.y) >= R.vh) { return; }
  let px = vec2f(id.xy) + 0.5 + vec2f(R.jitX, R.jitY) * (R.vw / R.width);
  let ray = lensRay(camRay(px));
  let ro = ray.o;
  let rd = ray.d;
  let ddim = vec2i(textureDimensions(depthT));
  let fpx = vec2i(px / vec2f(R.vw, R.vh) * vec2f(ddim));
  let sd = textureLoad(depthT, clamp(fpx, vec2i(0), ddim - 1), 0).x;
  let bmin = vec3f(R.ox, R.oy, R.oz); let bmax = bmin + vec3f(R.sx, R.sy, R.sz);
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv; let t1 = (bmax - ro) * inv;
  let tn = max(max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), 0.0);
  let tf = min(min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z)), sd);
  var L = vec3f(0.0); var Tr = 1.0; var haze = 0.0;
  let hs = fract(R.hueShift);
  var blueTint = vec3f(0.15, 0.3, 1.0);
  if (hs > 0.0001 && hs < 0.9999) { blueTint = hueRotate(blueTint, hs); }
  if (tf > tn) {
    let ds = R.dx * R.stepMul;
    let skipDs = min(ds * 2.5, R.dx * 2.5);
    let hazeDs = min(ds * 2.0, R.dx * 2.0);
    let jit = ign(vec2f(id.xy), R.frame);
    var t = tn + ds * jit;
    let dims = vec3f(R.nx, R.ny, R.nz);
    let invDims = 1.0 / dims;
    let occDims = vec3i(textureDimensions(occT));
    let nlit = i32(R.nLights);
    let ph = R.time / 0.7;
    let f0 = fract(ph); let f1 = fract(ph + 0.5);
    let w0 = 1.0 - abs(2.0 * f0 - 1.0);
    let o0 = vec3f(0.37, 0.0, 0.61) * floor(ph); let o1 = vec3f(0.71, 0.0, 0.29) * floor(ph + 0.5);
    for (var i = 0; i < 1200; i++) {
      if (t > tf || Tr < 0.003) { break; }
      let p = ro + rd * t;
      var g = (p - bmin) / R.dx;
      let occ = textureLoad(occT, clamp(vec3i(g * 0.25), vec3i(0), occDims - 1), 0);
      if (occ.x < 0.05 && occ.y < 1e-4 && occ.z < 1e-3 && occ.w < 1e-4) {
        t += skipDs;
        continue;
      }
      if (occ.y < 1e-4 && occ.z < 1e-3 && occ.w < 1e-4) {
        let edge0 = min(min(g.x, dims.x - g.x), min(g.z, dims.z - g.z));
        let fade0 = smoothstep(0.02, 0.15, edge0 * R.dx) * smoothstep(0.0, 0.4, (dims.y - g.y) * R.dx);
        let s0 = textureSampleLevel(sT, lin, g * invDims, 0.0) * fade0;
        haze += max(s0.x - 0.05, 0.0) * hazeDs;
        t += hazeDs;
        continue;
      }
      var mottle = 0.0;
      if (R.detailAmt > 0.0) {
        let rise = R.detailSpeed * (0.5 + 1.5 * smoothstep(0.0, 1.0, p.y));
        let q0 = (p - vec3f(0.0, rise * f0 * 0.7, 0.0)) * R.detailFreq * 0.25 + o0;
        let q1 = (p - vec3f(0.0, rise * f1 * 0.7, 0.0)) * R.detailFreq * 0.25 + o1;
        let c0 = textureSampleLevel(curlT, rep, q0, 0.0); let c1 = textureSampleLevel(curlT, rep, q1, 0.0);
        let cw = c0 * w0 + c1 * (1.0 - w0);
        g += cw.xyz * (R.detailAmt * 0.12) * vec3f(1.0, 0.6, 1.0);
        mottle = cw.w * 0.08 - 0.6;
      }
      var s = vec4f(0.0);
      if (R.cubic > 0.5) { s = sampleCubic(g, dims); } else { s = textureSampleLevel(sT, lin, g * invDims, 0.0); }
      let edge = min(min(g.x, dims.x - g.x), min(g.z, dims.z - g.z));
      let fade = smoothstep(0.02, 0.15, edge * R.dx) * smoothstep(0.0, 0.4, (dims.y - g.y) * R.dx);
      s *= fade;
      let T = 293.0 + s.x * R.tempScale + mottle * 60.0 * R.detailAmt * step(0.3, s.x);
      var soot = s.z;
      if (R.sootEdge > 0.0) { soot *= smoothstep(0.6 * R.sootEdge, 1.4 * R.sootEdge, soot); }
      var smoke = 0.0;
      if (R.smokeScat > 0.0 && occ.w >= 1e-4) { smoke = textureSampleLevel(s2T, lin, g * invDims, 0.0).z * fade; }
      if (soot > 1e-4 || s.w > 1e-3 || smoke > 1e-4) {
        let sigSoot = soot * R.sootAbs;
        let sigS = sigSoot * R.sootScat + smoke * R.smokeScat;
        let sigT = sigSoot + smoke * R.smokeScat * 1.1 + 1e-6;
        var e = vec3f(0.0);
        if (T > R.emitTempLo) { e = soot * R.sootEmit * bbSoot(bbT, T) * R.emitK; }
        e += blueTint * pow(s.w, 1.6) * (R.blueK / 3.0) * exp(-soot * 2.0);
        var ins = vec3f(0.0);
        if (sigS * Tr > 1e-6) {
          for (var k = 0; k < nlit; k++) {
            let Lk = lights[k];
            let toL = Lk.pos.xyz - p;
            let r2 = dot(toL, toL) + Lk.col.w * 0.6 + 0.004;
            ins += Lk.col.rgb * hg(dot(rd, toL * inverseSqrt(r2)), R.smokeG) / r2;
          }
          ins *= sigS * R.lightK;
        }
        let a = exp(-sigT * ds);
        let w = select((1.0 - a) / sigT, ds, sigT * ds < 1e-4);
        L += Tr * (e + ins) * w;
        Tr *= a;
      }
      haze += max(s.x - 0.05, 0.0) * ds;
      t += ds;
    }
  }
  textureStore(volOut, id.xy, vec4f(L, Tr));
  textureStore(auxOut, id.xy, vec4f(haze, sd, 0.0, 0.0));
}`,
      'main',
      'volume',
      [5, 7],
    )

    this.pComposite = computePipeline(
      d,
      H +
        /* wgsl */ `
@group(0) @binding(1) var surfT: texture_2d<f32>;
@group(0) @binding(2) var depthT: texture_2d<f32>;
@group(0) @binding(3) var volT: texture_2d<f32>;
@group(0) @binding(4) var auxT: texture_2d<f32>;
@group(0) @binding(5) var noiseT: texture_3d<f32>;
@group(0) @binding(6) var rep: sampler;
@group(0) @binding(7) var lin: sampler;
@group(0) @binding(8) var hdrOut: texture_storage_2d<rgba16float, write>;

fn sampleHaze(uv: vec2f) -> f32 {
  let vs = vec2f(R.vw, R.vh);
  let g = uv * vs - 0.5;
  let g0 = vec2i(floor(g));
  let f = g - floor(g);
  let mx = max(vec2i(vs) - 1, vec2i(0));
  let h00 = textureLoad(auxT, clamp(g0, vec2i(0), mx), 0).x;
  let h10 = textureLoad(auxT, clamp(g0 + vec2i(1, 0), vec2i(0), mx), 0).x;
  let h01 = textureLoad(auxT, clamp(g0 + vec2i(0, 1), vec2i(0), mx), 0).x;
  let h11 = textureLoad(auxT, clamp(g0 + vec2i(1, 1), vec2i(0), mx), 0).x;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

fn volAt(uv: vec2f, dFull: f32) -> vec4f {
  let vs = vec2f(R.vw, R.vh);
  let g = uv * vs - 0.5;
  let g0 = vec2i(floor(g)); let f = g - floor(g);
  var acc = vec4f(0.0); var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(g0 + o, vec2i(0), vec2i(vs) - 1);
    let wb = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let dv = textureLoad(auxT, q, 0).y;
    let rel = abs(dv - dFull) / max(min(dv, dFull), 0.05);
    let w = wb * exp(-rel * 8.0) + 1e-5;
    acc += textureLoad(volT, q, 0) * w; wsum += w;
  }
  return acc / wsum;
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= R.width || f32(id.y) >= R.height) { return; }
  let res = vec2f(R.width, R.height);
  let uv0 = (vec2f(id.xy) + 0.5) / res;
  var uv = uv0;
  let hz = sampleHaze(uv0);
  if (R.hazeK > 0.0 && hz > 1e-4) {
    let q = vec3f(uv0 * vec2f(R.aspect, 1.0) * 14.0, 0.0) + vec3f(0.0, R.time * 2.2, R.time * 0.4);
    let n = textureSampleLevel(noiseT, rep, q, 0.0).xy - 0.5;
    uv += n * min(hz, 0.6) * R.hazeK * (16.875 / 1920.0) * vec2f(1.0 / R.aspect, 1.0);
  }
  let sdim = vec2f(textureDimensions(surfT));
  let sp = vec2i(clamp(uv * sdim, vec2f(0.0), sdim - 1.0));
  var surf = textureLoad(surfT, sp, 0).rgb;
  if (sdim.x < res.x) { surf = textureSampleLevel(surfT, lin, uv, 0.0).rgb; }
  if (any(surf != surf) || any(abs(surf) > vec3f(6e4))) { surf = vec3f(0.0); }
  let sp0 = vec2i(clamp(uv0 * sdim, vec2f(0.0), sdim - 1.0));
  let dFull = textureLoad(depthT, sp0, 0).x;
  let v = volAt(uv0, dFull);
  textureStore(hdrOut, id.xy, vec4f(surf * v.a + v.rgb, 1.0));
}`,
      'main',
      'composite',
      [2, 4],
    )

    this.pTemporal = computePipeline(
      d,
      /* wgsl */ `
@group(0) @binding(0) var cur: texture_2d<f32>;
@group(0) @binding(1) var hist: texture_2d<f32>;
@group(0) @binding(2) var outT: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> a: vec4f;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = vec2i(textureDimensions(cur));
  let p = vec2i(id.xy);
  if (any(p >= s)) { return; }
  let c = textureLoad(cur, p, 0);
  var mn = c; var mx = c;
  for (var k = 0; k < 9; k++) {
    let q = clamp(p + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), s - 1);
    let v = textureLoad(cur, q, 0); mn = min(mn, v); mx = max(mx, v);
  }
  let h = clamp(textureLoad(hist, p, 0), mn, mx);
  textureStore(outT, p, select(mix(h, c, a.x), c, a.y > 0.5));
}`,
      'main',
      'temporal',
    )

    this.pDown = computePipeline(
      d,
      /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> o: vec4f;
fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, lin, uv, 0.0).rgb; }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let ds = vec2f(textureDimensions(dst));
  if (f32(id.x) >= ds.x || f32(id.y) >= ds.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / ds;
  let t = 1.0 / vec2f(textureDimensions(src));
  let a = s(uv + t * vec2f(-2, -2)); let b = s(uv + t * vec2f(0, -2)); let c = s(uv + t * vec2f(2, -2));
  let dd = s(uv + t * vec2f(-2, 0)); let e = s(uv); let f = s(uv + t * vec2f(2, 0));
  let g = s(uv + t * vec2f(-2, 2)); let h = s(uv + t * vec2f(0, 2)); let i = s(uv + t * vec2f(2, 2));
  let j = s(uv + t * vec2f(-1, -1)); let k = s(uv + t * vec2f(1, -1)); let l = s(uv + t * vec2f(-1, 1)); let m = s(uv + t * vec2f(1, 1));
  var col = vec3f(0.0);
  if (o.x > 0.5) {
    let g0 = (a + b + dd + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (dd + e + g + h) * 0.25; let g3 = (e + f + h + i) * 0.25; let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + dd + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  textureStore(dst, id.xy, vec4f(max(col, vec3f(0.0)), 1.0));
}`,
      'main',
      'bloomDown',
    )

    this.pUp = computePipeline(
      d,
      /* wgsl */ `
@group(0) @binding(0) var low: texture_2d<f32>;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var cur: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> o: vec4f;
fn s(uv: vec2f) -> vec3f { return textureSampleLevel(low, lin, uv, 0.0).rgb; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let ds = vec2f(textureDimensions(dst));
  if (f32(id.x) >= ds.x || f32(id.y) >= ds.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / ds;
  let t = o.x / vec2f(textureDimensions(low));
  var c = s(uv) * 4.0;
  c += (s(uv + vec2f(-t.x, 0)) + s(uv + vec2f(t.x, 0)) + s(uv + vec2f(0, -t.y)) + s(uv + vec2f(0, t.y))) * 2.0;
  c += s(uv + vec2f(-t.x, -t.y)) + s(uv + vec2f(t.x, -t.y)) + s(uv + vec2f(-t.x, t.y)) + s(uv + vec2f(t.x, t.y));
  c /= 16.0;
  let here = textureLoad(cur, vec2i(id.xy), 0).rgb;
  textureStore(dst, id.xy, vec4f(here + c, 1.0));
}`,
      'main',
      'bloomUp',
    )

    const finalCode =
      H +
      /* wgsl */ `
@group(0) @binding(1) var hdrT: texture_2d<f32>;
@group(0) @binding(2) var bloomT: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o;
}
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                  0.0784335999999992, 0.878468636469772, 0.0784336,
                  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let mi = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                   -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                   -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  let minEv = -12.47393; let maxEv = 4.026069;
  var v = m * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  v = mi * v;
  return clamp(v, vec3f(0.0), vec3f(1.0));
}
fn filmic(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  let y = clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
  return pow(y, vec3f(1.0 / 2.2));
}
fn srgbEnc(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn camera(c: vec3f) -> vec3f {
  let k = R.inset;
  let kn = R.knee;
  let cc = max(c, vec3f(0.0));
  let ex = max(cc - kn, vec3f(0.0));
  let m = mat3x3f(1.0 - 2.0 * k, k, k, k, 1.0 - 2.0 * k, k, k, k, 1.0 - 2.0 * k);
  var v = cc - ex + m * ex;
  v = select(kn + (1.0 - kn) * (1.0 - exp(-(v - kn) / (1.0 - kn))), v, v < vec3f(kn));
  return srgbEnc(clamp(v, vec3f(0.0), vec3f(1.0)));
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let cuv = i.uv - 0.5;
  var c = vec3f(textureSampleLevel(hdrT, lin, 0.5 + cuv * (1.0 + R.chroma), 0.0).r,
                textureSampleLevel(hdrT, lin, i.uv, 0.0).g,
                textureSampleLevel(hdrT, lin, 0.5 + cuv * (1.0 - R.chroma), 0.0).b);
  var bl = textureSampleLevel(bloomT, lin, i.uv, 0.0).rgb;
  if (any(c != c)) { c = vec3f(0.0); }
  if (any(bl != bl)) { bl = vec3f(0.0); }
  c = mix(c, bl / 7.0, R.bloomK);
  let ndc = cuv * 2.0 * vec2f(R.aspect, 1.0) * R.tanFov;
  let cos2 = 1.0 / (1.0 + dot(ndc, ndc));
  c *= mix(1.0, cos2 * cos2, R.vignette);
  c *= R.exposure;
  c += R.lift * vec3f(0.6, 0.7, 1.0) * 0.001;
  var o = vec3f(0.0);
  if (R.tonemap < 0.5) { o = agx(c); } else if (R.tonemap < 1.5) { o = filmic(c); } else { o = camera(c); }
  let lum = dot(o, vec3f(0.2126, 0.7152, 0.0722));
  o = mix(vec3f(lum), o, R.saturation);
  o = clamp((o - 0.5) * R.contrast + 0.5, vec3f(0.0), vec3f(1.0));
  let px = i.pos.xy;
  let gp = px / 1.5;
  let g0 = vec2i(floor(gp)); let gf = fract(gp); let gu = gf * gf * (3.0 - 2.0 * gf);
  var gn = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let o2 = vec2i(k & 1, k >> 1);
    let hh = hash3f(vec3i(g0 + o2, i32(R.frame))) - 0.5;
    let wv = select(1.0 - gu, gu, vec2<bool>(o2.x == 1, o2.y == 1));
    gn += (vec3f(hh.x) * 0.75 + hh * 0.25) * (wv.x * wv.y);
  }
  let gw = 4.0 * lum * (1.0 - lum) + 0.15;
  o += gn * R.grain * 3.0 * gw;
  let h = hash3f(vec3i(vec2i(px), i32(R.frame) + 911));
  o += (h.x + h.y - 1.0) / 255.0;
  return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), 1.0);
}`
    const fmod = d.createShaderModule({ label: 'final', code: finalCode })
    void fmod.getCompilationInfo?.().then((info) => {
      for (const m of info.messages) {
        if (m.type === 'error') {
          console.error(`[procedural-fire:final] ${m.lineNum}:${m.linePos} ${m.message}`)
        }
      }
    })
    this.finalModule = fmod
    this.finalBgl = layoutFromWGSL(d, finalCode, GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX)
    this.getFinalPipe(this.format)
  }

  private getFinalPipe(format: GPUTextureFormat): FinalPipe {
    const existing = this.finalPipes[format]
    if (existing) return existing
    const d = this.device
    const pipeline = d.createRenderPipeline({
      label: `final-${format}`,
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.finalBgl] }),
      vertex: { module: this.finalModule, entryPoint: 'vs' },
      fragment: { module: this.finalModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const fp: FinalPipe = { pipeline, bgl: this.finalBgl }
    this.finalPipes[format] = fp
    return fp
  }

  resize(w: number, h: number, volScale = 0.5, surfScale = this.surfScale): void {
    const d = this.device
    const rw = Math.max(16, Math.floor(w))
    const rh = Math.max(16, Math.floor(h))
    if (
      this.w === rw &&
      this.h === rh &&
      this.volScale === volScale &&
      this._surfScale === surfScale
    ) {
      return
    }
    this.w = rw
    this.h = rh
    this.volScale = volScale
    this.surfScale = surfScale
    this._surfScale = surfScale
    this.vw = Math.max(8, Math.round(rw * volScale))
    this.vh = Math.max(8, Math.round(rh * volScale))
    this.sw = Math.max(8, Math.round(rw * surfScale))
    this.sh = Math.max(8, Math.round(rh * surfScale))
    for (const t of this.targets) t.destroy()

    const RA = GPUTextureUsage.RENDER_ATTACHMENT
    this.surf = tex2D(d, [this.sw, this.sh], 'rgba16float', 'surf')
    this.depth = tex2D(d, [this.sw, this.sh], 'r32float', 'depth')
    this.gGeo = tex2D(d, [this.sw, this.sh], 'rg32uint', 'gGeo')
    this.gAlb = tex2D(d, [this.sw, this.sh], 'rgba16float', 'gAlb')
    this.gEmit = tex2D(d, [this.sw, this.sh], 'rgba16float', 'gEmit')
    this.geoStamp = ''
    this.vol = tex2D(d, [this.vw, this.vh], 'rgba16float', 'vol')
    this.aux = tex2D(d, [this.vw, this.vh], 'rg32float', 'aux')
    this.hdr = tex2D(d, [rw, rh], 'rgba16float', 'hdr', RA)
    this.hdrAvg = tex2D(d, [rw, rh], 'rgba16float', 'hdrAvg', RA)
    this.hist = tex2D(d, [rw, rh], 'rgba16float', 'hist')
    this.histReset = true

    this.blur = []
    let bw = rw
    let bh = rh
    for (let i = 0; i < 7; i++) {
      bw = Math.max(1, Math.ceil(bw / 2))
      bh = Math.max(1, Math.ceil(bh / 2))
      this.blur.push({
        down: tex2D(d, [bw, bh], 'rgba16float', `bd${i}`),
        up: tex2D(d, [bw, bh], 'rgba16float', `bu${i}`),
        w: bw,
        h: bh,
      })
    }
    this.targets = [
      this.surf,
      this.depth,
      this.gGeo,
      this.gAlb,
      this.gEmit,
      this.vol,
      this.aux,
      this.hdr,
      this.hdrAvg,
      this.hist,
      ...this.blur.flatMap((b) => [b.down, b.up]),
    ]
    this.makeBindGroups()
  }

  private makeBindGroups(): void {
    const d = this.device
    const U = this.U.buffer
    const sim = this.sim
    this.bgLights = bindGroup(d, this.pLights.bgl, [
      U,
      sim.S,
      this.bbTex,
      this.lightBuf,
      this.lightState,
    ])
    this.bgOccBuild = bindGroup(d, this.pOccBuild.bgl, [sim.S, sim.S2, this.occ0])
    this.bgOccDilate = bindGroup(d, this.pOccDilate.bgl, [this.occ0, this.occ1])
    this.bgSurfaceGeo = bindGroup(d, this.pSurfaceGeo.bgl, [
      this.Usurf.buffer,
      this.logBuf,
      this.stoneBuf,
      this.noiseTex,
      this.rep,
      this.bbTex,
      this.depth,
      this.gGeo,
      this.gAlb,
      this.gEmit,
    ])
    this.bgSurfaceLight = bindGroup(d, this.pSurfaceLight.bgl, [
      this.Usurf.buffer,
      this.logBuf,
      this.stoneBuf,
      this.bbTex,
      this.lightBuf,
      this.depth,
      this.gGeo,
      this.gAlb,
      this.gEmit,
      this.surf,
      sim.S,
      this.lin,
    ])
    this.bgVolume = bindGroup(d, this.pVolume.bgl, [
      U,
      sim.S,
      this.lin,
      this.noiseTex,
      this.rep,
      this.bbTex,
      this.lightBuf,
      this.depth,
      this.vol,
      this.aux,
      sim.S2,
      this.curlTex,
      this.occ1,
    ])
    this.bgSharpen = bindGroup(d, this.pSharpen.bgl, [U, sim.S, this.sSharp])
    this.bgVolumeSharp = bindGroup(d, this.pVolume.bgl, [
      U,
      this.sSharp,
      this.lin,
      this.noiseTex,
      this.rep,
      this.bbTex,
      this.lightBuf,
      this.depth,
      this.vol,
      this.aux,
      sim.S2,
      this.curlTex,
      this.occ1,
    ])
    this.bgComposite = bindGroup(d, this.pComposite.bgl, [
      U,
      this.surf,
      this.depth,
      this.vol,
      this.aux,
      this.noiseTex,
      this.rep,
      this.lin,
      this.hdr,
    ])
    this.bgTemporal = bindGroup(d, this.pTemporal.bgl, [this.hdr, this.hist, this.hdrAvg, this.taU])

    const makeDown = (src: GPUTexture) =>
      this.blur.map((b, i) => {
        const prev = i === 0 ? src : this.blur[i - 1]!.down
        const res: BindResource[] = [
          prev,
          this.lin,
          b.down,
          i === 0 ? this.uBloomKaris : this.uBloomPlain,
        ]
        return bindGroup(d, this.pDown.bgl, res)
      })
    this.bgDownHdr = makeDown(this.hdr)
    this.bgDownAvg = makeDown(this.hdrAvg)

    const n = this.blur.length
    this.bgUp = []
    for (let i = n - 2; i >= 0; i--) {
      const low = i === n - 2 ? this.blur[n - 1]!.down : this.blur[i + 1]!.up
      const cur = this.blur[i]!
      this.bgUp.push({
        bg: bindGroup(d, this.pUp.bgl, [low, this.lin, cur.down, cur.up, this.uBloomUp]),
        w: cur.w,
        h: cur.h,
      })
    }
    this.bloomOut = this.blur[0]!.up
    const fp = this.getFinalPipe(this.format)
    this.bgFinalHdr = bindGroup(d, fp.bgl, [U, this.hdr, this.bloomOut, this.lin])
    this.bgFinalAvg = bindGroup(d, fp.bgl, [U, this.hdrAvg, this.bloomOut, this.lin])
    this.bgFinalCache.clear()
  }

  setCamera(cam: CameraBasis): void {
    this.cam = cam
  }

  uploadParams(time: number, frame: number, jitter: readonly [number, number] = [0, 0]): void {
    const c = this.cam
    const sim = this.sim
    const lightDt =
      this.lastLightTime === null || time < this.lastLightTime || time - this.lastLightTime > 0.5
        ? -1
        : time - this.lastLightTime
    this.lastLightTime = time
    this.U.set({
      ...this.params,
      lightDt,
      width: this.w,
      height: this.h,
      vw: this.vw,
      vh: this.vh,
      time,
      frame,
      nLogs: this.nLogs,
      nStones: this.nStones,
      nLights: NLIGHTS,
      camX: c.pos[0],
      camY: c.pos[1],
      camZ: c.pos[2],
      fwdX: c.fwd[0],
      fwdY: c.fwd[1],
      fwdZ: c.fwd[2],
      rgtX: c.right[0],
      rgtY: c.right[1],
      rgtZ: c.right[2],
      upX: c.up[0],
      upY: c.up[1],
      upZ: c.up[2],
      tanFov: Math.tan(c.fovY / 2),
      aspect: this.w / this.h,
      jitX: jitter[0],
      jitY: jitter[1],
      ox: sim.origin[0],
      oy: sim.origin[1],
      oz: sim.origin[2],
      dx: sim.dx,
      sx: sim.size[0],
      sy: sim.size[1],
      sz: sim.size[2],
      nx: sim.res[0],
      ny: sim.res[1],
      nz: sim.res[2],
      bbTmin: this.bb.Tmin,
      bbTmax: this.bb.Tmax,
      bbN: this.bb.n,
    }).upload()

    this.Usurf.data.set(this.U.data)
    const sj = this.sw / this.w
    const su: Partial<Record<RPField, number>> = {
      width: this.sw,
      height: this.sh,
      jitX: 0,
      jitY: 0,
    }
    const p = this.params
    if (p.focus > 0) {
      const tf = Math.tan(c.fovY / 2)
      const asp = this.w / this.h
      su.camX = c.pos[0] + c.right[0] * p.lensX + c.up[0] * p.lensY
      su.camY = c.pos[1] + c.right[1] * p.lensX + c.up[1] * p.lensY
      su.camZ = c.pos[2] + c.right[2] * p.lensX + c.up[2] * p.lensY
      su.jitX = jitter[0] * sj + (-(p.lensX / p.focus) / (tf * asp)) * this.sw * 0.5
      su.jitY = jitter[1] * sj + (p.lensY / p.focus / tf) * this.sh * 0.5
    }
    this.Usurf.set(su).upload()
  }

  private currentGeoStamp(): string {
    const c = this.cam
    const p = this.params
    return [
      this.sw,
      this.sh,
      this.w,
      this.h,
      c.pos[0],
      c.pos[1],
      c.pos[2],
      c.fwd[0],
      c.fwd[1],
      c.fwd[2],
      c.right[0],
      c.right[1],
      c.right[2],
      c.up[0],
      c.up[1],
      c.up[2],
      c.fovY,
      p.surfDetail,
      this.Twb,
      p.focus,
      p.lensX,
      p.lensY,
    ].join('|')
  }

  renderHDR(enc: GPUCommandEncoder): void {
    const W = this.w
    const H = this.h
    const wgSurfX = Math.ceil(this.sw / 8)
    const wgSurfY = Math.ceil(this.sh / 8)
    const [ox, oy, oz] = this.occDims
    const occStamp = `${this.sim.frame}:${this.sim.time}`
    const geoStamp = this.currentGeoStamp()

    const pass = enc.beginComputePass()
    pass.setPipeline(this.pLights.pipeline)
    pass.setBindGroup(0, this.bgLights)
    pass.dispatchWorkgroups(NLIGHTS)

    if (occStamp !== this.occStamp) {
      this.occStamp = occStamp
      const wx = Math.ceil(ox / 4)
      const wy = Math.ceil(oy / 4)
      const wz = Math.ceil(oz / 4)
      pass.setPipeline(this.pOccBuild.pipeline)
      pass.setBindGroup(0, this.bgOccBuild)
      pass.dispatchWorkgroups(wx, wy, wz)

      pass.setPipeline(this.pOccDilate.pipeline)
      pass.setBindGroup(0, this.bgOccDilate)
      pass.dispatchWorkgroups(wx, wy, wz)
    }

    if (geoStamp !== this.geoStamp) {
      this.geoStamp = geoStamp
      pass.setPipeline(this.pSurfaceGeo.pipeline)
      pass.setBindGroup(0, this.bgSurfaceGeo)
      pass.dispatchWorkgroups(wgSurfX, wgSurfY)
    }

    pass.setPipeline(this.pSurfaceLight.pipeline)
    pass.setBindGroup(0, this.bgSurfaceLight)
    pass.dispatchWorkgroups(wgSurfX, wgSurfY)

    const sharp = this.params.flameSharp > 0 && this.params.cubic > 0.5
    if (sharp) {
      const stamp = `${this.sim.frame}:${this.sim.time}:${this.params.flameSharp}`
      if (stamp !== this.sharpStamp) {
        this.sharpStamp = stamp
        const [x, y, z] = this.sim.res
        pass.setPipeline(this.pSharpen.pipeline)
        pass.setBindGroup(0, this.bgSharpen)
        pass.dispatchWorkgroups(Math.ceil(x / 4), Math.ceil(y / 4), Math.ceil(z / 4))
      }
    }

    pass.setPipeline(this.pVolume.pipeline)
    pass.setBindGroup(0, sharp ? this.bgVolumeSharp : this.bgVolume)
    pass.dispatchWorkgroups(Math.ceil(this.vw / 8), Math.ceil(this.vh / 8))

    pass.setPipeline(this.pComposite.pipeline)
    pass.setBindGroup(0, this.bgComposite)
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8))
    pass.end()
  }

  temporal(enc: GPUCommandEncoder, weight = 0.4): void {
    this.device.queue.writeBuffer(
      this.taU,
      0,
      new Float32Array([weight, this.histReset ? 1 : 0, 0, 0]),
    )
    this.histReset = false
    const pass = enc.beginComputePass()
    pass.setPipeline(this.pTemporal.pipeline)
    pass.setBindGroup(0, this.bgTemporal)
    pass.dispatchWorkgroups(Math.ceil(this.w / 8), Math.ceil(this.h / 8))
    pass.end()
    enc.copyTextureToTexture({ texture: this.hdrAvg }, { texture: this.hist }, [this.w, this.h])
  }

  bloom(enc: GPUCommandEncoder, fromAvg: boolean): void {
    const pass = enc.beginComputePass()
    const downs = fromAvg ? this.bgDownAvg : this.bgDownHdr
    this.blur.forEach((b, i) => {
      pass.setPipeline(this.pDown.pipeline)
      pass.setBindGroup(0, downs[i]!)
      pass.dispatchWorkgroups(Math.ceil(b.w / 8), Math.ceil(b.h / 8))
    })
    for (const u of this.bgUp) {
      pass.setPipeline(this.pUp.pipeline)
      pass.setBindGroup(0, u.bg)
      pass.dispatchWorkgroups(Math.ceil(u.w / 8), Math.ceil(u.h / 8))
    }
    pass.end()
  }

  final(
    enc: GPUCommandEncoder,
    view: GPUTextureView,
    format: GPUTextureFormat,
    fromAvg: boolean,
  ): void {
    const fp = this.getFinalPipe(format)
    let bg = fromAvg ? this.bgFinalAvg : this.bgFinalHdr
    if (format !== this.format) {
      const key = `${format}:${fromAvg ? 'a' : 'h'}`
      let cached = this.bgFinalCache.get(key)
      if (!cached) {
        cached = bindGroup(this.device, fp.bgl, [
          this.U.buffer,
          fromAvg ? this.hdrAvg : this.hdr,
          this.bloomOut,
          this.lin,
        ])
        this.bgFinalCache.set(key, cached)
      }
      bg = cached
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    })
    pass.setPipeline(fp.pipeline)
    pass.setBindGroup(0, bg)
    pass.draw(3)
    pass.end()
  }

  dispose(): void {
    this.U.dispose()
    this.Usurf.dispose()
    this.logBuf.destroy()
    this.stoneBuf.destroy()
    this.lightBuf.destroy()
    this.lightState.destroy()
    this.bbTex.destroy()
    this.occ0.destroy()
    this.occ1.destroy()
    this.sSharp.destroy()
    this.uBloomKaris.destroy()
    this.uBloomPlain.destroy()
    this.uBloomUp.destroy()
    this.taU.destroy()
    for (const t of this.targets) t.destroy()
    this.targets = []
    this.bgFinalCache.clear()
  }
}
