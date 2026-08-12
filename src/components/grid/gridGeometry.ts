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
): { row: number; col: number } {
  const rect = gridEl.getBoundingClientRect()
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
