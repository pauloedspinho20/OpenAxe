/**
 * Shared WGSL snippets, tileable 3D noise/curl texture generators, and the
 * procedural SDF campfire surface shader ported from Leon Lin's `procedural-fire`
 * (MIT License, Copyright (c) 2026 Leon Lin, https://github.com/Leonxlnx/procedural-fire).
 */
import { bindGroup, computePipeline, tex3D } from './gpu'

export const HASH = /* wgsl */ `
fn pcg3d(vin: vec3u) -> vec3u {
  var v = vin * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn pcg(n: u32) -> u32 {
  let s = n * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash3f(p: vec3i) -> vec3f { return vec3f(pcg3d(bitcast<vec3u>(p))) * (1.0 / 4294967295.0); }
fn hash1u(n: u32) -> f32 { return f32(pcg(n)) * (1.0 / 4294967295.0); }
fn rand2(n: u32, m: u32) -> f32 { return f32(pcg(n ^ pcg(m))) * (1.0 / 4294967295.0); }
`

export const IGN = /* wgsl */ `
fn ign(px: vec2f, frame: f32) -> f32 {
  let p = px + 5.588238 * (frame % 64.0);
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
`

export const GNOISE = /* wgsl */ `
fn gradDot(ci: vec3i, f: vec3f) -> f32 {
  let h = hash3f(ci) * 2.0 - 1.0;
  return dot(normalize(h + vec3f(1e-4)), f);
}
fn gnoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = gradDot(i + vec3i(0,0,0), f - vec3f(0,0,0));
  let n100 = gradDot(i + vec3i(1,0,0), f - vec3f(1,0,0));
  let n010 = gradDot(i + vec3i(0,1,0), f - vec3f(0,1,0));
  let n110 = gradDot(i + vec3i(1,1,0), f - vec3f(1,1,0));
  let n001 = gradDot(i + vec3i(0,0,1), f - vec3f(0,0,1));
  let n101 = gradDot(i + vec3i(1,0,1), f - vec3f(1,0,1));
  let n011 = gradDot(i + vec3i(0,1,1), f - vec3f(0,1,1));
  let n111 = gradDot(i + vec3i(1,1,1), f - vec3f(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.6;
}
fn fbm3(p: vec3f, oct: i32) -> f32 {
  var a = 0.5; var s = 0.0; var q = p;
  for (var i = 0; i < oct; i++) { s += a * gnoise(q); q = q * 2.03 + vec3f(17.1, 3.7, 9.2); a *= 0.5; }
  return s;
}
`

export const SDF = /* wgsl */ `
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn sdCapsuleH(p: vec3f, a: vec3f, b: vec3f, r: f32) -> vec2f {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2f(length(pa - ba * h) - r, h);
}
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
`

/** Generates a tileable 3D noise texture on the GPU (rgba16float). */
export function makeNoiseTexture(device: GPUDevice, N = 128, seed = 1): GPUTexture {
  const tex = tex3D(device, [N, N, N], 'rgba16float', 'noise')
  const code = /* wgsl */ `
${HASH}
const N = ${N}.0;
fn wrap(c: vec3i, per: i32) -> vec3i { return ((c % per) + per) % per; }
fn grad(c: vec3i, per: i32, ch: i32) -> vec3f {
  let h = hash3f(wrap(c, per) + vec3i(ch * 1013 + ${seed}, ch * 7919, ch * 104729));
  return normalize(h * 2.0 - 1.0 + vec3f(1e-5));
}
fn tnoise(p: vec3f, per: i32, ch: i32) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var r = 0.0;
  var acc = array<f32, 8>();
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    acc[k] = dot(grad(i + o, per, ch), f - vec3f(o));
  }
  let x0 = mix(acc[0], acc[1], u.x); let x1 = mix(acc[2], acc[3], u.x);
  let x2 = mix(acc[4], acc[5], u.x); let x3 = mix(acc[6], acc[7], u.x);
  return mix(mix(x0, x1, u.y), mix(x2, x3, u.y), u.z);
}
fn tfbm(p01: vec3f, ch: i32) -> f32 {
  var s = 0.0; var a = 0.5; var per = 4;
  for (var o = 0; o < 5; o++) {
    s += a * tnoise(p01 * f32(per), per, ch);
    per *= 2; a *= 0.5;
  }
  return s * 1.5;
}
fn worley(p01: vec3f, per: i32) -> f32 {
  let p = p01 * f32(per);
  let i = vec3i(floor(p)); let f = fract(p);
  var d = 9.0;
  for (var k = 0; k < 27; k++) {
    let o = vec3i(k % 3 - 1, (k / 3) % 3 - 1, k / 9 - 1);
    let h = hash3f(wrap(i + o, per) + vec3i(77, 33, ${seed}));
    d = min(d, length(vec3f(o) + h - f));
  }
  return d;
}
@group(0) @binding(0) var outT: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let p = (vec3f(id) + 0.5) / N;
  let a = tfbm(p, 0); let b = tfbm(p, 1); let c = tfbm(p, 2);
  let w = 0.65 * worley(p, 8) + 0.35 * worley(p, 16);
  textureStore(outT, id, vec4f(a * 0.5 + 0.5, b * 0.5 + 0.5, c * 0.5 + 0.5, clamp(w, 0.0, 1.0)));
}`
  const pipe = computePipeline(device, code, 'main', 'noiseGen')
  const bg = bindGroup(device, pipe.bgl, [tex])
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipe.pipeline)
  pass.setBindGroup(0, bg)
  pass.dispatchWorkgroups(N / 4, N / 4, N / 4)
  pass.end()
  device.queue.submit([enc.finish()])
  return tex
}

/** Curl of the (r,g,b) vector potential of the noise texture, baked once. */
export function makeCurlTexture(device: GPUDevice, noiseTex: GPUTexture, N = 128): GPUTexture {
  const tex = tex3D(device, [N, N, N], 'rgba16float', 'curl')
  const code = /* wgsl */ `
@group(0) @binding(0) var src: texture_3d<f32>;
@group(0) @binding(1) var outT: texture_storage_3d<rgba16float, write>;
fn L(c: vec3i) -> vec3f { return textureLoad(src, (c + ${N}) % ${N}, 0).xyz * 2.0 - 1.0; }
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let c = vec3i(id);
  let dx = L(c + vec3i(1, 0, 0)) - L(c - vec3i(1, 0, 0));
  let dy = L(c + vec3i(0, 1, 0)) - L(c - vec3i(0, 1, 0));
  let dz = L(c + vec3i(0, 0, 1)) - L(c - vec3i(0, 0, 1));
  let curl = vec3f(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) * (${N}.0 / 2.0);
  textureStore(outT, id, vec4f(curl, length(curl)));
}`
  const pipe = computePipeline(device, code, 'main', 'curlGen')
  const bg = bindGroup(device, pipe.bgl, [noiseTex, tex])
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipe.pipeline)
  pass.setBindGroup(0, bg)
  pass.dispatchWorkgroups(N / 4, N / 4, N / 4)
  pass.end()
  device.queue.submit([enc.finish()])
  return tex
}

const SDF_COMMON = /* wgsl */ `
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
  let k0 = length(p / r); let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
const TAU = 6.2831853;
fn octNotZero(v: vec2f) -> vec2f { return select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0)); }
fn octEnc(n0: vec3f) -> vec2f {
  let n = n0 / (abs(n0.x) + abs(n0.y) + abs(n0.z) + 1e-8);
  var xy = n.xy;
  if (n.z < 0.0) { xy = (1.0 - abs(xy.yx)) * octNotZero(xy); }
  return xy;
}
fn octDec(e: vec2f) -> vec3f {
  var n = vec3f(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    let xy = (1.0 - abs(n.yx)) * octNotZero(n.xy);
    n.x = xy.x;
    n.y = xy.y;
  }
  return normalize(n);
}
fn surfCamRay(px: vec2f) -> vec3f {
  let ndc = vec2f(px.x / R.width * 2.0 - 1.0, 1.0 - px.y / R.height * 2.0);
  let fwd = vec3f(R.fwdX, R.fwdY, R.fwdZ); let rgt = vec3f(R.rgtX, R.rgtY, R.rgtZ); let up = vec3f(R.upX, R.upY, R.upZ);
  return normalize(fwd + rgt * ndc.x * R.tanFov * R.aspect + up * ndc.y * R.tanFov);
}
fn hq33(p: vec3f) -> vec3f {
  var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
fn hqi(c: vec3i) -> vec3f { return hq33(vec3f(c) + vec3f(0.31, 0.57, 0.13)); }
fn gn3(p: vec3f) -> f32 {
  let i = floor(p); let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(hq33(i) * 2.0 - 1.0, f);
  let n100 = dot(hq33(i + vec3f(1, 0, 0)) * 2.0 - 1.0, f - vec3f(1, 0, 0));
  let n010 = dot(hq33(i + vec3f(0, 1, 0)) * 2.0 - 1.0, f - vec3f(0, 1, 0));
  let n110 = dot(hq33(i + vec3f(1, 1, 0)) * 2.0 - 1.0, f - vec3f(1, 1, 0));
  let n001 = dot(hq33(i + vec3f(0, 0, 1)) * 2.0 - 1.0, f - vec3f(0, 0, 1));
  let n101 = dot(hq33(i + vec3f(1, 0, 1)) * 2.0 - 1.0, f - vec3f(1, 0, 1));
  let n011 = dot(hq33(i + vec3f(0, 1, 1)) * 2.0 - 1.0, f - vec3f(0, 1, 1));
  let n111 = dot(hq33(i + vec3f(1, 1, 1)) * 2.0 - 1.0, f - vec3f(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.5;
}
const STONE_RMIN = 0.40;
const STONE_RMAX = 0.93;
const STONE_YMAX = 0.19;
const STONE_SHRINK = 0.64;
fn burnThin(p: vec3f, r: f32, burn: f32) -> f32 { return r * 0.3 * (1.0 - smoothstep(0.0, 0.16, length(p.xz))) * burn; }
`

export const SCENE_SHADOW = /* wgsl */ `
@group(0) @binding(1) var<storage, read> logs: array<vec4f>;
@group(0) @binding(2) var<storage, read> stones: array<vec4f>;
${SDF_COMMON}
fn mapShadow(p: vec3f) -> f32 {
  var d = 1e9;
  let nl = i32(R.nLogs);
  for (var i = 0; i < nl; i++) {
    let A = logs[i * 2]; let B = logs[i * 2 + 1];
    d = min(d, sdCapsule(p, A.xyz, B.xyz, A.w) + burnThin(p, A.w, B.w));
  }
  let rr = length(p.xz);
  if (rr > STONE_RMIN - 0.03 && rr < STONE_RMAX + 0.03 && p.y < STONE_YMAX + 0.03) {
    let ns = i32(R.nStones);
    for (var i = 0; i < ns; i++) {
      let C = stones[i * 2]; let S = stones[i * 2 + 1];
      let q = p - C.xyz;
      let ext = max(S.x, max(S.y, S.z)) * 0.8;
      if (length(q) - ext > d) { continue; }
      d = min(d, sdEllipsoid(rotY(q, C.w), S.xyz * 0.72));
    }
  }
  return d;
}
fn softShadow(ro: vec3f, rd: vec3f, maxT: f32, k: f32, nIt: i32) -> f32 {
  var res = 1.0; var t = 0.012;
  for (var i = 0; i < nIt; i++) {
    let p = ro + rd * t;
    if (p.y > 0.58 || t > maxT) { break; }
    let h = mapShadow(p);
    res = min(res, sat(0.5 + 0.5 * k * h / t));
    if (res < 0.002) { break; }
    t += clamp(abs(h), 0.006, 0.09);
  }
  return res * res * (3.0 - 2.0 * res);
}
`

export const SCENE_SDF = /* wgsl */ `
@group(0) @binding(1) var<storage, read> logs: array<vec4f>;
@group(0) @binding(2) var<storage, read> stones: array<vec4f>;
@group(0) @binding(3) var noiseT: texture_3d<f32>;
@group(0) @binding(4) var rep: sampler;
${SDF_COMMON}
fn nz(q: vec3f) -> vec4f { return textureSampleLevel(noiseT, rep, q, 0.0); }
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }
fn fb3(p: vec3f, oct: i32) -> f32 {
  var a = 0.5; var s = 0.0; var q = p;
  for (var i = 0; i < oct; i++) { s += a * gn3(q); q = q * 2.03 + vec3f(17.1, 3.7, 9.2); a *= 0.5; }
  return s;
}
fn vn1(x: f32, s: f32) -> f32 {
  let i = floor(x); let f = x - i;
  let a = hq33(vec3f(i, s, 7.7)).x; let b = hq33(vec3f(i + 1.0, s, 7.7)).x;
  return (mix(a, b, f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0) * 1.3;
}
fn gauss(h: f32) -> f32 { return fract(h * 7.31) + fract(h * 13.71 + 0.3) + fract(h * 3.37 + 0.6) - 1.5; }

var<private> gFoot: f32 = 0.002;
var<private> gDet: f32 = 1.0;
var<private> gDbg: vec3f = vec3f(0.0);
var<private> gIter: i32 = 0;
fn pf(b: u32) -> bool { return (u32(R.matB) & b) != 0u; }
fn dfade(w: f32) -> f32 { return (1.0 - smoothstep(0.3 * w, 1.2 * w, gFoot)) * gDet; }

fn gnoise2(p: vec2f, s: i32) -> f32 {
  let i = vec2i(floor(p)); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let fi = vec3f(vec2f(i), f32(s) * 3.7 + 0.5);
  let a = dot(hq33(fi).xy * 2.0 - 1.0, f);
  let b = dot(hq33(fi + vec3f(1.0, 0.0, 0.0)).xy * 2.0 - 1.0, f - vec2f(1.0, 0.0));
  let c = dot(hq33(fi + vec3f(0.0, 1.0, 0.0)).xy * 2.0 - 1.0, f - vec2f(0.0, 1.0));
  let d = dot(hq33(fi + vec3f(1.0, 1.0, 0.0)).xy * 2.0 - 1.0, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
fn fbm2(p: vec2f, oct: i32, s: i32) -> f32 {
  var a = 0.5; var r = 0.0; var q = p;
  for (var i = 0; i < oct; i++) { r += a * gnoise2(q, s + i); q = mat2x2f(1.6, 1.2, -1.2, 1.6) * q; a *= 0.5; }
  return r;
}

const BED_R = 0.325;
const BED_H = 0.05;
const CC = 0.02;
const EMBER_R = 0.47;
fn bedRadDir(d: vec2f) -> f32 {
  let x = d.x; let y = d.y; let x2 = x * x; let y2 = y * y;
  let c2 = x2 - y2; let s2 = 2.0 * x * y;
  let c3 = x * (4.0 * x2 - 3.0); let s3 = y * (3.0 - 4.0 * y2);
  let c5 = x * (16.0 * x2 * x2 - 20.0 * x2 + 5.0); let s5 = y * (16.0 * y2 * y2 - 20.0 * y2 + 5.0);
  return BED_R + 0.018 * (0.8 * c2 - 0.6 * s2) + 0.012 * (0.5 * c3 + 0.87 * s3) + 0.03 * (0.19 * c5 - 0.98 * s5);
}
fn bedRho(xz: vec2f) -> f32 { let r = length(xz); return r / bedRadDir(xz / max(r, 1e-5)); }
fn bedBase(rho: f32) -> f32 { let s = sat(1.0 - rho * rho); return BED_H * s * sqrt(s); }

fn terrain(xz: vec2f) -> f32 {
  let r = length(xz);
  return gnoise2(xz * 1.3, 3) * 0.008 + gnoise2(xz * 4.1, 4) * 0.003 - 0.012 * (1.0 - smoothstep(0.3, 0.62, r));
}
fn ashEdge(xz: vec2f) -> f32 { return 0.5 + 0.07 * fbm2(xz * 2.4, 2, 41) + 0.025 * gnoise2(xz * 12.0, 44); }
fn ashCover(xz: vec2f, r: f32) -> f32 {
  if (r < 0.3) { return 1.0; }
  if (r > 0.72) { return 0.0; }
  return 1.0 - smoothstep(-0.08, 0.04, r - ashEdge(xz) + 0.03 * gnoise2(xz * 40.0, 46));
}
fn coalTer(xz: vec2f) -> f32 { return terrain(xz) + 0.004; }
fn stoneBerm(xz: vec2f, r: f32) -> f32 {
  if (r < STONE_RMIN - 0.05 || r > STONE_RMAX + 0.05) { return 0.0; }
  var b = 0.0;
  let ns = i32(R.nStones);
  for (var i = 0; i < ns; i++) {
    let C = stones[i * 2]; let S = stones[i * 2 + 1];
    let dxz = xz - C.xz;
    let ext = max(S.x, S.z) * 0.85 + 0.06;
    if (dot(dxz, dxz) > ext * ext) { continue; }
    let q = rotY(vec3f(dxz.x, 0.0, dxz.y), C.w).xz;
    let a = vec2f(S.x, S.z) * (STONE_SHRINK + 0.02);
    let dd = max((length(q / a) - 1.0) * min(a.x, a.y), 0.0);
    b = max(b, exp(-dd * dd / 0.0007));
  }
  return b;
}
struct GParts { h: f32, ash: f32, clump: f32, berm: f32, crumb: f32, twig: f32, twigT: f32, twigH: f32, rho: f32,
                gran: f32, granH: f32 };
fn granules(xz: vec2f) -> vec2f {
  let q = xz / 0.0055;
  let i0 = vec2i(floor(q - 0.5));
  var gb = 0.0; var hc = 0.0;
  for (var k = 0; k < 4; k++) {
    let ci = i0 + vec2i(k & 1, k >> 1u);
    let hh = hqi(vec3i(ci, 163));
    let c = vec2f(ci) + 0.25 + 0.5 * hh.xy - q;
    let b = sat(1.0 - dot(c, c) * (2.6 + 1.2 * hh.z)) * (0.5 + 0.5 * fract(hh.z * 5.9));
    if (b > gb) { gb = b; hc = hh.z; }
  }
  return vec2f(gb, hc);
}
fn groundParts(xz: vec2f, ter: f32, detail: bool) -> GParts {
  var o = GParts(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0);
  let r = length(xz);
  var h = ter;
  if (r < 0.4) {
    o.rho = bedRho(xz); h += bedBase(o.rho);
    if (o.rho < 1.08) {
      let g = granules(xz);
      o.gran = g.x; o.granH = g.y;
      if (detail) { h += g.x * 0.0016 * dfade(0.003) * (1.0 - smoothstep(0.95, 1.08, o.rho)); }
    }
  }
  o.ash = ashCover(xz, r);
  if (o.rho < 0.85) { h += 0.004; }
  else if (o.ash > 0.0) {
    let pt = sat(0.5 + 0.9 * fbm2(xz * 14.0, 2, 45));
    h += o.ash * (0.002 + 0.005 * pt);
    let q = xz / 0.03 - 0.5; let i0 = vec2i(floor(q));
    var cl = 0.0;
    for (var k = 0; k < 4; k++) {
      let ci = i0 + vec2i(k & 1, k >> 1u);
      let hh = hqi(vec3i(ci, 151));
      if (hh.z > 0.12 + 0.35 * pt) { continue; }
      let c = (vec2f(ci) + 0.25 + 0.5 * hh.xy) * 0.03;
      let rad = 0.006 + 0.0085 * fract(hh.z * 13.0);
      let dv = xz - c;
      let dd = length(dv) / (rad * (1.0 + 0.3 * sin(atan2(dv.y, dv.x) * 3.0 + hh.x * 6.0)));
      let b = sat(1.0 - dd * dd);
      cl = max(cl, b * b * (0.55 + 0.45 * fract(hh.z * 7.0)));
    }
    o.clump = cl * o.ash * smoothstep(0.85, 1.05, o.rho);
    h += o.clump * 0.0065;
  }
  if (!pf(16u)) { o.berm = stoneBerm(xz, r); }
  h += o.berm * 0.013;
  if (detail) {
    let hT = h;
    let soil = 1.0 - o.ash;
    let fc = select(dfade(0.004) * sat(soil * 1.2 + o.berm * 0.5), 0.0, pf(32u));
    if (fc > 0.0) {
      let q = xz / 0.0085;
      let i0 = vec2i(floor(q - 0.5));
      var cb = 0.0;
      for (var k = 0; k < 4; k++) {
        let ci = i0 + vec2i(k & 1, k >> 1u);
        let hh = hqi(vec3i(ci, 157));
        let c = vec2f(ci) + 0.1 + 0.8 * hh.xy - q;
        let rr = 0.25 + 0.3 * fract(hh.z * 3.1);
        cb = max(cb, sat(1.0 - dot(c, c) / (rr * rr)) * step(0.62, fract(hh.z * 7.3)) * (0.4 + 0.6 * hh.z));
      }
      let clod = smoothstep(-0.25, 0.45, gnoise2(xz * 18.0, 159));
      o.crumb = cb * (0.2 + 0.8 * clod);
      h += o.crumb * 0.0013 * fc;
    }
    let ft = dfade(0.003);
    if (ft > 0.0 && r > 0.42) {
      let q2 = xz * 7.0;
      let i2 = vec2i(floor(q2)); let f2 = q2 - floor(q2);
      var tw = 0.0;
      for (var k = 0; k < 9; k++) {
        let off = vec2i(k % 3 - 1, k / 3 - 1);
        let hh = hqi(vec3i(i2 + off, 53));
        if (hh.z > 0.5) { continue; }
        let dir = normalize(vec2f(fract(hh.z * 17.0), fract(hh.z * 41.0)) - 0.5 + 1e-4);
        let c = vec2f(off) + 0.2 + 0.6 * hh.xy - f2;
        let L = 0.15 + 0.35 * fract(hh.z * 5.3);
        let al = dot(-c, dir);
        let along = clamp(al, -L, L);
        let rt = 0.0012 + 0.003 * fract(hh.z * 11.0);
        let bend = 0.6 * rt * sin(along * 5.0 + hh.x * 6.0);
        let dperp = abs(dot(-c, vec2f(-dir.y, dir.x)) / 7.0 + bend);
        let dl = max(abs(al) - L, 0.0) / 7.0;
        let d = length(vec2f(dperp, dl));
        let b = sat(1.0 - d * d / (rt * rt));
        let th = sqrt(b) * rt * 1.4;
        if (th > tw) { tw = th; o.twigT = (along / L) * 0.5 + 0.5; o.twigH = hh.z; }
      }
      o.twig = tw * ft;
      h = max(h, hT + o.twig * 0.9);
    }
    h += gn3(vec3f(xz * 140.0, 2.0)) * 0.0004 * dfade(0.002);
  }
  o.h = h;
  return o;
}
fn groundH(xz: vec2f, detail: bool) -> f32 { return groundParts(xz, terrain(xz), detail).h; }
fn groundMax(r: f32) -> f32 { return 0.034 + select(0.0, 0.013, r > STONE_RMIN - 0.06) + bedBase(r / 0.39); }

fn chunkPlace(ci: vec2i, L: i32, ter: f32, rb: f32) -> vec4f {
  let h = hqi(vec3i(ci, 101 + L));
  let cxz = (vec2f(ci) + 0.2 + 0.6 * h.xy) * CC;
  let r = length(cxz);
  let rho = r / rb;
  var s = 0.0; var y = 0.0;
  if (rho < 1.04) {
    s = clamp(0.0108 * exp(0.7 * gauss(h.z)) * (1.0 - 0.35 * rho * rho) * select(1.0, 0.75, L == 1), 0.0035, select(0.0145, 0.0085, L == 1));
    let keep = select(0.98, 0.7, L == 1) * (1.0 - 0.5 * smoothstep(0.75, 1.04, rho));
    if (fract(h.z * 31.17) > keep) { s = 0.0; }
    y = ter + bedBase(rho) + select(0.1 * s, 0.004 + 0.6 * s, L == 1);
  } else if (L == 0 && r < EMBER_R) {
    let dens = 0.035 + 0.13 * (1.0 - smoothstep(0.0, 0.1, rho - 1.0));
    if (fract(h.z * 31.17) < dens) {
      s = 0.0025 + 0.0045 * fract(h.z * 7.7);
      y = ter + 0.25 * s;
    }
  }
  return vec4f(cxz.x, y, cxz.y, s);
}
struct ChunkG { F: mat3x3f, e: vec3f, hc: vec3f };
fn chunkGeo(ci: vec2i, L: i32, s: f32) -> ChunkG {
  let a = hqi(vec3i(ci, 111 + L));
  let b = hqi(vec3i(ci, 121 + L));
  let yaw = normalize(a.xy - 0.5 + 1e-4);
  let g0 = vec3f(yaw.x, 0.0, yaw.y);
  let up = normalize(vec3f((b.x - 0.5) * 1.6, 1.0, (b.y - 0.5) * 1.6));
  let g = normalize(g0 - up * dot(g0, up));
  let w = cross(g, up);
  let e = s * vec3f(1.0 + 0.6 * a.z, 0.45 + 0.3 * b.z, 0.6 + 0.35 * fract(a.z * 7.3 + b.z));
  return ChunkG(mat3x3f(g, up, w), e, hqi(vec3i(ci, 131 + L)));
}
fn chunkSDF(q: vec3f, e: vec3f, hc: vec3f) -> f32 {
  let rr = 0.28 * min(e.y, e.z);
  let qa = abs(q) - (e - rr);
  var d = length(max(qa, vec3f(0.0))) + min(max(qa.x, max(qa.y, qa.z)), 0.0) - rr;
  let sup = (e.x + e.y + e.z) * 0.57735;
  for (var k = 0; k < 3; k++) {
    let hk = fract(hc * (1.0 + 2.37 * f32(k)) + f32(k) * 0.31);
    let n = sign(hk - 0.5) * 0.57735;
    d = smax(d, dot(q, n) - sup * (0.55 + 0.3 * hk.x), rr * 0.5);
  }
  return d;
}
fn coalMax(r: f32) -> f32 { return select(0.03, 0.012 + bedBase(r / 0.39) + 0.037, r < 0.4); }
fn chunkId(ci: vec2i, L: i32) -> f32 { return f32(L * 4194304 + (ci.x + 1024) + (ci.y + 1024) * 2048); }
fn chunkCell(id: f32) -> vec3i {
  let k = i32(id + 0.5);
  let L = k / 4194304; let m = k - L * 4194304;
  return vec3i(m % 2048 - 1024, m / 2048 - 1024, L);
}
fn coalField(p: vec3f, ter0: f32, detail: bool) -> vec2f {
  let r = length(p.xz);
  if (r > EMBER_R + 0.03) { return vec2f(1e3, -1.0); }
  let bnd = p.y - coalMax(r);
  if (bnd > 0.008) { return vec2f(bnd, -1.0); }
  let ter = ter0 + 0.004;
  let rb = bedRadDir(p.xz / max(r, 1e-5));
  let bnd2 = p.y - (ter + select(0.012, bedBase(r / rb) + 0.036, r < rb * 1.05));
  if (bnd2 > 0.004) { return vec2f(bnd2, -1.0); }
  let ip = vec2i(floor(p.xz / CC));
  var best = vec2f(0.3 * CC + max(bnd2, 0.0), -1.0);
  let i2 = vec2i(floor(p.xz / CC - 0.5));
  for (var k = 0; k < 13; k++) {
    let L = select(0, 1, k >= 9);
    let kk = (k + 4) % 9;
    let ci = select(ip + vec2i(kk % 3 - 1, kk / 3 - 1), i2 + vec2i((k - 9) & 1, (k - 9) >> 1u), L == 1);
    let pl = chunkPlace(ci, L, ter, rb);
    if (pl.w <= 0.0) { continue; }
    let dc = p - pl.xyz;
    if (length(dc) - 1.95 * pl.w > best.x) { continue; }
    let G = chunkGeo(ci, L, pl.w);
    let d = chunkSDF(dc * G.F, G.e, G.hc);
    if (d < best.x) { best = vec2f(d, chunkId(ci, L)); }
  }
  if (detail && best.y >= 0.0 && best.x < 0.003) {
    best.x += gn3(p * 380.0) * 0.00035 * dfade(0.0015);
  }
  return best;
}

const PC = 0.034;
fn pebblePlace(ci: vec2i) -> vec4f {
  let h = hqi(vec3i(ci, 141));
  let cxz = (vec2f(ci) + 0.25 + 0.5 * h.xy) * PC;
  let r = length(cxz);
  let cl = hqi(vec3i(vec2i(floor(vec2f(ci) / 3.0)), 143)).x;
  let ringB = exp(-(r - 0.66) * (r - 0.66) / 0.012);
  let dens = (0.05 + 0.4 * ringB) * (0.2 + 1.6 * cl * cl) * smoothstep(0.42, 0.55, r);
  if (h.z > dens) { return vec4f(0.0); }
  let s = clamp(0.0045 * exp(1.1 * gauss(h.z * 3.7)), 0.0015, 0.0135);
  return vec4f(cxz, s, h.z);
}
fn pebbleSDF(p: vec3f, gh: f32, ci: vec2i, pl: vec4f) -> f32 {
  let hh = hqi(vec3i(ci, 147));
  let e = pl.z * vec3f(1.0 + 0.4 * hh.x, 0.8 + 0.25 * hh.y, 0.75 + 0.25 * hh.z);
  let c = vec3f(pl.x, gh - 0.22 * e.y, pl.y);
  var q = rotY(p - c, hh.x * 6.28) / e;
  q += 0.18 * vec3f(sin(q.y * 2.3 + hh.z * 9.0), sin(q.z * 2.1 + hh.x * 7.0), sin(q.x * 2.5 + hh.y * 8.0));
  return (length(q) - 1.0) * min(e.x, min(e.y, e.z)) * 0.65;
}
fn pebbleField(p: vec3f, gh: f32) -> vec2f {
  let q = p.xz / PC - 0.5;
  let i0 = vec2i(floor(q));
  var best = vec2f(1e3, -1.0);
  for (var k = 0; k < 4; k++) {
    let ci = i0 + vec2i(k & 1, k >> 1u);
    let pl = pebblePlace(ci);
    if (pl.z <= 0.0) { continue; }
    let d = pebbleSDF(p, gh, ci, pl);
    if (d < best.x) { best = vec2f(d, f32((ci.x + 1024) + (ci.y + 1024) * 2048)); }
  }
  return best;
}

fn heatAt(p: vec3f) -> f32 {
  let r = length(p.xz);
  return 1.0 - smoothstep(0.06, 0.5, r + 0.4 * max(p.y - 0.18, 0.0));
}
fn logClass(A: vec4f, B: vec4f) -> i32 {
  if (length(B.xyz - A.xyz) < 0.3) { return 2; }
  if (A.w < 0.05) { return 1; }
  return 0;
}
struct LogF { u: f32, x: f32, y: f32, len: f32, t: f32 };
fn logFrame(p: vec3f, A: vec3f, B: vec3f, i: i32, cls: i32) -> LogF {
  let ba = B - A; let len = length(ba); let ax = ba / len;
  let b1 = normalize(cross(ax, vec3f(0.37, 1.0, 0.21)));
  let b2 = cross(ax, b1);
  let pa = p - A; let u = dot(pa, ax);
  let t = sat(u / len);
  let hb = hqi(vec3i(i, 13, 9));
  let bow = (hb.x - 0.5) * 0.045 * len * 4.0 * t * (1.0 - t);
  let x0 = dot(pa, b1) - bow; let y0 = dot(pa, b2);
  var rv = normalize(hqi(vec3i(i, 13, 5)).xy - 0.5 + 1e-4);
  if (cls == 1) {
    let tw = (hb.z - 0.5) * 0.5 * (t - 0.5);
    let c = cos(tw); let s = sin(tw);
    rv = vec2f(rv.x * c - rv.y * s, rv.x * s + rv.y * c);
  }
  return LogF(u, rv.x * x0 - rv.y * y0, rv.y * x0 + rv.x * y0, len, t);
}
fn sdPie(p: vec2f, c: vec2f, r: f32) -> f32 {
  let q = vec2f(abs(p.x), p.y);
  let l = length(q) - r;
  let m = length(q - c * clamp(dot(q, c), 0.0, r));
  return max(l, m * sign(c.y * q.x - c.x * q.y));
}
const SPLIT_RW = 1.65;
const SPLIT_APEX = 0.62;
fn splitCS(i: i32) -> vec2f { return normalize(vec2f(0.72 + 0.35 * hqi(vec3i(i, 7, 1)).x, 1.0)); }
fn logSide(p: vec3f, f: LogF, r0: f32, cls: i32, i: i32, burn: f32) -> f32 {
  let hb = hqi(vec3i(i, 13, 9));
  let r = r0 * (1.0 + (hb.y - 0.5) * 0.16 * (2.0 * f.t - 1.0));
  let heat = heatAt(p) * burn;
  let lq = vec3f(f.u, f.x, f.y);
  let lump = gn3(lq * 11.0 + f32(i) * 3.1) * 0.75 + 0.25 * sin(lq.x * 61.0 + lq.y * 37.0 + f32(i)) * sin(lq.z * 43.0 - lq.x * 23.0);
  if (cls == 1) {
    let Rw = r * SPLIT_RW; let rr = r * 0.12;
    var d = sdPie(vec2f(f.x, f.y + Rw * SPLIT_APEX), splitCS(i), Rw - rr) - rr;
    d += r * (0.035 + 0.1 * heat) * lump;
    d += 0.0016 * gn3(vec3f(f.u * 5.0, f.x * 150.0, f.y * 150.0) + f32(i) * 7.0);
    return d;
  }
  var d = length(vec2f(f.x, f.y)) - r * (1.0 + (0.035 + 0.11 * heat) * lump);
  if (cls == 0) {
    for (var k = 0; k < 2; k++) {
      let hk = hqi(vec3i(i, 17, k));
      let kd = normalize(hqi(vec3i(i, 18, k)).xy - 0.5 + 1e-4);
      let kp = vec3f(f.len * (0.12 + 0.76 * hk.x), kd * r);
      let dd = lq - kp;
      d -= 0.0055 * exp(-dot(dd, dd) / (0.0004 + 0.0004 * hk.z));
    }
  }
  return d;
}
fn logBase(p: vec3f, f: LogF, r0: f32, cls: i32, i: i32, burn: f32) -> f32 {
  let d2 = logSide(p, f, r0, cls, i, burn);
  var e = r0 * 0.35;
  if (min(abs(f.u + e), abs(f.u - f.len - e)) < 0.02) { e += 0.004 * gn3(vec3f(f.x * 30.0, f.y * 30.0, f32(i))); }
  let dc = max(-f.u - e, f.u - f.len - e);
  return smax(d2, dc, r0 * (0.07 + 0.3 * heatAt(p) * burn));
}
fn logHollows(p: vec3f, i: i32, d0: f32) -> f32 {
  var d = d0;
  let nl = i32(R.nLogs);
  for (var j = 0; j < nl; j++) {
    if (j == i) { continue; }
    let Aj = logs[j * 2]; let Bj = logs[j * 2 + 1];
    let dj = sdCapsule(p, Aj.xyz, Bj.xyz, Aj.w * 1.08 + 0.003);
    if (dj < 0.03) { d = smax(d, -dj, 0.01); }
  }
  return d;
}
fn logChar(p: vec3f, burn: f32, i: i32) -> f32 {
  let h = heatAt(p) + 0.2 * gn3(p * 9.0 + f32(i) * 5.3);
  return burn * smoothstep(0.08, 0.35, h);
}
fn logBarkness(f: LogF, r: f32, cls: i32) -> f32 {
  if (cls == 2) { return 0.0; }
  if (cls == 0) { return 1.0; }
  let Rw = r * SPLIT_RW;
  return smoothstep(Rw * 0.82, Rw * 0.95, length(vec2f(f.x, f.y + Rw * SPLIT_APEX)));
}
fn logCap(f: LogF, r: f32) -> f32 { return smoothstep(0.12 * r, 0.28 * r, max(-f.u, f.u - f.len)); }
fn logPerim(f: LogF, r: f32, cls: i32, i: i32) -> vec2f {
  if (cls != 1) { return vec2f(atan2(f.y, f.x) / TAU + 0.5, TAU * r); }
  let Rw = r * SPLIT_RW;
  let q = vec2f(f.x, f.y + Rw * SPLIT_APEX);
  let cs = splitCS(i);
  let al = atan2(cs.x, cs.y);
  let th = atan2(q.x, q.y);
  let rho = length(q);
  let Pl = 2.0 * Rw * al + 2.0 * Rw;
  let dArc = abs(rho - Rw) + max(abs(th) - al, 0.0) * rho;
  let dFace = abs(rho * sin(abs(th) - al));
  var s = Rw * th;
  if (dFace < dArc) { s = sign(th) * (Rw * al + Rw - clamp(rho * cos(abs(th) - al), 0.0, Rw)); }
  return vec2f(s / Pl + 0.5, Pl);
}
fn charCell(cls: i32, burn: f32) -> vec2f {
  var cu = select(0.018, 0.0105, cls == 1);
  if (cls == 2) { cu = 0.014; }
  cu *= 0.85 + 0.3 * burn;
  return vec2f(cu, cu * 0.75);
}
fn charExposure(p: vec3f, burn: f32) -> f32 {
  let bedTop = bedBase(bedRho(p.xz)) + 0.016;
  let nearBed = (1.0 - smoothstep(0.0, 0.05, p.y - bedTop)) * (1.0 - smoothstep(0.34, 0.42, length(p.xz)));
  return max(heatAt(p) * burn, nearBed);
}
struct CharC { e: f32, w: f32, dep: f32, dome: f32, id: f32, eAll: f32, eGate: f32, id2: f32 };
fn rowGate(X: f32, j: i32, seed: i32, cu: f32) -> f32 {
  return smoothstep(-0.08, 0.08, vn1(X / (cu * 3.2), f32(j) * 1.37 + f32(seed) * 0.31) + 0.03);
}
fn rowT(X: f32, fy: f32, jw: i32, seed: i32, cu: f32) -> vec4f {
  let hr = hqi(vec3i(jw, seed, 7));
  let sx = 0.7 + 0.65 * hr.y;
  let x = X / cu * sx + hr.x * 5.0;
  let k = i32(floor(x));
  var lo = -1e3; var hi = 1e3; var hcl = 0.0; var hch = 0.0; var hb0 = 0.0;
  let fc = fy - 0.5;
  for (var mm = -1; mm <= 2; mm++) {
    let m = k + mm;
    let hb = hqi(vec3i(m, jw, seed + 3));
    let b = f32(m) + 0.75 * (hb.x - 0.5) + fc * 0.8 * (hb.z - 0.5) + fc * fc * 1.2 * (fract(hb.y * 7.9) - 0.5);
    if (b <= x) { if (b > lo) { lo = b; hcl = hb.y; hb0 = hb.z; } } else { if (b < hi) { hi = b; hch = hb.y; } }
  }
  let dLo = x - lo; let dHi = hi - x;
  return vec4f(min(dLo, dHi) * cu / sx, select(hch, hcl, dLo < dHi), hb0, (hi - lo) * cu / sx);
}
fn partCrack(h: f32, fy: f32) -> f32 {
  let k = fract(h * 5.7);
  if (k > 0.35) { return 1.0; }
  return select(smoothstep(0.75, 0.45, fy), smoothstep(0.25, 0.55, fy), k < 0.17);
}
fn crackW(h: f32, wk: f32) -> f32 { return (0.22 + 1.05 * h * h) * wk * 0.001; }
fn crackDep(d: f32, w: f32) -> f32 {
  if (w <= 1e-6) { return 0.0; }
  let x = sat(1.0 - d / w);
  return min(1.8 * w, 0.0055) * x * sqrt(x);
}
fn charCells(X: f32, a01: f32, P: f32, cu: f32, cs: f32, seed: i32, wk: f32) -> CharC {
  let Nf = max(3.0, round(P / cs));
  let Ni = i32(Nf);
  let csN = P / Nf;
  let ph = a01 * TAU; let sd = f32(seed);
  let warp = 0.17 * sin(X * 23.0 + ph + sd * 1.7) + 0.12 * sin(X * 41.0 - 2.0 * ph + sd * 4.1) + 0.07 * sin(X * 97.0 + 3.0 * ph + sd);
  let wkp = wk * (0.6 + 0.8 * smoothstep(-0.6, 0.6, sin(X * 9.0 - ph + sd * 2.3) * sin(X * 5.3 + 2.0 * ph + sd)));
  let y = a01 * Nf + warp;
  let j = i32(floor(y)); let fy = y - floor(y);
  let jw = ((j % Ni) + Ni) % Ni;
  let up = fy > 0.5;
  let jnw = (((j + select(-1, 1, up)) % Ni) + Ni) % Ni;
  let dB = min(fy, 1.0 - fy) * csN;
  let oLo = rowGate(X, jw, seed, cu);
  let oHi = rowGate(X, (jw + 1) % Ni, seed, cu);
  let oNear = select(oLo, oHi, up);
  let hs = hqi(vec3i(jw, seed, 9));
  let oSp = smoothstep(-0.08, 0.08, vn1(X / (cu * 2.4), f32(jw) * 2.11 + 7.0) - 0.45);
  let dSp = abs(fy - 0.5) * csN;
  let fyN = select(fy + 1.0, fy - 1.0, up);
  let tO = rowT(X, fy, jw, seed, cu);
  let tN = rowT(X, fyN, jnw, seed, cu);
  let wNb = (1.0 - oNear) * (1.0 - smoothstep(0.0, 0.45 * csN, dB));
  let pt1 = partCrack(tO.y, fy);
  let pt2 = wNb * partCrack(tN.y, sat(fyN));
  let wT1 = crackW(tO.y, wkp) * pt1;
  let wT2 = crackW(tN.y, wkp) * pt2;
  let wL0 = (0.1 + 0.3 * hs.x) * wkp * 0.001;
  let wLo = wL0 * oLo; let wHi = (0.1 + 0.3 * hqi(vec3i((jw + 1) % Ni, seed, 9)).x) * wkp * 0.001 * oHi;
  let wSp = wL0 * 0.7 * oSp;
  let dLo = fy * csN; let dHi = (1.0 - fy) * csN;
  var dep = max(max(crackDep(tO.x, wT1), crackDep(tN.x, wT2)), max(max(crackDep(dLo, wLo), crackDep(dHi, wHi)), crackDep(dSp, wSp)));
  var eAct = tO.x - wT1; var wAct = wT1; var id2 = tO.y;
  if (wT2 > 1e-5 && tN.x - wT2 < eAct) { eAct = tN.x - wT2; wAct = wT2; id2 = tN.y; }
  if (wLo > 1e-5 && dLo - wLo < eAct) { eAct = dLo - wLo; wAct = wLo; id2 = hs.y; }
  if (wHi > 1e-5 && dHi - wHi < eAct) { eAct = dHi - wHi; wAct = wHi; id2 = hs.z; }
  if (wSp > 1e-5 && dSp - wSp < eAct) { eAct = dSp - wSp; wAct = wSp; id2 = hs.z * 3.1; }
  let dA = min(min(dLo / max(oLo, 1e-3), dHi / max(oHi, 1e-3)), dSp / max(oSp, 1e-3));
  let dU = min(tO.x / max(pt1, 1e-3), tN.x / max(pt2, 1e-3));
  let cA = 1.0 - min(dA / (0.5 * csN), 1.0);
  let cU = 1.0 - min(dU / (0.45 * tO.w), 1.0);
  let dome = (1.0 - cA * cA * cA) * (1.0 - cU * cU * cU);
  let eAll = min(min(dB, tO.x), select(1.0, dSp, oSp > 0.5));
  let eGate = select(1.0, dB, oNear < 0.5);
  let id = fract(tO.z + hs.x * 3.7 + select(0.0, 0.37, oSp > 0.5 && fy > 0.5));
  return CharC(eAct, wAct, dep, dome, id, eAll, eGate, id2);
}
fn charRelief(c: CharC, cs: f32) -> f32 {
  let hd = cs * (0.05 + 0.06 * fract(c.id * 5.31));
  let sink = (fract(c.id * 11.7) - 0.5) * 0.002 * smoothstep(0.0, 0.3 * cs, c.eGate);
  let pit = select(0.0, 0.0045 * smoothstep(0.0, 0.003, c.eAll), fract(c.id * 23.3) < 0.04);
  return c.dep + sink + pit - hd * c.dome;
}
fn logDisp(p: vec3f, f: LogF, A: vec4f, B: vec4f, i: i32, cls: i32) -> vec2f {
  let r = A.w;
  let ch = logChar(p, B.w, i);
  let capF = logCap(f, r);
  var disp = 0.0; var stp = 0.9;
  if (ch > 0.05 && capF < 0.999) {
    let cz = charCell(cls, B.w);
    let fa = dfade(cz.y * 0.35);
    if (fa > 0.0) {
      let pc = logPerim(f, r, cls, i);
      let wk = 0.55 + 1.7 * charExposure(p, B.w);
      let c = charCells(f.u, pc.x, pc.y, cz.x, cz.y, i, wk);
      disp += charRelief(c, cz.y) * smoothstep(0.05, 0.4, ch) * (1.0 - capF) * fa;
      stp = mix(0.5, 0.9, smoothstep(0.0, 2.0 * c.w + 0.004, c.e + c.w));
    }
  }
  let bk = logBarkness(f, r, cls) * (1.0 - smoothstep(0.15, 0.6, ch)) * (1.0 - capF);
  if (bk > 0.02) {
    let fa = dfade(0.005);
    if (fa > 0.0) {
      let ang = atan2(f.y, f.x);
      let ca = cos(ang) * r; let sa = sin(ang) * r;
      let rn = abs(gn3(vec3f(f.u * 6.0, ca * 95.0, sa * 95.0) + f32(i) * 2.0));
      let rn2 = gn3(vec3f(f.u * 2.5, ca * 30.0, sa * 30.0) - f32(i));
      let furrow = 1.0 - smoothstep(0.0, 0.2, rn);
      disp += bk * (0.0035 * furrow - 0.0009 * rn2) * fa;
    }
  }
  if (capF > 0.01 && ch < 0.98) {
    let hc = hqi(vec3i(i, 19, select(0, 1, f.u > f.len * 0.5)));
    let kd = normalize(hc.yz - 0.5 + 1e-4);
    disp += 0.00035 * sin(dot(vec2f(f.x, f.y), kd) * 900.0 + 3.0 * gn3(vec3f(f.x * 25.0, f.y * 25.0, 1.0))) * capF * dfade(0.004);
  }
  return vec2f(disp, stp);
}
fn logSDF(p: vec3f, i: i32, detail: bool) -> f32 {
  let A = logs[i * 2]; let B = logs[i * 2 + 1];
  let bnd = sdCapsule(p, A.xyz, B.xyz, A.w * 1.55 + 0.01);
  if (bnd > 0.012) { return bnd; }
  let cls = logClass(A, B);
  let f = logFrame(p, A.xyz, B.xyz, i, cls);
  var d = logBase(p, f, A.w, cls, i, B.w) + burnThin(p, A.w, B.w);
  if (d < 0.03) { d = logHollows(p, i, d); }
  if (detail && d < 0.012 && !pf(8u)) {
    let ld = logDisp(p, f, A, B, i, cls);
    let fo = smoothstep(0.009, 0.012, d);
    return (d + ld.x * (1.0 - fo)) * mix(ld.y, 0.9, fo);
  }
  return d * 0.85;
}

fn stoneKind(S: vec4f) -> i32 { return i32(floor(S.w)); }
fn stoneSDF(p: vec3f, i: i32, detail: bool) -> f32 {
  let C = stones[i * 2]; let S = stones[i * 2 + 1];
  let ext = max(S.x, max(S.y, S.z));
  let bound = max(length(p - C.xyz) - ext * 0.98, p.y - C.y - S.y * 0.9 - 0.008);
  if (bound > 0.02) { return bound; }
  var lp = rotY(p - C.xyz, C.w);
  let hs = hqi(vec3i(i, 61, 1));
  let wf = 4.0 / ext;
  lp += 0.1 * ext * vec3f(sin(lp.y * wf + hs.x * 6.0), sin(lp.z * wf * 0.8 + hs.y * 6.0), sin(lp.x * wf * 0.9 + hs.z * 6.0));
  var d = sdEllipsoid(lp, S.xyz);
  for (var k = 0; k < 16; k++) {
    let h = hqi(vec3i(i, k, 67));
    var nk = h * 2.0 - 1.0;
    if (k < 12) { nk.y = abs(nk.y) * 0.85 + 0.05; }
    nk = normalize(nk);
    let sup = length(S.xyz * nk);
    d = smax(d, dot(lp, nk) - sup * (0.47 + 0.22 * fract(h.z * 9.7)), 0.0035 + 0.002 * h.x);
  }
  let nf = i32(1.0 + 1.99 * hs.z);
  for (var k = 0; k < nf; k++) {
    let h = hqi(vec3i(i, k, 71));
    let nk = normalize(vec3f(h.x - 0.5, 0.25 + 0.5 * h.y, h.z - 0.5));
    let sup = length(S.xyz * nk);
    d = smax(d, dot(lp, nk) - sup * (0.42 + 0.08 * h.y), 0.003);
  }
  if (detail && d < 0.008) {
    let sd = fract(S.w) * 97.0;
    d += ext * 0.02 * gn3(lp / ext * 5.0 + sd + 3.0) * dfade(0.01);
    let a = dfade(0.005);
    let q = lp * 38.0 + sd;
    let chip = 1.0 - abs(gn3(q));
    d += (gn3(q * 0.6) * 0.0011 - chip * chip * 0.001) * a + gn3(lp * 150.0 + sd) * 0.0003 * dfade(0.0015);
  }
  return d * 0.8;
}

fn mapScene(p: vec3f, detail: bool) -> vec3f {
  let r = length(p.xz);
  var res = vec3f((p.y - groundMax(r)) * 0.9, 3.0, 0.0);
  let nearG = res.x < 0.015;
  let nearC = r < EMBER_R + 0.03 && p.y < coalMax(r) + 0.008;
  var ter = 0.0;
  if (nearG || nearC) { ter = terrain(p.xz); }
  if (nearG) {
    let gh = groundParts(p.xz, ter, detail).h;
    res.x = (p.y - gh) * select(0.85, 0.6, detail);
    if (gDet > 0.01 && r > 0.42 && p.y - gh < 0.016 && !pf(2u)) {
      let pb = pebbleField(p, gh);
      if (pb.x < res.x) { res = vec3f(pb.x, 5.0, pb.y); }
    }
  }
  if (nearC && !pf(4u)) {
    let cf = coalField(p, ter, detail);
    if (cf.x < res.x) { res = vec3f(cf.x, 4.0, cf.y); }
  } else if (r < EMBER_R + 0.03) { res.x = min(res.x, p.y - coalMax(r)); }
  var dS = max(max(STONE_RMIN - r, r - STONE_RMAX), p.y - STONE_YMAX);
  if (dS < 0.02) {
    var si = -1.0; var dTrue = 1e9;
    let ns = i32(R.nStones);
    for (var i = 0; i < ns; i++) {
      let d = stoneSDF(p, i, detail);
      if (d < dTrue) { dTrue = d; si = f32(i); }
    }
    if (dTrue < res.x) { res = vec3f(dTrue, 2.0, si); }
  } else { res.x = min(res.x, dS); }
  let nl = i32(R.nLogs);
  for (var i = 0; i < nl; i++) {
    let d = logSDF(p, i, detail);
    if (d < res.x) { res = vec3f(d, 1.0, f32(i)); }
  }
  return res;
}
fn mapHit(p: vec3f, mat: f32, idx: i32, detail: bool) -> f32 {
  if (mat < 1.5) { return logSDF(p, idx, detail); }
  if (mat < 2.5) { return stoneSDF(p, idx, detail); }
  if (mat < 4.5) { return coalField(p, terrain(p.xz), detail).x; }
  let gh = groundH(p.xz, detail);
  return pebbleField(p, gh).x;
}
fn hitNormal(p: vec3f, e: f32, mat: f32, idx: i32, detail: bool) -> vec3f {
  let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * mapHit(p + k.xyy * e, mat, idx, detail) + k.yyx * mapHit(p + k.yyx * e, mat, idx, detail) +
                   k.yxy * mapHit(p + k.yxy * e, mat, idx, detail) + k.xxx * mapHit(p + k.xxx * e, mat, idx, detail));
}
fn groundNormal(xz: vec2f, e: f32, detail: bool) -> vec3f {
  let h0 = groundH(xz, detail);
  let hx = groundH(xz + vec2f(e, 0.0), detail);
  let hz = groundH(xz + vec2f(0.0, e), detail);
  return normalize(vec3f(h0 - hx, e, h0 - hz));
}
fn ambientOcc(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0; var sca = 1.0;
  for (var i = 1; i <= 3; i++) {
    let h = 0.006 + 0.018 * f32(i);
    occ += (h - mapScene(p + n * h, false).x) * sca;
    sca *= 0.65;
  }
  return clamp(1.0 - 3.5 * occ, 0.0, 1.0);
}
`

export const SCENE_SURFACE_GEO = /* wgsl */ `
@group(0) @binding(5) var bbT: texture_2d<f32>;
@group(0) @binding(6) var depthOut: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var gGeoOut: texture_storage_2d<rg32uint, write>;
@group(0) @binding(8) var gAlbOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var gEmitOut: texture_storage_2d<rgba16float, write>;

struct Surf { alb: vec3f, emit: vec3f, rough: f32, n: vec3f, occ: f32, lit: f32, spec: f32, phase: f32 };

fn crackGlow(eb: f32, w: f32, Lc: f32, Tc: f32, Tf: f32) -> vec3f {
  let ef = bbLoadRaw(bbT, Tf);
  let lc = 0.45 * w + 1e-5; let lcE = lc + 0.4 * gFoot;
  let ll = 0.5 * w + Lc;    let llE = ll + 0.5 * gFoot;
  let wc = exp(-eb / lcE) * lc / lcE;
  let wl = exp(-eb / llE) * ll / llE;
  let Tm = Tf + 0.55 * (Tc - Tf);
  return ef + (bbLoadRaw(bbT, Tm) - ef) * wl + (bbLoadRaw(bbT, Tc) - bbLoadRaw(bbT, Tm)) * wc;
}

struct CapS { alb: vec3f, emit: vec3f, chc: f32, occ: f32 };
fn capShade(p: vec3f, f: LogF, r0: f32, cls: i32, li: i32, burn: f32, X: f32, dSide: f32) -> CapS {
  let hc = hqi(vec3i(li, 19, select(0, 1, f.u > f.len * 0.5)));
  var pc = normalize(hc.xy - 0.5 + 1e-4) * r0 * (0.1 + 0.15 * hc.z);
  if (cls == 1) { pc = vec2f(0.0, -r0 * SPLIT_RW * SPLIT_APEX); }
  var q = vec2f(f.x, f.y) - pc;
  q.y *= 1.0 + 0.08 * hc.x;
  let rp = length(q) + 0.0025 * gn3(vec3f(q * 14.0, f32(li) * 1.3));
  let ang = atan2(q.y, q.x);
  let edge = max(-dSide, 0.0);
  let ph = rp * 230.0 + 2.6 * gnoise2(vec2f(rp * 24.0, hc.z * 50.0), 9);
  let ring = fract(ph);
  let rc = fract(floor(ph) * 0.618 + hc.x);
  let fR = dfade(0.004);
  let late = smoothstep(0.6, 0.88, ring) * (1.0 - smoothstep(0.93, 1.0, ring)) * (0.35 + 0.65 * rc) * fR;
  var wood = vec3f(0.40, 0.28, 0.16) * (0.92 + 0.12 * gn3(vec3f(q * 60.0, 3.0)));
  wood *= 1.0 - 0.3 * late;
  let rindW = 0.006 + 0.003 * gn3(vec3f(q * 30.0, 7.0));
  let sap = smoothstep(rindW, rindW + 0.004, edge) * (1.0 - smoothstep(0.022, 0.032, edge));
  wood = mix(wood * vec3f(0.85, 0.78, 0.72), wood * 1.1, sap + (1.0 - smoothstep(rindW, rindW + 0.004, edge)));
  let rind = (1.0 - smoothstep(rindW - 0.001, rindW + 0.001, edge)) * select(1.0, smoothstep(-0.2, 0.2, f.y), cls == 1);
  wood = mix(wood, vec3f(0.055, 0.04, 0.03) * (0.8 + 0.4 * gn3(vec3f(q * 200.0, 2.0))), rind);
  var chk = 0.0;
  let nck = 4 + i32(hc.z * 4.99);
  for (var k = 0; k < 8; k++) {
    if (k >= nck) { break; }
    let hk = hqi(vec3i(li, 23, k));
    let da = abs(fract((ang - hk.x * TAU) / TAU + 0.5) - 0.5) * TAU * rp;
    let wv = (0.0002 + 0.0012 * hk.y) * sat((rp / r0 - 0.2 - 0.35 * hk.z) * 2.0);
    chk = max(chk, (1.0 - smoothstep(0.0, wv + 0.5 * gFoot, da)) * (wv / (wv + 0.5 * gFoot + 1e-6)));
  }
  let kd = normalize(hc.yz - 0.5 + 1e-4);
  let kerf = sin(dot(q, kd) * 900.0 + 3.0 * gn3(vec3f(q * 25.0, 1.0))) * dfade(0.004);
  wood *= (1.0 - 0.75 * chk) * (1.0 + 0.03 * kerf);
  let heatE = heatAt(p) * burn;
  let rimW = 0.008 + 0.03 * heatE;
  var chc = max(smoothstep(-0.004, 0.004, rimW - edge), smoothstep(0.42, 0.62, heatE));
  if (cls == 2) { chc = 1.0; }
  let ph2 = ph * 0.5;
  let ri = floor(ph2); let fr = fract(ph2);
  let dRing = min(fr, 1.0 - fr) / 115.0;
  let gate = step(0.3, fract(ri * 0.73 + hc.y));
  let Mk = max(3.0, round(TAU * (ri + 0.5) / 115.0 / 0.0075));
  let a01 = (ang / TAU + 0.5) * Mk + fract(ri * 0.37);
  let dRad = (0.5 - abs(fract(a01) - 0.5)) * TAU * max(rp, 1e-4) / Mk;
  let eb = min(select(1.0, dRing, gate > 0.5), dRad);
  let wc = 0.0003 + 0.001 * X;
  let cov = (1.0 - smoothstep(0.0, wc + 0.5 * gFoot, eb)) * (wc / (wc + 0.5 * gFoot));
  let charC = vec3f(0.03, 0.029, 0.03) * (0.8 + 0.4 * fract(ri * 0.37 + floor(a01) * 0.13));
  let alb = mix(wood, charC * (1.0 - 0.5 * cov), chc);
  let Tc = 860.0 + 250.0 * X;
  let Tf = 420.0 + 450.0 * pow(X, 1.6);
  let em = crackGlow(eb, wc, 0.0006 + 0.0015 * X, Tc, Tf) * smoothstep(0.6, 1.0, chc);
  return CapS(alb, em, chc, 1.0 - 0.6 * cov * chc - 0.5 * chk * (1.0 - chc));
}

fn shadeLog(p: vec3f, n: vec3f, li: i32) -> Surf {
  let A = logs[li * 2]; let B = logs[li * 2 + 1];
  let r = A.w; let cls = logClass(A, B);
  let f = logFrame(p, A.xyz, B.xyz, li, cls);
  let capF = logCap(f, r);
  let ch = logChar(p, B.w, li);
  let bark = logBarkness(f, r, cls) * (1.0 - capF);
  let bedTop = coalTer(p.xz) + bedBase(bedRho(p.xz)) + 0.02;
  let rr = length(p.xz);
  let inBedR = 1.0 - smoothstep(0.32, 0.42, rr);
  let inBed = (1.0 - smoothstep(0.0, 0.05, p.y - bedTop)) * inBedR;
  let overBed = sat(-n.y * 1.5) * (1.0 - smoothstep(0.04, 0.25, p.y - bedTop)) * inBedR;
  let toC = normalize(vec3f(-p.x, 0.25 - p.y, -p.z));
  let facing = sat(0.5 + 0.5 * dot(n, toC));
  var X = max(max(inBed * 0.95, overBed), heatAt(p) * B.w * (0.4 + 0.6 * facing));
  X = clamp(X * R.glowTemp, 0.0, 1.25);
  let ang = atan2(f.y, f.x);
  let ca = cos(ang) * r; let sa = sin(ang) * r;
  let rn = abs(gn3(vec3f(f.u * 6.0, ca * 95.0, sa * 95.0) + f32(li) * 2.0));
  let furrow = 1.0 - smoothstep(0.0, 0.2 + gFoot * 10.0, rn);
  let g1 = gn3(vec3f(f.u * 30.0, ca * 160.0, sa * 160.0) + f32(li)) * 0.5 + 0.5;
  let barkC = mix(vec3f(0.062, 0.047, 0.036) * (0.75 + 0.5 * g1), vec3f(0.018, 0.013, 0.01), furrow) *
              (0.8 + 0.4 * (gn3(vec3f(f.u * 3.0, ca * 20.0, sa * 20.0)) * 0.5 + 0.5));
  let fib = gn3(vec3f(f.u * 8.0, f.x * 420.0, f.y * 420.0)) * dfade(0.0015);
  let fib2 = gn3(vec3f(f.u * 2.0, f.x * 90.0, f.y * 90.0)) * 0.5 + 0.5;
  let dash = smoothstep(0.2, 0.5, gn3(vec3f(f.u * 40.0, f.x * 300.0, f.y * 300.0) + 3.0));
  let woodC = vec3f(0.42, 0.30, 0.17) * (0.8 + 0.25 * fib2) * (1.0 - 0.18 * smoothstep(0.3, 0.6, fib) * dash);
  var alb = mix(woodC, barkC, bark);
  let scorch = smoothstep(0.0, 0.25, ch);
  alb = mix(alb, mix(vec3f(0.07, 0.035, 0.018), vec3f(0.03, 0.02, 0.015), sat(ch * 3.0)), scorch * (1.0 - 0.4 * bark));
  let cz = charCell(cls, B.w);
  let pc = logPerim(f, r, cls, li);
  let wk = 0.55 + 1.7 * charExposure(p, B.w);
  let cc = charCells(f.u, pc.x, pc.y, cz.x, cz.y, li, wk);
  let charAmt = smoothstep(0.25, 0.6, ch) * (1.0 - capF);
  let eb = max(cc.e + cc.w, 0.0);
  let wEff = cc.w + 0.5 * gFoot;
  let crack = (1.0 - smoothstep(0.0, wEff, eb)) * (cc.w / wEff) * charAmt;
  let charC = vec3f(0.031, 0.03, 0.032) * (0.82 + 0.36 * fract(cc.id * 5.1));
  alb = mix(alb, charC, charAmt);
  alb *= 1.0 - 0.55 * crack;
  let lq = vec3f(f.u, f.x, f.y);
  let an = fb3(lq * 28.0 + f32(li) * 3.0, 2) * 0.5 + 0.5;
  let an2 = gn3(lq * 160.0) * 0.5 + 0.5;
  var ash = smoothstep(0.55, 0.7, an + 0.3 * n.y - 0.25 * X + 0.15 * (1.0 - heatAt(p))) * smoothstep(0.45, 0.85, ch);
  ash *= smoothstep(0.0, 0.0015 + gFoot, cc.e) * (0.6 + 0.4 * cc.dome) * (1.0 - capF);
  let ashC = vec3f(0.44, 0.43, 0.42) * (0.82 + 0.3 * an2);
  alb = mix(alb, ashC, ash * 0.92);
  let openC = 0.6 + 0.4 * fract(cc.id2 * 3.7 + cc.id);
  let hot = smoothstep(0.85, 1.1, X) * smoothstep(0.9, 1.0, B.w);
  let Tc = 900.0 + 290.0 * X * openC;
  let Tf = mix(430.0 + 470.0 * pow(X, 1.6), 960.0 + 70.0 * cc.dome, hot);
  let Lc = 0.0006 + 0.0026 * X * X;
  let glowable = smoothstep(0.35, 0.75, ch) * (1.0 - capF);
  var emit = crackGlow(eb, cc.w, Lc, Tc, Tf) * (1.0 - 0.9 * ash) * glowable;
  let fl = gn3(lq * 520.0 + f32(li) * 3.7);
  let fleck = smoothstep(0.66, 0.76, fl) * glowable * smoothstep(0.55, 0.95, X) * (1.0 - ash) * dfade(0.002);
  emit += bbLoadRaw(bbT, Tc - 40.0) * fleck * 0.7;
  var rough = mix(mix(0.72, 0.85, bark), 0.74 - 0.12 * cc.dome, charAmt);
  rough = mix(rough, 0.95, ash);
  var occ = 1.0 - 0.7 * crack - 0.45 * furrow * bark * (1.0 - charAmt);
  if (capF > 0.001) {
    let dSide = logSide(p, f, r, cls, li, B.w);
    let cs = capShade(p, f, r, cls, li, B.w, X, dSide);
    alb = mix(alb, cs.alb, capF);
    emit = mix(emit, cs.emit, capF);
    occ = mix(occ, cs.occ, capF);
    rough = mix(rough, mix(0.75, 0.6, cs.chc), capF);
  }
  return Surf(alb, emit, rough, n, occ, 1.0, mix(1.0, 0.5, charAmt), cc.id);
}

fn shadeCoal(p: vec3f, n: vec3f, id: f32) -> Surf {
  let cl = chunkCell(id);
  let ci = cl.xy; let L = cl.z;
  let pl = chunkPlace(ci, L, coalTer(p.xz), bedRadDir(p.xz / max(length(p.xz), 1e-5)));
  let G = chunkGeo(ci, L, pl.w);
  let q = (p - pl.xyz) * G.F;
  let hh = hqi(vec3i(ci, 161 + L));
  let rc = length(pl.xz);
  let rho = rc / bedRadDir(p.xz / max(length(p.xz), 1e-5));
  let sp = 0.0045 + 0.0035 * hh.x;
  let tx = q.x / sp + hh.z * 7.0 + 0.3 * gn3(q * 110.0 + hh * 9.0);
  let dT = (0.5 - abs(fract(tx) - 0.5)) * sp;
  let gate = smoothstep(-0.25, 0.15, gn3(vec3f(floor(tx) * 1.7, q.y * 80.0, q.z * 80.0) + hh * 5.0));
  let lz = abs(gn3(vec3f(q.x * 35.0, q.y * 170.0, q.z * 170.0) + hh * 3.0)) / 250.0;
  let wF = 0.00045;
  let wE = wF + 0.5 * gFoot;
  let fis = max((1.0 - smoothstep(0.0, wE, dT)) * gate, (1.0 - smoothstep(0.0, wE * 0.8, lz)) * 0.8) * (wF / wE);
  var alb = vec3f(0.03, 0.029, 0.03) * (0.85 + 0.35 * hh.x);
  var T = 400.0;
  var ashC = 0.0;
  var spec = 0.6;
  if (rho < 1.04) {
    let topEnv = coalTer(p.xz) + bedBase(bedRho(p.xz)) + 0.022;
    let cav = sat((topEnv - p.y) / 0.022);
    let up = sat(n.y);
    let exposed = sat((1.0 - cav) * (0.6 + 0.4 * up) * 1.6);
    let deep = smoothstep(0.55, 0.95, max(cav, sat(-n.y * 1.2)));
    let kindU = fract(hh.z * 7.7);
    let fresh = step(kindU, 0.25);
    let ashy = step(0.9 - 0.3 * smoothstep(0.6, 1.0, rho), kindU);
    let bedHeat = sat(1.0 - rho * rho);
    let Tbody = 975.0 + 85.0 * bedHeat + 50.0 * (hh.y - 0.5) - select(0.0, 45.0, L == 1);
    let Tcrust = mix(650.0 + 180.0 * hh.x, Tbody - 60.0, fresh * 0.7);
    let crustA = smoothstep(0.25, 0.7, exposed) * (1.0 - 0.75 * fis);
    T = mix(Tbody, Tcrust, crustA) + 95.0 * deep * (0.5 + 0.5 * bedHeat);
    T = mix(T, 740.0 + 150.0 * bedHeat, 0.6 * smoothstep(0.85, 1.04, rho));
    let an = gn3(q * 260.0 + hh * 4.0) * 0.5 + 0.5;
    ashC = ashy * smoothstep(0.3, 0.65, exposed + 0.3 * an - 0.25 * fis);
    alb = mix(alb, vec3f(0.36, 0.35, 0.34) * (0.7 + 0.4 * an), ashC);
    spec = mix(0.5, 0.0, ashC);
  } else {
    if (hh.x < 0.3) { T = 850.0 + 150.0 * hh.y - 120.0 * sat(n.y) * fract(hh.z * 3.3); }
  }
  let emit = bbLoadRaw(bbT, T) * (1.0 - 0.92 * ashC);
  let glow = smoothstep(760.0, 950.0, T) * (1.0 - ashC);
  return Surf(alb, emit, mix(0.7, 0.95, ashC), n, 1.0 - 0.4 * fis, 1.0 - glow, spec * (1.0 - glow), hh.z);
}

fn shadeStone(p: vec3f, n: vec3f, si: i32) -> Surf {
  let C = stones[si * 2]; let S = stones[si * 2 + 1];
  let lp = rotY(p - C.xyz, C.w);
  let kind = stoneKind(S);
  let sd = fract(S.w) * 97.0;
  let hs = hqi(vec3i(si, 61, 3));
  let tone = 0.62 + 0.76 * hs.x;
  let m1 = fb3(lp * 15.0 + sd, 3);
  let m2 = gn3(lp * 38.0 + sd + 7.0);
  var base = vec3f(0.29, 0.28, 0.27);
  if (kind == 1) { base = vec3f(0.36, 0.27, 0.18); }
  else if (kind == 2) { base = vec3f(0.105, 0.105, 0.11); }
  else if (kind == 3) { base = vec3f(0.43, 0.41, 0.38); }
  if (kind == 0 && hs.y > 0.6) { base = vec3f(0.33, 0.27, 0.25); }
  var alb = base * tone * (0.82 + 0.32 * m1);
  let lum = dot(alb, vec3f(0.3, 0.59, 0.11));
  alb = mix(alb, vec3f(lum * 1.2), 0.3 * sat(n.y) * sat(m2 + 0.6));
  let iron = smoothstep(0.1, 0.45, fb3(lp * 10.0 + sd + 5.0, 2)) * step(0.4, hs.z);
  alb = mix(alb, alb * vec3f(1.3, 0.85, 0.55), iron * 0.55);
  if (kind == 1) {
    let band = sin(dot(lp, normalize(vec3f(0.2, 1.0, 0.15))) * 220.0 + m1 * 5.0) * 0.5 + 0.5;
    alb *= 0.9 + 0.18 * band * dfade(0.006);
  }
  let fG = dfade(0.0005);
  if (fG > 0.0) {
    let gA = gn3(lp * 380.0 + sd);
    let gB = gn3(lp * 290.0 + sd + 11.0);
    let gw = 0.07 + gFoot * 100.0;
    var g = alb;
    if (kind == 0) {
      g = mix(g, g * vec3f(1.25, 1.05, 1.0), smoothstep(0.3 - gw, 0.3 + gw, gB));
      g = mix(g, vec3f(lum * 1.5), smoothstep(-0.45 + gw, -0.45 - gw, gB));
      g = mix(g, vec3f(0.05), smoothstep(0.5 - gw, 0.5 + gw, gA));
    } else if (kind == 2) {
      g *= 0.85 + 0.35 * (gA * 0.5 + 0.5);
    } else {
      g *= 0.9 + 0.2 * (gA * 0.5 + 0.5);
    }
    alb = mix(alb, g, 0.7 * fG);
  }
  if (kind != 1 && hs.z > 0.55) {
    let vn = abs(gn3(lp * 11.0 + sd + 3.3));
    let vw = 0.02 + gFoot * 20.0;
    let vein = (1.0 - smoothstep(0.0, vw, vn)) * (0.02 / vw) * smoothstep(-0.2, 0.3, gn3(lp * 5.0 + sd));
    alb = mix(alb, vec3f(0.5, 0.49, 0.47), vein * 0.5);
  }
  let fz = abs(gn3(lp * 9.0 + sd + 21.0));
  let fw = 0.012 + gFoot * 8.0;
  alb *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, fw, fz)) * (0.012 / fw) * step(0.5, fract(sd * 3.3));
  let gh = groundH(p.xz, false);
  let above = p.y - gh;
  alb *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.035, above));
  alb = mix(alb, vec3f(0.08, 0.062, 0.047), (1.0 - smoothstep(0.0, 0.012 + 0.008 * m1, above)) * 0.7);
  let toFire = normalize(vec3f(-p.x, 0.0, -p.z));
  let face = dot(n, toFire);
  let edgeH = 0.018 + 0.014 * gn3(lp * 22.0 + sd);
  let sootV = smoothstep(edgeH - 0.003, edgeH + 0.003, above) * (1.0 - 0.45 * smoothstep(0.05, 0.13, above));
  let sn = fb3(lp * 13.0 + sd + 11.0, 2) * 0.5 + 0.5;
  let soot = sat(smoothstep(-0.15, 0.55, face) * sootV * smoothstep(0.25, 0.55, sn + 0.4 * face)) * (0.7 + 0.3 * hs.y);
  alb = mix(alb, vec3f(0.02, 0.017, 0.015), soot * 0.9);
  let dust = smoothstep(0.45, 0.85, n.y) * smoothstep(-0.4, 0.3, face) * smoothstep(0.45, 0.75, sn + 0.2 * (gn3(lp * 70.0) * 0.5 + 0.5));
  alb = mix(alb, vec3f(0.42, 0.41, 0.4), dust * 0.45);
  return Surf(alb, vec3f(0.0), mix(0.62, 0.88, max(soot, dust)), n, 1.0, 1.0, 1.0, 0.0);
}

fn shadePebble(p: vec3f, n: vec3f, id: f32) -> Surf {
  let k = i32(id + 0.5);
  let ci = vec2i(k % 2048 - 1024, k / 2048 - 1024);
  let h = hqi(vec3i(ci, 149));
  var c = mix(vec3f(0.17, 0.15, 0.13), vec3f(0.22, 0.22, 0.21), h.x);
  if (h.y > 0.9) { c = vec3f(0.36, 0.35, 0.33); }
  else if (h.y < 0.2) { c = vec3f(0.16, 0.1, 0.07); }
  c *= 0.7 + 0.6 * h.z;
  c = mix(c, vec3f(0.07, 0.055, 0.045), (1.0 - smoothstep(-0.2, 0.5, n.y)) * 0.6);
  c *= 0.85 + 0.25 * gn3(p * 300.0) * dfade(0.002);
  c *= 0.7 + 0.3 * sat(n.y + 0.3);
  return Surf(c, vec3f(0.0), 0.55, n, 1.0, 1.0, 1.0, 0.0);
}

fn shadeGround(p: vec3f, n: vec3f) -> Surf {
  let xz = p.xz; let r = length(xz);
  let gp = groundParts(xz, terrain(xz), gDet > 0.01);
  let g1 = fbm2(xz * 2.2, 3, 61);
  let g2 = gnoise2(xz * 13.0, 63) * 0.5 + 0.5;
  let g3 = gnoise2(xz * 55.0, 65) * 0.5 + 0.5;
  let f3 = dfade(0.006);
  var soil = vec3f(0.085, 0.064, 0.047) * (0.7 + 0.45 * (g1 * 0.5 + 0.5)) * (0.85 + 0.3 * mix(0.5, g3, f3));
  soil *= 0.8 + 0.35 * gp.crumb;
  let pc = vec2i(floor(xz * 9.0));
  let pa = hqi(vec3i(pc, 67)).x * 3.14159;
  let rq = mat2x2f(cos(pa), sin(pa), -sin(pa), cos(pa)) * xz;
  let needle = (1.0 - smoothstep(0.0, 0.18, abs(gnoise2(rq * vec2f(30.0, 700.0), 69)))) * dfade(0.002);
  let litter = smoothstep(0.75, 1.05, r + 0.15 * g1) * (0.5 + 0.5 * smoothstep(0.3, 0.7, g2));
  soil = mix(soil, vec3f(0.16, 0.085, 0.04) * (0.8 + 0.4 * g3), needle * litter * 0.75);
  let leaf = smoothstep(0.6, 0.75, gnoise2(xz * 24.0, 71) * 0.5 + 0.5 + 0.2 * g1) * smoothstep(0.85, 1.1, r);
  soil = mix(soil, mix(vec3f(0.17, 0.085, 0.035), vec3f(0.11, 0.075, 0.03), g3), leaf * 0.8);
  soil = mix(soil, soil * vec3f(1.15, 1.1, 1.05), gp.berm * 0.5);
  let scorched = 1.0 - smoothstep(0.5, 0.82 + 0.08 * g1, r);
  soil = mix(soil, soil * vec3f(0.5, 0.47, 0.45), scorched);
  if (gp.twig > 0.0) {
    let tA = fract(gp.twigH * 37.0);
    var twigC = mix(vec3f(0.13, 0.085, 0.05), vec3f(0.07, 0.055, 0.04), tA) * (0.75 + 0.5 * gnoise2(vec2f(gp.twigT * 9.0, gp.twigH * 40.0), 77));
    let burnt = select(0.0, smoothstep(0.55, 0.85, select(gp.twigT, 1.0 - gp.twigT, tA > 0.5)), fract(gp.twigH * 13.0) < 0.45 || r < 0.6);
    twigC = mix(twigC, vec3f(0.028, 0.025, 0.023), max(burnt, smoothstep(0.62, 0.5, r)));
    soil = mix(soil, twigC, sat(gp.twig * 1500.0));
  }
  let ashN = fbm2(xz * 18.0, 2, 73) * 0.5 + 0.5;
  var ashC = vec3f(0.47, 0.46, 0.445) * (0.82 + 0.3 * ashN) * (0.9 + 0.2 * mix(0.5, g3, f3));
  ashC = mix(ashC, vec3f(0.56, 0.55, 0.535), gp.clump);
  let ashAmt = gp.ash * smoothstep(0.0, 0.6, gp.ash + 0.35 * (ashN - 0.5));
  var alb = mix(soil, ashC, ashAmt);
  var emit = vec3f(0.0);
  var rough = 0.92;
  var lit = 1.0;
  var occ = 1.0 - 0.25 * (1.0 - gp.crumb) * dfade(0.004) * (1.0 - gp.ash);
  if (gp.rho < 1.1) {
    let inB = 1.0 - smoothstep(0.92, 1.1, gp.rho);
    let bh = sat(1.0 - gp.rho * gp.rho);
    let encl = 1.0 - smoothstep(0.002, 0.011, coalField(p + vec3f(0.0, 0.008, 0.0), terrain(xz), false).x);
    let gHot = step(fract(gp.granH * 7.31), 0.15 + 0.2 * bh + 0.45 * encl);
    let Thot = 960.0 + 110.0 * bh + 50.0 * (fract(gp.granH * 3.7) - 0.5);
    let Tcr = 690.0 + 90.0 * fract(gp.granH * 5.3);
    let hotA = max(gHot * mix(0.55, 1.0, gp.gran), encl * 0.85);
    let T = mix(Tcr, Thot + 125.0 * encl * encl, hotA);
    let fines = vec3f(0.038, 0.036, 0.036) * (0.75 + 0.5 * fract(gp.granH * 9.1));
    let ashF = (1.0 - hotA) * smoothstep(0.55, 0.85, fract(gp.granH * 17.7)) * gp.gran;
    alb = mix(alb, mix(fines, vec3f(0.38, 0.37, 0.36), ashF * 0.7), inB);
    emit = bbLoadRaw(bbT, T) * inB * (1.0 - 0.8 * ashF);
    lit = 1.0 - inB * smoothstep(760.0, 950.0, T);
    rough = mix(rough, 0.8, inB);
  }
  return Surf(alb, emit, rough, n, occ, lit, mix(0.3, 0.6, gp.ash), gp.granH);
}

fn stars(rd: vec3f, pixAng: f32) -> vec3f {
  if (rd.y < 0.08) { return vec3f(0.0); }
  let cell = 0.012;
  let az = atan2(rd.z, rd.x); let el = asin(clamp(rd.y, -1.0, 1.0));
  let q = vec2f(az * cos(el), el) / cell;
  let ip = vec2i(floor(q));
  let h = hqi(vec3i(ip, 91));
  if (h.z > 0.22) { return vec3f(0.0); }
  let c = (vec2f(ip) + 0.25 + 0.5 * h.xy) * cell;
  let d = length(vec2f(az * cos(el), el) - c);
  let s = max(pixAng * 0.75, 1e-5);
  let b = pow(fract(h.z * 37.0), 6.0) * 0.0016 + 0.00008;
  let tint = mix(vec3f(0.8, 0.88, 1.0), vec3f(1.0, 0.9, 0.75), fract(h.z * 91.0));
  return tint * b * exp(-0.5 * d * d / (s * s)) * smoothstep(0.08, 0.28, rd.y);
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= R.width || f32(id.y) >= R.height) { return; }
  gDet = clamp(R.surfDetail, 0.0, 1.0);
  let detail = gDet > 0.01;
  let px = vec2f(id.xy) + 0.5 + vec2f(R.jitX, R.jitY);
  let ro = vec3f(R.camX, R.camY, R.camZ);
  let rd = surfCamRay(px);
  let pixAng = 2.0 * R.tanFov / R.height;
  var t = 1e6; var hit = false; var m = vec3f(0.0);
  let bmin = vec3f(-2.0, -0.05, -2.0); let bmax = vec3f(2.0, 0.62, 2.0);
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv; let t1 = (bmax - ro) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  if (tf > max(tn, 0.0)) {
    var tt = max(tn, 0.0);
    var det = false;
    for (var i = 0; i < 180; i++) {
      gIter = i;
      let p = ro + rd * tt;
      gFoot = max(tt * pixAng, 2e-5);
      m = mapScene(p, det);
      if (detail && !det && m.x < 0.0045) { det = true; continue; }
      if (m.x < 0.55 * gFoot) { hit = true; t = tt; break; }
      if (det && m.x > 0.025) { det = false; }
      tt += m.x * select(0.95, 0.8, det);
      if (tt > tf) { break; }
    }
  }
  var farGround = false;
  if (!hit && rd.y < -1e-4) {
    var tg = -ro.y / rd.y;
    if (tg > 0.0) {
      for (var k = 0; k < 3; k++) {
        gFoot = tg * pixAng;
        let q = ro + rd * tg;
        tg = (groundH(q.xz, false) - ro.y) / rd.y;
      }
      t = tg; hit = true; m = vec3f(0.0, 3.0, 0.0); farGround = true;
    }
  }
  if (hit) {
    let p = ro + rd * t;
    gFoot = max(t * pixAng, 2e-5);
    let eps = clamp(gFoot * 0.5, 0.0002, 0.02);
    let mat = m.y;
    var n = vec3f(0.0, 1.0, 0.0);
    if (mat > 2.5 && mat < 3.5) { n = groundNormal(p.xz, eps, detail && !farGround); } else { n = hitNormal(p, eps, mat, i32(m.z), detail); }
    var S: Surf;
    if (mat < 1.5) { S = shadeLog(p, n, i32(m.z)); }
    else if (mat < 2.5) { S = shadeStone(p, n, i32(m.z)); }
    else if (mat < 3.5) { S = shadeGround(p, n); }
    else if (mat < 4.5) { S = shadeCoal(p, n, m.z); }
    else { S = shadePebble(p, n, m.z); }
    let rxz = length(p.xz);
    var ao = 1.0;
    if (gDet > 0.3 && rxz < 1.0 && mat != 4.0 && !(mat == 3.0 && rxz < 0.3) && !pf(64u)) { ao = mix(ambientOcc(p, S.n), 1.0, smoothstep(0.8, 1.0, rxz)); }
    let g0 = pack2x16snorm(octEnc(S.n));
    let g1 = pack4x8unorm(vec4f(sat(S.rough), sat(S.occ), sat(S.spec), sat(S.lit)));
    textureStore(depthOut, id.xy, vec4f(t, 0.0, 0.0, 0.0));
    textureStore(gGeoOut, id.xy, vec4u(g0, g1, 0u, 0u));
    textureStore(gAlbOut, id.xy, vec4f(S.alb, ao));
    textureStore(gEmitOut, id.xy, vec4f(S.emit, select(S.phase, -(S.phase + 1.0), mat < 1.5)));
  } else {
    let h = max(rd.y, 0.0);
    let skyUnit = mix(vec3f(0.000012, 0.000014, 0.00002), vec3f(0.000004, 0.000004, 0.000008), sqrt(h)) * smoothstep(0.1, 0.3, rd.y) + stars(rd, pixAng);
    textureStore(depthOut, id.xy, vec4f(1e6, 0.0, 0.0, 0.0));
    textureStore(gGeoOut, id.xy, vec4u(0u));
    textureStore(gAlbOut, id.xy, vec4f(skyUnit * 1000.0, -1.0));
    textureStore(gEmitOut, id.xy, vec4f(0.0));
  }
}
`

export const SCENE_SURFACE_LIGHT = (NLIGHTS: number): string => /* wgsl */ `
@group(0) @binding(3) var bbT: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> lights: array<Light>;
@group(0) @binding(5) var depthT: texture_2d<f32>;
@group(0) @binding(6) var gGeoT: texture_2d<u32>;
@group(0) @binding(7) var gAlbT: texture_2d<f32>;
@group(0) @binding(8) var gEmitT: texture_2d<f32>;
@group(0) @binding(9) var colorOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var simS: texture_3d<f32>;
@group(0) @binding(11) var lin: sampler;

fn gasTemp(p: vec3f) -> f32 {
  let g = (p - vec3f(R.ox, R.oy, R.oz)) / vec3f(R.sx, R.sy, R.sz);
  if (any(g < vec3f(0.0)) || any(g > vec3f(1.0))) { return 293.0; }
  return 293.0 + textureSampleLevel(simS, lin, g, 0.0).x * R.tempScale;
}
fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let a = rough * rough; let a2 = a * a;
  let nh = max(dot(n, h), 0.0);
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let nl = max(dot(n, l), 0.0); let nv = max(dot(n, v), 1e-3);
  let k = a * 0.5;
  let G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  let F = 0.04 + 0.2 * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  return D * G * F / (4.0 * nv * max(nl, 1e-3));
}
fn farVis(p: vec3f, lp: vec3f, rs: f32) -> f32 {
  let rx = max(length(p.xz), 0.7);
  let rl = min(length(lp.xz), 0.3);
  let y1 = lp.y + (p.y - lp.y) * sat((0.64 - rl) / (rx - rl));
  let y2 = lp.y + (p.y - lp.y) * sat((0.42 - rl) / (rx - rl));
  let w1 = 2.0 * rs * (rx - 0.64) / rx + 0.02;
  let w2 = 2.0 * rs * (rx - 0.42) / rx + 0.02;
  let v1 = sat(0.5 + (y1 - 0.095) / w1);
  let v2 = mix(0.45, 1.0, sat(0.5 + (y2 - 0.12) / w2));
  return v1 * v2 * 0.9;
}
struct Shade { diff: vec3f, spec: vec3f };
fn fireLight(p: vec3f, n: vec3f, v: vec3f, rough: f32, nsh: i32, nIt: i32) -> Shade {
  var o = Shade(vec3f(0.0), vec3f(0.0));
  let fFar = select(1.0, smoothstep(1.4, 2.4, length(p.xz)), nsh > 0);
  var tot = 0.0;
  for (var i = 0; i < ${NLIGHTS}; i++) {
    let L = lights[i];
    if (L.pos.w <= 0.0) { continue; }
    let toL = L.pos.xyz - p;
    tot += dot(L.col.rgb, vec3f(0.3, 0.6, 0.1)) / (dot(toL, toL) + L.col.w * 0.6 + 0.004);
  }
  var shPrev = 1.0;
  for (var i = 0; i < ${NLIGHTS}; i++) {
    let L = lights[i];
    if (L.pos.w <= 0.0) { continue; }
    let toL = L.pos.xyz - p;
    let d2 = dot(toL, toL);
    let dL = sqrt(d2);
    let l = toL / max(dL, 1e-4);
    let rs = sqrt(max(L.col.w, 1e-4));
    let ndl = dot(n, l);
    let sa = clamp(rs / max(dL, 1e-3), 0.02, 0.95);
    var cosT = max(ndl, 0.0);
    if (ndl < sa) { cosT = select(0.0, (ndl + sa) * (ndl + sa) / (4.0 * sa), ndl > -sa); }
    let kk = clamp(dL / rs, 2.5, 14.0) * R.shadowSoft / 6.0;
    let share = dot(L.col.rgb, vec3f(0.3, 0.6, 0.1)) / (d2 + L.col.w * 0.6 + 0.004) / max(tot, 1e-12);
    var sh = 1.0;
    if (fFar < 1.0) {
      if (nsh > 1) {
        if ((nsh >= 3 || (i & 1) == 0) && share > 0.05) {
          shPrev = 1.0;
          if (cosT > 0.0) { shPrev = softShadow(p + n * 0.004, l, dL, kk, nIt); }
        }
        sh = shPrev;
      } else if (nsh == 1) {
        if (i % 3 == 0) {
          let Ls = lights[min(i + 1, ${NLIGHTS} - 1)];
          let toS = Ls.pos.xyz - p;
          let dS = length(toS);
          shPrev = 1.0;
          if (Ls.pos.w > 0.0 && dot(n, toS) > -0.3 * dS) {
            shPrev = softShadow(p + n * 0.004, toS / dS, dS, clamp(dS / sqrt(max(Ls.col.w, 1e-4)), 2.5, 14.0) * R.shadowSoft / 6.0, nIt);
          }
        }
        sh = shPrev;
      }
    }
    if (cosT <= 0.0) { continue; }
    if (fFar > 0.0) { sh = mix(sh, farVis(p, L.pos.xyz, rs), fFar); }
    let E = L.col.rgb * sh / (d2 + L.col.w * 0.6 + 0.004);
    o.diff += E * cosT;
    o.spec += E * max(ndl, 0.0) * ggxSpec(n, v, l, rough);
  }
  o.diff *= R.lightK; o.spec *= R.lightK;
  return o;
}
fn groundBounce(p: vec3f, n: vec3f) -> vec3f {
  let g = vec3f(p.x + n.x * 0.22, 0.02, p.z + n.z * 0.22);
  var E = vec3f(0.0);
  for (var i = 0; i < ${NLIGHTS}; i++) {
    let L = lights[i];
    if (L.pos.w <= 0.0) { continue; }
    let toL = L.pos.xyz - g;
    let d2 = dot(toL, toL);
    let e = L.col.rgb * max(toL.y, 0.0) * inverseSqrt(d2 + 1e-6) / (d2 + L.col.w * 0.6 + 0.004);
    E += e;
  }
  let rg = length(g.xz);
  let nxz = n.xz / max(length(n.xz), 1e-4);
  let toF = -p.xz / max(length(p.xz), 1e-4);
  let selfS = mix(0.3, 1.0, sat(0.5 + 0.8 * dot(nxz, toF)));
  var vis = 0.65;
  if (rg > 0.7) { vis = farVis(g, vec3f(0.0, 0.3, 0.0), 0.15); }
  vis *= selfS;
  let ashG = 1.0 - smoothstep(0.45, 0.6, rg);
  let alb = mix(0.1, 0.42, ashG);
  return E * R.lightK * alb * vis * 0.5 * (1.0 - n.y);
}
fn bedMeanT() -> f32 {
  return 1040.0 + 35.0 * R.glowTemp + 18.0 * gn3(vec3f(0.3, 1.7, R.time * 0.35)) * R.emberFlicker;
}
fn bedLight(p: vec3f, n: vec3f) -> vec3f {
  let c = vec3f(0.0, 0.05, 0.0);
  let toB = c - p;
  let d2 = dot(toB, toB);
  let l = toB * inverseSqrt(d2 + 1e-6);
  let a2 = 0.3 * 0.3 * 0.8;
  let cosB = sat(0.3 - 0.7 * l.y);
  let ndl = dot(n, l);
  let cosT = max(ndl * 0.8 + 0.2, 0.0) * smoothstep(-0.2, 0.15, ndl);
  let rx = length(p.xz);
  var vis = 1.0;
  if (rx > 0.6) {
    let yr = 0.05 + (p.y - 0.05) * (0.64 - 0.2) / (rx - 0.2);
    vis = sat(0.5 + (yr - 0.1) / 0.05);
  }
  let Lb = bbLoad(bbT, bedMeanT()) * 0.35 * R.emitK * R.bedGlow;
  return Lb * PI * a2 * cosB * cosT * vis / (d2 + a2);
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= R.width || f32(id.y) >= R.height) { return; }
  let pxi = vec2i(id.xy);
  let gAlb = textureLoad(gAlbT, pxi, 0);
  if (gAlb.a < -0.5) {
    textureStore(colorOut, id.xy, vec4f(gAlb.rgb * (R.moon * 0.001), 1.0));
    return;
  }
  let gGeo = textureLoad(gGeoT, pxi, 0);
  let t = textureLoad(depthT, pxi, 0).x;
  let px = vec2f(id.xy) + 0.5 + vec2f(R.jitX, R.jitY);
  let ro = vec3f(R.camX, R.camY, R.camZ);
  let rd = surfCamRay(px);
  let p = ro + rd * t;
  let v = -rd;
  let n = octDec(unpack2x16snorm(gGeo.x));
  let moonDir = normalize(vec3f(-0.4, 0.8, -0.45));
  let haze = 0.03 * R.fogK;
  let m = unpack4x8unorm(gGeo.y);
  let rough = m.x;
  let occ = m.y;
  let spec = m.z;
  let lit = m.w;
  let ao = gAlb.a;
  let nsh = i32(R.shadowMode + 0.5);
  let nIt = i32(R.shadowSteps + 0.5);
  var sh = Shade(vec3f(0.0), vec3f(0.0));
  if (lit > 0.02) { sh = fireLight(p, n, v, rough, nsh, nIt); }
  let rxz = length(p.xz);
  let bl = bedLight(p, n) * smoothstep(0.24, 0.4, rxz) * mix(1.0, ao, 0.7) + groundBounce(p, n) * ao;
  let moon = vec3f(0.00006, 0.00008, 0.00013) * R.moon * (max(dot(n, moonDir), 0.0) + 0.3) * ao;
  let aoD = mix(1.0, ao, 0.5);
  let gE = textureLoad(gEmitT, pxi, 0);
  var emit = vec3f(0.0);
  if (dot(gE.rgb, vec3f(1.0)) > 1e-6) {
    let isLog = gE.a < 0.0;
    let ph = select(gE.a, -gE.a - 1.0, isLog);
    let fq = 0.1 + 0.4 * fract(ph * 17.3);
    let br = sin(TAU * (R.time * fq + ph * 7.0)) * 0.58 + gn3(vec3f(p * 8.0 + vec3f(0.0, 0.0, R.time * 0.28))) * 0.42;
    let gT = gasTemp(p + n * 0.02);
    let gh = sat((gT - 650.0) / 550.0);
    let emGain = (1.0 + 0.18 * br * R.emberFlicker + 0.12 * gh) * select(R.bedGlow, R.logGlow, isLog);
    var emRgb = max(gE.rgb * emGain, vec3f(0.0));
    let hs = fract(R.hueShift);
    if (hs > 0.0001 && hs < 0.9999) { emRgb = hueRotate(emRgb, hs); }
    emit = emRgb * R.emitK * R.glowK;
  }
  var col = (gAlb.rgb / PI * (sh.diff * aoD + bl) + sh.spec * aoD * spec) * occ * lit + gAlb.rgb * moon * R.ambient * occ + emit;
  col *= exp(-max(t - 2.0, 0.0) * haze);
  textureStore(colorOut, id.xy, vec4f(col, 1.0));
}
`
