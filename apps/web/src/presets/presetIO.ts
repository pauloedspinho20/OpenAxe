/**
 * Preset sharing via JSON files, since there's no cloud sync (local-first
 * decision - see the scaffolding epic). Two layers: pure serialize/parse
 * (testable without a browser) and thin DOM-triggering helpers for the
 * actual file download/upload (the UI/UX epic wires these to buttons).
 */
import type { PresetBlockData, PresetEdgeData, Preset } from './types'

export function presetToJson(preset: Preset): string {
  return JSON.stringify(preset, null, 2)
}

/** Parses and validates a preset. Throws with a descriptive message on anything malformed. */
export function presetFromJson(json: string): Preset {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Preset file is not valid JSON')
  }
  return validatePreset(parsed)
}

function validatePreset(value: unknown): Preset {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Preset must be an object')
  }
  const preset = value as Record<string, unknown>
  const requiredStrings: (keyof Preset)[] = ['id', 'name']
  for (const key of requiredStrings) {
    if (typeof preset[key] !== 'string') {
      throw new Error(`Preset is missing required string field '${key}'`)
    }
  }
  if (typeof preset.masterLevel !== 'number') {
    throw new Error("Preset is missing required number field 'masterLevel'")
  }
  if (typeof preset.masterMuted !== 'boolean') {
    throw new Error("Preset is missing required boolean field 'masterMuted'")
  }
  if (!Array.isArray(preset.blocks)) {
    throw new Error("Preset is missing required array field 'blocks'")
  }
  for (const block of preset.blocks) {
    validateBlock(block)
  }
  if (!Array.isArray(preset.edges)) {
    throw new Error("Preset is missing required array field 'edges'")
  }
  for (const edge of preset.edges) {
    validateEdge(edge)
  }

  return {
    id: preset.id as string,
    name: preset.name as string,
    tags: Array.isArray(preset.tags) ? (preset.tags as string[]) : [],
    favorite: typeof preset.favorite === 'boolean' ? preset.favorite : false,
    createdAt: typeof preset.createdAt === 'number' ? preset.createdAt : Date.now(),
    updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
    blocks: preset.blocks as PresetBlockData[],
    edges: preset.edges as PresetEdgeData[],
    masterLevel: preset.masterLevel as number,
    masterMuted: preset.masterMuted as boolean,
  }
}

function validateBlock(value: unknown): asserts value is PresetBlockData {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Preset.blocks entries must be objects')
  }
  const block = value as Record<string, unknown>
  if (typeof block.id !== 'string') {
    throw new Error("Preset.blocks entry is missing required string field 'id'")
  }
  if (typeof block.kind !== 'string') {
    throw new Error("Preset.blocks entry is missing required string field 'kind'")
  }
  if (typeof block.row !== 'number' || typeof block.col !== 'number') {
    throw new Error("Preset.blocks entry is missing required number fields 'row'/'col'")
  }
  if (typeof block.params !== 'object' || block.params === null) {
    throw new Error("Preset.blocks entry is missing required object field 'params'")
  }
}

function validateEdge(value: unknown): asserts value is PresetEdgeData {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Preset.edges entries must be objects')
  }
  const edge = value as Record<string, unknown>
  if (typeof edge.id !== 'string') {
    throw new Error("Preset.edges entry is missing required string field 'id'")
  }
  validateJack(edge.from, 'from')
  validateJack(edge.to, 'to')
}

function validateJack(value: unknown, fieldName: string): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Preset.edges entry is missing required object field '${fieldName}'`)
  }
  const jack = value as Record<string, unknown>
  if (typeof jack.blockId !== 'string' || typeof jack.port !== 'number') {
    throw new Error(
      `Preset.edges entry's '${fieldName}' is missing required fields 'blockId'/'port'`,
    )
  }
}

/** Trigger a browser download of a preset as a `.json` file. */
export function downloadPresetAsFile(preset: Preset): void {
  const blob = new Blob([presetToJson(preset)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `${sanitizeFilename(preset.name)}.json`
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Read and validate a preset from a File (e.g. from a file input's change event). */
export async function readPresetFromFile(file: File): Promise<Preset> {
  return presetFromJson(await file.text())
}

/** Exported for testing; also used by downloadPresetAsFile. */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[^a-z0-9 _-]/gi, '')
  return trimmed.length > 0 ? trimmed : 'preset'
}
