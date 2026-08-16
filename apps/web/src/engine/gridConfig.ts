/** Provisional grid size - see the app's grid rearchitecture plan for why this may change. */
export const GRID_ROWS = 4
export const GRID_COLS = 10

/** The fixed rail sentinels - not real blocks, never occupy a grid cell. */
export const IN_RAIL = 'IN'
export const OUT_RAIL = 'OUT'

/**
 * One endpoint of a cable. `port` is the input-jack slot for multi-input
 * blocks (Mixer); it's always 0 for single-input blocks and for every
 * output jack (a block's one output can fan out to many cables for free).
 */
export interface Jack {
  blockId: string
  port: number
}

export function jack(blockId: string, port = 0): Jack {
  return { blockId, port }
}

export function jackKey(j: Jack): string {
  return `${j.blockId}:${j.port}`
}
