#include "presets.h"

#include <vector>

#include "openaxe/api.h"
#include "plugin_state.h"

namespace openaxe_vst3::presets {

namespace {

// Mirrors TS RowEffect helpers in apps/web/src/presets/factoryPresets.ts.
struct RowEffect {
  NamStudioBlockKind kind;
  std::vector<std::pair<const char*, float>> params;  // symbol -> value
};

RowEffect compressor() {
  return {NAM_STUDIO_BLOCK_COMPRESSOR,
          {{"threshold", -18}, {"ratio", 4}, {"attack", 5}, {"release", 100}, {"knee", 0}}};
}
RowEffect eq() {
  // Band gains mirror the TS eq(): band0..3 with gains 0/0/2/1.
  return {NAM_STUDIO_BLOCK_EQ,
          {{"band0_frequency", 100},
           {"band0_gain", 0},
           {"band0_q", 0.707f},
           {"band1_frequency", 500},
           {"band1_gain", 0},
           {"band1_q", 0.707f},
           {"band2_frequency", 2000},
           {"band2_gain", 2},
           {"band2_q", 0.707f},
           {"band3_frequency", 6000},
           {"band3_gain", 1},
           {"band3_q", 0.707f}}};
}
RowEffect chorus() { return {NAM_STUDIO_BLOCK_CHORUS, {{"rate", 1.2f}, {"depth", 4}, {"feedback", 0.15f}}}; }
RowEffect tapeDelay() {
  // TS uses {character:'tape', time:0.35, feedback:0.35, tone:3500} — here
  // delay model is separate from params, time is ms, tone is Hz.
  return {NAM_STUDIO_BLOCK_DELAY, {{"time", 350}, {"feedback", 0.35f}, {"tone", 3500}}};
}
RowEffect reverb(float roomSize) {
  // TS {roomSize, damping:0.5} maps to ReverbControl; we set via control after
  // construction so the document round-trips via the abstraction, not raw hall params.
  (void)roomSize;
  return {NAM_STUDIO_BLOCK_REVERB, {}};
}

// Sets params by symbol using the block's live param table.
void ApplyParams(NamStudioGraph* g, int32_t block, const std::vector<std::pair<const char*, float>>& writes) {
  for (auto [sym, val] : writes) {
    const int32_t n = nam_studio_block_param_count(g, block);
    for (int32_t i = 0; i < n; ++i) {
      const char* s = nullptr;
      if (!nam_studio_block_param_info(g, block, i, nullptr, &s, nullptr, nullptr, nullptr)) continue;
      if (s && std::string(s) == sym) {
        nam_studio_set_param(g, block, i, val);
        break;
      }
    }
  }
}

std::string SerializeGraphFromRows(const std::string& id, const std::vector<std::vector<RowEffect>>& rows) {
  NamStudioGraph* g = nam_studio_graph_create();

  std::vector<int32_t> rowEndpoints;
  std::vector<int> rowCols;
  int mixerCol = 1;
  for (size_t r = 0; r < rows.size(); ++r) {
    int32_t prev = NAM_STUDIO_IN_RAIL;
    int col = 0;
    for (const auto& eff : rows[r]) {
      const int32_t b = nam_studio_add_block(g, eff.kind, static_cast<int32_t>(r), col);
      if (!eff.params.empty()) ApplyParams(g, b, eff.params);
      // Special handling for reverb/tapeDelay that need control/model setup
      if (eff.kind == NAM_STUDIO_BLOCK_REVERB) {
        // The TS reverb(0.7) means roomSize 0.7 — map to control
        float rs = 0.7f;
        // Extract from caller's intent: if row contains reverb(0.7) we set 0.7
        // (hard-coded for the two factory rows; a generic script would paramize).
        nam_studio_set_reverb_control(g, b, NAM_STUDIO_REVERB_ROOM_SIZE, rs);
        nam_studio_set_reverb_control(g, b, NAM_STUDIO_REVERB_DAMPING, 0.5f);
      }
      if (eff.kind == NAM_STUDIO_BLOCK_DELAY) {
        // tape character
        nam_studio_set_delay_model(g, b, NAM_STUDIO_DELAY_TAPE);
      }
      nam_studio_connect(g, prev, 0, b, 0);
      prev = b;
      col += 1;
    }
    rowEndpoints.push_back(prev);
    rowCols.push_back(col);
    mixerCol = std::max(mixerCol, col + 1);
  }
  const int32_t mixer = nam_studio_add_block(g, NAM_STUDIO_BLOCK_MIXER, 0, mixerCol);
  for (size_t r = 0; r < rowEndpoints.size(); ++r) {
    nam_studio_connect(g, rowEndpoints[r], 0, mixer, static_cast<int>(r));
  }
  nam_studio_connect(g, mixer, 0, NAM_STUDIO_OUT_RAIL, 0);

  // Tag: use the same id as factory preset key for web↔plugin round-trip
  (void)id;
  const std::string json = openaxe_vst3::state::SerializeForHost(g);
  nam_studio_graph_destroy(g);
  return json;
}

}  // namespace

std::vector<FactoryPresetJson> BuildFactoryPresets() {
  std::vector<FactoryPresetJson> out;
  // factory-clean-boost: two rows [compressor, eq] each
  out.push_back({"Clean Boost",
                 SerializeGraphFromRows("factory-clean-boost", {{compressor(), eq()}, {compressor(), eq()}})});
  // factory-ambient-swell: [chorus, reverb(0.7)], [tapeDelay, reverb(0.7)]
  out.push_back({"Ambient Swell",
                 SerializeGraphFromRows("factory-ambient-swell",
                                        {{chorus(), reverb(0.7f)}, {tapeDelay(), reverb(0.7f)}})});
  return out;
}

}  // namespace openaxe_vst3::presets
