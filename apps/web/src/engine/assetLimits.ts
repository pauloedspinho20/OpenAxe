/**
 * Hard ceilings on user-supplied asset bytes before they reach the DSP core
 * (NAM model JSON or a cab IR WAV). A malformed or oversized file can otherwise
 * exhaust memory or crash the WASM/native engine (issue #69). The web UI
 * enforces these up front; the desktop bridge enforces the same numbers.
 */
export const MAX_MODEL_BYTES = 32 * 1024 * 1024 // 32 MB
export const MAX_IR_BYTES = 8 * 1024 * 1024 // 8 MB
export const MAX_SOUNDFONT_BYTES = 32 * 1024 * 1024 // 32 MB — SF2/SF3 for the song player (#165), same ceiling as kMaxModelBytes

/** Thrown when a user file fails a pre-load guard; surfaced as a load error. */
export class AssetLoadError extends Error {}

/** Cheap checks that only need the File handle, before any byte copying. */
export function assertModelFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.nam')) {
    throw new AssetLoadError('Model must be a .nam file')
  }
  if (file.size > MAX_MODEL_BYTES) {
    throw new AssetLoadError(`Model file too large (max ${MAX_MODEL_BYTES / 1024 / 1024} MB)`)
  }
}

export function assertIrFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.wav')) {
    throw new AssetLoadError('IR must be a .wav file')
  }
  if (file.size > MAX_IR_BYTES) {
    throw new AssetLoadError(`IR file too large (max ${MAX_IR_BYTES / 1024 / 1024} MB)`)
  }
}

export function assertSoundfontFile(file: File): void {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.sf2') && !name.endsWith('.sf3')) {
    throw new AssetLoadError('SoundFont must be .sf2 or .sf3')
  }
  if (file.size > MAX_SOUNDFONT_BYTES) {
    throw new AssetLoadError(`SoundFont too large (max ${MAX_SOUNDFONT_BYTES / 1024 / 1024} MB)`)
  }
}

/** After reading bytes: confirm the model text is a JSON document. */
export function assertModelText(text: string): void {
  const head = text.trimStart()[0]
  if (head !== '{' && head !== '[') {
    throw new AssetLoadError('Not a NAM model JSON file')
  }
}

/** After reading bytes: confirm the buffer is a RIFF/WAVE WAV container. */
export function assertIrBytes(buf: ArrayBuffer): void {
  if (buf.byteLength < 12) {
    throw new AssetLoadError('Not a WAV file')
  }
  const view = new DataView(buf)
  const riff = view.getUint32(0, true)
  const wave = view.getUint32(8, true)
  if (riff !== 0x46464952 || wave !== 0x45564157) {
    throw new AssetLoadError('Not a WAV file')
  }
}

export function assertSoundfontBytes(buf: ArrayBuffer): void {
  if (buf.byteLength < 4) throw new AssetLoadError('Not a SoundFont file')
  const view = new DataView(buf)
  // SF2 is RIFF sfbk, SF3 is RIFF sfbk with ogg — check RIFF.
  const riff = view.getUint32(0, true)
  if (riff !== 0x46464952) throw new AssetLoadError('Not a SoundFont file')
}
