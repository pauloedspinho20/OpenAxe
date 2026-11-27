/**
 * WebGPU device, texture, uniform buffer, explicit bind-group layout, and
 * compute pipeline helpers adapted from Leon Lin's `procedural-fire`
 * (MIT License, Copyright (c) 2026 Leon Lin, https://github.com/Leonxlnx/procedural-fire).
 */

export function tex3D(
  device: GPUDevice,
  dims: readonly [number, number, number],
  format: GPUTextureFormat = 'rgba16float',
  label = '',
): GPUTexture {
  return device.createTexture({
    label,
    size: [dims[0], dims[1], dims[2]],
    dimension: '3d',
    format,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC,
  })
}

export function tex2D(
  device: GPUDevice,
  dims: readonly [number, number],
  format: GPUTextureFormat = 'rgba16float',
  label = '',
  extraUsage: GPUTextureUsageFlags = 0,
): GPUTexture {
  return device.createTexture({
    label,
    size: [dims[0], dims[1]],
    format,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST |
      extraUsage,
  })
}

/** Builds a WGSL struct of f32 fields + a matching Float32Array writer. */
export class UniformStruct<K extends string> {
  readonly name: string
  readonly fields: readonly K[]
  readonly data: Float32Array<ArrayBuffer>
  readonly buffer: GPUBuffer
  private readonly device: GPUDevice
  private readonly index: Record<string, number>

  constructor(device: GPUDevice, name: string, fields: readonly K[], label = name) {
    this.device = device
    this.name = name
    this.fields = fields
    this.index = Object.fromEntries(fields.map((f, i) => [f, i]))
    const n = Math.ceil(fields.length / 4) * 4
    this.data = new Float32Array(n)
    this.buffer = device.createBuffer({
      label,
      size: n * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  wgsl(): string {
    const padCount = this.data.length - this.fields.length
    const pads = Array.from({ length: padCount }, (_, i) => `  _pad${i}: f32,`).join('\n')
    return `struct ${this.name} {\n${this.fields.map((f) => `  ${f}: f32,`).join('\n')}${pads ? `\n${pads}` : ''}\n};\n`
  }

  set(obj: Partial<Record<K, number>>): this {
    for (const k in obj) {
      const val = obj[k]
      if (val === undefined) continue
      const i = this.index[k]
      if (i === undefined) throw new Error(`unknown uniform ${this.name}.${k}`)
      this.data[i] = val
    }
    return this
  }

  upload(): this {
    this.device.queue.writeBuffer(this.buffer, 0, this.data)
    return this
  }

  dispose(): void {
    this.buffer.destroy()
  }
}

/**
 * Derives an explicit bind group layout from WGSL group 0 declarations so
 * bindings stripped from an 'auto' layout stay valid. Bindings listed in
 * `unfilterable` (32-bit float textures read with `textureLoad`) use
 * `unfilterable-float`, avoiding the optional `float32-filterable` feature.
 */
export function layoutFromWGSL(
  device: GPUDevice,
  code: string,
  visibility: GPUShaderStageFlags = GPUShaderStage.COMPUTE,
  unfilterable: readonly number[] = [],
): GPUBindGroupLayout {
  const unfilterableSet = new Set(unfilterable)
  const re = /@group\(0\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+\w+\s*:\s*([^;]+);/g
  const entries: GPUBindGroupLayoutEntry[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const binding = Number(m[1])
    const space = (m[2] ?? '').replace(/\s/g, '')
    const type = (m[3] ?? '').trim()
    const entry: GPUBindGroupLayoutEntry = { binding, visibility }
    if (space.startsWith('uniform')) {
      entry.buffer = { type: 'uniform' }
    } else if (space.startsWith('storage')) {
      entry.buffer = {
        type: space.includes('read_write') ? 'storage' : 'read-only-storage',
      }
    } else if (type.startsWith('sampler')) {
      entry.sampler = { type: 'filtering' }
    } else if (type.startsWith('texture_storage_')) {
      const match = type.match(/texture_storage_(\w+)<\s*(\w+)\s*,\s*(\w+)\s*>/)
      if (!match) continue
      const dim = match[1]! as GPUTextureViewDimension
      const fmt = match[2]! as GPUTextureFormat
      const acc = match[3]!
      entry.storageTexture = {
        format: fmt,
        access: acc === 'read_write' ? 'read-write' : acc === 'read' ? 'read-only' : 'write-only',
        viewDimension: dim,
      }
    } else if (type.startsWith('texture_')) {
      const match = type.match(/texture_(\w+?)<\s*(\w+)\s*>/)
      if (!match) continue
      const dim = match[1]! as GPUTextureViewDimension
      const elem = match[2]!
      entry.texture = {
        sampleType:
          elem === 'u32'
            ? 'uint'
            : elem === 'i32'
              ? 'sint'
              : unfilterableSet.has(binding)
                ? 'unfilterable-float'
                : 'float',
        viewDimension: dim,
      }
    } else {
      continue
    }
    entries.push(entry)
  }
  return device.createBindGroupLayout({ entries })
}

export interface ComputePipe {
  readonly pipeline: GPUComputePipeline
  readonly bgl: GPUBindGroupLayout
}

export function computePipeline(
  device: GPUDevice,
  code: string,
  entryPoint = 'main',
  label = entryPoint,
  unfilterable: readonly number[] = [],
): ComputePipe {
  const module = device.createShaderModule({ label, code })
  void module.getCompilationInfo?.().then((info) => {
    for (const msg of info.messages) {
      if (msg.type === 'error') {
        console.error(`[procedural-fire:${label}] ${msg.lineNum}:${msg.linePos} ${msg.message}`)
      }
    }
  })
  const bgl = layoutFromWGSL(device, code, GPUShaderStage.COMPUTE, unfilterable)
  const pipeline = device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    compute: { module, entryPoint },
  })
  return { pipeline, bgl }
}

export type BindResource = GPUBuffer | GPUTexture | GPUTextureView | GPUSampler

export function bindGroup(
  device: GPUDevice,
  bgl: GPUBindGroupLayout,
  resources: readonly BindResource[],
  label = '',
): GPUBindGroup {
  const entries: GPUBindGroupEntry[] = resources.map((r, i) => {
    let resource: GPUBindingResource
    if (r instanceof GPUBuffer) resource = { buffer: r }
    else if (r instanceof GPUTexture) resource = r.createView()
    else resource = r
    return { binding: i, resource }
  })
  return device.createBindGroup({ label, layout: bgl, entries })
}

export function dispatch3(
  pass: GPUComputePassEncoder,
  pipe: ComputePipe,
  bg: GPUBindGroup,
  dims: readonly [number, number, number],
  wg: readonly [number, number, number] = [8, 8, 4],
): void {
  pass.setPipeline(pipe.pipeline)
  pass.setBindGroup(0, bg)
  pass.dispatchWorkgroups(
    Math.ceil(dims[0] / wg[0]),
    Math.ceil(dims[1] / wg[1]),
    Math.ceil(dims[2] / wg[2]),
  )
}
