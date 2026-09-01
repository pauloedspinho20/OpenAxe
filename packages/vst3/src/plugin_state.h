#pragma once

// Host state (de)serialization for the VST3/AU plugin — issue #128.
//
// This is the plugin-side consumer of `packages/core`'s rig-serialization
// (issues #119, #120). Hosts persist whatever `SerializeState` puts into the
// `IByteChunk`; on next launch they hand that chunk back to `UnserializeState`.
// Two requirements are non-negotiable:
//
//   1) The saved document must be self-contained: a DAW project saved on one
//      machine reopens identically on another without the source .nam/.wav files
//      being present. Hence `openaxe_serialize_state_ex(..., embed_assets=1)`
//      — every loaded capture and IR is base64-embedded (#120). Callers that
//      want a small preset next to a model library (desktop) pass `0`, but a
//      plugin chunk is always `1`.
//
//   2) Rebuilding the topology on restore must be done with audio suspended and
//      followed by a *single* `openaxe_reset`. The old native path that
//      suspended+reset on every param change was the cautionary tale in #62
//      (#64 also documents the partial-restore tolerance — malformed individual
//      entries are skipped, never aborting the whole document).
//
// Wire format and versioning: `packages/core/README.md` § "Rig state wire
// format". `openaxe_load_state` returns `OPENAXE_LOAD_STATE_*`; a
// document with `schemaVersion` newer than this build returns
// `UNSUPPORTED_VERSION` and leaves the existing graph untouched — i.e. it
// degrades gracefully instead of crashing, which the verification step in
// #128 requires. Unknown param symbols / dangling edges are the #64 path and
// are skipped with a warning.
//
// This header is intentionally iPlug-free so the helpers can be exercised by
// offline CTests that link only `openaxe_core` (no SDK/host). `plugin.cpp`
// bridges the string helpers below to `IByteChunk` + the suspend handshake.

#include <string>
#include <vector>

struct OpenAxeGraph;

namespace openaxe_vst3::state {

// Serialize the entire graph to a NUL-terminated JSON document.
// `embed_assets` matches `openaxe_serialize_state_ex`'s flag: `true` for
// host chunks / portable .json presets that must be self-contained, `false`
// for small sidecar presets. Returns empty string on failure (should not
// happen for a valid graph — the two-call sizing pattern would have returned
// -1).
//
// Not real-time safe (allocates). Caller (the plugin) handles suspension.
std::string Serialize(OpenAxeGraph* graph, bool embed_assets);

// Restore `graph` from `json`. `sample_rate`/`max_block_size` are the host's
// current values — on success the helper does the required single
// `openaxe_reset(graph, sample_rate, max_block_size)` as the last step.
// On `PARSE_ERROR` / `BAD_DOCUMENT` / `UNSUPPORTED_VERSION` the graph is left
// untouched (per ABI contract) and this returns the corresponding enum. Caller
// must have audio suspended around this call (Tier 2).
int Restore(OpenAxeGraph* graph, const std::string& json, double sample_rate, int max_block_size);

// Convenience for host chunks: always embedded.
inline std::string SerializeForHost(OpenAxeGraph* graph) { return Serialize(graph, true); }

// Missing-asset list from the most recent `Restore` on `graph` (#120). Empty
// when everything resolved, otherwise display names (or "(unnamed model)"/IR).
// A UI offers relinking here — matching by content hash is what the document
// suggests. Stays valid until the next `Restore`.
std::vector<std::string> MissingAssets(OpenAxeGraph* graph);

// File helpers: load/save the portable JSON preset that web ↔ desktop ↔ plugin
// share. Same document as the host chunk, just written to disk rather than
// handed to iPlug's `IByteChunk`. `SavePortableJson` uses embedded form;
// `LoadPortableJson` is `Restore` from a file.
bool SavePortableJson(OpenAxeGraph* graph, const std::string& path);
int LoadPortableJson(OpenAxeGraph* graph, const std::string& path, double sample_rate, int max_block_size);

// iPlug bridging helpers (header-only to keep this file testable without
// pulling in IPlug headers). The plugin's `SerializeState`/`UnserializeState`
// delegate to these under `WithSuspend`.
//
// We intentionally use `std::string` as the interchange — the plugin puts it
// into an `IByteChunk` via `PutStr`/`GetStr`. This avoids making this helper
// depend on the iPlug types and keeps CTests SDK-free.

}  // namespace openaxe_vst3::state
