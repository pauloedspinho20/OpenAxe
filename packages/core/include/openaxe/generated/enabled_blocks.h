// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs --target=effects from packages/core/effects.config.json.
//
// One macro per block kind for the `#if` guards in engine.cpp, plus the two
// predicates the loader and the ABI use. Everything here is constexpr, so a
// compiled-out kind folds away rather than costing a runtime branch.
#pragma once

#include "openaxe/block.h"

#define OPENAXE_BLOCK_NOISE_GATE_COMPILED 1
#define OPENAXE_BLOCK_COMPRESSOR_COMPILED 1
#define OPENAXE_BLOCK_EQ_COMPILED 1
#define OPENAXE_BLOCK_CHORUS_COMPILED 1
#define OPENAXE_BLOCK_FLANGER_COMPILED 1
#define OPENAXE_BLOCK_PHASER_COMPILED 1
#define OPENAXE_BLOCK_TREMOLO_COMPILED 1
#define OPENAXE_BLOCK_DELAY_COMPILED 1
#define OPENAXE_BLOCK_REVERB_COMPILED 1
#define OPENAXE_BLOCK_RING_MOD_COMPILED 1
#define OPENAXE_BLOCK_GRANULAR_DELAY_COMPILED 1
#define OPENAXE_BLOCK_FILTER_COMPILED 1
#define OPENAXE_BLOCK_PITCH_SHIFTER_COMPILED 1
#define OPENAXE_BLOCK_ROTARY_COMPILED 1
#define OPENAXE_BLOCK_AMP_COMPILED 1
#define OPENAXE_BLOCK_AMP_CAB_COMPILED 1
#define OPENAXE_BLOCK_PEDAL_COMPILED 1
#define OPENAXE_BLOCK_OUTBOARD_COMPILED 1
#define OPENAXE_BLOCK_SPACE_COMPILED 1
#define OPENAXE_BLOCK_CAB_COMPILED 1
#define OPENAXE_BLOCK_MIXER_COMPILED 1
#define OPENAXE_BLOCK_SPLITTER_COMPILED 1
#define OPENAXE_BLOCK_SEND_1_COMPILED 1
#define OPENAXE_BLOCK_RETURN_1_COMPILED 1
#define OPENAXE_BLOCK_SEND_2_COMPILED 1
#define OPENAXE_BLOCK_RETURN_2_COMPILED 1

namespace openaxe::blocks {

// Whether this build contains the DSP for `kind`. A false here means
// AddBlock refuses the kind and the state loader drops it - see
// state::LoadOutcome::unsupported_blocks.
inline constexpr bool IsCompiled(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kNoiseGate: return true;
    case graph::BlockKind::kCompressor: return true;
    case graph::BlockKind::kEq: return true;
    case graph::BlockKind::kChorus: return true;
    case graph::BlockKind::kFlanger: return true;
    case graph::BlockKind::kPhaser: return true;
    case graph::BlockKind::kTremolo: return true;
    case graph::BlockKind::kDelay: return true;
    case graph::BlockKind::kReverb: return true;
    case graph::BlockKind::kRingMod: return true;
    case graph::BlockKind::kGranularDelay: return true;
    case graph::BlockKind::kFilter: return true;
    case graph::BlockKind::kPitchShifter: return true;
    case graph::BlockKind::kRotary: return true;
    case graph::BlockKind::kAmp: return true;
    case graph::BlockKind::kAmpCab: return true;
    case graph::BlockKind::kPedal: return true;
    case graph::BlockKind::kOutboard: return true;
    case graph::BlockKind::kSpace: return true;
    case graph::BlockKind::kCab: return true;
    case graph::BlockKind::kMixer: return true;
    case graph::BlockKind::kSplitter: return true;
    case graph::BlockKind::kSend1: return true;
    case graph::BlockKind::kReturn1: return true;
    case graph::BlockKind::kSend2: return true;
    case graph::BlockKind::kReturn2: return true;
  }
  return false;
}

// Whether the block palette offers `kind`. Independent of IsCompiled: a
// kind can be built and still withheld from the picker while its quality is
// being worked on (ring-mod, granular-delay today).
inline constexpr bool IsInPalette(graph::BlockKind kind) {
  switch (kind) {
    case graph::BlockKind::kNoiseGate: return true;
    case graph::BlockKind::kCompressor: return true;
    case graph::BlockKind::kEq: return true;
    case graph::BlockKind::kChorus: return true;
    case graph::BlockKind::kFlanger: return true;
    case graph::BlockKind::kPhaser: return true;
    case graph::BlockKind::kTremolo: return true;
    case graph::BlockKind::kDelay: return true;
    case graph::BlockKind::kReverb: return true;
    case graph::BlockKind::kRingMod: return true;
    case graph::BlockKind::kGranularDelay: return true;
    case graph::BlockKind::kFilter: return true;
    case graph::BlockKind::kPitchShifter: return false;
    case graph::BlockKind::kRotary: return true;
    case graph::BlockKind::kAmp: return true;
    case graph::BlockKind::kAmpCab: return true;
    case graph::BlockKind::kPedal: return true;
    case graph::BlockKind::kOutboard: return false;
    case graph::BlockKind::kSpace: return true;
    case graph::BlockKind::kCab: return true;
    case graph::BlockKind::kMixer: return true;
    case graph::BlockKind::kSplitter: return false;
    case graph::BlockKind::kSend1: return true;
    case graph::BlockKind::kReturn1: return true;
    case graph::BlockKind::kSend2: return true;
    case graph::BlockKind::kReturn2: return true;
  }
  return false;
}

}  // namespace openaxe::blocks
