#pragma once

#include <string>

#include "nam_studio/engine.h"

// Rig-state (de)serialization - issue #119's step 5 of ARCHITECTURE.md's
// migration order ("Preset/scene model in core, with front ends supplying only
// storage"). One JSON document shape serves the plugin's host chunks, preset
// files, and eventually IndexedDB, so every target restores a rig identically.
//
// The document is a superset of apps/web/src/presets/types.ts's Preset (see
// packages/core/README.md's "Rig state wire format" for the full schema), and
// the loader additionally understands the web app's existing files' UI-level
// param keys exactly as RigBlock.ts + namStudioRigWorklet.js resolve them -
// so today's exported presets load without migration.
namespace nam_studio::state {

// Bumped for any breaking change to the document shape. Policy:
//  - missing schemaVersion  -> treated as 1 (the web app's existing presets)
//  - version == kCurrent    -> accepted
//  - version > kCurrent     -> rejected (kUnsupportedVersion): never guess at
//                              an unknown future format
inline constexpr int kCurrentSchemaVersion = 1;

// Serializes the engine's entire rig - blocks (kind, row/col, params by
// symbol, bypass, I/O trims, reverb algorithm / delay model choice), edges,
// master level/mute - as a schemaVersion-stamped JSON document. Not real-time
// safe; suspend audio around it like any other control-thread call.
std::string SerializeState(const engine::AudioEngine& engine);

enum class LoadError {
  kNone = 0,
  kParseError,          // not valid JSON
  kUnsupportedVersion,  // schemaVersion newer than kCurrentSchemaVersion
  kBadDocument,         // wrong root shape / missing required fields
};

// Per-entry accounting returned by LoadState - the ABI layer's only window
// into what was skipped. Partial-failure tolerance mirrors applyPreset's
// (#64): one bad block must not abort the restore and leave a half-built rig.
struct LoadStats {
  int blocks_restored = 0;
  int blocks_skipped = 0;
  int params_skipped = 0;   // unknown symbols, non-numeric values
  int edges_restored = 0;
  int edges_skipped = 0;    // malformed entries, dangling endpoints, rejected connections
};

struct LoadOutcome {
  LoadError error = LoadError::kNone;
  std::string detail;  // empty on success; describes hard failures
  LoadStats stats;
};

// Rebuilds the engine's rig from a serialized document. The existing topology
// is cleared first (mirroring applyPreset). Hard failures leave the graph
// untouched; soft failures skip the offending entry, keep going, and are
// counted in the returned stats. Not real-time safe - suspend audio around it.
LoadOutcome LoadState(engine::AudioEngine& engine, const char* json);

}  // namespace nam_studio::state
