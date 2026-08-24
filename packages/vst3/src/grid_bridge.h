#pragma once

// Grid / cables / block inspector bridge for the plugin — issue #134.
// Hosts the shared React GridEditor + BlockInspector via the webview
// shell (editor.{h,cpp}). The React components already exist in
// apps/web/src/components/grid/*; the plugin reuses them — no native
// grid/cable rendering, no third copy of validation rules.
//
// Contract (mirrors apps/desktop/src/bridge.cpp and the web
// engine's GraphRig, but via the plugin's suspend handshake):
//  - Grid dims are read from packages/core/include/openaxe/grid_config.h
//    (scripts/check-grid-dims.mjs), never hardcoded.
//  - Block cards show kind, bypass, meter, model/IR name.
//  - Cables use IN/OUT rails (NAM_STUDIO_IN_RAIL=-1, OUT_RAIL=-2).
//  - Drag-to-connect calls nam_studio_connect and honours -1 (rejected).
//  - Add/remove/move via WithSuspend (Tier 2, like desktop's Mutate).
//  - Inspector builds params dynamically from nam_studio_block_param_*.
//  - Automation slot binding via nam_studio_bind_automation_slot.
//  - Rendering cost: React memoization (not whole-grid re-render per knob).
// This header is SDK-free for offline CTests.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

struct NamStudioGraph;

namespace openaxe_vst3::grid {

// ── Grid dims (never hardcoded, read from core) ────────────────────────
struct GridDims {
  int rows = 4;
  int cols = 10;
};
GridDims GetGridDims();

// ── Block card (what the React card renders) ───────────────────────────
struct BlockCard {
  int32_t id = -1;
  std::string kind; // e.g. "amp", "cab", "delay"
  int row = 0;
  int col = 0;
  bool bypassed = false;
  float meter = 0.0f;
  bool has_model = false;
  std::string model_name; // from asset source if loaded
  bool has_ir = false;
  int ir_length = 0;
};

// ── Cable (jack endpoints, rails as -1/-2) ─────────────────────────────
struct Cable {
  int32_t id = -1;
  int32_t from_block = -1; // -1 = IN rail, -2 = OUT rail sentinel handled by caller
  int from_port = 0;
  int32_t to_block = -1;
  int to_port = 0;
};

// ── Inspector param (one row in BlockInspector) ────────────────────────
struct InspectorParam {
  int32_t index = -1;
  std::string name;
  std::string symbol;
  float min = 0;
  float max = 1;
  std::string unit;
  float value = 0;
};

// ── Operations (Tier 2 — caller must have suspended, e.g. via
//    OpenAxePlugin::WithSuspend). Offline tests call them directly with a
//    suspended-like guarantee (single-threaded, no concurrent Process).
//    Return -1 on rejection / unknown.

int32_t AddBlock(NamStudioGraph* graph, const std::string& kind_str, int row, int col);
bool RemoveBlock(NamStudioGraph* graph, int32_t block_id);
bool MoveBlock(NamStudioGraph* graph, int32_t block_id, int row, int col);
int32_t Connect(NamStudioGraph* graph, int32_t from_block, int from_port, int32_t to_block, int to_port);
bool Disconnect(NamStudioGraph* graph, int32_t edge_id);

std::optional<BlockCard> GetBlockCard(NamStudioGraph* graph, int32_t block_id);
std::vector<BlockCard> ListBlockCards(NamStudioGraph* graph);
std::vector<Cable> ListCables(NamStudioGraph* graph);

std::vector<InspectorParam> GetInspectorParams(NamStudioGraph* graph, int32_t block_id);
bool SetInspectorParam(NamStudioGraph* graph, int32_t block_id, int32_t param_index, float value);

// Automation slot binding from the inspector (issue #127 slot map).
bool BindAutomationSlot(NamStudioGraph* graph, int slot, int32_t block_id);
bool UnbindAutomationSlot(NamStudioGraph* graph, int slot);

}  // namespace openaxe_vst3::grid
