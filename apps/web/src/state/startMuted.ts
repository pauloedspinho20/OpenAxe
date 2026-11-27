/**
 * One-shot "power on muted" request (PowerGate's secondary button).
 *
 * Setting graphStore.masterMuted alone isn't enough: right after power-on the
 * boot scene restore applies the active preset, and `syncStore` overwrites the
 * store with that preset's saved masterMuted (normally false). While armed,
 * preset syncs OR the mute in instead, and useSceneEngine disarms it once the
 * boot restore has finished - so later preset switches behave as usual and the
 * user's own unmute sticks.
 */
let armed = false

export function armStartMuted(): void {
  armed = true
}

export function clearStartMuted(): void {
  armed = false
}

export function isStartMuted(): boolean {
  return armed
}
