// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs --target=automation-map from
// packages/core/param_schema.json's "pluginAutomation" section.
// The stable automation-parameter map plugin hosts see (issue #121; design
// note and alternatives considered in ../README.md). The numbers below are
// frozen API surface: changing any of them remaps every host parameter id.
#pragma once

#include <cstddef>

#include "openaxe/engine.h"  // kAutomation* constants asserted below

namespace openaxe::automation {

inline constexpr int kSlotCount = 16;
inline constexpr int kParamsPerSlot = 20;
inline constexpr int kMasterSlotIndex = 0;  // permanently the master bus
inline constexpr int kFirstBlockSlot = 1;
inline constexpr int kBlockSlotCount = 15;
inline constexpr int kMasterParamCount = 2;
inline constexpr int kTotalPluginParams = kMasterParamCount + kBlockSlotCount * kParamsPerSlot;  // = 302

// Host parameter id of entry `entry` (0..kParamsPerSlot-1) on block slot
// `slot` (kFirstBlockSlot..kSlotCount-1). Master slot entries precede all
// block slots: id 0 is master level, id 1 master mute.
inline constexpr int SlotParamId(int slot, int entry) {
  return kMasterParamCount + (slot - kFirstBlockSlot) * kParamsPerSlot + entry;
}

// Slot 0's fixed descriptors, verbatim from the schema. Core mirrors these
// in engine.h (kMasterAutomation*) so the ABI can resolve them without
// including this generated header.
inline constexpr const char* kMasterSymbols[kMasterParamCount] = {"level", "muted"};
inline constexpr const char* kMasterLabels[kMasterParamCount] = {"Master Level", "Master Mute"};
inline constexpr float kMasterMin[kMasterParamCount] = {0.0f, 0.0f};
inline constexpr float kMasterMax[kMasterParamCount] = {1.5f, 1.0f};
inline constexpr const char* kMasterUnits[kMasterParamCount] = {"x", ""};
// Native-unit default mapped into 0..1 - the construction-time position
// hosts show before anything is loaded.
inline constexpr float kMasterDefaultNormalized[kMasterParamCount] = {0.6666666666666666f, 0.0f};

// Compile-time string equality - static_asserting raw pointer == would
// compare identities of distinct literals, which nothing guarantees.
constexpr bool StrEq(const char* a, const char* b) {
  while (*a != '\0' && *a == *b) {
    ++a;
    ++b;
  }
  return *a == *b;
}

// Pin core's own copies of the constants to this file (both derive from the
// same schema section; a mismatch means one side was hand-edited).
static_assert(kSlotCount == openaxe::engine::kAutomationSlotCount,
              "slot count drifted between param_schema.json and engine.h");
static_assert(kParamsPerSlot == openaxe::engine::kAutomationParamsPerSlot,
              "params-per-slot drifted between param_schema.json and engine.h");
static_assert(kMasterParamCount <= openaxe::engine::kAutomationParamsPerSlot,
              "master slot overflows the stride");
static_assert(StrEq(kMasterSymbols[0], openaxe::engine::kMasterAutomationSymbols[0]),
              "master param 0 symbol drifted");
static_assert(kMasterMin[0] == openaxe::engine::kMasterAutomationMin[0] && kMasterMax[0] == openaxe::engine::kMasterAutomationMax[0],
              "master param level range drifted");
static_assert(StrEq(kMasterSymbols[1], openaxe::engine::kMasterAutomationSymbols[1]),
              "master param 1 symbol drifted");
static_assert(kMasterMin[1] == openaxe::engine::kMasterAutomationMin[1] && kMasterMax[1] == openaxe::engine::kMasterAutomationMax[1],
              "master param muted range drifted");

}  // namespace openaxe::automation
