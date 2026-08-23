#pragma once

#include <string>
#include <vector>

#include "openaxe/engine.h"

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
namespace openaxe::state {

// Bumped for any breaking change to the document shape. Policy:
//  - missing schemaVersion  -> treated as 1 (the web app's existing presets)
//  - version == kCurrent    -> accepted
//  - version > kCurrent     -> rejected (kUnsupportedVersion): never guess at
//                              an unknown future format
inline constexpr int kCurrentSchemaVersion = 1;

// Serializes the engine's entire rig - blocks (kind, row/col, params by
// symbol, bypass, I/O trims, reverb algorithm / delay model choice), edges,
// master level/mute - as a schemaVersion-stamped JSON document.
//
// With `embed_assets` (issue #120), each amp-family block's loaded NAM capture
// and each cab block's IR are additionally embedded into the document
// (base64), making it self-contained: it restores bit-identically on a machine
// that has never seen the source files. Without it, blocks record only
// name/content-hash/source-path references and restoration falls back to those
// paths. Embedding is opt-in per call: a plugin writing a host chunk wants it,
// a desktop app writing a small .preset file next to a model library does not.
// Not real-time safe either way; suspend audio around it like any other
// control-thread call.
std::string SerializeState(const engine::AudioEngine& engine, bool embed_assets = false);

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
  int assets_restored = 0;  // models/IRs reinstated from payload or path (#120)
  int assets_missing = 0;   // referenced but unresolvable - see missing_assets below
  int slots_restored = 0;   // automation slot bindings re-bound (#121)
  int slots_skipped = 0;    // out-of-range slots, dangling block ids, refused binds
  int midi_restored = 0;    // MIDI bindings restored (#124)
  int midi_skipped = 0;     // malformed MIDI entries
};

struct LoadOutcome {
  LoadError error = LoadError::kNone;
  std::string detail;  // empty on success; describes hard failures
  LoadStats stats;
  // Names of the assets (#120) a load could not resolve - neither an embedded
  // payload nor the recorded source path produced a usable asset. A UI offers
  // relinking here; matching by content hash is the document's own suggestion.
  // Empty unless error == kNone. Unnamed assets report as "(unnamed model)" /
  // "(unnamed IR)". Valid until the next LoadState call.
  std::vector<std::string> missing_assets;
};

// Rebuilds the engine's rig from a serialized document. The existing topology
// is cleared first (mirroring applyPreset). Hard failures leave the graph
// untouched; soft failures skip the offending entry, keep going, and are
// counted in the returned stats. Not real-time safe - suspend audio around it.
LoadOutcome LoadState(engine::AudioEngine& engine, const char* json);

}  // namespace openaxe::state
