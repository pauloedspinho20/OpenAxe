/**
 * Import service: takes a Tone3000 model/IR the user picked, downloads it via
 * the authenticated client, caches the bytes in the asset StoreDB (keyed by
 * id so presets + offline reuse work), and loads it into a live Amp or Cab
 * block.
 */
import { Tone3000Library } from './library'
import type { Tone3000Slot } from './types'

export interface ImportRequest {
  /** App-level asset id (e.g. `tone3000:model:123`) - key cached under and stored in presets. */
  id: string
  blockId: string
  slot: Tone3000Slot
  name: string
  /** Bearer-authed model_url from the API. */
  modelUrl: string
  creator: string
  sourceUrl: string
  toneTitle: string | null
  imageUrl?: string | null
}

export interface ImportResult {
  id: string
  name: string
  slot: Tone3000Slot
  blockId: string
}

/**
 * Load functions for a live Amp/Cab block. Pass null when the engine isn't
 * powered on - the asset is still downloaded + cached for later.
 */
export interface BlockLoadTarget {
  loadModel: (json: string, info: { id: string; name: string }) => Promise<unknown>
  loadIR: (buffer: AudioBuffer, info: { id: string; name: string }) => void
}

/**
 * Download + cache the model/IR blob and (if a live target is given) load it
 * into the block. Returns the info to record on the screen.
 */
export async function importTone3000Asset(
  request: ImportRequest,
  load: BlockLoadTarget | null,
  context: AudioContext | null,
): Promise<ImportResult> {
  const entry = await Tone3000Library.importAsset({
    id: request.id,
    kind: request.slot,
    name: request.name,
    creator: request.creator,
    sourceUrl: request.sourceUrl,
    modelUrl: request.modelUrl,
    toneTitle: request.toneTitle,
    imageUrl: request.imageUrl ?? null,
  })

  if (load && context) {
    const blob = await Tone3000Library.getBlob(request.id)
    if (!blob) throw new Error(`Imported asset '${request.id}' was not cached`)
    if (request.slot === 'model') {
      const json = await blob.text()
      await load.loadModel(json, { id: request.id, name: request.name })
    } else {
      const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
      load.loadIR(audioBuffer, { id: request.id, name: request.name })
    }
  }

  return { id: entry.id, name: entry.name, slot: request.slot, blockId: request.blockId }
}
