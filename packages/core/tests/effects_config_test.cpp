// Guards the two invariants packages/core/effects.config.json has to hold
// (issue #313), plus the loader behaviour that falls out of them.
//
// The generated IsCompiled/IsInPalette switches have no `default`, so the
// compiler already proves every BlockKind is covered - what it cannot prove is
// that the two flags are consistent with each other, that the ABI reports the
// same answer the C++ predicate does, and that a document naming a kind this
// build cannot place still restores the rest of the rig.

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "openaxe/api.h"
#include "openaxe/block.h"
#include "openaxe/generated/enabled_blocks.h"
#include "test_harness.h"

using openaxe::graph::BlockKind;

namespace {

// Every enumerator, so the loops below are exhaustive rather than a sample.
// Adding a kind to block.h without adding it here is caught by the count
// assertion at the end.
constexpr BlockKind kAllKinds[] = {
    BlockKind::kNoiseGate,   BlockKind::kCompressor,    BlockKind::kEq,
    BlockKind::kChorus,      BlockKind::kFlanger,       BlockKind::kPhaser,
    BlockKind::kTremolo,     BlockKind::kDelay,         BlockKind::kReverb,
    BlockKind::kAmp,         BlockKind::kAmpCab,
    BlockKind::kPedal,       BlockKind::kOutboard,      BlockKind::kSpace,
    BlockKind::kCab,         BlockKind::kMixer,         BlockKind::kSplitter,
    BlockKind::kRingMod,     BlockKind::kFilter,        BlockKind::kPitchShifter,
    BlockKind::kGranularDelay, BlockKind::kRotary,      BlockKind::kSend1,
    BlockKind::kReturn1,     BlockKind::kSend2,         BlockKind::kReturn2,
};

// A palette entry the engine would refuse to construct is the one combination
// that must never ship - the generator rejects it too, but only for the config
// it happens to be run on.
void PaletteImpliesCompiled() {
  for (BlockKind kind : kAllKinds) {
    if (openaxe::blocks::IsInPalette(kind)) {
      OPENAXE_EXPECT(openaxe::blocks::IsCompiled(kind));
    }
  }
}

// The ABI is what a front end asks at startup to detect a stale prebuilt WASM.
// If it disagreed with the predicate the check would be worse than useless.
void AbiMatchesPredicate() {
  for (int i = 0; i <= NAM_STUDIO_BLOCK_RETURN_2; ++i) {
    const auto kind = static_cast<NamStudioBlockKind>(i);
    const bool from_abi = nam_studio_block_kind_compiled(kind) != 0;
    const bool from_cpp = openaxe::blocks::IsCompiled(static_cast<BlockKind>(i));
    OPENAXE_EXPECT(from_abi == from_cpp);
  }
  // Out of range is 0, not a read past the table.
  OPENAXE_EXPECT(nam_studio_block_kind_compiled(static_cast<NamStudioBlockKind>(-1)) == 0);
  OPENAXE_EXPECT(nam_studio_block_kind_compiled(
                     static_cast<NamStudioBlockKind>(NAM_STUDIO_BLOCK_RETURN_2 + 1)) == 0);
}

// A kind string this build has no name for - the shape a document from a newer
// OpenAxe takes. The rig must come back minus that block, not fail outright,
// and the caller must be able to say which kind went missing.
void UnknownKindIsDroppedNotFatal() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const char* doc = R"({
    "schemaVersion": 1,
    "blocks": [
      {"id": "a", "kind": "delay", "row": 0, "col": 0},
      {"id": "b", "kind": "quantum-flux-pedal", "row": 0, "col": 1},
      {"id": "c", "kind": "chorus", "row": 0, "col": 2}
    ],
    "edges": []
  })";
  const int32_t rc = nam_studio_load_state(graph, doc);
  OPENAXE_EXPECT(rc == NAM_STUDIO_LOAD_STATE_OK);  // the document loads

  // Exactly one kind reported, named, and only once.
  OPENAXE_EXPECT(nam_studio_state_unsupported_block_count(graph) == 1);
  const char* name = nam_studio_state_unsupported_block(graph, 0);
  OPENAXE_EXPECT(name != nullptr);
  if (name != nullptr) OPENAXE_EXPECT(std::strcmp(name, "quantum-flux-pedal") == 0);

  // Out-of-range indices are null rather than a crash.
  OPENAXE_EXPECT(nam_studio_state_unsupported_block(graph, 1) == nullptr);
  OPENAXE_EXPECT(nam_studio_state_unsupported_block(graph, -1) == nullptr);

  nam_studio_graph_destroy(graph);
}

// Two blocks of the same unsupported kind are one entry, not two: the list is
// "which pedals could not be restored", not a per-block log.
void UnsupportedKindsAreDeduped() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const char* doc = R"({
    "schemaVersion": 1,
    "blocks": [
      {"id": "a", "kind": "quantum-flux-pedal", "row": 0, "col": 0},
      {"id": "b", "kind": "quantum-flux-pedal", "row": 1, "col": 0},
      {"id": "c", "kind": "delay", "row": 0, "col": 1}
    ],
    "edges": []
  })";
  OPENAXE_EXPECT(nam_studio_load_state(graph, doc) == NAM_STUDIO_LOAD_STATE_OK);
  OPENAXE_EXPECT(nam_studio_state_unsupported_block_count(graph) == 1);
  nam_studio_graph_destroy(graph);
}

// The list belongs to the most recent load, like the missing-asset list.
void ListResetsBetweenLoads() {
  NamStudioGraph* graph = nam_studio_graph_create();
  const char* with = R"({"schemaVersion":1,"blocks":[
      {"id":"a","kind":"quantum-flux-pedal","row":0,"col":0}],"edges":[]})";
  const char* without = R"({"schemaVersion":1,"blocks":[
      {"id":"a","kind":"delay","row":0,"col":0}],"edges":[]})";
  OPENAXE_EXPECT(nam_studio_load_state(graph, with) == NAM_STUDIO_LOAD_STATE_OK);
  OPENAXE_EXPECT(nam_studio_state_unsupported_block_count(graph) == 1);
  OPENAXE_EXPECT(nam_studio_load_state(graph, without) == NAM_STUDIO_LOAD_STATE_OK);
  OPENAXE_EXPECT(nam_studio_state_unsupported_block_count(graph) == 0);
  nam_studio_graph_destroy(graph);
}

}  // namespace

int main() {
  // If this fires, a BlockKind was added without extending kAllKinds, and the
  // loops above stopped being exhaustive.
  static_assert(sizeof(kAllKinds) / sizeof(kAllKinds[0]) ==
                    static_cast<size_t>(BlockKind::kReturn2) + 1,
                "kAllKinds is missing a BlockKind enumerator");

  PaletteImpliesCompiled();
  AbiMatchesPredicate();
  UnknownKindIsDroppedNotFatal();
  UnsupportedKindsAreDeduped();
  ListResetsBetweenLoads();
  return openaxe::test::g_failures == 0 ? 0 : 1;
}
