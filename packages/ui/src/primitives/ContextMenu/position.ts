export interface MenuAnchor {
  x: number
  y: number
}

/** Keeps the menu clear of the viewport edges. Pure for testability. */
export function clampMenuPosition(
  anchor: MenuAnchor,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): MenuAnchor {
  return {
    x: Math.min(
      Math.max(anchor.x, margin),
      Math.max(margin, viewport.width - menuSize.width - margin),
    ),
    y: Math.min(
      Math.max(anchor.y, margin),
      Math.max(margin, viewport.height - menuSize.height - margin),
    ),
  }
}
