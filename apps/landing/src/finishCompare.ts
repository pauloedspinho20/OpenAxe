/**
 * Drives the Carbon vs. Aluminum split-wipe image comparator with a native
 * accessible range input for pointer, touch, and keyboard control.
 */
export function initFinishCompare(): void {
  const compare = document.getElementById('finish-compare')
  const slider = document.getElementById('finish-compare-slider') as HTMLInputElement | null
  if (!compare || !slider) return

  const update = () => {
    const value = Number(slider.value)
    const clamped = Number.isFinite(value) ? Math.min(95, Math.max(5, value)) : 50
    compare.style.setProperty('--compare-pos', `${clamped}%`)
  }

  slider.addEventListener('input', update)
  update()
}
