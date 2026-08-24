import type { Effect } from './Effect'

/**
 * @deprecated Replaced by the single rig worklet + `packages/core` graph (issue #263).
 * Web audio routing, per-effect worklets and this chain topology are now owned by
 * `GraphRig`/`RigWorkletNode` and `engine.cpp`. Kept only for type-surface and
 * legacy tests; do not use for new code.
 *
 * An ordered list of effects wired input -> effect[0] -> effect[1] -> ... ->
 * output. Reordering rewires the chain rather than the individual effects
 * (each effect's own bypass/mix state is untouched by its position).
 *
 * This is the chain topology only - the actual drag-and-drop reordering UI
 * belongs to the UI/UX epic; this is what it will call into.
 */
export class EffectsChain {
  private readonly input: GainNode
  private readonly output: GainNode
  private effects: Effect[] = []

  constructor(context: BaseAudioContext) {
    this.input = new GainNode(context)
    this.output = new GainNode(context)
    this.rewire()
  }

  get inputNode(): AudioNode {
    return this.input
  }

  get outputNode(): AudioNode {
    return this.output
  }

  /** Current effect order, read-only. */
  list(): readonly Effect[] {
    return this.effects
  }

  /** Insert an effect at `index` (defaults to the end) and rewire the chain. */
  insert(effect: Effect, index: number = this.effects.length): void {
    this.disconnectAll()
    const clamped = Math.min(Math.max(0, index), this.effects.length)
    this.effects = [...this.effects.slice(0, clamped), effect, ...this.effects.slice(clamped)]
    this.rewire()
  }

  /** Remove an effect from the chain. Does not dispose it - call effect.dispose() yourself. */
  remove(effect: Effect): void {
    this.disconnectAll()
    this.effects = this.effects.filter((e) => e !== effect)
    this.rewire()
  }

  /** Move the effect at `fromIndex` to `toIndex`, shifting the rest. */
  move(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.effects.length ||
      toIndex < 0 ||
      toIndex >= this.effects.length
    ) {
      throw new RangeError(`move: index out of range (length ${this.effects.length})`)
    }
    this.disconnectAll()
    const next = [...this.effects]
    // Non-null: fromIndex was already bounds-checked above.
    const moved = next.splice(fromIndex, 1)[0]!
    next.splice(toIndex, 0, moved)
    this.effects = next
    this.rewire()
  }

  private disconnectAll(): void {
    this.input.disconnect()
    for (const effect of this.effects) effect.outputNode.disconnect()
  }

  private rewire(): void {
    let previous: AudioNode = this.input
    for (const effect of this.effects) {
      previous.connect(effect.inputNode)
      previous = effect.outputNode
    }
    previous.connect(this.output)
  }

  /** Disconnects the chain's own nodes. Does not dispose the effects it holds. */
  dispose(): void {
    this.disconnectAll()
    this.output.disconnect()
  }
}
