#include "automation_params.h"

#include <cstdio>
#include <cstring>

#if defined(VST3_API) || defined(AU_API) || defined(STANDALONE_APP) || defined(CLAP_API)
#include "IPlug_include_in_plug_hdr.h"
#endif

namespace openaxe_vst3::params {

std::string DisplayForSlotEntry(OpenAxeGraph* graph, int slot, int entry, float normalized) {
  const char* name = nullptr;
  const char* symbol = nullptr;
  float mn = 0.0f, mx = 1.0f;
  const char* unit = nullptr;
  const int32_t ok = openaxe_automation_slot_param_info(graph, slot, entry, &name, &symbol, &mn, &mx, &unit);
  if (ok == 0 || !symbol) return std::string("—");
  const float real = NormalizedToReal(normalized, mn, mx);
  char buf[64];
  // Hosts show "-12.0 dB" not "0.42" (issue #127); format with unit when present.
  if (unit && unit[0] != '\0')
    std::snprintf(buf, sizeof(buf), "%.2f %s", real, unit);
  else
    std::snprintf(buf, sizeof(buf), "%.2f", real);
  return std::string(buf);
}

bool HostParamWrite(OpenAxeGraph* graph, int host_id, float normalized, bool& out_needs_suspend) {
  out_needs_suspend = false;
  int slot = -1, entry = -1;
  if (!HostIdToSlotEntry(host_id, slot, entry)) return false;

  const char* symbol = nullptr;
  float mn = 0.0f, mx = 1.0f;
  const char* unit = nullptr;
  // Peek the symbol to catch the Slim Size Tier-2 case. When the slot is
  // unbound this resolves to nothing — fall through to the generic
  // normalized write path anyway so the slot's remembered value updates.
  const int32_t has_info =
      openaxe_automation_slot_param_info(graph, slot, entry, nullptr, &symbol, &mn, &mx, &unit);
  if (has_info != 0 && symbol && std::strcmp(symbol, "slim_size") == 0) {
    // Amp-family slim_size is Tier 2 (may reallocate in NAMCore). The ABI
    // documents openaxe_set_param for this index as NOT real-time safe.
    // Caller must reroute via WithSuspend + openaxe_set_param on the
    // underlying block, not via the slot's normalized path either (both end
    // in the same NAMCore call). Signal that back.
    out_needs_suspend = true;
    return false;
  }

  // Normal lock-free path — also updates the slot's remembered value when
  // unbound, per the automation slot spec (issue #121).
  openaxe_set_automation_param_normalized(graph, slot, entry, normalized);
  return true;
}

std::string GroupForSlot(int slot) {
  using namespace openaxe::automation;
  if (slot == kMasterSlotIndex) return "Master";
  char buf[32];
  std::snprintf(buf, sizeof(buf), "Slot %d", slot);
  return std::string(buf);
}

#if defined(VST3_API) || defined(AU_API) || defined(STANDALONE_APP) || defined(CLAP_API)
void RegisterParams(iplug::Plugin& plugin) {
  using namespace openaxe::automation;
  // iPlug's Plugin is also an IEditorDelegate: GetParam / InitParamRange etc.
  // Declare exactly kTotalPluginParams stable ids, grouped per slot so hosts
  // show "Master" + "Slot 1" .. "Slot 15" sections rather than 302 flat rows.
  //
  // The constructor already allocates all kTotalPluginParams IParam objects
  // (MakeConfig(HostParamCount(), kNumPresets) in plugin.cpp); this function
  // *initialises* them. Before issue #390 the Init calls below were commented
  // out, so every slot kept its uninitialised [0,1] default, the host saw
  // unnamed parameters, and automation recorded nothing the core understood.
  //
  // Exact API is the pinned iPlug2 d54f690:
  //   IParam::InitDouble(name, default, min, max, step, label, flags, group,
  //                      shape, unit, displayFunc)   (IPlugParameter.h)
  //   IPlugPluginBase::InitParamRange(start, end, countStart, nameFmt, ...)
  // `label` is the unit suffix the host appends to the value; `group` is the
  // automation-list section name. Both are strcpy'd by InitDouble, so the
  // temporaries below are safe.

  // Master slot: fixed descriptors from the generated header. Their min/max
  // come straight from param_schema.json's masterSlot.params, normalized
  // default already provided there. kMasterLabels is the host-facing name
  // ("Master Level" / "Master Mute"); kMasterSymbols are the internal core
  // symbols and stay out of the host UI.
  const std::string master_group = GroupForSlot(kMasterSlotIndex);
  for (int e = 0; e < kMasterParamCount; ++e) {
    const int host_id = SlotEntryToHostId(kMasterSlotIndex, e);
    const double mn = kMasterMin[e];
    const double mx = kMasterMax[e];
    const double def = mn + kMasterDefaultNormalized[e] * (mx - mn);
    plugin.GetParam(host_id)->InitDouble(kMasterLabels[e], def, mn, mx, 0.01,
                                         kMasterUnits[e], 0, master_group.c_str());
  }

  // Block slots: kParamsPerSlot generic entries per slot, one contiguous
  // InitParamRange per slot. Hosts see "Param 1" .. "Param 20" placeholders
  // until a block is bound and the title-change notification fires (VST3
  // restartComponent, etc.). Ranges are seeded generically [0,1] here and
  // resolved dynamically on each write — the host always sends normalized
  // 0..1 anyway, so the lane's real units live in the block descriptor, not
  // in the IParam. A per-entry display hook would need the live graph, which
  // is not available at declaration time; the host's default readout is used
  // instead.
  for (int slot = kFirstBlockSlot; slot < kSlotCount; ++slot) {
    const std::string group = GroupForSlot(slot);
    const int first = SlotParamId(slot, 0);
    const int last = SlotParamId(slot, kParamsPerSlot - 1);
    plugin.InitParamRange(first, last, 1, "Param %d", 0.0, 0.0, 1.0, 0.01, "", 0,
                          group.c_str());
  }

  // Host -> core and Core -> host wiring beyond declaration:
  //   - Plugin::OnParamChange(int paramIdx) will call HostParamWrite with the
  //     already-normalized value the host hands us (GetParam(paramIdx)->GetNormalized()).
  //     If out_needs_suspend is true, it reroutes via WithSuspend on the
  //     control thread; otherwise it already applied lock-free.
  //   - Knob moves from the plugin's own editor must bracket with
  //     BeginInformHostOfParamChange(paramIdx) / EndInformHostOfParamChange.
  //   - Title changes on rebind fire restartComponent(kParamTitlesChanged)
  //     (VST3), kAudioUnitProperty_ParameterList (AU), or
  //     params_rescan(CLAP_PARAM_RESCAN_VALUES|TEXT) (CLAP).
}

#endif

}  // namespace openaxe_vst3::params
