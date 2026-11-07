import { GRID_ROWS, GRID_COLS } from '../../engine/gridConfig'

/** Find the grid container currently on the page - there's only ever one. */
export function findGridElement(): HTMLElement | null {
  return document.querySelector('[data-grid-bounds]')
}

/** Resolve a viewport point to a grid (row, col), clamped to the grid's bounds. */
export function resolveGridCell(
  gridEl: HTMLElement,
  clientX: number,
  clientY: number,
  opts?: { transposed?: boolean },
): { row: number; col: number } {
  const rect = gridEl.getBoundingClientRect()
  const transposed = opts?.transposed ?? gridEl.dataset.transposed === 'true'
  if (transposed) {
    // On mobile vertical we visually transpose: cols run top→bottom (rows in CSS),
    // rows run left→right (cols in CSS). Swap the axes so a touch downward
    // increments `col` (signal flow) and rightward increments `row`.
    const col = Math.min(
      GRID_COLS - 1,
      Math.max(0, Math.floor((clientY - rect.top) / (rect.height / GRID_COLS))),
    )
    const row = Math.min(
      GRID_ROWS - 1,
      Math.max(0, Math.floor((clientX - rect.left) / (rect.width / GRID_ROWS))),
    )
    return { row, col }
  }
  const col = Math.min(
    GRID_COLS - 1,
    Math.max(0, Math.floor((clientX - rect.left) / (rect.width / GRID_COLS))),
  )
  const row = Math.min(
    GRID_ROWS - 1,
    Math.max(0, Math.floor((clientY - rect.top) / (rect.height / GRID_ROWS))),
  )
  return { row, col }
}

/** True if the point is actually within the grid's own bounding box (not just clamped to it). */
export function isPointOverGrid(gridEl: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = gridEl.getBoundingClientRect()
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  )
}

/**
 * Measure the real rendered cell size of the grid (its tracks are responsive:
 * 80px desktop, 70/60px on narrower widths, 80px transposed on mobile), so a
 * drag ghost can grow to exactly match a block card. Reads the first computed
 * column/row track of the grid container; returns null when the tracks aren't
 * px-sized (or jsdom can't compute them), letting the caller fall back to CSS.
 */
export function measureGridCell(gridEl: HTMLElement): { w: number; h: number } | null {
  const cs = window.getComputedStyle(gridEl)
  const col = parseFloat(String(cs.gridTemplateColumns).split(' ')[0] ?? '')
  const row = parseFloat(String(cs.gridTemplateRows).split(' ')[0] ?? '')
  if (!Number.isFinite(col) || !Number.isFinite(row) || col <= 0 || row <= 0) return null
  return { w: col, h: row }
}
