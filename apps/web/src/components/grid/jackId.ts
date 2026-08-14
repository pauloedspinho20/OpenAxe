import type { Jack } from '../../engine/gridConfig'

export type JackSide = 'in' | 'out'

/** DOM identifier for one jack - what `data-jack-id` is set to on its element. */
export function jackElementId(blockId: string, side: JackSide, port: number): string {
  return `${blockId}:${side}:${port}`
}

export function parseJackElementId(id: string): { blockId: string; side: JackSide; jack: Jack } {
  const [blockId, side, portStr] = id.split(':')
  return {
    blockId: blockId!,
    side: side as JackSide,
    jack: { blockId: blockId!, port: Number(portStr) },
  }
}
