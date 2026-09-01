#pragma once

// Automation parameter surface for the VST3 plugin (issue #127, depends on #121).
//
// This header mediates between the host's frozen, normalized (0..1) parameter
// ids and core's dynamic (slot, entry) automation map. It is the plugin-side
// companion to packages/core's AutomationSlotState and the generated map at
// generated/automation_param_map.h.
//
// Scope / stability notes (see packages/vst3/README.md's design note):
//   - Host ids are frozen API surface: changing them breaks every saved DAW
//     project that automated them. The generated header pins them and this
//     file must never invent a second layout.
//   - Slot 0 is permanently the master bus (level, mute). Slots 1..15 bind to
//     live blocks. Each slot exposes kParamsPerSlot entries whose display
//     name/range/unit resolve dynamically via openaxe_automation_slot_*.
//   - Values cross the boundary normalized 0..1 and map linearly onto the
//     resolved param's [min, max]. No non-linear shaping is done here today;
//     #127's issue notes that frequency/time params ultimately want log-ish
//     curves, but that requires host shape support (IParam::Shape) and a
//     per-param decision — linear remains the correct host contract until that
//     ships, so automation lanes remain meaningful across kinds.
//   - Host -> core for generic params lands via
//     openaxe_set_automation_param_normalized (lock-free). The one
//     exception is any Amp-family Slim Size write that resolved through a
//     slot — the ABI documents _that_ index as Tier 2, so it must be routed
//     through the control thread's suspend handshake (see plugin.h's
//     WithSuspend). This file's HostParamWrite helper codifies that split.
//   - Core -> host knob moves in the plugin's own editor must call
//     BeginInformHostOfParamChange / EndInformHostOfParamChange so the host
//     records automation. The editor will call NotifyHostParamChanged for
//     that.
//   - Reverb blocks automate through openaxe_set_reverb_control, not raw
//     params. The per-algorithm mapping is core's job; plugin wrappers just
//     forward the slot's normalized value through the reverb-control path when
//     the bound block is a reverb. That indirection lives here rather than in
//     core's generic slot path so hosts don't need to know about reverb
//     internals.
//   - The Amp family's input_level/output_level are NOT exposed as volume
//     controls. Those two symbols carry the loaded capture's dBu calibration;
//     writing to them recalibrates the amp. The per-block Input/Output trims
//     are the user-facing volume controls and live as separate block trims
//     (openaxe_set_block_input_trim / output_trim), not as generic params.
//     Host automation for "amp volume" should therefore target a separate
//     trim param set — which is a future chunk-format concern, not part of
//     this slot map. This header enforces that by never treating those two
//     symbols as automatable target for volume: callers should refuse to bind
//     or warn, not silently map them.

#include <algorithm>
#include <cmath>
#include <string>

#include "../generated/automation_param_map.h"
#include "openaxe/api.h"

// Forward-declare iPlug's types without pulling in IPlug headers when the SDK
// isn't present (smoke/latency builds still include this header for its
// helpers and the HostParamId layout test). When a format is being built
// (VST3_API/AU_API/CLAP_API), IPlug headers define `iplug::Plugin` as an
// alias to the format's base class, not a plain class — so we must not
// forward-declare it as a class in that case.
#if defined(VST3_API) || defined(AU_API) || defined(CLAP_API) || defined(STANDALONE_APP)
#include "IPlug_include_in_plug_hdr.h"
#else
namespace iplug {
class IParam;
class Plugin;
}  // namespace iplug
#endif

namespace openaxe_vst3::params {

// ── Host id <-> slot/entry ───────────────────────────────────────────────

inline constexpr int HostParamCount() { return openaxe::automation::kTotalPluginParams; }  // 302

// Maps a host param id (0..kTotalPluginParams-1) to (slot, entry). Returns
// false for out-of-range ids.
inline bool HostIdToSlotEntry(int host_id, int& out_slot, int& out_entry) {
  using namespace openaxe::automation;
  if (host_id < 0 || host_id >= kTotalPluginParams) return false;
  if (host_id < kMasterParamCount) {
    out_slot = kMasterSlotIndex;
    out_entry = host_id;
    return true;
  }
  const int block_off = host_id - kMasterParamCount;
  out_slot = kFirstBlockSlot + block_off / kParamsPerSlot;
  out_entry = block_off % kParamsPerSlot;
  return true;
}

inline int SlotEntryToHostId(int slot, int entry) {
  using namespace openaxe::automation;
  if (slot == kMasterSlotIndex) return entry;  // 0,1
  return SlotParamId(slot, entry);
}

// ── Normalized <-> real (linear, via min/max from the slot's descriptor) ─

inline float NormalizedToReal(float norm, float mn, float mx) {
  const float t = std::clamp(norm, 0.0f, 1.0f);
  return mn + t * (mx - mn);
}

inline float RealToNormalized(float real, float mn, float mx) {
  const float range = mx - mn;
  if (range == 0.0f) return 0.0f;
  return std::clamp((real - mn) / range, 0.0f, 1.0f);
}

// ── Display helper ───────────────────────────────────────────────────────
// Formats a host-visible string for the resolved slot entry (e.g. "-12.0 dB").
// Hosts call this for every automation lane / generic editor. Returns "—"
// when the entry resolves to nothing (unbound slot, beyond the block's table).
std::string DisplayForSlotEntry(OpenAxeGraph* graph, int slot, int entry, float normalized);

// ── Host -> core write ───────────────────────────────────────────────────
// Applies one host param write (host_id, normalized 0..1) to core. The
// Slim Size exception is enforced here: if the resolved entry's symbol is
// "slim_size" on an Amp-family block, this returns false so the caller MUST
// reroute the write through the control thread's suspend handshake
// (plugin.h:WithSuspend). All other cases forward lock-free and return true.
bool HostParamWrite(OpenAxeGraph* graph, int host_id, float normalized, bool& out_needs_suspend);

// ── Host param group name for host automation lists ──────────────────────
// Hosts group params by this string (VST3/AU/CLAP automation dialogs).
// "Master" for slot 0, "Slot N" for block slots.
std::string GroupForSlot(int slot);

// ── iPlug2 registration (only linked when the SDK is present) ───────────
#if defined(VST3_API) || defined(AU_API) || defined(CLAP_API) || defined(STANDALONE_APP)
// Declares the full stable 302-param list at construction from the generated
// table, with stable ids and groups so a host's automation list is navigable
// rather than 200 flat entries. Safe to call only from the main thread at
// Plugin construction (before any ProcessBlock).
void RegisterParams(iplug::Plugin& plugin);
#endif

}  // namespace openaxe_vst3::params
