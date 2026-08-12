/**
 * Preset sharing via JSON files, since there's no cloud sync (local-first
 * decision - see the scaffolding epic). Two layers: pure serialize/parse
 * (testable without a browser) and thin DOM-triggering helpers for the
 * actual file download/upload (the UI/UX epic wires these to buttons).
 */
import type { ChainPresetData, EffectPresetData, Preset } from './types'

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
  if (typeof preset.linked !== 'boolean') {
    throw new Error("Preset is missing required boolean field 'linked'")
  }
  validateChain(preset.chainA, 'chainA')
  validateChain(preset.chainB, 'chainB')

  return {
    id: preset.id as string,
    name: preset.name as string,
    tags: Array.isArray(preset.tags) ? (preset.tags as string[]) : [],
    favorite: typeof preset.favorite === 'boolean' ? preset.favorite : false,
    createdAt: typeof preset.createdAt === 'number' ? preset.createdAt : Date.now(),
    updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
    chainA: preset.chainA as ChainPresetData,
    chainB: preset.chainB as ChainPresetData,
    masterLevel: preset.masterLevel as number,
    linked: preset.linked as boolean,
  }
}

function validateChain(value: unknown, fieldName: string): asserts value is ChainPresetData {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Preset is missing required object field '${fieldName}'`)
  }
  const chain = value as Record<string, unknown>
  const requiredNumbers = ['irMix', 'level', 'pan']
  for (const key of requiredNumbers) {
    if (typeof chain[key] !== 'number') {
      throw new Error(`Preset.${fieldName} is missing required number field '${key}'`)
    }
  }
  const requiredBooleans = ['mute', 'solo']
  for (const key of requiredBooleans) {
    if (typeof chain[key] !== 'boolean') {
      throw new Error(`Preset.${fieldName} is missing required boolean field '${key}'`)
    }
  }
  for (const key of ['preFx', 'postFx']) {
    if (!Array.isArray(chain[key])) {
      throw new Error(`Preset.${fieldName} is missing required array field '${key}'`)
    }
    for (const effect of chain[key] as unknown[]) {
      validateEffect(effect, `${fieldName}.${key}`)
    }
  }
}

function validateEffect(value: unknown, fieldName: string): asserts value is EffectPresetData {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${fieldName} entries must be objects`)
  }
  const effect = value as Record<string, unknown>
  if (typeof effect.kind !== 'string') {
    throw new Error(`${fieldName} entry is missing required string field 'kind'`)
  }
  if (typeof effect.bypass !== 'boolean') {
    throw new Error(`${fieldName} entry is missing required boolean field 'bypass'`)
  }
  if (typeof effect.mix !== 'number') {
    throw new Error(`${fieldName} entry is missing required number field 'mix'`)
  }
  if (typeof effect.params !== 'object' || effect.params === null) {
    throw new Error(`${fieldName} entry is missing required object field 'params'`)
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
