#pragma once

// Ported from apps/web/src/engine/blocks/Block.ts's BlockKind union and the
// MIXER_INPUT_COUNT/SPLITTER_OUTPUT_COUNT constants from MixerBlock.ts/
// SplitterBlock.ts.
namespace openaxe::graph {

// Every placeable grid block kind: the 10 synthetic effects, the 5 NAM-model
// gear kinds (structurally identical, kind only affects UI labeling/gear
// filtering), plus cab/mixer/splitter. The wire-format string mapping (the TS
// union's hyphenated literals, e.g. "ping-pong-delay") lives in
// src/serialization/rig_state.cpp - the only place that speaks both this enum
// and the preset/state JSON dialect (issue #119).
enum class BlockKind {
  kNoiseGate,
  kCompressor,
  kEq,
  kChorus,
  kFlanger,
  kPhaser,
  kTremolo,
  kDelay,
  kPingPongDelay,
  kReverb,
  kAmp,
  kAmpCab,
  kPedal,
  kOutboard,
  kSpace,
  kCab,
  kMixer,
  kSplitter,
};

inline constexpr int kMixerInputCount = 4;
inline constexpr int kSplitterOutputCount = 4;

// The minimal per-block state the topology layer needs - kind (for port
// counting) plus row/col (grid position; row is pure UI/layout data, never
// used in validation or routing). No params field: GraphRig.ts's own
// topology-level state is exactly {kind, row, col} too - params and the live
// audio object live one layer up (BlockEntry in the TS original), which this
// PR doesn't port.
struct BlockRecord {
  BlockKind kind;
  int row = 0;
  int col = 0;
};

}  // namespace openaxe::graph
