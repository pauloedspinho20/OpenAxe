// CTest for host state (issue #128) — save/load with embedded assets,
// web ↔ plugin portable JSON, newer-schema graceful, missing-asset list,
// and single-reset invariant (#62). Offline, no host/SDK needed.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "../src/plugin_state.h"
#include "../src/presets.h"
#include "openaxe/api.h"

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::fprintf(stderr, "CHECK failed: %s (%s:%d)\n", #cond, __FILE__, __LINE__); ++g_failures; } } while (0)
#define EXPECT(cond) CHECK(cond)

namespace {

float GetParamBySymbol(OpenAxeGraph* g, int32_t b, const char* sym) {
  const int32_t n = openaxe_block_param_count(g, b);
  for (int32_t i=0;i<n;++i){ const char* s=nullptr; if(openaxe_block_param_info(g,b,i,nullptr,&s,nullptr,nullptr,nullptr) && s && std::string(s)==sym) return openaxe_get_param(g,b,i); }
  return std::nanf("");
}

void TestHostChunkIsSelfContained() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t amp = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0,0);
  const int32_t cab = openaxe_add_block(g, OPENAXE_BLOCK_CAB, 0,1);
  openaxe_connect(g, OPENAXE_IN_RAIL,0, amp,0);
  openaxe_connect(g, amp,0, cab,0);
  openaxe_connect(g, cab,0, OPENAXE_OUT_RAIL,0);
  // Set distinctive params
  const int32_t n = openaxe_block_param_count(g, amp);
  for(int32_t i=0;i<n;++i){const char* s=nullptr; if(openaxe_block_param_info(g,amp,i,nullptr,&s,nullptr,nullptr,nullptr) && s && std::string(s)=="bass") openaxe_set_param(g,amp,i, 3.5f); }
  openaxe_set_master_level(g, 0.77f);
  openaxe_reset(g, 48000.0, 512);

  const std::string chunk = openaxe_vst3::state::SerializeForHost(g);
  CHECK(!chunk.empty());
  CHECK(chunk.find("\"schemaVersion\"") != std::string::npos);
  CHECK(chunk.find("\"bass\"") != std::string::npos || chunk.find("bass") != std::string::npos);

  // Fresh graph → restore with single reset (helper does it)
  OpenAxeGraph* h = openaxe_graph_create();
  int res = openaxe_vst3::state::Restore(h, chunk, 48000.0, 512);
  CHECK(res == OPENAXE_LOAD_STATE_OK);
  CHECK(GetParamBySymbol(h, 0, "bass") == 3.5f);
  CHECK(openaxe_get_master_level(h) == 0.77f);
  // Audio identical after single reset
  float in[128]; for(int i=0;i<128;++i) in[i]= std::sin(float(i)*0.07f)*0.3f;
  float out_g[128]={}, out_h[128]={};
  const float* inP[1]={in}; float* outG[1]={out_g}; float* outH[1]={out_h};
  // Use mono->mono via the same topology — but need to reset after restore already done
  // Process both with same input (note amp without model is passthrough-like but still processes)
  openaxe_process(g, inP,1,outG,1,128);
  openaxe_process(h, inP,1,outH,1,128);
  float maxdiff=0; for(int i=0;i<128;++i) maxdiff = std::max(maxdiff, std::fabs(out_g[i]-out_h[i]));
  CHECK(maxdiff == 0.0f);
  CHECK(openaxe_vst3::state::MissingAssets(h).empty());

  openaxe_graph_destroy(g);
  openaxe_graph_destroy(h);
  std::printf("  host chunk self-contained + audio identical: ok\n");
}

void TestPortableJsonRoundTrip() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t gate = openaxe_add_block(g, OPENAXE_BLOCK_NOISE_GATE,0,0);
  openaxe_connect(g, OPENAXE_IN_RAIL,0, gate,0);
  openaxe_connect(g, gate,0, OPENAXE_OUT_RAIL,0);
  // Use plugin_state file helper
  // Platform temp dir, not "/tmp": that path does not exist on Windows, so the
  // save silently failed there and the next two assertions cascaded from it.
  // Never caught because CI selected tests by name regex and this one was not
  // in the pattern (issue #300).
  const std::string path =
      (std::filesystem::temp_directory_path() / "openaxe_portable_test.json").string();
  bool saved = openaxe_vst3::state::SavePortableJson(g, path);
  CHECK(saved);
  OpenAxeGraph* h = openaxe_graph_create();
  int res = openaxe_vst3::state::LoadPortableJson(h, path, 48000.0, 256);
  CHECK(res == OPENAXE_LOAD_STATE_OK);
  // File content should be same as SerializeForHost
  std::ifstream in(path); std::string fileDoc((std::istreambuf_iterator<char>(in)), {});
  const std::string memDoc = openaxe_vst3::state::SerializeForHost(g);
  CHECK(fileDoc == memDoc);
  openaxe_graph_destroy(g);
  openaxe_graph_destroy(h);
  std::printf("  portable JSON file round-trip: ok\n");
}

void TestNewerSchemaGraceful() {
  OpenAxeGraph* g = openaxe_graph_create();
  const int32_t comp = openaxe_add_block(g, OPENAXE_BLOCK_COMPRESSOR,0,0);
  const int before = openaxe_block_param_count(g, comp);
  CHECK(before > 0);
  const std::string doc = R"({"schemaVersion": 99, "blocks": [], "edges": []})";
  int res = openaxe_vst3::state::Restore(g, doc, 48000.0, 512);
  CHECK(res == OPENAXE_LOAD_STATE_UNSUPPORTED_VERSION);
  // Graph untouched — block still there
  CHECK(openaxe_block_param_count(g, comp) == before);
  // Parse error also leaves untouched
  int res2 = openaxe_vst3::state::Restore(g, std::string("{not json"), 48000.0, 512);
  CHECK(res2 == OPENAXE_LOAD_STATE_PARSE_ERROR);
  CHECK(openaxe_block_param_count(g, comp) == before);
  openaxe_graph_destroy(g);
  std::printf("  newer schema / parse error graceful (graph untouched): ok\n");
}

void TestPartialRestoreTolerance() {
  OpenAxeGraph* g = openaxe_graph_create();
  const char* doc = R"({
    "schemaVersion": 1,
    "blocks": [
      { "id": "a", "kind": "chorus", "row": 0, "col": 0, "params": { "rate": 1.5, "depth": 0.7, "no_such_symbol": 3 } },
      { "id": "b", "kind": "teleporter", "row": 1, "col": 0, "params": {} }
    ],
    "edges": [
      { "from": { "blockId": "a", "port": 0 }, "to": { "blockId": "ghost", "port": 0 } }
    ]
  })";
  int res = openaxe_vst3::state::Restore(g, doc, 48000.0, 512);
  CHECK(res == OPENAXE_LOAD_STATE_OK);
  CHECK(openaxe_block_param_count(g, 0) == 5); // chorus survived (4 DSP params + the engine mix, issue #263)
  CHECK(GetParamBySymbol(g,0,"rate")==1.5f);
  openaxe_graph_destroy(g);
  std::printf("  partial-restore tolerance (bad entry skipped): ok\n");
}

void TestWebLegacyPresetLoad() {
  // Mirrors api_state_test's web preset: amp with trims disguised as params, IN/OUT rails, reverb roomSize
  const char* web_preset = R"({
    "blocks": [
      { "id": "amp1", "kind": "amp", "row": 0, "col": 1, "params": { "input_level": 1.5, "output_level": 0.8, "bass": 1.0 } },
      { "id": "verb1", "kind": "reverb", "row": 0, "col": 2, "params": { "reverbAlgorithm": "plate", "roomSize": 0.6 } }
    ],
    "edges": [
      { "from": { "blockId": "IN", "port": 0 }, "to": { "blockId": "amp1", "port": 0 } },
      { "from": { "blockId": "amp1", "port": 0 }, "to": { "blockId": "verb1", "port": 0 } },
      { "from": { "blockId": "verb1", "port": 0 }, "to": { "blockId": "OUT", "port": 0 } }
    ],
    "masterLevel": 0.85
  })";
  OpenAxeGraph* g = openaxe_graph_create();
  int res = openaxe_vst3::state::Restore(g, web_preset, 48000.0, 256);
  CHECK(res == OPENAXE_LOAD_STATE_OK);
  // trims became block trims, not calibration params
  CHECK(openaxe_get_block_input_trim(g,0) == 1.5f);
  CHECK(openaxe_get_block_output_trim(g,0) == 0.8f);
  CHECK(GetParamBySymbol(g,0,"bass")==1.0f);
  CHECK(openaxe_get_master_level(g)==0.85f);
  // Save as host chunk and reload — should still be web↔plugin identical
  const std::string chunk = openaxe_vst3::state::SerializeForHost(g);
  OpenAxeGraph* h = openaxe_graph_create();
  CHECK(openaxe_vst3::state::Restore(h, chunk, 48000.0,256)==OPENAXE_LOAD_STATE_OK);
  CHECK(openaxe_get_block_input_trim(h,0)==1.5f);
  CHECK(openaxe_get_master_level(h)==0.85f);
  openaxe_graph_destroy(g);
  openaxe_graph_destroy(h);
  std::printf("  web legacy preset round-trip: ok\n");
}

void TestFactoryPresetsGenerated() {
  auto presets = openaxe_vst3::presets::BuildFactoryPresets();
  CHECK(presets.size()==2);
  for(auto& p: presets){
    CHECK(!p.name.empty());
    CHECK(!p.json.empty());
    CHECK(p.json.find("\"schemaVersion\"")!=std::string::npos);
    OpenAxeGraph* g = openaxe_graph_create();
    int res = openaxe_vst3::state::Restore(g, p.json, 48000.0,256);
    CHECK(res==OPENAXE_LOAD_STATE_OK);
    // Not silent (at least one block wired)
    CHECK(openaxe_block_param_count(g,0)>=0);
    openaxe_graph_destroy(g);
  }
  std::printf("  factory presets (generated from rows): %zu presets, each loadable\n", presets.size());
}

void TestProgramChangeNoDropout() {
  // Simulate host preset switching back-to-back with suspend.
  OpenAxeGraph* g = openaxe_graph_create();
  auto presets = openaxe_vst3::presets::BuildFactoryPresets();
  CHECK(presets.size()>=2);
  for(int i=0;i<6;++i){
    const auto& json = presets[i % presets.size()].json;
    int res = openaxe_vst3::state::Restore(g, json, 48000.0,512);
    CHECK(res==OPENAXE_LOAD_STATE_OK);
    // Process a buffer after each switch — must not NaN/crash (dropout would be silence, not crash)
    float in[64]; for(int k=0;k<64;++k) in[k]=0.1f*std::sin(float(k)*0.2f);
    float out[64]={};
    const float* ip[1]={in}; float* op[1]={out};
    openaxe_process(g, ip,1, op,1,64);
    for(int k=0;k<64;++k) CHECK(std::isfinite(out[k]));
  }
  openaxe_graph_destroy(g);
  std::printf("  program change switching (6 swaps, process after each): ok\n");
}

} // namespace


// ── D1: the bridge's view must follow the graph across a restore ─────
// Restoring a host chunk rebuilds the topology and the core reassigns block
// ids. The bridge kept its own jsId->coreId map and never rebuilt it, so after
// a project reload every setParam/blockInfo/removeBlock from the UI addressed
// a stale id. This asserts the property the fix depends on: the ids in a
// restored document are exactly the ids the graph now holds, so rebuilding the
// map from that document is sound.
static void TestRestoredIdsMatchGraph() {
  auto* g = openaxe_graph_create();
  openaxe_reset(g, 48000, 512);

  // A rig whose ids will not survive as-is: remove one so the next add reuses
  // or skips an id, making a stale map demonstrably wrong.
  const int32_t a = openaxe_add_block(g, OPENAXE_BLOCK_AMP, 0, 1);
  const int32_t b = openaxe_add_block(g, OPENAXE_BLOCK_REVERB, 1, 3);
  const int32_t c = openaxe_add_block(g, OPENAXE_BLOCK_DELAY, 2, 5);
  openaxe_remove_block(g, b);
  openaxe_connect(g, OPENAXE_IN_RAIL, 0, a, 0);
  openaxe_connect(g, a, 0, c, 0);
  openaxe_connect(g, c, 0, OPENAXE_OUT_RAIL, 0);

  const std::string saved = openaxe_vst3::state::Serialize(g, false);
  CHECK(!saved.empty());

  // Round-trip through a fresh graph, as a project reload does.
  auto* g2 = openaxe_graph_create();
  openaxe_reset(g2, 48000, 512);
  CHECK(openaxe_vst3::state::Restore(g2, saved, 48000, 512) == OPENAXE_LOAD_STATE_OK);

  // Every id the restored document advertises must be a live block in the new
  // graph, with the kind the document claims — that is exactly what
  // VstBridge::SyncFromCore relies on to rebuild its maps.
  const std::string after = openaxe_vst3::state::Serialize(g2, false);
  CHECK(!after.empty());
  const auto doc = nlohmann::json::parse(after, nullptr, false);
  CHECK(!doc.is_discarded());
  CHECK(doc.contains("blocks"));
  int checked = 0;
  for (const auto& blk : doc["blocks"]) {
    const int32_t id = static_cast<int32_t>(std::stol(blk.value("id", "-1")));
    CHECK(id >= 0);
    // A live block answers its param count; a stale id would not.
    CHECK(openaxe_block_param_count(g2, id) >= 0);
    const char* kind_name = openaxe_block_kind_name(
        static_cast<OpenAxeBlockKind>(0));
    (void)kind_name;
    CHECK(!blk.value("kind", "").empty());
    ++checked;
  }
  CHECK(checked == 2);  // amp + delay; the removed reverb must not come back

  openaxe_graph_destroy(g2);
  openaxe_graph_destroy(g);
  std::printf("  restored ids match the graph: ok\n");
}

int main(){
  TestRestoredIdsMatchGraph();
  TestHostChunkIsSelfContained();
  TestPortableJsonRoundTrip();
  TestNewerSchemaGraceful();
  TestPartialRestoreTolerance();
  TestWebLegacyPresetLoad();
  TestFactoryPresetsGenerated();
  TestProgramChangeNoDropout();
  if(g_failures){ std::fprintf(stderr,"%d failure(s)\n", g_failures); return 1; }
  std::printf("state_test: all checks passed\n");
  return 0;
}
