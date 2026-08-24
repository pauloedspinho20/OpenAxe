#pragma once

// Shared React primitives for the plugin — issue #133.
// No IControl fork: the plugin reuses packages/ui React primitives
// (Knob, Fader, Meter, Toggle, Led, HardwareButton, Panel) directly
// via the webview shell (editor.{h,cpp}). This header documents that
// contract and exposes the pure-logic bridge that makes it work.
//
// Previous scope (IControl vector graphics, tokens.h) is kept for
// history in the issue — not the plan. The visual spec remains
// packages/ui/src/primitives/*.module.css and the Storybook stories;
// dimensions/colors come from CSS custom properties generated from
// design-tokens.json (issue #131), not a C++ tokens.h for IGraphics.
//
// What the plugin must still guarantee for each primitive:
//  - Knob/Fader/Toggle: param → nam_studio_set_param (or automation slot
//    → SetAutomationParamNormalized) with host automation gestures
//    (BeginInformHostOfParamChange on drag start, End on release) so
//    recording doesn't drop writes.
//  - Meter: meter → nam_studio_get_meter (same ballistics as web).
//  - Panel: layout container, no bridge.
// This header is SDK-free so the contract can be exercised offline.
// When OPENAXE_HAS_WEBVIEW is set, the editor's window.openAxe.* bindings
// forward to these helpers under the suspend handshake where needed.

#include <cstdint>
#include <string>

struct NamStudioGraph;

namespace openaxe_vst3::primitives {

// ── Host automation gesture (issue #133) ───────────────────────────────
// A drag must bracket the normalized write with begin/end so the host
// captures an undo step and records automation. The plugin forwards these
// to the host's IParam mechanism (iPlug: BeginInformHostOfParamChange /
// EndInformHostOfParamChange). Offline tests stub them as no-ops.
void BeginHostParamChange(int host_param_id);
void EndHostParamChange(int host_param_id);

// ── Param bridge (Knob / Fader / Toggle) ──────────────────────────────
// Normalized 0..1 value from the React primitive → core param.
// For automation slots the host id's normalized value is already 0..1;
// for direct block params we map through the block's [min,max] (same as
// automation_params::NormalizedToReal). Tier 1: lock-free; slim_size is
// Tier 2 and must go through the editor's WithSuspend.
bool WriteParam(NamStudioGraph* graph, int32_t block_id, int param_index, float normalized_value);
bool WriteAutomationParam(NamStudioGraph* graph, int host_param_id, float normalized_value);

// ── Meter bridge (Meter / Led) ────────────────────────────────────────
// Peak |sample| over the last Process() call — same ballistics the web
// meter uses. Cheap read, never blocks the audio thread.
float ReadMeter(NamStudioGraph* graph, int32_t block_id);
float ReadCpuLoad(NamStudioGraph* graph);

// ── Visual spec guard ─────────────────────────────────────────────────
// Returns true if a C++ IControl fork for the named primitive exists
// under packages/vst3/src — it must not. The plugin must reuse the React
// primitives; a fork would duplicate the visual spec and blur at fractional
// DPI.
bool HasIControlFork(const std::string& primitive_name);

// ── Token provenance ──────────────────────────────────────────────────
// Dimensions/colors for the React primitives come from CSS custom
// properties generated from design-tokens.json (issue #131). This helper
// reports whether the generated CSS is available — the editor's React
// bundle imports it via packages/ui/tokens/index.css.
bool HasGeneratedCssTokens();

}  // namespace openaxe_vst3::primitives
