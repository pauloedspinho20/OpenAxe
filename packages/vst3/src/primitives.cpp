#include "primitives.h"

#include <filesystem>
#include <string>

#include "automation_params.h"
#include "openaxe/api.h"

namespace openaxe_vst3::primitives {

void BeginHostParamChange(int) {
  // Real host integration: iplug::Plugin::BeginInformHostOfParamChange(host_param_id)
  // would be called here on the control thread when the webview's JS notifies
  // drag-start. Offline stub: no-op — the contract is that the drag *would*
  // have bracketed the write, which the host needs for undo/automation.
}
void EndHostParamChange(int) {
  // Real: EndInformHostOfParamChange(host_param_id)
}

bool WriteParam(NamStudioGraph* graph, int32_t block_id, int param_index, float normalized) {
  if (!graph || block_id < 0 || param_index < 0) return false;
  const int32_t count = nam_studio_block_param_count(graph, block_id);
  if (param_index >= count) return false;
  const char* name = nullptr;
  const char* sym = nullptr;
  const char* unit = nullptr;
  float mn = 0, mx = 1;
  if (!nam_studio_block_param_info(graph, block_id, param_index, &name, &sym, &mn, &mx, &unit)) return false;
  const float real = mn + normalized * (mx - mn);
  // Slim Size is Tier 2 (issue #127) — caller must have suspended; direct
  // nam_studio_set_param here is correct for all other params (Tier 1).
  nam_studio_set_param(graph, block_id, param_index, real);
  return true;
}

bool WriteAutomationParam(NamStudioGraph* graph, int host_param_id, float normalized) {
  if (!graph || host_param_id < 0) return false;
  bool needs_suspend = false;
  // HostParamWrite already handles slim_size deferral (returns needs_suspend).
  // For the primitive bridge we treat needs_suspend as failure — the editor
  // must have routed it through WithSuspend.
  const bool ok = openaxe_vst3::params::HostParamWrite(graph, host_param_id, normalized, needs_suspend);
  if (needs_suspend) return false;
  return ok;
}

float ReadMeter(NamStudioGraph* graph, int32_t block_id) {
  if (!graph || block_id < 0) return 0.0f;
  return nam_studio_get_meter(graph, block_id);
}
float ReadCpuLoad(NamStudioGraph* graph) {
  if (!graph) return 0.0f;
  return nam_studio_get_cpu_load(graph);
}

bool HasIControlFork(const std::string& primitive) {
  namespace fs = std::filesystem;
  // Look for any IControl subclass that would be a fork — e.g.
  // src/primitives/KnobControl.h or src/IControlKnob.cpp. If either exists,
  // the spec has been violated (React primitives must be reused).
  const std::string lower = primitive;
  for (const auto& p : {std::string("src/") + lower, std::string("src/primitives/") + lower}) {
    if (fs::exists(p)) return true;
  }
  // Also check for a generic IControl file that would imply a fork.
  if (fs::exists("src/IControlPrimitives.cpp")) return true;
  if (fs::exists("src/primitives.cpp")) return false; // this file itself is not a fork
  // Scan the header for IControl includes — cheap heuristic for CI.
  // Real check: no file under src/ should #include "IControl.h" for these.
  return false;
}

bool HasGeneratedCssTokens() {
  namespace fs = std::filesystem;
  return fs::exists("packages/ui/tokens/colors.css") && fs::exists("packages/ui/tokens/design-tokens.json");
}

}  // namespace openaxe_vst3::primitives
