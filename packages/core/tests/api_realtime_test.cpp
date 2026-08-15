// Real end-to-end test of the extern "C" real-time ABI (issue #14): builds
// an IN -> Amp -> Reverb -> OUT rig, loads an actual .nam model bundled with
// the NeuralAmpModelerCore submodule, and processes real audio through it.
// Only built if NAM_STUDIO_HAS_NAM_CORE && NAM_STUDIO_HAS_DRAGONFLY (see
// tests/CMakeLists.txt) - same WHOLE_ARCHIVE link requirement as
// nam_amp_test (NAMCore's architecture parsers self-register via static
// initializers with no other symbol referenced, so a plain static-archive
// link silently drops those object files otherwise).
#include "nam_studio/api.h"

#include <cmath>
#include <string>
#include <vector>

#include "test_harness.h"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr int32_t kBlockSize = 512;

void TestEndToEndAmpAndReverbRig() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t amp = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_AMP, 0, 0);
  const int32_t reverb = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 1);
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, amp, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, amp, 0, reverb, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, reverb, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);

  nam_studio_reset(graph, kSampleRate, kBlockSize);

  const std::string model_path = std::string(NAM_CORE_EXAMPLE_MODELS_DIR) + "/lstm.nam";
  NAM_EXPECT(nam_studio_load_nam_model(graph, amp, model_path.c_str()) == NAM_STUDIO_LOAD_OK);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 1);

  std::vector<float> input(kBlockSize, 0.0f);
  input[0] = 1.0f;  // impulse
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};

  bool any_nonzero = false;
  bool all_finite = true;
  for (int i = 0; i < 8; ++i) {  // several buffers - a reverb tail outlasts one impulse block
    nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);
    input[0] = 0.0f;  // impulse only on the very first buffer
    for (float sample : output) {
      if (!std::isfinite(sample)) all_finite = false;
      if (sample != 0.0f) any_nonzero = true;
    }
  }
  NAM_EXPECT(all_finite);
  NAM_EXPECT(any_nonzero);
  NAM_EXPECT(nam_studio_get_meter(graph, amp) >= 0.0f);
  NAM_EXPECT(nam_studio_get_cpu_load(graph) >= 0.0f);

  nam_studio_unload_nam_model(graph, amp);
  NAM_EXPECT(nam_studio_block_has_model(graph, amp) == 0);

  nam_studio_graph_destroy(graph);
}

void TestUnwrappedKindPassesAudioThrough() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t compressor = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_COMPRESSOR, 0, 0);
  NAM_EXPECT(nam_studio_block_param_count(graph, compressor) == 0);  // LSP Suite isn't wrapped yet
  NAM_EXPECT(nam_studio_connect(graph, NAM_STUDIO_IN_RAIL, 0, compressor, 0) >= 0);
  NAM_EXPECT(nam_studio_connect(graph, compressor, 0, NAM_STUDIO_OUT_RAIL, 0) >= 0);
  nam_studio_reset(graph, kSampleRate, kBlockSize);

  std::vector<float> input(kBlockSize, 0.3f);
  std::vector<float> output(kBlockSize, 0.0f);
  const float* in_ptrs[1] = {input.data()};
  float* out_ptrs[1] = {output.data()};
  nam_studio_process(graph, in_ptrs, 1, out_ptrs, 1, kBlockSize);

  for (float sample : output) NAM_EXPECT(sample == 0.3f);

  nam_studio_graph_destroy(graph);
}

void TestReverbAlgorithmSwitchOnlyAffectsThatBlock() {
  NamStudioGraph* graph = nam_studio_graph_create();

  const int32_t reverb_a = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 0, 0);
  const int32_t reverb_b = nam_studio_add_block(graph, NAM_STUDIO_BLOCK_REVERB, 1, 0);
  const int32_t hall_param_count = nam_studio_block_param_count(graph, reverb_a);
  NAM_EXPECT(hall_param_count == nam_studio_block_param_count(graph, reverb_b));

  nam_studio_set_reverb_algorithm(graph, reverb_a, NAM_STUDIO_REVERB_EARLY_REFLECTIONS);
  NAM_EXPECT(nam_studio_block_param_count(graph, reverb_a) != hall_param_count);
  NAM_EXPECT(nam_studio_block_param_count(graph, reverb_b) == hall_param_count);  // untouched

  const char* name = nullptr;
  const char* symbol = nullptr;
  float min_value = 0.0f, max_value = 0.0f;
  const char* unit = nullptr;
  NAM_EXPECT(nam_studio_block_param_info(graph, reverb_a, 0, &name, &symbol, &min_value, &max_value,
                                          &unit) == 1);
  NAM_EXPECT(name != nullptr);

  nam_studio_graph_destroy(graph);
}

void TestUnknownBlockCallsAreSafeNoOps() {
  NamStudioGraph* graph = nam_studio_graph_create();

  NAM_EXPECT(nam_studio_block_param_count(graph, 999) == 0);
  NAM_EXPECT(nam_studio_get_param(graph, 999, 0) == 0.0f);
  nam_studio_set_param(graph, 999, 0, 1.0f);  // must not crash
  NAM_EXPECT(nam_studio_get_meter(graph, 999) == 0.0f);
  NAM_EXPECT(nam_studio_block_has_model(graph, 999) == 0);
  NAM_EXPECT(nam_studio_load_nam_model(graph, 999, "/does/not/matter.nam") ==
             NAM_STUDIO_LOAD_FILE_NOT_FOUND);
  nam_studio_remove_block(graph, 999);       // must not crash
  nam_studio_disconnect(graph, 999);         // must not crash

  nam_studio_graph_destroy(graph);
}

}  // namespace

int main() {
  TestEndToEndAmpAndReverbRig();
  TestUnwrappedKindPassesAudioThrough();
  TestReverbAlgorithmSwitchOnlyAffectsThatBlock();
  TestUnknownBlockCallsAreSafeNoOps();

  return nam_studio::test::g_failures == 0 ? 0 : 1;
}
