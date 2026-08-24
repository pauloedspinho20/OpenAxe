/**
 * Seeds the default scene bank: scene 0 ("Guitar rig") gets starter presets
 * built from whatever factory pack is manifest-listed (issue #101), so the app
 * boots ready-to-play - fully offline after the first factory download, no
 * Tone3000 connection needed - the user will overwrite these as they build
 * their own scenes.
 */
import { getPreset, savePreset } from '../presets/presetStore'
import { IN_RAIL, OUT_RAIL } from '../engine/gridConfig'
import type { BlockKind, EffectParams } from '../engine/blocks/Block'
import type { Preset, PresetBlockData, PresetEdgeData } from '../presets/types'
import { createEmptyBank, loadSceneBank, saveSceneBank } from './sceneBankStore'
import { cacheFactoryGear, firstFactoryGearFor, loadFactoryManifest } from '../tone3000/factoryGear'
import type { FactoryGearEntry } from '../tone3000/factoryGear'

export const DEFAULT_SCENE_NAME = 'Guitar rig'
/** Pre-#101 name - existing installs whose scene 0 is still exactly this
 * (never renamed by the user) get retrofitted to DEFAULT_SCENE_NAME. */
const LEGACY_DEFAULT_SCENE_NAME = 'Default'

/** Deterministic id for scene 0's slot `slot` (0-7) - stable across re-seeds. */
export function starterPresetId(slot: number): string {
  return `scene-starter-${slot + 1}`
}

interface ChainBlock {
  kind: BlockKind
  params?: EffectParams
  gear?: FactoryGearEntry
}

/** A single left-to-right signal chain: IN -> chain[0] -> chain[1] -> ... -> OUT. */
function buildChainPreset(id: string, name: string, chain: ChainBlock[]): Preset {
  const blocks: PresetBlockData[] = []
  const edges: PresetEdgeData[] = []
  let nextId = 0
  const genId = (prefix: string) => `${prefix}${++nextId}`

  let previousId: string = IN_RAIL
  chain.forEach((item, col) => {
    const blockId = genId('b')
    blocks.push({
      id: blockId,
      kind: item.kind,
      row: 0,
      col,
      bypass: false,
      params: item.params ?? {},
      ...(item.gear?.slot === 'model' ? { modelId: item.gear.id, modelName: item.gear.name } : {}),
      ...(item.gear?.slot === 'ir' ? { irId: item.gear.id, irName: item.gear.name } : {}),
    })
    edges.push({
      id: genId('e'),
      from: { blockId: previousId, port: 0 },
      to: { blockId, port: 0 },
    })
    previousId = blockId
  })
  edges.push({
    id: genId('e'),
    from: { blockId: previousId, port: 0 },
    to: { blockId: OUT_RAIL, port: 0 },
  })

  return {
    id,
    name,
    tags: ['factory'],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks,
    edges,
    masterLevel: 1,
    masterMuted: false,
  }
}

/**
 * One starter preset per useful combination of whatever factory pack is
 * actually manifest-listed (public/factory/manifest.json - empty until real
 * files are curated, in which case there simply aren't any gear-based starter
 * presets yet). Always ends with a plain "Bypass" pass-through as a minimal,
 * gear-independent reference point.
 */
export function buildStarterPresets(): Preset[] {
  const amp = firstFactoryGearFor('amp')
  const ampCab = firstFactoryGearFor('amp-cab')
  const pedal = firstFactoryGearFor('pedal')
  const cab = firstFactoryGearFor('cab')

  const presets: Preset[] = []
  const addPreset = (name: string, chain: ChainBlock[]) =>
    presets.push(buildChainPreset(starterPresetId(presets.length), name, chain))

  if (amp) {
    addPreset('Clean Amp', [
      { kind: 'amp', gear: amp },
      ...(cab ? [{ kind: 'cab' as const, gear: cab }] : []),
    ])
  }
  if (ampCab) {
    addPreset('Amp + Cab', [{ kind: 'amp-cab', gear: ampCab }])
  }
  if (pedal && amp) {
    addPreset('Pedal + Amp', [
      { kind: 'pedal', gear: pedal },
      { kind: 'amp', gear: amp },
      ...(cab ? [{ kind: 'cab' as const, gear: cab }] : []),
    ])
  }
  addPreset('Bypass', [])

  return presets
}

export const STARTER_PRESETS: readonly Preset[] = buildStarterPresets()

/** Every FactoryGearEntry actually referenced by the current starter presets,
 * so their bytes can be pre-cached before the presets that point at them are
 * ever applied. */
function gearUsedByStarterPresets(presets: Preset[]): FactoryGearEntry[] {
  const ids = new Set<string>()
  for (const p of presets) {
    for (const b of p.blocks) {
      if (b.modelId) ids.add(b.modelId)
      if (b.irId) ids.add(b.irId)
    }
  }
  // Resolve ids back to entries via the live gear lookups.
  const all = [
    firstFactoryGearFor('amp'),
    firstFactoryGearFor('amp-cab'),
    firstFactoryGearFor('pedal'),
    firstFactoryGearFor('cab'),
  ].filter((e): e is FactoryGearEntry => e !== undefined)
  return all.filter((e) => ids.has(e.id))
}

/**
 * Idempotent in two independent halves: seeding the starter presets never
 * overwrites a user-customized one (matched by id), and the initial bank is
 * only ever written once - if a bank already exists (even partially
 * customized), only a one-time scene-0-name retrofit runs; its presets are
 * never touched.
 */
export async function installFactoryScenes(): Promise<void> {
  const existingBank = await loadSceneBank()
  if (existingBank) {
    // issue #101: rename scene 0 for existing installs too, but only if it's
    // still exactly the old default name - if the user renamed it to
    // anything else, leave it alone. Can't distinguish "never touched" from
    // "renamed back to the literal string 'Default' on purpose" - that's an
    // accepted, exceedingly unlikely edge case, not a real bug.
    if (existingBank.scenes[0]?.name === LEGACY_DEFAULT_SCENE_NAME) {
      existingBank.scenes[0].name = DEFAULT_SCENE_NAME
      await saveSceneBank(existingBank)
    }
    return
  }

  // Ensure manifest is loaded so buildStarterPresets can see factory entries.
  // Best-effort: if fetch fails (offline / not yet deployed), fall back to
  // the Bypass-only set built at import time — the app still boots.
  let starterPresets: Preset[]
  try {
    await loadFactoryManifest()
    starterPresets = buildStarterPresets()
  } catch {
    starterPresets = [...STARTER_PRESETS]
  }

  // App.tsx fire-and-forgets installFactoryScenes() with no .catch() (it's
  // otherwise pure IndexedDB writes, which can't reject) - a real network
  // fetch failure here must not become an unhandled rejection or block the
  // rest of setup, so cache each factory asset independently and continue past
  // one that fails. A preset referencing an uncached id just skips loading
  // that block's model/IR when applied (see presets/apply.ts), the same
  // graceful degradation an unreachable Tone3000 asset already gets.
  await Promise.all(
    gearUsedByStarterPresets(starterPresets).map((entry) =>
      cacheFactoryGear(entry).catch((err: unknown) =>
        console.warn(`[factoryScenes] failed to cache factory gear "${entry.id}":`, err),
      ),
    ),
  )

  for (const preset of starterPresets) {
    const existing = await getPreset(preset.id)
    if (!existing) await savePreset(preset)
  }

  const bank = createEmptyBank()
  bank.scenes[0] = {
    index: 0,
    name: DEFAULT_SCENE_NAME,
    slots: starterPresets.map((p) => p.id),
  }
  bank.activeScene = 0
  bank.activeSlot = 0
  bank.updatedAt = 0
  await saveSceneBank(bank)
}
